import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchChrome, InfraError } from './cdp.js';
import { listen } from './server.js';
import { SCREENS } from './screens.js';
import { determinismSource } from './page-determinism.js';
import { comparePng } from './png.js';

var HERE = path.dirname(fileURLToPath(import.meta.url));
var BASELINE = path.join(HERE, 'baseline');
var ACTUAL = path.resolve(HERE, '../../tmp/ui-check/actual');
var CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
var TOTAL_TIMEOUT = Number(process.env.UI_CHECK_TIMEOUT_MS) || 180000;
var WAIT_MS = 10000, NAV_MS = 15000, MAX_PX = 16384;
var UPDATE = process.argv.includes('--update');
var ONLY = process.argv.slice(2).filter(function (a) { return !a.startsWith('--'); });
var INJECT = {};
(process.env.UI_CHECK_INJECT || '').split('\n').filter(Boolean).forEach(function (s) {
  var i = s.indexOf(':');
  INJECT[s.slice(0, i)] = s.slice(i + 1);
});

function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

// ページ内で selector+text に合致する可視要素の件数を返す式
function countExpr(sel, text) {
  return '(function(s,t){return Array.from(document.querySelectorAll(s)).filter(function(e){' +
    'return e.getClientRects().length>0&&(!t||e.textContent.indexOf(t)>=0)}).length})(' + JSON.stringify(sel) + ',' + JSON.stringify(text || null) + ')';
}

