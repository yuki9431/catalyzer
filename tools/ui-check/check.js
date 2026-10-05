import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchChrome, InfraError } from './cdp.js';
import { listen } from './server.js';
import { SCREENS, THEMES } from './screens.js';
import { determinismSource } from './page-determinism.js';
import { comparePng } from './png.js';

var HERE = path.dirname(fileURLToPath(import.meta.url));
var BASELINE = path.join(HERE, 'baseline');
var ACTUAL = path.resolve(HERE, '../../tmp/ui-check/actual');
var CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
var TOTAL_TIMEOUT = Number(process.env.UI_CHECK_TIMEOUT_MS) || 300000;
var WAIT_MS = 10000, NAV_MS = 15000, MAX_PX = 16384;
var UPDATE = process.argv.includes('--update');
var ONLY = process.argv.slice(2).filter(function (a) { return !a.startsWith('--'); });
var START_URL = { login: '/', report: '/__preview/', parts: '/__preview/parts.html' };
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

// selector+text の最初の可視要素の中心がビューポート内にあり、その点の最前面が自身か子孫かを返す式（無ければ false）
function inviewExpr(sel, text) {
  return '(function(s,t){var e=Array.from(document.querySelectorAll(s)).filter(function(e){' +
    'return e.getClientRects().length>0&&(!t||e.textContent.indexOf(t)>=0)})[0];if(!e)return false;' +
    'var r=e.getBoundingClientRect(),x=r.left+r.width/2,y=r.top+r.height/2;' +
    'if(x<0||y<0||x>innerWidth||y>innerHeight)return false;var top=document.elementFromPoint(x,y);' +
    'return !!top&&(top===e||e.contains(top))})(' + JSON.stringify(sel) + ',' + JSON.stringify(text || null) + ')';
}

// 上部バーの下端+下部タブバーの高さ(fixed)と、タブ行の上に残る帯の高さ(band)を返す式。対象が無ければ fixed=-1
var FIXED_EXPR = '(function(){var bar=document.querySelector(\'[data-ui="topbar"]\'),tab=document.querySelector(\'[data-ui="tabbar"]\');' +
  'if(!bar||!tab)return{fixed:-1,band:0};var H=innerHeight,cl=function(v){return Math.min(Math.max(v,0),H)};' +
  'var br=bar.getBoundingClientRect(),tr=tab.getBoundingClientRect(),tl=bar.querySelector(\'[role="tablist"]\');' +
  'return{fixed:Math.round(cl(br.bottom)+cl(H-tr.top)),band:tl?Math.round(tl.getBoundingClientRect().top-Math.max(0,br.top)):0}})()';

// 画面の左右端をまたぐ要素（横スクロールする祖先の中と、全体が画面外のものは除く）の最初の1件を返す式
var OVERFLOW_EXPR = '(function(){var W=innerWidth,all=document.body.querySelectorAll("*");' +
  'for(var i=0;i<all.length;i++){var e=all[i],r=e.getBoundingClientRect();if(r.width<1||r.height<1)continue;' +
  'if(!((r.left<-1&&r.right>0)||(r.right>W+1&&r.left<W)))continue;if(getComputedStyle(e).visibility==="hidden")continue;' +
  'for(var p=e.parentElement;p&&p!==document.body;p=p.parentElement){if(getComputedStyle(p).overflowX!=="visible")break}' +
  'if(p&&p!==document.body)continue;' +
  'return e.tagName.toLowerCase()+(e.className&&typeof e.className==="string"?"."+e.className.trim().split(/\\s+/).join("."):"")+" (x "+Math.round(r.left)+"〜"+Math.round(r.right)+", 画面幅 "+W+")"}' +
  'return null})()';

// 表示中の全テキスト(::before/::after を含む)の最小 font-size が 14px 未満の最初の1件を返す式
var SMALL_TEXT_EXPR = '(function(){var all=document.body.querySelectorAll("*");for(var i=0;i<all.length;i++){var e=all[i];' +
  'if(!e.getClientRects().length)continue;var cs=getComputedStyle(e);if(cs.visibility==="hidden")continue;' +
  'var own=Array.prototype.some.call(e.childNodes,function(n){return n.nodeType===3&&n.textContent.trim()});' +
  'var px=own?parseFloat(cs.fontSize):99;["::before","::after"].forEach(function(p){var s=getComputedStyle(e,p),c=s.content;' +
  'if(c&&c!=="none"&&c!=="normal"&&c!==\'""\')px=Math.min(px,parseFloat(s.fontSize))});' +
  'if(px<14)return e.tagName.toLowerCase()+(typeof e.className==="string"&&e.className?"."+e.className.trim().split(/\\s+/).join("."):"")+" "+px+"px"}return null})()';

// selector に合致する可視要素の件数と、高さ 44px 未満の要素(文字列先頭20字+高さ)を返す式
function tapExpr(sel) {
  return '(function(s){var all=Array.from(document.querySelectorAll(s)).filter(function(e){return e.getClientRects().length>0});' +
    'return{count:all.length,small:all.map(function(e){return[(e.textContent||"").trim().slice(0,20),e.getBoundingClientRect().height]}).filter(function(x){return x[1]<44}).map(function(x){return x[0]+" "+Math.round(x[1])+"px"})}})(' + JSON.stringify(sel) + ')';
}

