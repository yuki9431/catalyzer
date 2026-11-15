import { describe, it } from 'node:test';
import assert from 'node:assert';
import { popoverStyle, createLayerStack, isEscape, hasOpenPopup } from '../components/popover.js';

var RECT = { bottom: 100 };

describe('popoverStyle', () => {
  it('anchor は常に空', () => {
    assert.deepStrictEqual(popoverStyle('anchor', RECT, 400), {});
  });

  it('sheet-top は 720 以下で top を返し、721 では空', () => {
    assert.deepStrictEqual(popoverStyle('sheet-top', RECT, 720), { top: '104px' });
    assert.deepStrictEqual(popoverStyle('sheet-top', RECT, 721), {});
  });

  it('sheet-bottom は 720 以下で下端固定、721 では空', () => {
    assert.deepStrictEqual(popoverStyle('sheet-bottom', RECT, 720), {
      position: 'fixed', top: 'auto', bottom: '0', left: '0', right: '0', width: '100%', minWidth: '0',
      maxHeight: '70vh', margin: '0', borderRadius: '8px 8px 0 0',
    });
    assert.deepStrictEqual(popoverStyle('sheet-bottom', RECT, 721), {});
  });

  it('rect が null の sheet-top は空', () => {
    assert.deepStrictEqual(popoverStyle('sheet-top', null, 400), {});
  });
});

describe('createLayerStack', () => {
  it('push した順に積まれ、最上位だけが isTop', () => {
    var st = createLayerStack(), a = {}, b = {};
    st.push(a); st.push(b);
    assert.strictEqual(st.isTop(b), true);
    assert.strictEqual(st.isTop(a), false);
  });
  it('最上位を remove すると下が isTop になる', () => {
    var st = createLayerStack(), a = {}, b = {};
    st.push(a); st.push(b); st.remove(b);
    assert.strictEqual(st.isTop(a), true);
    assert.strictEqual(st.isTop(b), false);
  });
  it('途中を remove しても順序が保たれ、空では誰も isTop でない', () => {
    var st = createLayerStack(), a = {}, b = {}, c = {};
    st.push(a); st.push(b); st.push(c); st.remove(b);
    assert.strictEqual(st.isTop(c), true);
    st.remove(c);
    assert.strictEqual(st.isTop(a), true);
    st.remove(a);
    assert.strictEqual(st.isTop(a), false);
    st.remove(a);
  });
});

describe('isEscape', () => {
  it('Escape だけ真。IME 変換中(isComposing・keyCode 229)は偽', () => {
    assert.strictEqual(isEscape({ key: 'Escape' }), true);
    assert.strictEqual(isEscape({ key: 'Enter' }), false);
    assert.strictEqual(isEscape({ key: 'Escape', isComposing: true }), false);
    assert.strictEqual(isEscape({ key: 'Escape', keyCode: 229 }), false);
  });
});

describe('hasOpenPopup', () => {
  it('層の中に aria-expanded="true" があるときだけ真(開いたドロップダウンがあれば層は Esc で閉じない)', () => {
    var seen = [];
    var root = { querySelector: function (sel) { seen.push(sel); return sel === '[aria-expanded="true"]' ? {} : null; } };
    assert.strictEqual(hasOpenPopup(root), true);
    assert.strictEqual(hasOpenPopup({ querySelector: function () { return null; } }), false);
    assert.strictEqual(hasOpenPopup(null), false);
    assert.deepStrictEqual(seen, ['[aria-expanded="true"]']);
  });
});
