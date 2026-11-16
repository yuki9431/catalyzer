import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import {
  sanitizeNotes, notesForEnemy, notesForMatch, hasNoteForMatch, groupByEnemy, notesByTab, tabCounts,
  noteTargetLabel, defaultDraft, draftFromNote, draftToRequest, textLength, validateDraft, canAddEnemy, enemyOptions, pinnedCount,
  upsertNote, removeNoteById, msChoices, loadDecision, responseOutcome,
} from '../lib/notes.js';
import { matchDraft, todayDraft } from '../components/notes.js';

function note(over) {
  return Object.assign({ id: 'n1', text: 'メモ', enemies: ['A'], my_ms: '', date: '', pinned: false, created_at: '2026-06-01T00:00:00Z', updated_at: '2026-06-01T00:00:00Z' }, over);
}
var LIMITS = { text_max: 500, count_max: 2000, pinned_max: 3, enemies_max: 5 };

describe('sanitizeNotes', () => {
  it('壊れた項目を落とし、欠けた文字列項目は空にする', () => {
    var out = sanitizeNotes([
      { id: 'a', text: 'x', enemies: ['A'] },
      { id: 1, text: 'x' },
      { id: 'c' },
      null,
    ]);
    assert.deepStrictEqual(out.map(function (n) { return n.id; }), ['a']);
    assert.deepStrictEqual([out[0].my_ms, out[0].date, out[0].pinned, out[0].updated_at], ['', '', false, '']);
  });
  it('配列でなければ空', () => {
    assert.deepStrictEqual(sanitizeNotes(null), []);
    assert.deepStrictEqual(sanitizeNotes({}), []);
  });
  it('enemies は空でない文字列だけの配列にし、配列でなければ空にする', () => {
    assert.deepStrictEqual(sanitizeNotes([{ id: 'a', text: 'x', enemies: ['A', '', 3, null, 'B'] }])[0].enemies, ['A', 'B']);
    assert.deepStrictEqual(sanitizeNotes([{ id: 'a', text: 'x', enemies: 'A' }])[0].enemies, []);
    assert.deepStrictEqual(sanitizeNotes([{ id: 'a', text: 'x' }])[0].enemies, []);
  });
  it('出力のキーは8つだけ(旧項目を持ち越さない)', () => {
    var out = sanitizeNotes([{ id: 'a', text: 'x', enemies: ['A'], extra: 1 }])[0];
    assert.deepStrictEqual(Object.keys(out).sort(), ['created_at', 'date', 'enemies', 'id', 'my_ms', 'pinned', 'text', 'updated_at']);
  });
});

describe('notesForEnemy', () => {
  var list = [note({ id: '1' }), note({ id: '2', my_ms: 'X' }), note({ id: '3', enemies: ['B'] }), note({ id: '4', enemies: [] })];
  it('自機を問わない(null)なら敵機が一致するものを全部', () => {
    assert.deepStrictEqual(notesForEnemy(list, 'A', null).map(function (n) { return n.id; }), ['1', '2']);
  });
  it('複数の敵機のどれかが一致すれば出る', () => {
    var multi = [note({ id: 'm', enemies: ['A', 'B'] })];
    assert.strictEqual(notesForEnemy(multi, 'A', null).length, 1);
    assert.strictEqual(notesForEnemy(multi, 'B', null).length, 1);
    assert.strictEqual(notesForEnemy(multi, 'C', null).length, 0);
  });
  it('自機を指定すると、指定なしと同じ自機のメモだけ', () => {
    assert.deepStrictEqual(notesForEnemy(list, 'A', 'X').map(function (n) { return n.id; }), ['1', '2']);
    assert.deepStrictEqual(notesForEnemy(list, 'A', 'Y').map(function (n) { return n.id; }), ['1']);
  });
});

