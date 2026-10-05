import { describe, it } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../styles/tokens.css', import.meta.url), 'utf8');
const TOKEN_RE = /^\s*(--[a-z0-9-]+):\s*(.+?);\s*$/gm;
const parse = (block) => Object.fromEntries([...block.matchAll(TOKEN_RE)].map((m) => [m[1], m[2]]));
const darkBlock = css.slice(css.indexOf(':root {'), css.indexOf('}'));
const lightMedia = css.slice(css.indexOf('@media (prefers-color-scheme: light)'));
const dark = parse(darkBlock);
const light = { ...dark, ...parse(lightMedia) };

// var() を再帰的に解決して [r,g,b,a] にする。#rgb/#rrggbb/rgba(R,G,B,A)/R,G,B に対応
function color(tokens, name) {
  const v = tokens[name];
  assert.ok(v !== undefined, name + ' が未定義');
  const ref = v.match(/^var\((--[a-z0-9-]+)\)$/);
  if (ref) return color(tokens, ref[1]);
  let m = v.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (m) {
    const h = m[1].length === 3 ? [...m[1]].map((c) => c + c).join('') : m[1];
    return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)).concat(1);
  }
  m = v.match(/^rgba\(\s*(\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)$/);
  if (m) return [+m[1], +m[2], +m[3], +m[4]];
  m = v.match(/^(\d+),(\d+),(\d+)$/);
  if (m) return [+m[1], +m[2], +m[3], 1];
  throw new Error(name + ' の値を解釈できない: ' + v);
}

const lum = ([r, g, b]) => {
  const f = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
const ratio = (a, b) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
const over = (fg, base) => fg[3] >= 1 ? fg : [0, 1, 2].map((i) => Math.round(fg[3] * fg[i] + (1 - fg[3]) * base[i])).concat(1);

const FG = ['text', 'muted', 'accent', 'accent-2', 'great', 'good', 'bad', 'terrible', 'warn-text', 'timeup', 'error-text', 'text-dim', 'text-subtle', 'text-faint', 'text-legal', 'chart-text', 'chart-text-sub', 'chart-ref-text', 'disabled-text', 'heat-text'];
const BG = ['bg', 'bg-glow', 'panel', 'panel-2', 'surface-sub', 'disabled-bg'];
const TINT = ['text', 'muted', 'accent', 'accent-2', 'great', 'good', 'bad', 'terrible', 'warn-text'];
// [文字色, 背景色, 背景が半透明のときの基準面]
function pairs() {
  const out = [];
  FG.forEach((f) => BG.forEach((b) => out.push([f, b, 'bg'])));
  ['accent', 'accent-2', 'good', 'bad'].forEach((b) => out.push(['on-accent', b, 'bg']));
  TINT.forEach((f) => ['accent-a05', 'accent-a06', 'accent-a07'].forEach((b) => out.push([f, b, 'panel'])));
  out.push(['muted', 'accent-a06', 'bg']);
  [['text', 'accent-a15'], ['text', 'accent-a10'], ['muted', 'accent-a10'], ['accent', 'accent-a10'], ['accent-2', 'accent-a10'], ['accent', 'accent-a08']].forEach(([f, b]) => out.push([f, b, 'panel']));
  out.push(['accent', 'accent-a10', 'bg']);
  ['text', 'muted', 'bad'].forEach((f) => out.push([f, 'accent-a10', 'bg']));
  out.push(['bad', 'accent-a10', 'panel']);
  [['great', 'great-a15'], ['terrible', 'terrible-a15'], ['timeup', 'timeup-a15']].forEach(([f, b]) => ['panel', 'panel-2'].forEach((base) => out.push([f, b, base])));
  out.push(['accent-2', 'accent-a18', 'panel']);
  ['text', 'muted', 'good', 'accent'].forEach((f) => out.push([f, 'good-a08', 'panel']));
  [['heat-text', 'win-a85'], ['heat-text', 'terrible-a85'], ['heat-text', 'heat-mid'], ['text-faint', 'heat-empty']].forEach(([f, b]) => out.push([f, b, 'panel']));
  out.push(['warn-text', 'warn-bg', 'bg'], ['error-text', 'error-bg', 'bg']);
  return out;
}

function failures(tokens) {
  return pairs().map(([f, b, base]) => {
    const bg = over(color(tokens, '--' + b), color(tokens, '--' + base));
    const fg = over(color(tokens, '--' + f), bg);
    return { f, b, base, r: ratio(fg, bg) };
  }).filter((x) => x.r < 4.5).map((x) => `${x.f} / ${x.b} (${x.base}) = ${x.r.toFixed(3)}`);
}

describe('contrast', () => {
  it('比の計算が WCAG の値と一致する', () => {
    assert.strictEqual(ratio([0, 0, 0], [255, 255, 255]), 21);
    const r = ratio([0x77, 0x77, 0x77], [255, 255, 255]);
    assert.ok(r > 4.47 && r < 4.49, String(r));
  });

  it('ダークの全組が 4.5 以上', () => {
    assert.deepStrictEqual(failures(dark), []);
  });

  it('ライトの全組が 4.5 以上', () => {
    assert.deepStrictEqual(failures(light), []);
  });

  it('ライトのブロックは定義済みの名前だけを上書きし color-scheme: light を持つ', () => {
    const names = Object.keys(parse(lightMedia));
    assert.deepStrictEqual(names.filter((n) => !(n in dark)), []);
    assert.ok(/color-scheme: light;/.test(lightMedia));
    assert.ok(/color-scheme: dark;/.test(darkBlock));
  });

  it('alpha トークンは元の色の RGB と NN/100 の不透明度に一致する', () => {
    const EXC = { '--win-a70': '--great', '--win-a85': '--win-rgb', '--terrible-a85': '--terrible-rgb' };
    const bad = [];
    [dark, light].forEach((tokens, i) => {
      Object.keys(tokens).forEach((n) => {
        const m = n.match(/^(--.+)-a(\d\d)$/);
        if (!m) return;
        const base = color(tokens, EXC[n] || m[1]);
        const got = color(tokens, n);
        const want = [base[0], base[1], base[2], +m[2] / 100];
        if (got.some((v, k) => Math.abs(v - want[k]) > 1e-9)) bad.push(`${i ? 'light' : 'dark'} ${n}: ${got} != ${want}`);
      });
    });
    assert.deepStrictEqual(bad, []);
  });
});
