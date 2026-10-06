import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';

// Skeleton は actions.onLogout を参照する。渡し忘れは空期間表示で TypeError になる(#424)
// AppShell は nav.view を参照し、MoreView は onLogout を呼ぶ。渡し忘れは描画・操作時の TypeError になる(#412)
function jsFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(function (e) {
    var p = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === '__tests__' ? [] : jsFiles(p);
    return e.name.endsWith('.js') ? [p] : [];
  });
}

describe('Skeleton', () => {
  it('全ての <${Skeleton} 呼び出しに actions が付く', () => {
    var root = new URL('..', import.meta.url).pathname;
    var bad = [];
    var found = 0;
    jsFiles(root).forEach(function (f) {
      Array.from(fs.readFileSync(f, 'utf8').matchAll(/<\$\{Skeleton\}([^>]*)>/g)).forEach(function (m) {
        found++;
        if (!/(^|\s)actions=/.test(m[1])) bad.push(f);
      });
    });
    assert.ok(found >= 2);
    assert.deepStrictEqual(bad, []);
  });

  // 呼び出し(<${Name} ...>)ごとに、タグ内に属性 attr が付いているかを検査する
  function missingAttr(name, attr) {
    var root = new URL('..', import.meta.url).pathname;
    var re = new RegExp('<\\$\\{' + name + '\\}([^>]*)>', 'g');
    var found = 0, bad = [];
    jsFiles(root).forEach(function (f) {
      Array.from(fs.readFileSync(f, 'utf8').matchAll(re)).forEach(function (m) {
        found++;
        if (!new RegExp('(^|\\s)' + attr + '=').test(m[1])) bad.push(f + ': ' + m[0]);
      });
    });
    return { found: found, bad: bad };
  }

  // userKey が変わったら再マウントし前ユーザーの state を捨てる(#402)
  it('全ての <${Report} 呼び出しに key が付く', () => {
    var r = missingAttr('Report', 'key');
    assert.ok(r.found >= 1);
    assert.deepStrictEqual(r.bad, []);
  });

  it('全ての <${AppShell} 呼び出しに nav が付く', () => {
    var r = missingAttr('AppShell', 'nav');
    assert.ok(r.found >= 6);
    assert.deepStrictEqual(r.bad, []);
  });

  it('全ての <${MoreView} 呼び出しに onLogout が付く', () => {
    var r = missingAttr('MoreView', 'onLogout');
    assert.ok(r.found >= 2);
    assert.deepStrictEqual(r.bad, []);
  });

  it('全ての <${MoreView} 呼び出しに autoRefresh が付く(未注入だと設定画面が TypeError になる)', () => {
    var r = missingAttr('MoreView', 'autoRefresh');
    assert.ok(r.found >= 2);
    assert.deepStrictEqual(r.bad, []);
  });

  it('全ての <${MoreView} 呼び出しに onReanalyze が付く(未注入だと「再分析」行で TypeError になる)', () => {
    var r = missingAttr('MoreView', 'onReanalyze');
    assert.ok(r.found >= 2);
    assert.deepStrictEqual(r.bad, []);
  });

  it('onPull を持つ全ての <${AppShell} 呼び出しに canPull が付く(無いと分析中でも引っ張りで再分析が走る)', () => {
    var root = new URL('..', import.meta.url).pathname;
    var found = 0, bad = [];
    jsFiles(root).forEach(function (f) {
      Array.from(fs.readFileSync(f, 'utf8').matchAll(/<\$\{AppShell\}([^>]*)>/g)).forEach(function (m) {
        if (!/(^|\s)onPull=/.test(m[1])) return;
        found++;
        if (!/(^|\s)canPull=/.test(m[1])) bad.push(f + ': ' + m[0]);
      });
    });
    assert.ok(found >= 1);
    assert.deepStrictEqual(bad, []);
  });
});