describe('notesForMatch', () => {
  var list = [note({ id: '1', enemies: ['A'] }), note({ id: '2', enemies: ['B'], my_ms: 'M' }), note({ id: '3', enemies: ['B'], my_ms: 'Z' })];
  it('敵機ごとに opponent1・2 の順でまとめ、自機で絞る', () => {
    var g = notesForMatch(list, { ms: 'M', opponent1_ms: 'B', opponent2_ms: 'A' });
    assert.deepStrictEqual(g.map(function (x) { return x.enemy; }), ['B', 'A']);
    assert.deepStrictEqual(g[0].notes.map(function (n) { return n.id; }), ['2']);
  });
  it('相手2機が同じ機体なら1つにまとめる', () => {
    assert.strictEqual(notesForMatch(list, { ms: 'M', opponent1_ms: 'A', opponent2_ms: 'A' }).length, 1);
  });
  it('相手の片方だけがメモの敵機でも hasNoteForMatch は真(OR)', () => {
    var multi = [note({ id: 'm', enemies: ['A', 'B'] })];
    assert.strictEqual(hasNoteForMatch(multi, { ms: 'M', opponent1_ms: 'B', opponent2_ms: 'X' }), true);
    assert.strictEqual(hasNoteForMatch(multi, { ms: 'M', opponent1_ms: 'X', opponent2_ms: 'A' }), true);
  });
  it('相手2機を両方持つメモは両方の敵機の下に出る', () => {
    var multi = [note({ id: 'm', enemies: ['A', 'B'] })];
    var g = notesForMatch(multi, { ms: 'M', opponent1_ms: 'A', opponent2_ms: 'B' });
    assert.deepStrictEqual(g.map(function (x) { return x.notes.length; }), [1, 1]);
  });
  it('メモが無い敵機も返し、hasNoteForMatch は1件以上で真', () => {
    assert.strictEqual(notesForMatch([], { ms: 'M', opponent1_ms: 'A', opponent2_ms: 'B' }).length, 2);
    assert.strictEqual(hasNoteForMatch(list, { ms: 'M', opponent1_ms: 'A', opponent2_ms: 'C' }), true);
    assert.strictEqual(hasNoteForMatch(list, { ms: 'M', opponent1_ms: 'C', opponent2_ms: 'D' }), false);
    assert.strictEqual(hasNoteForMatch(list, { ms: 'Q', opponent1_ms: 'B', opponent2_ms: 'C' }), false);
  });
});

describe('groupByEnemy・notesByTab・tabCounts', () => {
  var list = [
    note({ id: '1', enemies: ['B'], updated_at: '2026-06-01T00:00:00Z' }),
    note({ id: '2', enemies: ['A'], updated_at: '2026-06-03T00:00:00Z', pinned: true }),
    note({ id: '3', enemies: ['B'], updated_at: '2026-06-02T00:00:00Z' }),
    note({ id: '4', enemies: [], date: '2026-06-10', updated_at: '2026-06-04T00:00:00Z' }),
    note({ id: '5', enemies: [], date: '2026-06-12', updated_at: '2026-06-01T00:00:00Z' }),
    note({ id: '6', enemies: [], updated_at: '2026-06-05T00:00:00Z' }),
  ];
  it('groupByEnemy は件数の多い順、同数は五十音順', () => {
    var g = groupByEnemy(list);
    assert.deepStrictEqual(g.map(function (x) { return [x.enemy, x.count]; }), [['B', 2], ['A', 1]]);
  });
  it('groupByEnemy は複数の敵機を持つメモを各敵機の下に入れ、件数にも数える', () => {
    var g = groupByEnemy([note({ id: '1', enemies: ['A', 'B'] }), note({ id: '2', enemies: ['B'] })]);
    assert.deepStrictEqual(g.map(function (x) { return [x.enemy, x.count, x.notes.map(function (n) { return n.id; })]; }), [['B', 2, ['1', '2']], ['A', 1, ['1']]]);
  });
  it('敵機と日付の両方を持つメモは enemy・date の両方に出て、tabCounts の両方に数える', () => {
    var both = [note({ id: 'x', enemies: ['A'], date: '2026-06-01' })];
    assert.deepStrictEqual(notesByTab(both, 'enemy').map(function (n) { return n.id; }), ['x']);
    assert.deepStrictEqual(notesByTab(both, 'date').map(function (n) { return n.id; }), ['x']);
    assert.deepStrictEqual(tabCounts(both), { all: 1, enemy: 1, date: 1, pin: 0 });
  });
  it('all は更新の新しい順', () => {
    assert.deepStrictEqual(notesByTab(list, 'all').map(function (n) { return n.id; }), ['6', '4', '2', '3', '1', '5']);
  });
  it('enemy・date・pin に絞る。date は日付の新しい順', () => {
    assert.deepStrictEqual(notesByTab(list, 'enemy').map(function (n) { return n.id; }), ['2', '3', '1']);
    assert.deepStrictEqual(notesByTab(list, 'date').map(function (n) { return n.id; }), ['5', '4']);
    assert.deepStrictEqual(notesByTab(list, 'pin').map(function (n) { return n.id; }), ['2']);
  });
  it('tabCounts', () => {
    assert.deepStrictEqual(tabCounts(list), { all: 6, enemy: 3, date: 2, pin: 1 });
  });
  it('更新が同じなら id の昇順', () => {
    var same = [note({ id: 'b' }), note({ id: 'a' })];
    assert.deepStrictEqual(notesByTab(same, 'all').map(function (n) { return n.id; }), ['a', 'b']);
  });
});

