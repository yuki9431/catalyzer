import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { pct, num, cellValue, cellDisplay, wrMark, wrTone, wrBarTone, signed, sortNumber, isTimeUp, TIMEUP_SEC } from '../lib/format.js';

// --- pct ---

describe('pct', function () {
  it('formats number as percentage', function () {
    assert.equal(pct(50.123), '50.1%');
  });

  it('formats zero', function () {
    assert.equal(pct(0), '0.0%');
  });

  it('returns dash for null', function () {
    assert.equal(pct(null), '-');
  });

  it('returns dash for undefined', function () {
    assert.equal(pct(undefined), '-');
  });
});

// --- num ---

describe('num', function () {
  it('formats with default 0 decimals', function () {
    assert.equal(num(123.456), '123');
  });

  it('formats with specified decimals', function () {
    assert.equal(num(123.456, 2), '123.46');
  });

  it('returns dash for null', function () {
    assert.equal(num(null), '-');
  });

  it('returns dash for undefined', function () {
    assert.equal(num(undefined, 3), '-');
  });
});

// --- sortNumber ---

describe('sortNumber', function () {
  it('カンマ入りの数値文字列を数値として読む (#401)', function () {
    assert.equal(sortNumber('1,000戦'), 1000);
    assert.equal(sortNumber('12,345'), 12345);
    assert.ok(sortNumber('1,000戦') > sortNumber('26戦'));
  });

  it('単位・符号付きの文字列と sortValue を読む', function () {
    assert.equal(sortNumber('53.8%'), 53.8);
    assert.equal(sortNumber('+3.9'), 3.9);
    assert.equal(sortNumber({ sortValue: 7, display: '7件' }), 7);
    assert.equal(sortNumber(5), 5);
  });

  it('数値として読めない文字列は NaN', function () {
    assert.ok(Number.isNaN(sortNumber('ヴァルキュリア')));
    assert.ok(Number.isNaN(sortNumber('-')));
  });
});

// --- cellValue ---

describe('cellValue', function () {
  it('extracts sortValue from object', function () {
    assert.equal(cellValue({ sortValue: 42, display: 'formatted' }), 42);
  });

  it('returns primitive as-is', function () {
    assert.equal(cellValue(100), 100);
    assert.equal(cellValue('text'), 'text');
  });

  it('handles null', function () {
    assert.equal(cellValue(null), null);
  });

  it('handles object without sortValue', function () {
    var obj = { display: 'text' };
    assert.deepEqual(cellValue(obj), obj);
  });
});

// --- cellDisplay ---

describe('cellDisplay', function () {
  it('extracts display from object', function () {
    assert.equal(cellDisplay({ sortValue: 42, display: 'formatted' }), 'formatted');
  });

  it('returns primitive as-is', function () {
    assert.equal(cellDisplay(100), 100);
    assert.equal(cellDisplay('text'), 'text');
  });

  it('handles null', function () {
    assert.equal(cellDisplay(null), null);
  });
});

// --- isTimeUp ---

describe('isTimeUp', function () {
  it('returns true when game_end_sec reaches the time limit', function () {
    assert.equal(isTimeUp({ game_end_sec: TIMEUP_SEC }), true);
    assert.equal(isTimeUp({ game_end_sec: TIMEUP_SEC + 5 }), true);
  });

  it('returns false when the match ended before the time limit', function () {
    assert.equal(isTimeUp({ game_end_sec: 143 }), false);
    assert.equal(isTimeUp({ game_end_sec: TIMEUP_SEC - 1 }), false);
  });

  it('returns false when game_end_sec is missing or zero', function () {
    assert.equal(isTimeUp({ game_end_sec: 0 }), false);
    assert.equal(isTimeUp({}), false);
    assert.equal(isTimeUp(null), false);
  });
});

// --- wrMark / wrTone / wrBarTone ---

describe('勝率の色分け', function () {
  it('wrMark は 60 以上 ▲ / 40 以下 ▼', function () {
    assert.equal(wrMark(60), '▲ ');
    assert.equal(wrMark(59.9), '');
    assert.equal(wrMark(40.1), '');
    assert.equal(wrMark(40), '▼ ');
    assert.equal(wrMark(null), '');
  });

  it('wrTone は 60 以上 good / 40 以下 bad', function () {
    assert.equal(wrTone(60), 'good');
    assert.equal(wrTone(59.9), '');
    assert.equal(wrTone(40.1), '');
    assert.equal(wrTone(40), 'bad');
    assert.equal(wrTone(null), '');
  });

  it('wrBarTone は 60/50 境界の3段階', function () {
    assert.equal(wrBarTone(60), 'good');
    assert.equal(wrBarTone(59.9), 'mid');
    assert.equal(wrBarTone(50), 'mid');
    assert.equal(wrBarTone(49.9), 'bad');
    assert.equal(wrBarTone(null), null);
  });
});

describe('signed', function () {
  it('符号付きで小数1桁、丸め後に符号を判定して -0.0 を出さない', function () {
    assert.equal(signed(3.94), '+3.9');
    assert.equal(signed(-10.8), '-10.8');
    assert.equal(signed(0), '+0.0');
    assert.equal(signed(-0.04), '+0.0');
  });
});
