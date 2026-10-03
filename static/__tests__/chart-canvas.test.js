import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { winRateColors, winRateComboConfig } from '../components/chart-canvas.js';

const token = (n) => n;
const base = { labels: ['a', 'b'], winRates: [60, 40], matches: [3, 4] };

describe('winRateColors', () => {
  it('60以上は win、50未満は terrible、他は中間色', () => {
    assert.deepEqual(winRateColors(token, [60, 59.9, 50, 49.9], 'mid'), ['--win-a70', 'mid', 'mid', '--terrible-a70']);
  });
});

describe('winRateComboConfig', () => {
  it('棒+線の2軸で、線に背景色・50%基準線・凡例生成を持つ', () => {
    const c = winRateComboConfig(token, base);
    assert.deepEqual(c.data.datasets.map((d) => d.type || c.type), ['bar', 'line']);
    assert.equal(c.data.datasets[1].backgroundColor, '--accent-2-a10');
    assert.equal(c.data.datasets[0].backgroundColor[1], '--terrible-a70');
    assert.equal(c.options.scales.y.min, 0);
    assert.equal(c.options.scales.y.max, 100);
    assert.equal(c.options.scales.y1.ticks.stepSize, 1);
    assert.deepEqual(c.plugins.map((p) => p.id), ['winRate50Line']);
    assert.equal(typeof c.options.plugins.legend.labels.generateLabels, 'function');
  });

  it('plain は線に背景色が無く、凡例も簡素', () => {
    const c = winRateComboConfig(token, Object.assign({ plain: true }, base));
    assert.equal('backgroundColor' in c.data.datasets[1], false);
    assert.equal('generateLabels' in c.options.plugins.legend.labels, false);
  });
});