describe('noteTargetLabel', () => {
  it('日付と敵機を半角空白でつなぎ、どちらも無ければメモ', () => {
    assert.strictEqual(noteTargetLabel(note({ enemies: ['A', 'B'], date: '2026-06-15' })), '6/15 A・B');
    assert.strictEqual(noteTargetLabel(note({ enemies: [], date: '2026-06-05' })), '6/5');
    assert.strictEqual(noteTargetLabel(note({ enemies: ['A', 'B'] })), 'A・B');
    assert.strictEqual(noteTargetLabel(note({ enemies: [] })), 'メモ');
  });
});

describe('draft', () => {
  it('defaultDraft は { enemy, date } を受け、無ければ敵機0欄・日付なし。自機は指定しない', () => {
    assert.deepStrictEqual(defaultDraft({ enemy: 'A', date: '2026-06-01' }), { id: null, text: '', enemies: ['A'], my_ms: '', date: '2026-06-01', pinned: false });
    assert.deepStrictEqual(defaultDraft(), { id: null, text: '', enemies: [], my_ms: '', date: '', pinned: false });
    assert.deepStrictEqual(defaultDraft({}).enemies, []);
  });
  it('draftFromNote は編集できる項目と id だけで、敵機は複製する', () => {
    var n = note({ my_ms: 'X', pinned: true });
    var d = draftFromNote(n);
    assert.deepStrictEqual(d, { id: 'n1', text: 'メモ', enemies: ['A'], my_ms: 'X', date: '', pinned: true });
    assert.notStrictEqual(d.enemies, n.enemies);
  });
  it('draftToRequest は CRLF を LF にし前後の空白を除く', () => {
    assert.strictEqual(draftToRequest(Object.assign(defaultDraft({ enemy: 'A' }), { text: '  a\r\nb \n' })).text, 'a\nb');
  });
  it('draftToRequest は未選択の欄を落とし、前後の空白を除いて順序を保つ', () => {
    var d = { id: 'x', text: 't', enemies: [' B ', '', 'A', '  '], my_ms: 'M', date: '2026-06-01', pinned: true };
    assert.deepStrictEqual(draftToRequest(d), { text: 't', enemies: ['B', 'A'], my_ms: 'M', date: '2026-06-01', pinned: true });
  });
  it('matchDraft は試合のプレイ日(朝5時切替)と相手の1機目', () => {
    var d = matchDraft({ date: '2026-06-15 03:00', opponent1_ms: 'A', opponent2_ms: 'B' });
    assert.strictEqual(d.date, '2026-06-14');
    assert.deepStrictEqual(d.enemies, ['A']);
  });
  it('todayDraft は今日のプレイ日で、敵機が空なら0欄', () => {
    var now = new Date(2026, 5, 15, 4, 0);
    assert.strictEqual(todayDraft('', now).date, '2026-06-14');
    assert.deepStrictEqual(todayDraft('', now).enemies, []);
    assert.deepStrictEqual(todayDraft('A', now).enemies, ['A']);
  });
  it('canAddEnemy は上限未満で真、到達で偽、limits が無ければ偽(未選択の欄も数える)', () => {
    assert.strictEqual(canAddEnemy({ enemies: ['A', ''] }, LIMITS), true);
    assert.strictEqual(canAddEnemy({ enemies: ['A', 'B', 'C', 'D', ''] }, LIMITS), false);
    assert.strictEqual(canAddEnemy({ enemies: [] }, null), false);
    assert.strictEqual(canAddEnemy({ enemies: [] }, { text_max: 500 }), false);
  });
  it('enemyOptions は他の欄の機体を除き、自分の値は残し、選択肢に無い値を足す', () => {
    var opts = [{ value: 'A', label: 'A' }, { value: 'B', label: 'B' }, { value: 'C', label: 'C' }];
    var values = function (o) { return o.map(function (x) { return x.value; }); };
    assert.deepStrictEqual(values(enemyOptions(opts, ['A', 'B'], 1)), ['B', 'C']);
    assert.deepStrictEqual(values(enemyOptions(opts, ['A', ''], 1)), ['B', 'C']);
    assert.deepStrictEqual(values(enemyOptions(opts, ['Z', 'B'], 0)), ['A', 'C', 'Z']);
  });
});

