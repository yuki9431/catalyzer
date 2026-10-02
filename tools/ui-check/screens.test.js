import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import { SCREENS } from './screens.js';

// クラス名セレクタ(`.foo`・`div.foo`)を検出する(属性値内は除く)。data-ui・id・タグ・ARIA だけで探す規約
var CLASS_SEL = /\.[A-Za-z_-]/;
function hasClassSel(sel) { return CLASS_SEL.test(sel.replace(/\[[^\]]*\]/g, '[]')); }

function selectors(screen) {
  var ops = screen.ops.map(function (op) { return op.click ? op.click[0] : op.type ? op.type[0] : op.scroll[0]; });
  return ops.concat(screen.required.map(function (r) { return r[0]; }));
}

describe('screens', () => {
  it('クラスセレクタ検出が h2.title 等を拾い、属性値内の . は拾わない', () => {
    ['h2.title', 'div.panel', '.foo', '[data-ui="x"].active'].forEach(function (x) { assert.ok(hasClassSel(x), x); });
    ['[data-ui="a.b"]', 'input[value="0.5"]', '[data-ui="x"] > button'].forEach(function (x) { assert.ok(!hasClassSel(x), x); });
  });

  it('全画面の操作・必須要素がクラス名セレクタを使わない', () => {
    var bad = [];
    SCREENS.forEach(function (s) {
      selectors(s).forEach(function (sel) { if (hasClassSel(sel)) bad.push(s.id + ': ' + sel); });
    });
    assert.deepStrictEqual(bad, []);
  });

  it('部品一覧ページの styles link が index.html と同じ順', () => {
    var read = function (f, re) { return Array.from(fs.readFileSync(new URL(f, import.meta.url), 'utf8').matchAll(re)).map(function (m) { return m[1]; }); };
    var app = read('../../static/index.html', /href="styles\/([a-z-]+\.css)"/g);
    var parts = read('./preview/parts.html', /href="\/styles\/([a-z-]+\.css)"/g);
    assert.deepStrictEqual(parts, app);
  });
});
