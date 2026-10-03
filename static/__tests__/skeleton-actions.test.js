import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';

// Skeleton は actions.onLogout を参照する。渡し忘れは空期間表示で TypeError になる(#424)
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
});