describe('textLength・validateDraft', () => {
  it('絵文字は1文字、CRLF は1文字として数える', () => {
    assert.strictEqual(textLength('😀😀'), 2);
    assert.strictEqual(textLength('a\r\nb'), 3);
    assert.strictEqual(textLength('  '), 0);
  });
  var ok = function (over) { return Object.assign(defaultDraft({ enemy: 'A' }), { text: 'x' }, over); };
  it('保存できるなら空文字', () => {
    assert.strictEqual(validateDraft(ok(), LIMITS, 0), '');
  });
  it('本文が空・長すぎる', () => {
    assert.strictEqual(validateDraft(ok({ text: ' ' }), LIMITS, 0), 'メモの本文を入力してください');
    assert.strictEqual(validateDraft(ok({ text: 'あ'.repeat(500) }), LIMITS, 0), '');
    assert.strictEqual(validateDraft(ok({ text: 'あ'.repeat(501) }), LIMITS, 0), 'メモは500文字までです');
    assert.strictEqual(validateDraft(ok({ text: '😀'.repeat(500) }), LIMITS, 0), '');
  });
  it('上限は limits の値に従う', () => {
    assert.strictEqual(validateDraft(ok({ text: 'abc' }), { text_max: 2, pinned_max: 3 }, 0), 'メモは2文字までです');
  });
  it('敵機は空でない欄の数で上限を判定する(未選択の欄は数えない)', () => {
    assert.strictEqual(validateDraft(ok({ enemies: ['A', 'B', 'C', 'D', 'E'] }), LIMITS, 0), '');
    assert.strictEqual(validateDraft(ok({ enemies: ['A', 'B', 'C', 'D', 'E', ''] }), LIMITS, 0), '');
    assert.strictEqual(validateDraft(ok({ enemies: ['A', 'B', 'C', 'D', 'E', 'F'] }), LIMITS, 0), '敵機は5機までです');
    assert.strictEqual(validateDraft(ok({ enemies: [] }), LIMITS, 0), '');
  });
  it('敵機の重複は止め、日付は空なら通す', () => {
    assert.strictEqual(validateDraft(ok({ enemies: ['A', 'B', 'A'] }), LIMITS, 0), '同じ敵機が重複しています');
    assert.strictEqual(validateDraft(ok({ enemies: ['A', ' A '] }), LIMITS, 0), '同じ敵機が重複しています');
    assert.strictEqual(validateDraft(ok({ date: '' }), LIMITS, 0), '');
  });
  it('日付の形式が不正なら止める', () => {
    assert.strictEqual(validateDraft(ok({ date: '2026-13-01' }), LIMITS, 0), '日付の形式が正しくありません');
    assert.strictEqual(validateDraft(ok({ date: '2026-02-30' }), LIMITS, 0), '日付の形式が正しくありません');
    assert.strictEqual(validateDraft(ok({ date: '2026-06-15' }), LIMITS, 0), '');
  });
  it('他のピンが上限に達しているとピン留めできない', () => {
    assert.strictEqual(validateDraft(ok({ pinned: true }), LIMITS, 3), 'ピン留めは3件までです');
    assert.strictEqual(validateDraft(ok({ pinned: true }), LIMITS, 2), '');
    assert.strictEqual(validateDraft(ok({ pinned: false }), LIMITS, 3), '');
  });
});

