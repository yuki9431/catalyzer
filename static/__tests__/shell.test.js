import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert';
import { TAB_ITEMS, TAB_ICONS, VIEW_KEY, readView, tabOf, tabDot } from '../components/shell.js';

function stubStorage(impl) {
  Object.defineProperty(globalThis, 'localStorage', { value: impl, configurable: true });
}

describe('shell', () => {
  afterEach(() => { delete globalThis.localStorage; });

  it('TAB_ITEMS は 5 項目が決まった順', () => {
    assert.deepStrictEqual(TAB_ITEMS.map((t) => [t.key, t.label]), [['home', 'ホーム'], ['report', 'レポート'], ['search', '試合検索'], ['notes', 'メモ'], ['more', 'その他']]);
  });

  it('readView は保存された 5 値をそのまま返す', () => {
    TAB_ITEMS.forEach((t) => {
      stubStorage({ getItem: (k) => (k === VIEW_KEY ? t.key : null) });
      assert.strictEqual(readView(), t.key);
    });
  });

  it('readView は総合戦歴(その他の下の画面)の保存値もそのまま返す', () => {
    stubStorage({ getItem: () => 'classrecord' });
    assert.strictEqual(readView(), 'classrecord');
  });

  it('tabOf は総合戦歴をその他に寄せ、他とプロトタイプ名はそのまま返す', () => {
    assert.strictEqual(tabOf('classrecord'), 'more');
    assert.strictEqual(tabOf('notes'), 'notes');
    assert.strictEqual(tabOf('valueOf'), 'valueOf');
  });

  it('tabDot は下の画面の点を親タブに出し、表示中のタブには出さない', () => {
    assert.strictEqual(tabDot({ classrecord: true }, 'more', 'home'), true);
    assert.strictEqual(tabDot({ classrecord: true }, 'more', 'more'), false);
    assert.strictEqual(tabDot({ classrecord: true }, 'more', 'classrecord'), false);
    assert.strictEqual(tabDot({ classrecord: true }, 'notes', 'home'), false);
    assert.strictEqual(tabDot({ report: true }, 'report', 'classrecord'), true);
    assert.strictEqual(tabDot(undefined, 'more', 'home'), false);
  });

  it('TAB_ICONS は全タブに関数を持ち、classrecord は持たない', () => {
    TAB_ITEMS.forEach((t) => assert.strictEqual(typeof TAB_ICONS[t.key], 'function', t.key));
    assert.ok(!('classrecord' in TAB_ICONS));
  });

  it('readView は未保存・未知・プロトタイプ名・例外で home(ログアウト後の再ログインもホームで開く)', () => {
    [null, 'foo', 'valueOf'].forEach((v) => {
      stubStorage({ getItem: () => v });
      assert.strictEqual(readView(), 'home');
    });
    stubStorage({ getItem: () => { throw new Error('denied'); } });
    assert.strictEqual(readView(), 'home');
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

  it('MoreView は総合戦歴の行だけを持ち、メモは持たない', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('../components/shell.js', import.meta.url), 'utf8');
    assert.match(src, /autoRefresh, onClassRecord, classRecordDot \}\)/);
    assert.ok(src.includes("dot: !!classRecordDot"));
    assert.ok(!src.includes("from './notes.js'"));
    assert.ok(!/notesRow|more-notes/.test(src));
  });

  it('shell.js が描く部品(<${X})は全て import か定義済み', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('../components/shell.js', import.meta.url), 'utf8');
    const used = new Set(Array.from(src.matchAll(/<\$\{(\w+)\}/g)).map((m) => m[1]));
    used.forEach((n) => {
      assert.ok(new RegExp('import \\{[^}]*\\b' + n + '\\b[^}]*\\}').test(src) || new RegExp('function ' + n + '\\b').test(src), n);
    });
  });
});
