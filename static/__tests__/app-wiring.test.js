import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

var src = fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8');

// 関数宣言の本体(次のトップレベルの閉じ括弧まで)を取り出す
function body(name) {
  var m = src.match(new RegExp('function ' + name + '\\([^)]*\\) \\{\\n([\\s\\S]*?)\\n\\}\\n'));
  assert.ok(m, name + ' が見つからない');
  return m[1];
}

describe('試合データの取得し直し(#486)', function () {
  var b = body('rebuildCache');
  it('分析中は再構築を始めない', function () {
    var guard = b.search(/if \(analysisBusy\(\)\) \{[^}]*return; \}/);
    assert.ok(guard >= 0, 'analysisBusy() で戻る判定が無い');
    assert.ok(guard < b.indexOf('rebuildCacheFromServer('), '判定が再構築の呼び出しより後にある');
  });
  it('再構築は分析の多重起動ロックの中で走る', function () {
    assert.match(b, /analysis\.run\(async function \(\) \{ rebuilt = await rebuildCacheFromServer\(userKey\); \}\)/);
  });
});

describe('表示中の定期取得(#487)', function () {
  it('touch は touch: false のときに送らない', function () {
    var b = body('pullAutoRefresh');
    assert.match(b, /var touch = !opts \|\| opts\.touch !== false;/);
    assert.match(b, /if \(touch\) \{\n\s+var touchRes = await fetch\('\/auto-refresh\/touch'/);
    assert.equal(b.match(/\/auto-refresh\/touch/g).length, 1, 'touch の送信が条件の外にもある');
  });
  it('touch なしの取得は20秒の間引きを進めない', function () {
    var b = body('pullAutoRefresh');
    assert.match(b, /if \(touch\) lastPullAt = Date\.now\(\);/);
    assert.equal(b.match(/lastPullAt =/g).length, 1, '条件の外でも lastPullAt を進めている');
  });
  it('分析・再構築のロック中は取り込まない', function () {
    assert.match(body('pullAutoRefresh'), /shouldPull\(\{[^}]*busy: analysisBusy\(\)/);
  });
  it('定期取得は pullAutoRefresh を使い、表示状態の変化で開始・停止する', function () {
    assert.match(src, /createPeriodicPull\(\{[\s\S]*?pull: pullAutoRefresh,[\s\S]*?\}\);/);
    assert.match(src, /addEventListener\('visibilitychange', function \(\) \{\n\s+periodicPull\.sync\(\);/);
  });
});