describe('一覧の更新', () => {
  it('pinnedCount は自分を除く', () => {
    var list = [note({ id: '1', pinned: true }), note({ id: '2', pinned: true }), note({ id: '3' })];
    assert.strictEqual(pinnedCount(list, null), 2);
    assert.strictEqual(pinnedCount(list, '1'), 1);
  });
  it('upsertNote は同じ id を置き換え、無ければ先頭に足す', () => {
    var list = [note({ id: '1' }), note({ id: '2' })];
    assert.deepStrictEqual(upsertNote(list, note({ id: '2', text: '新' })).map(function (n) { return n.text; }), ['メモ', '新']);
    assert.deepStrictEqual(upsertNote(list, note({ id: '3' })).map(function (n) { return n.id; }), ['3', '1', '2']);
  });
  it('removeNoteById', () => {
    assert.deepStrictEqual(removeNoteById([note({ id: '1' }), note({ id: '2' })], '1').map(function (n) { return n.id; }), ['2']);
  });
});

describe('msChoices', () => {
  var matches = [
    { ms: 'M1', opponent1_ms: 'B', opponent2_ms: 'A' },
    { ms: 'M2', opponent1_ms: 'B', opponent2_ms: 'C' },
    { ms: 'M2', opponent1_ms: 'B', opponent2_ms: 'A' },
  ];
  it('対戦した機体を試合数の多い順、続けて画像だけにある機体を五十音順', () => {
    var c = msChoices({ Z: 'z', A: 'a', Y: 'y' }, matches);
    assert.deepStrictEqual(c.enemies.map(function (o) { return o.value; }), ['B', 'A', 'C', 'Y', 'Z']);
    assert.deepStrictEqual(c.mine.map(function (o) { return o.value; }), ['M2', 'M1', 'A', 'Y', 'Z']);
  });
  it('msImages・matches が無くても動く', () => {
    assert.deepStrictEqual(msChoices(null, null), { enemies: [], mine: [] });
  });
});

describe('静的検査', () => {
  ['../components/notes.js', '../lib/notes.js'].forEach(function (f) {
    var src = fs.readFileSync(new URL(f, import.meta.url), 'utf8');
    it(f + ' は innerHTML・dangerouslySetInnerHTML・localStorage を使わない', () => {
      ['dangerouslySetInnerHTML', 'innerHTML', 'localStorage'].forEach(function (w) { assert.ok(!src.includes(w), w); });
    });
  });
  it('lib/notes.js は import を持たない', () => {
    assert.ok(!/^\s*import\s/m.test(fs.readFileSync(new URL('../lib/notes.js', import.meta.url), 'utf8')));
  });
});

