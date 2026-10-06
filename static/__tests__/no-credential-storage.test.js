import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

function jsFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(function (e) {
    var p = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === '__tests__' ? [] : jsFiles(p);
    return e.name.endsWith('.js') && !e.name.includes('.min.') && !e.name.includes('standalone') ? [p] : [];
  });
}

// パスワードを Web Storage に書かない(#490)
describe('資格情報の保存', function () {
  it('static/ の JS は sessionStorage・localStorage にパスワードを書かない', function () {
    var root = new URL('..', import.meta.url).pathname;
    var bad = [];
    jsFiles(root).forEach(function (f) {
      fs.readFileSync(f, 'utf8').split('\n').forEach(function (line, i) {
        if (/(session|local)Storage\.setItem/.test(line) && /pass/i.test(line)) bad.push(f + ':' + (i + 1));
      });
    });
    assert.deepEqual(bad, []);
  });
  it('sessionStorage には何も書かない', function () {
    var src = fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8');
    assert.doesNotMatch(src, /sessionStorage\.setItem/);
  });
});
