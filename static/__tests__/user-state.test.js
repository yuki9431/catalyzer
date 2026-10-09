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

function removedKeys(code) {
  return Array.from(code.matchAll(/(?:local|session)Storage\.removeItem\(([^)]+)\)/g), function (m) { return m[1]; });
}

// ログイン画面に戻る経路とログアウトで、消す画面状態を揃える(#520)
describe('ユーザーの画面状態の消去', function () {
  it('ログアウトとセッション失効の両方が clearUserState を呼ぶ', function () {
    assert.match(body('logout'), /clearUserState\(\);/);
    assert.match(body('returnToLogin'), /clearUserState\(\);/);
  });
  it('両経路が個別に消すキーは clearUserState の対象に含まれる', function () {
    var shared = body('clearUserState');
    removedKeys(body('logout') + body('returnToLogin')).forEach(function (k) {
      assert.ok(shared.includes(k), k + ' が clearUserState に無い');
    });
  });
  it('clearUserState は画面状態のキーを消す', function () {
    var shared = body('clearUserState');
    ['VIEW_KEY', 'TAB_SEEN_KEY', 'FOCUS_KEY', 'CLASS_RECORD_KEY', 'ANALYSIS_STARTED_KEY', 'ANALYSIS_FINISHED_KEY',
      "'catalyzer_user_key'", "'catalyzer_has_session'", "'catalyzer_cred'"].forEach(function (k) {
      assert.ok(shared.includes(k), k);
    });
  });
});