describe('loadDecision', () => {
  it('ユーザーが無い・API が使えないときは off', () => {
    assert.strictEqual(loadDecision('', true, null, null), 'off');
    assert.strictEqual(loadDecision('u1', false, null, null), 'off');
  });
  it('取得済み・同じユーザーを取得中なら skip、それ以外は load', () => {
    assert.strictEqual(loadDecision('u1', true, 'u1', null), 'skip');
    assert.strictEqual(loadDecision('u1', true, null, 'u1'), 'skip');
    assert.strictEqual(loadDecision('u1', true, null, null), 'load');
  });
  it('別ユーザーの取得中・取得済みでも新しいユーザーは load する', () => {
    assert.strictEqual(loadDecision('u2', true, 'u1', null), 'load');
    assert.strictEqual(loadDecision('u2', true, null, 'u1'), 'load');
  });
});

describe('responseOutcome', () => {
  var ok = { status: 200, body: { user_key: 'u1', notes: [] } };
  it('取得中にユーザーが替わった応答は stale で捨てる(新ユーザーを error で確定しない)', () => {
    assert.strictEqual(responseOutcome('u1', 'u2', ok), 'stale');
    assert.strictEqual(responseOutcome('u1', '', ok), 'stale');
  });
  it('本人の 200 は on、401 は off、それ以外と別人の応答は error', () => {
    assert.strictEqual(responseOutcome('u1', 'u1', ok), 'on');
    assert.strictEqual(responseOutcome('u1', 'u1', { status: 401, body: null }), 'off');
    assert.strictEqual(responseOutcome('u1', 'u1', { status: 500, body: null }), 'error');
    assert.strictEqual(responseOutcome('u1', 'u1', { status: 200, body: { user_key: 'u9' } }), 'error');
  });
});

describe('useNotes の取得の判定', () => {
  var src = fs.readFileSync(new URL('../components/notes.js', import.meta.url), 'utf8');
  it('使えなくなったら取得済みの印を外す(同じユーザーで再ログインしたとき取り直す)', () => {
    assert.match(src, /if \(d === 'off'\) \{\s*settled\.current = null;/);
  });
  it('応答は取得時のユーザーと今のユーザーで判定する', () => {
    assert.match(src, /responseOutcome\(key, current\.current, res\)/);
  });
});

describe('NoteList・その他画面の受け渡し', () => {
  var src = fs.readFileSync(new URL('../components/notes.js', import.meta.url), 'utf8');
  var report = fs.readFileSync(new URL('../components/report/report.js', import.meta.url), 'utf8');
  it('NoteList は groupByEnemy・notesByTab・tabCounts を import して使う', () => {
    var imp = src.slice(src.indexOf('import {\n'), src.indexOf("} from '../lib/notes.js'"));
    assert.ok(imp.length > 0);
    ['groupByEnemy', 'notesByTab', 'tabCounts'].forEach(function (f) {
      assert.match(imp, new RegExp('\\b' + f + '\\b'));
      assert.ok(src.includes(f + '('), f);
    });
    ['note-list', 'note-list-back', 'note-tabs', 'note-group'].forEach(function (u) { assert.ok(src.includes(u), u); });
  });
  it('report.js の MoreView は Report の呼び出しだけ notes を渡し、Skeleton 側は渡さない', () => {
    var calls = Array.from(report.matchAll(/<\$\{MoreView\}[^>]*\/>/g)).map(function (m) { return m[0]; });
    assert.strictEqual(calls.length, 2);
    assert.strictEqual(calls.filter(function (c) { return /notes=\$\{notes\}/.test(c); }).length, 1);
  });
  it('more view にも NoteSheet を描く', () => {
    var i = report.indexOf("view === 'more'");
    assert.ok(report.slice(i, i + 900).includes('<${NoteSheet}'));
  });
});
