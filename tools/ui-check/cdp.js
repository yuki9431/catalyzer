import { spawn } from 'node:child_process';

export class InfraError extends Error {}

var FLAGS = [
  '--headless=new', '--remote-debugging-pipe', '--no-first-run', '--no-default-browser-check',
  '--disable-gpu', '--hide-scrollbars', '--disable-lcd-text', '--font-render-hinting=none',
  '--force-color-profile=srgb', '--disable-extensions', '--disable-component-update',
  '--disable-background-networking', '--mute-audio', '--lang=ja-JP',
];

// Chrome を pipe 接続で起動し、CDP クライアントと kill 関数を返す(依存ゼロ)
export function launchChrome(chromePath, userDataDir) {
  return new Promise(function (resolve, reject) {
    var proc = spawn(chromePath, FLAGS.concat(['--user-data-dir=' + userDataDir, 'about:blank']), {
      detached: true, stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'],
    });
    var nextId = 1, pending = new Map(), listeners = [], buf = Buffer.alloc(0), dead = false;
    function fail(err) {
      dead = true;
      pending.forEach(function (p) { p.reject(err); });
      pending.clear();
    }
    function kill() {
      dead = true;
      try { process.kill(-proc.pid, 'SIGKILL'); } catch (e) {}
    }
    proc.stdio[3].on('error', function () {});
    proc.stdio[4].on('error', function () {});
    proc.once('error', function (e) { var err = new InfraError('Chrome 起動失敗 (CHROME_PATH で指定): ' + e.message); fail(err); reject(err); });
    proc.once('exit', function () { fail(new InfraError('Chrome が終了した')); });
    proc.stdio[4].on('data', function (chunk) {
      buf = Buffer.concat([buf, chunk]);
      var i;
      while ((i = buf.indexOf(0)) >= 0) {
        var msg = JSON.parse(buf.subarray(0, i).toString('utf8'));
        buf = buf.subarray(i + 1);
        if (msg.id && pending.has(msg.id)) {
          var p = pending.get(msg.id);
          pending.delete(msg.id);
          clearTimeout(p.timer);
          if (msg.error) p.reject(new Error(p.method + ': ' + msg.error.message));
          else p.resolve(msg.result);
        } else if (msg.method) {
          listeners.slice().forEach(function (l) { l(msg.method, msg.params || {}, msg.sessionId || null); });
        }
      }
    });
    var conn = {
      send: function (method, params, sessionId, timeoutMs) {
        return new Promise(function (res, rej) {
          if (dead) return rej(new InfraError('Chrome が終了している'));
          var id = nextId++;
          var timer = setTimeout(function () {
            pending.delete(id);
            rej(new InfraError('CDP タイムアウト: ' + method));
          }, timeoutMs || 30000);
          pending.set(id, { resolve: res, reject: rej, timer: timer, method: method });
          var msg = { id: id, method: method, params: params || {} };
          if (sessionId) msg.sessionId = sessionId;
          proc.stdio[3].write(JSON.stringify(msg) + '\0');
        });
      },
      onEvent: function (fn) {
        listeners.push(fn);
        return function () { listeners = listeners.filter(function (l) { return l !== fn; }); };
      },
    };
    // 起動確認: Browser.getVersion が返れば pipe 接続成立
    conn.send('Browser.getVersion', {}, null, 15000).then(function (v) {
      resolve({ conn: conn, kill: kill, version: v.product });
    }, function (e) { kill(); reject(e instanceof InfraError ? e : new InfraError(e.message)); });
  });
}
