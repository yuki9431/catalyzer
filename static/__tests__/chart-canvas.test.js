import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { canvasFont, winRateColors, winRateComboConfig } from '../components/chart-canvas.js';

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

describe('テーマ切替の再描画', () => {
  const dir = new URL('../components/', import.meta.url);
  const files = readdirSync(dir, { recursive: true }).filter((f) => f.endsWith('.js')).map((f) => [f, readFileSync(new URL(f, dir), 'utf8')]);
  const count = (src, re) => (src.match(re) || []).length;

  it('ChartCanvas は theme を effect の deps に含める', () => {
    const src = files.find(([f]) => f === 'chart-canvas.js')[1];
    assert.ok(src.includes('deps.concat([inView, theme])'));
  });

  it('themeReader() で色を解決するコンポーネントのファイルは useThemeName() を同数以上呼ぶ', () => {
    const bad = files.filter(([f]) => f !== 'chart-canvas.js')
      .filter(([, s]) => count(s, /useThemeName\(\)/g) < count(s, /themeReader\(\)/g)).map(([f]) => f);
    assert.deepEqual(bad, []);
  });
});

describe('canvas のフォント', () => {
  const dir = new URL('../components/', import.meta.url);
  const sources = readdirSync(dir, { recursive: true }).filter((f) => f.endsWith('.js')).map((f) => readFileSync(new URL(f, dir), 'utf8')).join('\n');

  it('canvasFont は weight 付き・なしで組み立てる', () => {
    assert.equal(canvasFont((n) => 'F', 12, '700'), '700 12px F');
    assert.equal(canvasFont((n) => 'F', 12), '12px F');
  });

  it('ctx.font の直書き・OS 標準以外のフォント直書きがなく、サイズは 12 以上', () => {
    assert.equal((sources.match(/ctx\.font = '/g) || []).length, 0);
    assert.equal((sources.match(/sans-serif|system-ui/g) || []).length, 0);
    const sizes = [...sources.matchAll(/(?:canvasFont\(cssVar, |font: \{ size: )(\d+)/g)].map((m) => +m[1]);
    assert.ok(sizes.length > 0);
    assert.deepEqual(sizes.filter((n) => n < 12), []);
  });
});
