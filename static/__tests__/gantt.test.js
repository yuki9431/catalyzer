import { describe, it } from 'node:test';
import assert from 'node:assert';
import { TICK_GAP, ganttTicks } from '../lib/gantt.js';

function labelOf(raw, sec) { return ganttTicks(raw).ticks.find(function (t) { return t.sec === sec; }).label; }

describe('ganttTicks', () => {
  it('30秒ごとに目盛りを作り、ラベル候補は1分ごとだけ', () => {
    var r = ganttTicks(205);
    assert.deepStrictEqual(r.ticks.map(function (t) { return t.sec; }), [30, 60, 90, 120, 150, 180]);
    assert.ok(r.ticks.filter(function (t) { return !t.major; }).every(function (t) { return t.label === null; }));
  });

  it('タイムアップ(240秒)は 180 を広い画面だけで出し、終了と同じ 240 の目盛りは作らない', () => {
    assert.strictEqual(labelOf(240, 120), 'all');
    assert.strictEqual(labelOf(240, 180), 'wide');
    assert.ok(!ganttTicks(240).ticks.some(function (t) { return t.sec === 240; }));
  });

  it('終了に近い目盛りは出さない(205秒の 180)', () => {
    assert.strictEqual(labelOf(205, 180), null);
    assert.strictEqual(labelOf(205, 120), 'all');
  });

  it('閾値は 320px 幅と 720px 超の軸幅から決めた値', () => {
    assert.deepStrictEqual(TICK_GAP, { narrow: 0.4, wide: 0.16 });
  });

  it('境界: 残り割合が narrow/wide の下限ちょうどで切り替わる', () => {
    var rawN = 120 / (1 - TICK_GAP.narrow), rawW = 120 / (1 - TICK_GAP.wide);
    assert.strictEqual(labelOf(rawN + 0.01, 120), 'all');
    assert.strictEqual(labelOf(rawN - 0.01, 120), 'wide');
    assert.strictEqual(labelOf(rawW + 0.01, 120), 'wide');
    assert.strictEqual(labelOf(rawW - 0.01, 120), null);
  });

  it('終了秒は切り捨てで、目盛りの上限もそれに合わせる', () => {
    assert.strictEqual(ganttTicks(239.6).end, 239);
    assert.strictEqual(ganttTicks(180.4).end, 180);
    assert.ok(!ganttTicks(180.4).ticks.some(function (t) { return t.sec === 180; }));
  });
});
