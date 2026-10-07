import { describe, it } from 'node:test';
import assert from 'node:assert';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');
const SRC = read('../theme-init.js');

// opts: stored(保存値)/ osLight / noMatchMedia / getItemThrows / storageThrows / setItemThrows
function load(opts) {
  opts = opts || {};
  const attrs = {};
  const meta = { content: null, setAttribute(k, v) { if (k === 'content') this.content = v; } };
  const listeners = [];
  const store = { v: opts.stored === undefined ? null : opts.stored };
  const win = {
    document: {
      documentElement: { setAttribute(k, v) { attrs[k] = v; }, getAttribute(k) { return attrs[k]; } },
      querySelector(sel) { return sel === 'meta[name="theme-color"]' ? meta : null; },
    },
  };
  const mq = { matches: !!opts.osLight, addEventListener(t, fn) { listeners.push(fn); } };
  if (!opts.noMatchMedia) win.matchMedia = (q) => (q === '(prefers-color-scheme: light)' ? mq : { matches: false, addEventListener() {} });
  if (opts.storageThrows) Object.defineProperty(win, 'localStorage', { get() { throw new Error('denied'); } });
  else win.localStorage = {
    getItem() { if (opts.getItemThrows) throw new Error('x'); return store.v; },
    setItem(k, v) { if (opts.setItemThrows) throw new Error('quota'); store.v = v; },
  };
  vm.runInNewContext(SRC, { window: win });
  const fire = (osLight) => { mq.matches = osLight; listeners.forEach((fn) => fn()); };
  return { api: win.catalyzerTheme, attrs, meta, store, fire };
}

describe('theme-init', () => {
  it('保存値 dark/light/system がそのまま選択になる', () => {
    ['dark', 'light', 'system'].forEach((v) => assert.strictEqual(load({ stored: v }).api.choice(), v));
  });

  it('未保存・未知値・例外は system で、例外を投げない', () => {
    [{}, { stored: 'foo' }, { stored: 'valueOf' }, { getItemThrows: true }, { storageThrows: true }].forEach((o) => {
      assert.strictEqual(load(o).api.choice(), 'system');
    });
  });

  it('resolve は system を OS で決め、dark/light はそのまま返す', () => {
    const { api } = load();
    assert.deepStrictEqual(
      [['system', false], ['system', true], ['dark', false], ['dark', true], ['light', false], ['light', true]].map(([c, o]) => api.resolve(c, o)),
      ['dark', 'light', 'dark', 'dark', 'light', 'light'],
    );
  });

  it('初期適用は選択を OS より優先し、meta も揃える', () => {
    let r = load({ stored: 'light', osLight: false });
    assert.deepStrictEqual([r.attrs['data-theme'], r.meta.content], ['light', '#f4f6f8']);
    r = load({ stored: 'dark', osLight: true });
    assert.deepStrictEqual([r.attrs['data-theme'], r.meta.content], ['dark', '#0e141b']);
    r = load({ stored: 'system', osLight: true });
    assert.strictEqual(r.attrs['data-theme'], 'light');
  });

  it('matchMedia が無ければダーク', () => {
    assert.strictEqual(load({ noMatchMedia: true }).attrs['data-theme'], 'dark');
  });

  it('set は保存して即適用し、保存に失敗しても適用し、未知値は system にする', () => {
    let r = load();
    r.api.set('light');
    assert.deepStrictEqual([r.store.v, r.attrs['data-theme']], ['light', 'light']);
    r = load({ setItemThrows: true });
    r.api.set('light');
    assert.strictEqual(r.attrs['data-theme'], 'light');
    r = load({ stored: 'light' });
    r.api.set('bogus');
    assert.deepStrictEqual([r.store.v, r.attrs['data-theme']], ['system', 'dark']);
  });

  it('OS の切替は system のときだけ反映する', () => {
    let r = load({ stored: 'system' });
    r.fire(true);
    assert.strictEqual(r.attrs['data-theme'], 'light');
    r = load({ stored: 'dark' });
    r.fire(true);
    assert.strictEqual(r.attrs['data-theme'], 'dark');
  });

  it('META は tokens.css の --bg と一致する', () => {
    const css = read('../styles/tokens.css');
    const bg = (marker) => css.slice(css.indexOf(marker)).match(/--bg:\s*(#[0-9a-f]{6});/i)[1].toLowerCase();
    const { META } = load().api;
    assert.strictEqual(META.dark, bg(':root {'));
    assert.strictEqual(META.light, bg(':root[data-theme="light"] {'));
  });

  it('index.html と parts.html は theme-init.js を最初の stylesheet より前に同期で読み、theme-color は1本', () => {
    ['../index.html', '../../tools/ui-check/preview/parts.html'].forEach((f) => {
      const html = read(f);
      const tag = html.match(/<script[^>]*theme-init\.js[^>]*>/);
      assert.ok(tag, f + ' に theme-init.js が無い');
      assert.ok(!/defer|async|type=/.test(tag[0]), f + ' は同期クラシックで読む');
      assert.ok(html.indexOf(tag[0]) < html.indexOf('rel="stylesheet"'), f);
    });
    assert.strictEqual((read('../index.html').match(/name="theme-color"/g) || []).length, 1);
  });
});
