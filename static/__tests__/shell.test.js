import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert';
import { TAB_ITEMS, VIEW_KEY, readView } from '../components/shell.js';

function stubStorage(impl) {
  Object.defineProperty(globalThis, 'localStorage', { value: impl, configurable: true });
}

describe('shell', () => {
  afterEach(() => { delete globalThis.localStorage; });

  it('TAB_ITEMS は 5 項目が決まった順', () => {
    assert.deepStrictEqual(TAB_ITEMS.map((t) => [t.key, t.label]), [['home', 'ホーム'], ['report', 'レポート'], ['search', '試合検索'], ['classrecord', '総合戦歴'], ['more', 'その他']]);
  });

  it('readView は保存された 5 値をそのまま返す', () => {
    TAB_ITEMS.forEach((t) => {
      stubStorage({ getItem: (k) => (k === VIEW_KEY ? t.key : null) });
      assert.strictEqual(readView(), t.key);
    });
  });

  it('readView は未保存・未知・プロトタイプ名・例外で report', () => {
    [null, 'foo', 'valueOf'].forEach((v) => {
      stubStorage({ getItem: () => v });
      assert.strictEqual(readView(), 'report');
    });
    stubStorage({ getItem: () => { throw new Error('denied'); } });
    assert.strictEqual(readView(), 'report');
  });
});

describe('shell ソース', () => {
  it('MoreView の hasShare は真偽値化され、数値 0 を描画しない', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('../components/shell.js', import.meta.url), 'utf8');
    assert.match(src, /var hasShare = !!\(shareData && shareData\.length\);/);
    assert.doesNotMatch(src, /\.length\s*&&\s*html`/);
  });

  it('useCollapsingBar はスクロールロック中(シート表示中)に状態を更新しない', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('../components/shell.js', import.meta.url), 'utf8');
    const apply = src.slice(src.indexOf('function apply()'), src.indexOf('function schedule()'));
    assert.ok(/scrollLocked\(\)\) return;/.test(apply));
  });
});
