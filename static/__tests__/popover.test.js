import { describe, it } from 'node:test';
import assert from 'node:assert';
import { popoverStyle } from '../components/popover.js';

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