async function runScreen(conn, origin, screen, update) {
  var ctx = await conn.send('Target.createBrowserContext', {});
  var ctxId = ctx.browserContextId;
  var targetId = (await conn.send('Target.createTarget', { url: 'about:blank', browserContextId: ctxId })).targetId;
  var sid = (await conn.send('Target.attachToTarget', { targetId: targetId, flatten: true })).sessionId;
  var send = function (m, p, t) { return conn.send(m, p, sid, t); };
  var consoleErrors = [], external = [], dialogs = [];
  var loadWaiters = [];
  var off = conn.onEvent(function (method, p, s) {
    if (s !== sid) return;
    if (method === 'Runtime.exceptionThrown') consoleErrors.push(p.exceptionDetails.exception ? p.exceptionDetails.exception.description : p.exceptionDetails.text);
    else if (method === 'Runtime.consoleAPICalled' && p.type === 'error') consoleErrors.push(p.args.map(function (a) { return a.value !== undefined ? a.value : a.description; }).join(' '));
    else if (method === 'Log.entryAdded' && p.entry.level === 'error') consoleErrors.push(p.entry.text + (p.entry.url ? ' ' + p.entry.url : ''));
    else if (method === 'Page.javascriptDialogOpening') {
      dialogs.push(p.message);
      send('Page.handleJavaScriptDialog', { accept: false }).catch(function () {});
    } else if (method === 'Page.loadEventFired') loadWaiters.splice(0).forEach(function (f) { f(); });
    else if (method === 'Fetch.requestPaused') {
      var u = p.request.url;
      if (u.indexOf(origin) === 0) send('Fetch.continueRequest', { requestId: p.requestId }).catch(function () {});
      else if (p.resourceType === 'Image') {
        send('Fetch.fulfillRequest', { requestId: p.requestId, responseCode: 200, responseHeaders: [{ name: 'Content-Type', value: 'image/png' }],
          body: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==' }).catch(function () {});
      } else {
        external.push(u);
        send('Fetch.failRequest', { requestId: p.requestId, errorReason: 'BlockedByClient' }).catch(function () {});
      }
    }
  });
  var evalJs = async function (expr, awaitPromise) {
    var r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: !!awaitPromise });
    if (r.exceptionDetails) throw new Error('評価エラー: ' + (r.exceptionDetails.exception && r.exceptionDetails.exception.description || r.exceptionDetails.text));
    return r.result.value;
  };
  var waitCount = async function (sel, text, min) {
    var end = Date.now() + WAIT_MS;
    for (;;) {
      if (await evalJs(countExpr(sel, text)) >= min) return true;
      if (Date.now() > end) return false;
      await sleep(100);
    }
  };
  var fail = function (reason) { return { id: screen.id, ok: false, reason: reason }; };
  var missing = async function (list, wait) {
    for (var i = 0; i < list.length; i++) {
      var r = list[i], min = r[2] || 1;
      var ok = wait ? await waitCount(r[0], r[1], min) : (await evalJs(countExpr(r[0], r[1]))) >= min;
      if (!ok) return r[0] + (r[1] ? ' (' + r[1] + ')' : '');
    }
    return null;
  };
  try {
    await Promise.all(['Page.enable', 'Runtime.enable', 'Log.enable'].map(function (m) { return send(m); }));
    await send('Fetch.enable', { patterns: [{ urlPattern: '*' }] });
    await send('Page.addScriptToEvaluateOnNewDocument', { source: determinismSource });
    await send('Emulation.setDeviceMetricsOverride', { width: screen.viewport.width, height: screen.viewport.height, deviceScaleFactor: 1, mobile: false });
    await send('Emulation.setTimezoneOverride', { timezoneId: 'Asia/Tokyo' });
    await send('Emulation.setLocaleOverride', { locale: 'ja-JP' });

    var loaded = new Promise(function (resolve, reject) {
      loadWaiters.push(resolve);
      setTimeout(function () { reject(new InfraError('ナビゲーションタイムアウト')); }, NAV_MS).unref();
    });
    await send('Page.navigate', { url: origin + (screen.start === 'report' ? '/__preview/' : '/') });
    await loaded;
    if (screen.start === 'report') {
      var navEnd = Date.now() + NAV_MS;
      for (;;) {
        try { if (await evalJs('location.pathname==="/"&&document.readyState==="complete"')) break; } catch (e) { if (e instanceof InfraError) throw e; }
        if (Date.now() > navEnd) throw new InfraError('ナビゲーションタイムアウト(/ への遷移)');
        await sleep(100);
      }
    }

    for (var i = 0; i < screen.ops.length; i++) {
      var op = screen.ops[i], kind = Object.keys(op)[0], a = op[kind];
      if (!(await waitCount(a[0], kind === 'click' ? a[1] : null, 1))) return fail('必須要素なし ' + a[0]);
      if (kind === 'scroll') {
        await evalJs('document.querySelector(' + JSON.stringify(a[0]) + ').scrollIntoView({block:"center"})');
      } else if (kind === 'click') {
        await evalJs('(function(s,t){var e=Array.from(document.querySelectorAll(s)).filter(function(e){return e.getClientRects().length>0&&(!t||e.textContent.indexOf(t)>=0)})[0];e.click()})(' + JSON.stringify(a[0]) + ',' + JSON.stringify(a[1] || null) + ')');
      } else {
        await evalJs('(function(s,v){var e=document.querySelector(s);e.value=v;e.dispatchEvent(new Event("input",{bubbles:true}))})(' + JSON.stringify(a[0]) + ',' + JSON.stringify(a[1]) + ')');
      }
    }

    var m = await missing(screen.required, true);
    if (m) return fail('必須要素なし ' + m);
    if (INJECT[screen.id]) await evalJs(INJECT[screen.id]);
    m = await missing(screen.required, false);
    if (m) return fail('必須要素なし ' + m);

    await evalJs('Promise.race([new Promise(function(r){setTimeout(r,5000)}),Promise.all([document.fonts.ready].concat(Array.from(document.images).map(function(i){i.loading="eager";return i.complete?1:new Promise(function(r){i.onload=i.onerror=r})})))]).then(function(){window.scrollTo(0,0);return new Promise(function(r){requestAnimationFrame(function(){requestAnimationFrame(r)})})})', true);

    var shot = async function () {
      var p = { format: 'png' };
      if (screen.full) {
        var h = await evalJs('Math.max(document.documentElement.scrollHeight,document.body.scrollHeight)');
        if (h > MAX_PX) throw new Error('高さ ' + h + 'px が上限 ' + MAX_PX + ' を超える');
        p.captureBeyondViewport = true;
        p.clip = { x: 0, y: 0, width: screen.viewport.width, height: h, scale: 1 };
      }
      return Buffer.from((await send('Page.captureScreenshot', p)).data, 'base64');
    };
    var prev = await shot(), png = null;
    for (var n = 0; n < 12 && !png; n++) {
      await sleep(250);
      var cur = await shot();
      if (cur.equals(prev)) png = cur; else prev = cur;
    }
    if (!png) return fail('画面が安定しない');

    fs.mkdirSync(ACTUAL, { recursive: true });
    fs.writeFileSync(path.join(ACTUAL, screen.id + '.png'), png);
    if (external.length) return fail('外部リクエスト ' + external[0]);
    if (dialogs.length) return fail('ダイアログ ' + dialogs[0]);
    if (consoleErrors.length) return fail('console エラー ' + consoleErrors[0]);

    var basePath = path.join(BASELINE, screen.id + '.png');
    if (update) {
      fs.mkdirSync(BASELINE, { recursive: true });
      fs.writeFileSync(basePath, png);
    } else if (!fs.existsSync(basePath)) {
      return fail('基準画像なし');
    } else {
      var base = fs.readFileSync(basePath);
      if (!base.equals(png)) {
        var c = comparePng(base, png);
        if (c.sizeMismatch) return fail('基準画像と不一致 (サイズ違い: 基準 ' + c.a.join('x') + ' / 実 ' + c.b.join('x') + ')');
        if (!c.equal) return fail('基準画像と不一致 (' + c.diffCount + ' px, bbox ' + c.bbox.x + ',' + c.bbox.y + ' ' + c.bbox.w + 'x' + c.bbox.h + ')');
      }
    }
    return { id: screen.id, ok: true };
  } finally {
    off();
    await conn.send('Target.disposeBrowserContext', { browserContextId: ctxId }).catch(function () {});
  }
}

