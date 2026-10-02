import { describe, it } from 'node:test';
import assert from 'node:assert';
import { SCREENS } from './screens.js';

// クラス名セレクタ(`.foo`)を検出する。data-ui・id・タグ・ARIA だけで探す規約
var CLASS_SEL = /(^|[\s>+~,(])\.[A-Za-z_-]/;

function selectors(screen) {
  var ops = screen.ops.map(function (op) { return op.click ? op.click[0] : op.type ? op.type[0] : op.scroll[0]; });
  return ops.concat(screen.required.map(function (r) { return r[0]; }));
}

describe('screens', () => {
  it('全画面の操作・必須要素がクラス名セレクタを使わない', () => {
    var bad = [];
    SCREENS.forEach(function (s) {
      selectors(s).forEach(function (sel) { if (CLASS_SEL.test(sel)) bad.push(s.id + ': ' + sel); });
    });
    assert.deepStrictEqual(bad, []);
  });
});
