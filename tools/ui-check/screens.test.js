import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import { SCREENS, THEMES } from './screens.js';

// クラス名セレクタ(`.foo`・`div.foo`)を検出する(属性値内は除く)。data-ui・id・タグ・ARIA だけで探す規約
var CLASS_SEL = /\.[A-Za-z_-]/;
function hasClassSel(sel) { return CLASS_SEL.test(sel.replace(/\[[^\]]*\]/g, '[]')); }

function selectors(screen) {
  var ops = screen.ops.map(function (op) { var a = op.click || op.type || op.scroll || op.wait; return a && a[0]; }).filter(Boolean);
  return ops.concat(screen.required.map(function (r) { return r[0]; }), (screen.inview || []).map(function (r) { return r[0]; }), (screen.outview || []).map(function (r) { return r[0]; }), screen.tap || []);
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

  it('selectors() が inview のセレクタも検査対象に含める', () => {
    var sel = selectors({ ops: [], required: [['a']], inview: [['[data-ui="x"]', 't']], outview: [['[data-ui="y"]']], tap: ['b'] });
    assert.deepStrictEqual(sel, ['a', '[data-ui="x"]', '[data-ui="y"]', 'b']);
  });

  it('mobile-report-overview は正の scrollBy の後に絞り込み行が画面外・タブ行が画面内で、固定高さが 120px 以下', () => {
    var s = SCREENS.find(function (x) { return x.id === 'mobile-report-overview'; });
    assert.ok(s.ops.some(function (op) { return op.scrollBy && op.scrollBy[0] > 0; }));
    ['[data-ui="period-trigger"]', '[data-ui="ms-trigger"]', '[data-ui="lens-toggle"] button'].forEach(function (sel) {
      assert.ok(s.outview.some(function (r) { return r[0] === sel; }), sel);
    });
    assert.ok(s.inview.some(function (r) { return r[0] === '[data-ui="tab"][aria-selected="true"]'; }));
    assert.ok(s.fixedMax <= 120);
  });

  it('レポート5画面は要約の主指標が種別ごとに違う', () => {
    var heroes = ['report-overview', 'report-playstyle', 'report-burst', 'report-matchup', 'report-time'].map(function (id) {
      var s = SCREENS.find(function (x) { return x.id === id; });
      return s.required.find(function (r) { return r[0] === '[data-ui="summary-hero"]'; })[1];
    });
    assert.strictEqual(new Set(heroes).size, 5);
  });

  it('部品一覧ページの styles link が index.html と同じ順', () => {
    var read = function (f, re) { return Array.from(fs.readFileSync(new URL(f, import.meta.url), 'utf8').matchAll(re)).map(function (m) { return m[1]; }); };
    var app = read('../../static/index.html', /href="styles\/([a-z-]+\.css)"/g);
    var parts = read('./preview/parts.html', /href="\/styles\/([a-z-]+\.css)"/g);
    assert.deepStrictEqual(parts, app);
  });

  it('基準画像が SCREENS × THEMES の <id>-<theme>.png と過不足なく一致する', () => {
    var want = [];
    SCREENS.forEach(function (s) { THEMES.forEach(function (t) { want.push(s.id + '-' + t + '.png'); }); });
    var have = fs.readdirSync(new URL('./baseline/', import.meta.url)).filter(function (f) { return f.endsWith('.png'); });
    assert.deepStrictEqual(have.sort(), want.sort());
  });

  it('mobile-more は 4 項目を巡回して最後に再読み込みし、タップ領域を検査する', () => {
    var s = SCREENS.find(function (x) { return x.id === 'mobile-more'; });
    var clicked = s.ops.filter(function (op) { return op.click; }).map(function (op) { return op.click[1]; });
    ['レポート', '試合検索', '総合戦歴', 'その他'].forEach(function (l) { assert.ok(clicked.includes(l), l); });
    assert.deepStrictEqual(s.ops[s.ops.length - 1], { reload: true });
    assert.ok(s.required.some(function (r) { return r[0].includes('aria-current') && r[1] === 'その他'; }));
    assert.ok(s.tap && s.tap.length > 0);
  });
});
