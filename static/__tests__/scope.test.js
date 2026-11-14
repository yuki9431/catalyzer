import { describe, it } from 'node:test';
import assert from 'node:assert';
import { searchScope, applyScope, inCustomRange, customRangeLabel } from '../lib/scope.js';

var ALL = { period: 'all', customRange: null, mode: 'all' };

describe('searchScope', () => {
  it('全期間は playDays 空・プリセットはそのまま', () => {
    assert.deepStrictEqual(searchScope('all', null, 'all'), { playDays: '', dateFrom: '', dateTo: '', rangeStart: '', rangeEnd: '', mode: 'all' });
    assert.deepStrictEqual(searchScope('30d', null, 'fixed'), { playDays: '30d', dateFrom: '', dateTo: '', rangeStart: '', rangeEnd: '', mode: 'fixed' });
  });
  it('日付指定はシート用の日付と、時刻まで含む範囲を渡す', () => {
    var r = { start: '2026-10-01 18:00', end: '2026-10-05 23:59' };
    assert.deepStrictEqual(searchScope('custom', r, 'shuffle'), { playDays: '', dateFrom: '2026-10-01', dateTo: '2026-10-05', rangeStart: '2026-10-01 18:00', rangeEnd: '2026-10-05 23:59', mode: 'shuffle' });
  });
  it('プリセット選択中は保持している日付指定を渡さない', () => {
    assert.strictEqual(searchScope('7d', { start: '2026-10-01 00:00', end: '2026-10-05 23:59' }, 'all').dateFrom, '');
  });
});

describe('applyScope', () => {
  it('期間プリセットを選ぶ・外す', () => {
    assert.strictEqual(applyScope('playDays', '14d', ALL).period, '14d');
    assert.strictEqual(applyScope('playDays', '', { period: '14d', customRange: null, mode: 'all' }).period, 'all');
  });
  it('日付を選ぶと日付指定になり、期間プリセットは外れる', () => {
    var a = applyScope('dateFrom', '2026-10-01', { period: '7d', customRange: null, mode: 'all' });
    assert.deepStrictEqual(a, { period: 'custom', customRange: { start: '2026-10-01 00:00', end: '' }, mode: 'all' });
    var b = applyScope('dateTo', '2026-10-05', a);
    assert.deepStrictEqual(b.customRange, { start: '2026-10-01 00:00', end: '2026-10-05 23:59' });
  });
  it('日付指定中に期間を空で選んでも日付指定は残る', () => {
    var cur = { period: 'custom', customRange: { start: '2026-10-01 00:00', end: '' }, mode: 'all' };
    assert.strictEqual(applyScope('playDays', '', cur).period, 'custom');
  });
  it('カレンダーの1クリック(開始日→終了日を空に)を続けて合成しても開始日が残る', () => {
    var a = applyScope('dateTo', '', applyScope('dateFrom', '2026-10-01', ALL));
    assert.deepStrictEqual(a, { period: 'custom', customRange: { start: '2026-10-01 00:00', end: '' }, mode: 'all' });
  });
  it('日付を両方外すと全期間に戻る', () => {
    var cur = { period: 'custom', customRange: { start: '2026-10-01 00:00', end: '' }, mode: 'all' };
    assert.deepStrictEqual(applyScope('dateFrom', '', cur), { period: 'all', customRange: null, mode: 'all' });
  });
  it('対戦形式と全解除', () => {
    assert.strictEqual(applyScope('mode', 'fixed', ALL).mode, 'fixed');
    assert.deepStrictEqual(applyScope(null, null, { period: '7d', customRange: null, mode: 'fixed' }), ALL);
  });
});

describe('inCustomRange / customRangeLabel', () => {
  it('片側だけの範囲も判定する', () => {
    assert.strictEqual(inCustomRange('2026-10-02 10:00', { start: '2026-10-01 00:00', end: '' }), true);
    assert.strictEqual(inCustomRange('2026-09-30 10:00', { start: '2026-10-01 00:00', end: '' }), false);
    assert.strictEqual(inCustomRange('2026-10-06 10:00', { start: '', end: '2026-10-05 23:59' }), false);
  });
  it('表示は M/D で、空の側は省く', () => {
    assert.strictEqual(customRangeLabel({ start: '2026-10-01 00:00', end: '2026-12-15 23:59' }), '10/1~12/15');
    assert.strictEqual(customRangeLabel({ start: '2026-10-01 00:00', end: '' }), '10/1~');
    assert.strictEqual(customRangeLabel({ start: '', end: '2026-10-05 23:59' }), '~10/5');
  });
});