async function runScreen(conn, origin, screen, theme, update) {
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
    var metrics = function (height) { return send('Emulation.setDeviceMetricsOverride', { width: screen.viewport.width, height: height, deviceScaleFactor: 1, mobile: false }); };
    await metrics(screen.viewport.height);
    if (screen.ops.some(function (o) { return o.pull; })) await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
    if (screen.standalone) await send('Page.addScriptToEvaluateOnNewDocument', { source: "Object.defineProperty(Navigator.prototype,'standalone',{configurable:true,get:function(){return true}})" });
    await send('Emulation.setTimezoneOverride', { timezoneId: 'Asia/Tokyo' });
    await send('Emulation.setLocaleOverride', { locale: 'ja-JP' });
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }] });

    if (!START_URL[screen.start]) throw new InfraError('未知の start: ' + screen.start);
    var loaded = new Promise(function (resolve, reject) {
      loadWaiters.push(resolve);
      setTimeout(function () { reject(new InfraError('ナビゲーションタイムアウト')); }, NAV_MS).unref();
    });
    await send('Page.navigate', { url: origin + START_URL[screen.start] });
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
      if (!['click', 'type', 'scroll', 'wait', 'reload', 'scrollBy', 'pull', 'release', 'absentNow'].includes(kind)) throw new InfraError('未知の操作: ' + kind);
      if ((kind === 'scrollBy' || kind === 'pull') && typeof a[0] !== 'number') throw new InfraError(kind + ' の第1引数は数値');
      if (kind === 'absentNow') {
        if (await evalJs(countExpr(a[0], null))) return fail('在ってはいけない要素 ' + a[0]);
        continue;
      }
      if (kind === 'release') {
        await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        await evalJs('new Promise(function(r){requestAnimationFrame(function(){requestAnimationFrame(r)})})', true);
        continue;
      }
      if (kind === 'scrollBy') {
        await evalJs('window.scrollBy(0,' + a[0] + ');new Promise(function(r){requestAnimationFrame(function(){requestAnimationFrame(r)})})', true);
        continue;
      }
      if (kind === 'pull') {
        var tx = Math.round(screen.viewport.width / 2);
        var touch = function (type, y) { return send('Input.dispatchTouchEvent', { type: type, touchPoints: type === 'touchEnd' ? [] : [{ x: tx, y: y }] }); };
        await touch('touchStart', 300);
        for (var pi = 1; pi <= 10; pi++) await touch('touchMove', 300 + Math.round(a[0] * pi / 10));
        if (a[1] === 'release') await touch('touchEnd', 0);
        await evalJs('new Promise(function(r){requestAnimationFrame(function(){requestAnimationFrame(r)})})', true);
        continue;
      }
      if (kind === 'reload') {
        var reloaded = new Promise(function (resolve, reject) {
          loadWaiters.push(resolve);
          setTimeout(function () { reject(new InfraError('再読み込みタイムアウト')); }, NAV_MS).unref();
        });
        await send('Page.reload', {});
        await reloaded;
        continue;
      }
      if (!(await waitCount(a[0], kind === 'click' || kind === 'wait' ? a[1] : null, 1))) return fail('必須要素なし ' + a[0]);
      if (kind === 'wait') continue;
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

    var inview = screen.inview || [];
    for (var vi = 0; vi < inview.length; vi++) {
      if (!(await evalJs(inviewExpr(inview[vi][0], inview[vi][1])))) return fail('画面内に見えない ' + inview[vi][0] + (inview[vi][1] ? ' (' + inview[vi][1] + ')' : ''));
    }

    var outview = screen.outview || [];
    for (var oi = 0; oi < outview.length; oi++) {
      if (!(await evalJs(countExpr(outview[oi][0], outview[oi][1])))) return fail('outview の対象なし ' + outview[oi][0]);
      if (await evalJs(inviewExpr(outview[oi][0], outview[oi][1]))) return fail('画面内に見える ' + outview[oi][0] + (outview[oi][1] ? ' (' + outview[oi][1] + ')' : ''));
    }
    var absent = screen.absent || [];
    for (var ai = 0; ai < absent.length; ai++) {
      if (await evalJs(countExpr(absent[ai][0], absent[ai][1]))) return fail('在ってはいけない要素 ' + absent[ai][0] + (absent[ai][1] ? ' (' + absent[ai][1] + ')' : ''));
    }
    var note = '';
    if (screen.fixedMax != null) {
      var fx = await evalJs(FIXED_EXPR);
      if (fx.fixed < 0) return fail('固定高さの対象なし');
      if (fx.band > 0) return fail('上部バーの帯 ' + fx.band + 'px(タブ行の上)');
      if (fx.fixed > screen.fixedMax) return fail('固定高さ ' + fx.fixed + 'px が上限 ' + screen.fixedMax + 'px を超える');
      note = '固定 ' + fx.fixed + 'px 帯 0px';
    }

    await evalJs('Promise.race([new Promise(function(r){setTimeout(r,5000)}),Promise.all([document.fonts.ready].concat(Array.from(document.images).map(function(i){i.loading="eager";return i.complete?1:new Promise(function(r){i.onload=i.onerror=r})})))]).then(function(){window.scrollTo(0,0);return new Promise(function(r){requestAnimationFrame(function(){requestAnimationFrame(r)})})})', true);

    var shot = async function () {
      var p = { format: 'png' };
      if (!screen.full) return Buffer.from((await send('Page.captureScreenshot', p)).data, 'base64');
      var h = await evalJs('Math.max(document.documentElement.scrollHeight,document.body.scrollHeight)');
      if (h > MAX_PX) throw new Error('高さ ' + h + 'px が上限 ' + MAX_PX + ' を超える');
      // ビューポートを全高に広げて撮る。固定要素(下部タブバー)が画面途中に写り込むのを防ぐ
      await metrics(h);
      try {
        p.clip = { x: 0, y: 0, width: screen.viewport.width, height: h, scale: 1 };
        return Buffer.from((await send('Page.captureScreenshot', p)).data, 'base64');
      } finally {
        await metrics(screen.viewport.height);
      }
    };
    var prev = await shot(), png = null;
    for (var n = 0; n < 12 && !png; n++) {
      await sleep(250);
      var cur = await shot();
      if (cur.equals(prev)) png = cur; else prev = cur;
    }
    if (!png) return fail('画面が安定しない');

    fs.mkdirSync(ACTUAL, { recursive: true });
    fs.writeFileSync(path.join(ACTUAL, screen.id + '-' + theme + '.png'), png);
    if (external.length) return fail('外部リクエスト ' + external[0]);
    if (dialogs.length) return fail('ダイアログ ' + dialogs[0]);
    // 4xx 応答はブラウザが console エラーに出す。応答自体が画面の主題のとき(合言葉誤りの 403 等)だけ screen.expectConsole で許す
    consoleErrors = consoleErrors.filter(function (e) { return !(screen.expectConsole || []).some(function (x) { return String(e).includes(x); }); });
    if (consoleErrors.length) return fail('console エラー ' + consoleErrors[0]);
    var overflow = await evalJs(OVERFLOW_EXPR);
    if (overflow) return fail('画面の左右にはみ出し ' + overflow);
    var small = await evalJs(SMALL_TEXT_EXPR);
    if (small) return fail('14px 未満の文字 ' + small);
    var taps = screen.tap || [];
    for (var ti = 0; ti < taps.length; ti++) {
      var tapRes = await evalJs(tapExpr(taps[ti]));
      if (!tapRes.count) return fail('タップ領域の対象なし ' + taps[ti]);
      if (tapRes.small.length) return fail(tapRes.small.map(function (x) { return 'タップ領域 44px 未満 ' + taps[ti] + ' ' + x; }).join(' / '));
    }

    var basePath = path.join(BASELINE, screen.id + '-' + theme + '.png');
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
    return { id: screen.id, ok: true, note: note };
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
    if (ONLY.length) screens.forEach(function (s) { THEMES.forEach(function (t) { fs.rmSync(path.join(ACTUAL, s.id + '-' + t + '.png'), { force: true }); }); });
    else fs.rmSync(ACTUAL, { recursive: true, force: true });
    srv = await listen(0);
    chrome = await launchChrome(CHROME, userDataDir);
    var origin = 'http://127.0.0.1:' + srv.port;
    var metaPath = path.join(BASELINE, 'meta.json');
    if (!UPDATE && fs.existsSync(metaPath)) {
      var meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
      if (meta.chrome !== chrome.version) console.log('WARN Chrome ' + chrome.version + ' は基準 (' + meta.chrome + ') と異なる。不一致は環境差の可能性');
    }
    var okCount = 0, total = 0;
    for (var i = 0; i < screens.length; i++) {
      for (var j = 0; j < THEMES.length; j++) {
        var r, label = screens[i].id + ' (' + THEMES[j] + ')';
        total++;
        try {
          r = await runScreen(chrome.conn, origin, screens[i], THEMES[j], UPDATE);
        } catch (e) {
          if (e instanceof InfraError) throw e;
          r = { ok: false, reason: e.message };
        }
        console.log(r.ok ? 'OK ' + label + (r.note ? ' ' + r.note : '') : 'FAIL ' + label + ': ' + r.reason);
        if (r.ok) okCount++;
      }
    }
    if (UPDATE) {
      fs.writeFileSync(path.join(BASELINE, 'meta.json'), JSON.stringify({ chrome: chrome.version, platform: process.platform + '-' + process.arch }, null, 2) + '\n');
    }
    console.log('ui-check: ' + okCount + '/' + total + ' OK');
    return okCount === total ? 0 : 1;
  } finally {
    clearTimeout(timer);
    cleanup();
  }
}

main().then(function (code) { process.exit(code); }, function (e) {
  console.log('ui-check: 基盤エラー: ' + e.message);
  process.exit(2);
});
