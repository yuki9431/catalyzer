import { describe, it } from 'node:test';
import assert from 'node:assert';
import { readFileSync, readdirSync } from 'node:fs';
import { themeReader } from '../lib/theme.js';

const root = new URL('../', import.meta.url);
const read = (rel) => readFileSync(new URL(rel, root), 'utf8');
const list = (dir, ext) => readdirSync(new URL(dir, root), { recursive: true }).filter((f) => f.endsWith(ext)).map((f) => dir + f);
// 1行書き(`:root { --x: 1px; --y: 2px }`)の定義も拾う
const DEF_RE = /(?:^|[{;])\s*(--[a-z0-9-]+)\s*:/gm;

const tokensCss = read('styles/tokens.css');
const defined = new Set([...tokensCss.matchAll(DEF_RE)].map((m) => m[1]));
const jsFiles = ['app.js', ...list('components/', '.js'), ...list('lib/', '.js'), ...list('analysis/', '.js')];
const cssFiles = list('styles/', '.css');

describe('theme', () => {
  it('DEF_RE は1行書きの定義を2件拾う', () => {
    assert.deepStrictEqual([...':root { --x: 1px; --y: 2px }'.matchAll(DEF_RE)].map((m) => m[1]), ['--x', '--y']);
  });

  it('themeReader は Node では空文字を返し例外を投げない', () => {
    assert.strictEqual(themeReader()('--accent'), '');
  });

  it('themeReader は2トークンを読んでも getComputedStyle を1回しか呼ばない', () => {
    const prevDoc = globalThis.document;
    const prevGcs = globalThis.getComputedStyle;
    let calls = 0;
    globalThis.document = { documentElement: {} };
    globalThis.getComputedStyle = () => { calls++; return { getPropertyValue: (n) => ' v' + n + ' ' }; };
    try {
      const cssVar = themeReader();
      assert.deepStrictEqual([cssVar('--a'), cssVar('--b')], ['v--a', 'v--b']);
      assert.strictEqual(calls, 1);
    } finally {
      globalThis.document = prevDoc;
      globalThis.getComputedStyle = prevGcs;
    }
  });

  it('JS の cssVar 呼び出しは tokens.css 定義済みの文字列リテラルだけ', () => {
    const undef = [];
    const nonLiteral = [];
    for (const f of jsFiles) {
      const src = read(f);
      for (const m of src.matchAll(/cssVar\('(--[a-z0-9-]+)'\)/g)) {
        if (!defined.has(m[1])) undef.push(f + ': ' + m[1]);
      }
      src.split('\n').forEach((line, i) => {
        if (/function cssVar/.test(line)) return;
        if (/cssVar\((?!'--)/.test(line)) nonLiteral.push(f + ':' + (i + 1));
      });
    }
    assert.deepStrictEqual(undef, []);
    assert.deepStrictEqual(nonLiteral, []);
  });

  it('var(--x) 参照はすべて tokens.css に定義され、定義は tokens.css だけにある', () => {
    const undef = [];
    for (const f of [...cssFiles, ...jsFiles]) {
      for (const m of read(f).matchAll(/var\((--[a-z0-9-]+)/g)) {
        if (!defined.has(m[1])) undef.push(f + ': ' + m[1]);
      }
    }
    assert.deepStrictEqual(undef, []);
    const stray = cssFiles.filter((f) => f !== 'styles/tokens.css' && new RegExp(DEF_RE.source, 'm').test(read(f)));
    assert.deepStrictEqual(stray, []);
  });
});
