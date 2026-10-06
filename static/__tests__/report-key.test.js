import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';

// Report は再描画で使い回され allMatches が userKey を見ないため、key で再マウントして前ユーザーの試合を捨てる(#402)
describe('renderReport', () => {
  it('<${Report} に key=${userKey} が付く', () => {
    var src = fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8');
    var tags = Array.from(src.matchAll(/<\$\{Report\}([^>]*)>/g));
    assert.ok(tags.length >= 1);
    tags.forEach(function (m) { assert.match(m[1], /(^|\s)key=\$\{userKey\}/); });
  });
});