async function main() {
  var known = SCREENS.map(function (s) { return s.id; });
  var unknown = ONLY.concat(Object.keys(INJECT)).filter(function (id) { return !known.includes(id); });
  if (unknown.length) throw new InfraError('存在しない画面 id: ' + unknown.join(', '));
  var screens = SCREENS.filter(function (s) { return !ONLY.length || ONLY.includes(s.id); });
  if (!screens.length) throw new InfraError('対象の画面が0件');
  var userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'catalyzer-ui-check-'));
  var chrome = null, srv = null;
  var cleanup = function () {
    if (chrome) chrome.kill();
    if (srv) srv.server.close();
    try { fs.rmSync(userDataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); } catch (e) {}
  };
  var timer = setTimeout(function () {
    console.log('ui-check: 全体タイムアウト ' + TOTAL_TIMEOUT + 'ms');
    cleanup();
    process.exit(2);
  }, TOTAL_TIMEOUT);
  ['SIGINT', 'SIGTERM'].forEach(function (sig) {
    process.on(sig, function () { cleanup(); process.exit(130); });
  });
  try {
    if (ONLY.length) screens.forEach(function (s) { fs.rmSync(path.join(ACTUAL, s.id + '.png'), { force: true }); });
    else fs.rmSync(ACTUAL, { recursive: true, force: true });
    srv = await listen(0);
    chrome = await launchChrome(CHROME, userDataDir);
    var origin = 'http://127.0.0.1:' + srv.port;
    var metaPath = path.join(BASELINE, 'meta.json');
    if (!UPDATE && fs.existsSync(metaPath)) {
      var meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
      if (meta.chrome !== chrome.version) console.log('WARN Chrome ' + chrome.version + ' は基準 (' + meta.chrome + ') と異なる。不一致は環境差の可能性');
    }
    var okCount = 0;
    for (var i = 0; i < screens.length; i++) {
      var r;
      try {
        r = await runScreen(chrome.conn, origin, screens[i], UPDATE);
      } catch (e) {
        if (e instanceof InfraError) throw e;
        r = { id: screens[i].id, ok: false, reason: e.message };
      }
      console.log(r.ok ? 'OK ' + r.id : 'FAIL ' + r.id + ': ' + r.reason);
      if (r.ok) okCount++;
    }
    if (UPDATE) {
      fs.writeFileSync(path.join(BASELINE, 'meta.json'), JSON.stringify({ chrome: chrome.version, platform: process.platform + '-' + process.arch }, null, 2) + '\n');
    }
    console.log('ui-check: ' + okCount + '/' + screens.length + ' OK');
    return okCount === screens.length ? 0 : 1;
  } finally {
    clearTimeout(timer);
    cleanup();
  }
}

main().then(function (code) { process.exit(code); }, function (e) {
  console.log('ui-check: 基盤エラー: ' + e.message);
  process.exit(2);
});
