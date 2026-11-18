import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import {
  sanitizeNotes, notesForEnemy, notesForMatch, hasNoteForMatch, groupByMs, notesByTab, tabCounts,
  noteTargetLabel, defaultDraft, draftFromNote, draftToRequest, textLength, validateDraft, canAddEnemy, enemyOptions, pinnedCount, swipeAxis, swipeOffset, swipeOpens, createTapGuard,
  upsertNote, removeNoteById, msChoices, loadDecision, responseOutcome, matchEnemies, pinnedNotes, canPinMore, lastPlayedMs,
} from '../lib/notes.js';
import { Notice } from '../components/parts.js';
import { matchDraft, todayDraft, homeDraft, PinnedNotes, NoteItem, NotesView } from '../components/notes.js';

function note(over) {
  return Object.assign({ id: 'n1', text: 'メモ', enemies: ['A'], my_ms: '', partner_ms: '', date: '', pinned: false, created_at: '2026-06-01T00:00:00Z', updated_at: '2026-06-01T00:00:00Z' }, over);
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
  it('出力のキーは9つだけ(旧項目を持ち越さない)。僚機の欠けは空', () => {
    var out = sanitizeNotes([{ id: 'a', text: 'x', enemies: ['A'], extra: 1 }])[0];
    assert.deepStrictEqual(Object.keys(out).sort(), ['created_at', 'date', 'enemies', 'id', 'my_ms', 'partner_ms', 'pinned', 'text', 'updated_at']);
    assert.strictEqual(out.partner_ms, '');
    assert.strictEqual(sanitizeNotes([{ id: 'a', text: 'x', partner_ms: 'P' }])[0].partner_ms, 'P');
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
    assert.deepStrictEqual(g.map(function (x) { return x.head; }), ['B', 'A']);
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
  it('相手2機を両方持つメモは「A・B」の組に1回だけ出て、1機ずつの組には出ない', () => {
    var multi = [note({ id: 'm', enemies: ['C', 'B', 'A'] }), note({ id: 'a', enemies: ['A', 'C'] })];
    var g = notesForMatch(multi, { ms: 'M', opponent1_ms: 'A', opponent2_ms: 'B' });
    assert.deepStrictEqual(g.map(function (x) { return [x.head, x.notes.map(function (n) { return n.id; })]; }), [['A', ['a']], ['B', []], ['A・B', ['m']]]);
  });
  it('相手1機だけの試合では、2機を持つメモもその1機の組に入り「A・B」の組は作らない', () => {
    var g = notesForMatch([note({ id: 'm', enemies: ['A', 'B'] })], { ms: 'M', opponent1_ms: 'A', opponent2_ms: '' });
    assert.deepStrictEqual(g.map(function (x) { return [x.head, x.notes.map(function (n) { return n.id; })]; }), [['A', ['m']]]);
  });
  it('2機の組は該当が無ければ出さず、相手が同じ機体2機なら作らない', () => {
    assert.deepStrictEqual(notesForMatch([note({ enemies: ['A'] })], { ms: 'M', opponent1_ms: 'A', opponent2_ms: 'B' }).map(function (x) { return x.head; }), ['A', 'B']);
    assert.deepStrictEqual(notesForMatch([note({ enemies: ['A'] })], { ms: 'M', opponent1_ms: 'A', opponent2_ms: 'A' }).map(function (x) { return x.head; }), ['A']);
  });
  it('メモが無い敵機も返し、hasNoteForMatch は1件以上で真', () => {
    assert.strictEqual(notesForMatch([], { ms: 'M', opponent1_ms: 'A', opponent2_ms: 'B' }).length, 2);
    assert.strictEqual(hasNoteForMatch(list, { ms: 'M', opponent1_ms: 'A', opponent2_ms: 'C' }), true);
    assert.strictEqual(hasNoteForMatch(list, { ms: 'M', opponent1_ms: 'C', opponent2_ms: 'D' }), false);
    assert.strictEqual(hasNoteForMatch(list, { ms: 'Q', opponent1_ms: 'B', opponent2_ms: 'C' }), false);
  });
  it('僚機を指定したメモは、同じ僚機の試合だけに出る', () => {
    var p = [note({ id: 'p', enemies: ['A'], partner_ms: 'P' })];
    assert.strictEqual(hasNoteForMatch(p, { ms: 'M', partner_ms: 'P', opponent1_ms: 'A', opponent2_ms: 'B' }), true);
    assert.strictEqual(hasNoteForMatch(p, { ms: 'M', partner_ms: 'Q', opponent1_ms: 'A', opponent2_ms: 'B' }), false);
  });
  it('敵機の無いメモは、自機か僚機を指定して合うときだけ末尾の head が空の組に入る', () => {
    var own = [note({ id: 'o', enemies: [], my_ms: 'M' }), note({ id: 'q', enemies: [], partner_ms: 'P' }), note({ id: 'n', enemies: [] }), note({ id: 'z', enemies: [], my_ms: 'Z' })];
    var g = notesForMatch(own, { ms: 'M', partner_ms: 'P', opponent1_ms: 'A', opponent2_ms: 'B' });
    assert.deepStrictEqual(g.map(function (x) { return [x.head, x.notes.map(function (n) { return n.id; })]; }), [['A', []], ['B', []], ['', ['o', 'q']]]);
    assert.strictEqual(notesForMatch(own, { ms: 'X', partner_ms: 'Y', opponent1_ms: 'A', opponent2_ms: 'B' }).length, 2);
  });
});

describe('groupByMs・notesByTab・tabCounts', () => {
  var list = [
    note({ id: '1', enemies: ['B'], updated_at: '2026-06-01T00:00:00Z' }),
    note({ id: '2', enemies: ['A'], updated_at: '2026-06-03T00:00:00Z', pinned: true }),
    note({ id: '3', enemies: ['B'], updated_at: '2026-06-02T00:00:00Z' }),
    note({ id: '4', enemies: [], date: '2026-06-10', updated_at: '2026-06-04T00:00:00Z' }),
    note({ id: '5', enemies: [], date: '2026-06-12', updated_at: '2026-06-01T00:00:00Z' }),
    note({ id: '6', enemies: [], updated_at: '2026-06-05T00:00:00Z' }),
  ];
  it('groupByMs(enemies) は件数の多い順、同数は五十音順', () => {
    var g = groupByMs(list, 'enemies');
    assert.deepStrictEqual(g.map(function (x) { return [x.ms, x.count]; }), [['B', 2], ['A', 1]]);
  });
  it('groupByMs(enemies) は複数の敵機を持つメモを各敵機の下に入れ、件数にも数える', () => {
    var g = groupByMs([note({ id: '1', enemies: ['A', 'B'] }), note({ id: '2', enemies: ['B'] })], 'enemies');
    assert.deepStrictEqual(g.map(function (x) { return [x.ms, x.count, x.notes.map(function (n) { return n.id; })]; }), [['B', 2, ['1', '2']], ['A', 1, ['1']]]);
  });
  it('groupByMs(my_ms・partner_ms) は指定の無いメモを除き、機体ごとにまとめる', () => {
    var ms = [note({ id: '1', my_ms: 'X', partner_ms: 'P' }), note({ id: '2', my_ms: 'X' }), note({ id: '3' })];
    assert.deepStrictEqual(groupByMs(ms, 'my_ms').map(function (x) { return [x.ms, x.count]; }), [['X', 2]]);
    assert.deepStrictEqual(groupByMs(ms, 'partner_ms').map(function (x) { return [x.ms, x.count]; }), [['P', 1]]);
    assert.deepStrictEqual(notesByTab(ms, 'mine').map(function (n) { return n.id; }).sort(), ['1', '2']);
    assert.deepStrictEqual(notesByTab(ms, 'partner').map(function (n) { return n.id; }), ['1']);
  });
  it('敵機と日付の両方を持つメモは enemy・date の両方に出て、tabCounts の両方に数える', () => {
    var both = [note({ id: 'x', enemies: ['A'], date: '2026-06-01' })];
    assert.deepStrictEqual(notesByTab(both, 'enemy').map(function (n) { return n.id; }), ['x']);
    assert.deepStrictEqual(notesByTab(both, 'date').map(function (n) { return n.id; }), ['x']);
    assert.deepStrictEqual(tabCounts(both), { all: 1, enemy: 1, mine: 0, partner: 0, date: 1 });
  });
  it('all はピン留めを先頭に置き、その中とそれ以外は更新の新しい順', () => {
    assert.deepStrictEqual(notesByTab(list, 'all').map(function (n) { return n.id; }), ['2', '6', '4', '3', '1', '5']);
    var pins = list.map(function (n) { return n.id === '1' ? note(Object.assign({}, n, { pinned: true })) : n; });
    assert.deepStrictEqual(notesByTab(pins, 'all').map(function (n) { return n.id; }), ['2', '1', '6', '4', '3', '5']);
  });
  it('enemy・date・pin に絞る。date は日付の新しい順', () => {
    assert.deepStrictEqual(notesByTab(list, 'enemy').map(function (n) { return n.id; }), ['2', '3', '1']);
    assert.deepStrictEqual(notesByTab(list, 'date').map(function (n) { return n.id; }), ['5', '4']);
    assert.deepStrictEqual(notesByTab(list, 'pin').map(function (n) { return n.id; }), ['2']);
  });
  it('tabCounts', () => {
    assert.deepStrictEqual(tabCounts(list), { all: 6, enemy: 3, mine: 0, partner: 0, date: 2 });
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
  it('defaultDraft は { enemies, my_ms, date, pinned } を受け、無ければ敵機0欄・自機なし・日付なし・ピンなし。敵機は複製し、僚機は指定しない', () => {
    assert.deepStrictEqual(defaultDraft({ enemies: ['A', 'B'], my_ms: 'M', date: '2026-06-01', pinned: true }), { id: null, text: '', enemies: ['A', 'B'], my_ms: 'M', partner_ms: '', date: '2026-06-01', pinned: true });
    assert.deepStrictEqual(defaultDraft(), { id: null, text: '', enemies: [], my_ms: '', partner_ms: '', date: '', pinned: false });
    assert.deepStrictEqual(defaultDraft({}).enemies, []);
    var src = ['A'];
    assert.notStrictEqual(defaultDraft({ enemies: src }).enemies, src);
  });
  it('draftFromNote は編集できる項目と id だけで、敵機は複製する', () => {
    var n = note({ my_ms: 'X', partner_ms: 'P', pinned: true });
    var d = draftFromNote(n);
    assert.deepStrictEqual(d, { id: 'n1', text: 'メモ', enemies: ['A'], my_ms: 'X', partner_ms: 'P', date: '', pinned: true });
    assert.notStrictEqual(d.enemies, n.enemies);
  });
  it('draftToRequest は CRLF を LF にし前後の空白を除く', () => {
    assert.strictEqual(draftToRequest(Object.assign(defaultDraft({ enemies: ['A'] }), { text: '  a\r\nb \n' })).text, 'a\nb');
  });
  it('draftToRequest は未選択の欄を落とし、前後の空白を除いて順序を保つ', () => {
    var d = { id: 'x', text: 't', enemies: [' B ', '', 'A', '  '], my_ms: 'M', partner_ms: ' P ', date: '2026-06-01', pinned: true };
    assert.deepStrictEqual(draftToRequest(d), { text: 't', enemies: ['B', 'A'], my_ms: 'M', partner_ms: 'P', date: '2026-06-01', pinned: true });
  });
  it('matchDraft は試合のプレイ日(朝5時切替)と相手の2機。同じ機体は1機、空は除く', () => {
    var d = matchDraft({ date: '2026-06-15 03:00', opponent1_ms: 'A', opponent2_ms: 'B' });
    assert.strictEqual(d.date, '2026-06-14');
    assert.deepStrictEqual(d.enemies, ['A', 'B']);
    assert.deepStrictEqual(matchDraft({ date: '2026-06-15 12:00', opponent1_ms: 'A', opponent2_ms: 'A' }).enemies, ['A']);
    assert.deepStrictEqual(matchDraft({ date: '2026-06-15 12:00', opponent1_ms: 'A', opponent2_ms: '' }).enemies, ['A']);
  });
  it('matchDraft は自機にその試合の機体を入れ、僚機は指定しない', () => {
    var d = matchDraft({ date: '2026-06-15 12:00', ms: 'M', partner_ms: 'P', opponent1_ms: 'A', opponent2_ms: 'B' });
    assert.strictEqual(d.my_ms, 'M');
    assert.strictEqual(d.partner_ms, '');
  });
  it('todayDraft は今日のプレイ日で、敵機が空なら0欄', () => {
    var now = new Date(2026, 5, 15, 4, 0);
    assert.strictEqual(todayDraft('', '', now).date, '2026-06-14');
    assert.deepStrictEqual(todayDraft('', '', now).enemies, []);
    assert.deepStrictEqual(todayDraft('A', '', now).enemies, ['A']);
    assert.strictEqual(todayDraft('A', 'M', now).my_ms, 'M');
  });
  it('lastPlayedMs は日時が最も新しい試合の自機。試合が無ければ空', () => {
    assert.strictEqual(lastPlayedMs([{ date: '2026-06-15 12:00', ms: 'A' }, { date: '2026-06-15 21:00', ms: 'B' }, { date: '2026-06-14 23:00', ms: 'C' }]), 'B');
    assert.strictEqual(lastPlayedMs([]), '');
    assert.strictEqual(lastPlayedMs(null), '');
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
  var ok = function (over) { return Object.assign(defaultDraft({ enemies: ['A'] }), { text: 'x' }, over); };
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
    assert.deepStrictEqual(msChoices(null, null), { enemies: [], mine: [], partners: [] });
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
  it('行の操作(fromRow)の保存・削除は、後から開いた編集シートを閉じない', () => {
    assert.match(src, /function save\(d, fromRow\)[\s\S]*?upsertNote\(list, note\); \}\); if \(!fromRow\) setDraft\(null\);/);
    assert.match(src, /function remove\(id, fromRow\)[\s\S]*?removeNoteById\(list, id\); \}\); if \(!fromRow\) setDraft\(null\);/);
    var row = src.slice(src.indexOf('export function SwipeNote'), src.indexOf('function useSwipeRows'));
    assert.match(row, /notes\.save\([^;]*\), true\)/);
    assert.match(row, /notes\.remove\(note\.id, true\)/);
  });
});

describe('NoteList・その他画面の受け渡し', () => {
  var src = fs.readFileSync(new URL('../components/notes.js', import.meta.url), 'utf8');
  var report = fs.readFileSync(new URL('../components/report/report.js', import.meta.url), 'utf8');
  it('NoteList は groupByMs・notesByTab・tabCounts を import して使う', () => {
    var imp = src.slice(src.indexOf('import {\n'), src.indexOf("} from '../lib/notes.js'"));
    assert.ok(imp.length > 0);
    ['groupByMs', 'notesByTab', 'tabCounts'].forEach(function (f) {
      assert.match(imp, new RegExp('\\b' + f + '\\b'));
      assert.ok(src.includes(f + '('), f);
    });
    ['note-list', 'note-tabs', 'note-group', 'notes-view'].forEach(function (u) { assert.ok(src.includes(u), u); });
    assert.ok(!src.includes('note-list-back'));
    assert.ok(!src.includes('<${Layer} ui="note-list"'));
  });
  it('MoreView の呼び出しは notes を渡さない', () => {
    var calls = Array.from(report.matchAll(/<\$\{MoreView\}[^>]*\/>/g)).map(function (m) { return m[0]; });
    assert.strictEqual(calls.length, 2);
    assert.strictEqual(calls.filter(function (c) { return /notes=/.test(c); }).length, 0);
  });
  it('notes 分岐は NotesView と NoteSheet を描き、trailing・onPull を持たない', () => {
    var i = report.indexOf("if (view === 'notes')");
    var branch = report.slice(i, report.indexOf("if (view === 'classrecord')"));
    assert.ok(i >= 0 && branch.includes('<${NotesView}') && branch.includes('<${NoteSheet}'));
    assert.ok(!/trailing=|onPull=/.test(branch));
  });
  it('report.js・shell.js にメモ一覧の開閉 state が無く、ホームに「すべて ›」を置かない(下部タブで行ける)', () => {
    assert.ok(!/noteListOpen|openNoteList|listOpen|setListOpen/.test(report));
    var shellSrc = fs.readFileSync(new URL('../components/shell.js', import.meta.url), 'utf8');
    assert.ok(!/noteListOpen|openNoteList|listOpen|setListOpen/.test(shellSrc));
    assert.ok(!/onAll|home-notes-all/.test(report + fs.readFileSync(new URL('../components/notes.js', import.meta.url), 'utf8')));
  });
});

describe('ホームのピン留め(#689)', () => {
  var comp = fs.readFileSync(new URL('../components/notes.js', import.meta.url), 'utf8');
  var report = fs.readFileSync(new URL('../components/report/report.js', import.meta.url), 'utf8');
  var NOW = new Date(2026, 5, 15, 4, 0);
  // vnode を辿って type が一致するものを集める
  function collect(v, type, out) {
    if (Array.isArray(v)) v.forEach(function (c) { collect(c, type, out); });
    else if (v && typeof v === 'object') {
      if (v.type === type) out.push(v);
      if (v.props) collect(v.props.children, type, out);
    }
    return out;
  }
  function uis(v) {
    var out = [];
    (function walk(x) {
      if (Array.isArray(x)) x.forEach(walk);
      else if (x && typeof x === 'object' && x.props) { var u = x.props['data-ui'] || x.props.ui; if (u) out.push(u); walk(x.props.children); }
    })(v);
    return out;
  }
  it('matchEnemies は opponent1_ms・opponent2_ms の順で空と重複を除く', () => {
    assert.deepStrictEqual(matchEnemies({ opponent1_ms: 'A', opponent2_ms: 'B' }), ['A', 'B']);
    assert.deepStrictEqual(matchEnemies({ opponent1_ms: 'A', opponent2_ms: 'A' }), ['A']);
    assert.deepStrictEqual(matchEnemies({ opponent1_ms: '', opponent2_ms: 'B' }), ['B']);
    assert.deepStrictEqual(matchEnemies({}), []);
  });
  it('pinnedNotes はピンだけを新しい順に並べ、max が正の数なら先頭 max 件', () => {
    var list = [note({ id: 'a', pinned: true, updated_at: '2026-06-01T00:00:00Z' }), note({ id: 'b', pinned: false, updated_at: '2026-06-09T00:00:00Z' }),
      note({ id: 'c', pinned: true, updated_at: '2026-06-03T00:00:00Z' }), note({ id: 'd', pinned: true, updated_at: '2026-06-02T00:00:00Z' })];
    assert.deepStrictEqual(pinnedNotes(list).map(function (n) { return n.id; }), ['c', 'd', 'a']);
    assert.deepStrictEqual(pinnedNotes(list, 2).map(function (n) { return n.id; }), ['c', 'd']);
    assert.strictEqual(pinnedNotes(list, 0).length, 3);
    assert.deepStrictEqual(pinnedNotes(null, 3), []);
  });
  it('canPinMore は pinned_max に空きがあるときだけ真。limits が無ければ偽', () => {
    var two = [note({ id: 'a', pinned: true }), note({ id: 'b', pinned: true })];
    assert.strictEqual(canPinMore(two, LIMITS), true);
    assert.strictEqual(canPinMore(two.concat(note({ id: 'c', pinned: true })), LIMITS), false);
    assert.strictEqual(canPinMore(two, null), false);
    assert.strictEqual(canPinMore(two, { text_max: 500 }), false);
  });
  it('homeDraft は今日のプレイ日・敵機0欄で、ピンに空きがあればピン留めする', () => {
    var two = [note({ id: 'a', pinned: true }), note({ id: 'b', pinned: true })];
    var d = homeDraft(two, LIMITS, 'M', NOW);
    assert.strictEqual(d.date, '2026-06-14');
    assert.deepStrictEqual(d.enemies, []);
    assert.strictEqual(d.my_ms, 'M');
    assert.strictEqual(d.pinned, true);
    assert.strictEqual(homeDraft(two.concat(note({ id: 'c', pinned: true })), LIMITS, '', NOW).pinned, false);
  });
  it('PinnedNotes は on 以外で null、0件は「書く」だけ、4件で上限3なら3件まで', () => {
    ['off', 'loading', 'error'].forEach(function (s) { assert.strictEqual(PinnedNotes({ notes: { status: s, list: [], limits: LIMITS } }), null, s); });
    var empty = uis(PinnedNotes({ notes: { status: 'on', list: [note({ pinned: false })], limits: LIMITS } }));
    assert.ok(empty.includes('home-note-write'));
    assert.ok(!empty.includes('home-notes-all'));
    var four = [1, 2, 3, 4].map(function (i) { return note({ id: 'n' + i, pinned: true, updated_at: '2026-06-0' + i + 'T00:00:00Z' }); });
    var v = PinnedNotes({ notes: { status: 'on', list: four, limits: LIMITS } });
    var rows = [];
    (function walk(x) { if (Array.isArray(x)) x.forEach(walk); else if (x && typeof x === 'object' && x.props) { if (x.type && x.type.name === 'PinnedRows') rows.push(x); walk(x.props.children); } })(v);
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0].props.list.length, 3);
    assert.ok(uis(v).includes('home-note-write'));
  });
  it('components/notes.js は lib/notes.js の export のうち使う関数を全て import している', () => {
    var lib = fs.readFileSync(new URL('../lib/notes.js', import.meta.url), 'utf8');
    var imp = comp.slice(comp.indexOf('import {\n'), comp.indexOf("} from '../lib/notes.js'"));
    var names = Array.from(lib.matchAll(/^export function (\w+)/gm)).map(function (m) { return m[1]; });
    assert.ok(names.length > 10);
    names.forEach(function (n) { if (comp.includes(n + '(')) assert.match(imp, new RegExp('\\b' + n + '\\b'), n); });
  });
  it('report.js は PinnedNotes を import し、ホーム分岐で EmptyMode より前に PinnedNotes と NoteSheet を描き、描く部品は全て import か定義済み', () => {
    assert.match(report, /^import \{[^}]*\bPinnedNotes\b[^}]*\} from '\.\.\/notes\.js';/m);
    var i = report.indexOf("if (view === 'home')");
    var home = report.slice(i, report.indexOf("if (view === 'search')"));
    assert.ok(home.indexOf('<${PinnedNotes}') >= 0 && home.indexOf('<${PinnedNotes}') < home.indexOf('<${EmptyMode}'));
    assert.ok(home.includes('<${NoteSheet}'));
    var used = new Set(Array.from(report.matchAll(/<\$\{(\w+)\}/g)).map(function (m) { return m[1]; }));
    used.forEach(function (n) {
      assert.ok(new RegExp('import \\{[^}]*\\b' + n + '\\b[^}]*\\}').test(report) || new RegExp('function ' + n + '\\b').test(report), n);
    });
  });
  it('NotesView は off/loading/error で書く・一覧を出さず、error の再読み込みは notes.reload', () => {
    var reload = function () {};
    ['off', 'loading', 'error'].forEach(function (st) {
      var v = NotesView({ notes: { status: st, list: [], limits: LIMITS, reload: reload, open: function () {} } });
      var u = uis(v);
      assert.ok(u.includes('notes-view') && !u.includes('note-write') && !u.includes('note-list'), st);
    });
    var err = NotesView({ notes: { status: 'error', list: [], reload: reload } });
    assert.strictEqual(collect(err, Notice, [])[0].props.action.onClick, reload);
    assert.strictEqual(collect(NotesView({ notes: { status: 'off', list: [] } }), Notice, []).length, 1);
    assert.strictEqual(collect(NotesView({ notes: { status: 'loading', list: [] } }), Notice, []).length, 0);
  });
  it('NoteItem は showPin かつピン留めのときだけピンの印を出す', () => {
    var marks = function (v) {
      var out = [];
      (function walk(x) { if (Array.isArray(x)) x.forEach(walk); else if (x && typeof x === 'object' && x.props) { if (typeof x.type === 'function') out.push(x.type.name); walk(x.props.children); } })(v);
      return out.filter(function (n) { return n === 'PinMark'; }).length;
    };
    var open = function () {};
    assert.strictEqual(marks(NoteItem({ note: note({ pinned: true }), showPin: true, onOpen: open })), 1);
    assert.strictEqual(marks(NoteItem({ note: note({ pinned: true }), onOpen: open })), 0);
    assert.strictEqual(marks(NoteItem({ note: note({ pinned: false }), showPin: true, onOpen: open })), 0);
  });
  it('NotesView は on で書くを出し、NoteList を描き、書くは敵機0欄・ピンなしの下書きで開く', () => {
    var opened = null;
    var v = NotesView({ notes: { status: 'on', list: [note()], limits: LIMITS, open: function (d) { opened = d; } } });
    assert.ok(uis(v).includes('note-write'));
    var kids = [];
    (function walk(x) { if (Array.isArray(x)) x.forEach(walk); else if (x && typeof x === 'object' && x.props) { if (typeof x.type === 'function') kids.push(x.type.name); walk(x.props.children); } })(v);
    assert.ok(kids.includes('NoteList'));
    var write = [];
    (function walk(x) { if (Array.isArray(x)) x.forEach(walk); else if (x && typeof x === 'object' && x.props) { if ((x.props['data-ui'] || x.props.ui) === 'note-write') write.push(x); walk(x.props.children); } })(v);
    write[0].props.onClick();
    assert.deepStrictEqual(opened.enemies, []);
    assert.strictEqual(opened.pinned, false);
  });
});

describe('スワイプ', () => {
  it('swipeAxis は 8px 動くまで未定で、大きい方の向き', () => {
    assert.strictEqual(swipeAxis(7, -7), '');
    assert.strictEqual(swipeAxis(-12, 5), 'x');
    assert.strictEqual(swipeAxis(3, 9), 'y');
    assert.strictEqual(swipeAxis(10, 10), 'y');
  });
  it('swipeOffset は閉じた状態からは dx、開いた状態からは -width+dx で、0〜-width に収める', () => {
    assert.strictEqual(swipeOffset(-50, false, 144), -50);
    assert.strictEqual(swipeOffset(30, false, 144), 0);
    assert.strictEqual(swipeOffset(-200, false, 144), -144);
    assert.strictEqual(swipeOffset(40, true, 144), -104);
    assert.strictEqual(swipeOffset(-10, true, 144), -144);
  });
  it('createTapGuard はタッチのタップを pointerup で通し、直後の click を捨てる', () => {
    let t = 1000;
    const g = createTapGuard(() => t);
    const ev = (pointerType, x, y, pointerId = 1) => ({ pointerType, clientX: x, clientY: y, pointerId });
    g.down(ev('touch', 10, 10));
    assert.strictEqual(g.up(ev('touch', 13, 12)), true);
    t += 300;
    assert.strictEqual(g.click({ detail: 1, pointerType: 'touch' }), false);
    assert.strictEqual(g.click({ detail: 1 }), false, 'pointerType の無い合成 click も捨てる');
    assert.strictEqual(g.click({ detail: 0 }), true, 'キーボードは通す');
    assert.strictEqual(g.click({ detail: 1, pointerType: 'mouse' }), false, 'タッチ直後は click の pointerType を当てにしない');
    g.down(ev('mouse', 10, 10));
    assert.strictEqual(g.click({ detail: 1, pointerType: 'mouse' }), true, 'マウスの押下は通す');
    t += 600;
    assert.strictEqual(g.click({ detail: 1, pointerType: 'touch' }), true);
    g.down(ev('touch', 10, 10));
    assert.strictEqual(g.up(ev('touch', 30, 10)), false, '動いたタッチは押下にしない');
    assert.strictEqual(g.up(ev('touch', 10, 10)), false, 'down の無い up は通さない');
    g.down(ev('touch', 10, 10));
    assert.strictEqual(g.up(ev('touch', 10, 10, 2)), false, '別の指の up は通さない');
    g.down(ev('touch', 10, 10));
    g.cancel();
    assert.strictEqual(g.up(ev('touch', 10, 10)), false, 'cancel の後の up は通さない');
    g.down(ev('mouse', 10, 10));
    assert.strictEqual(g.up(ev('mouse', 10, 10)), false, 'マウスは click で扱う');
  });
  it('swipeOpens は半分より引いていれば開く', () => {
    assert.strictEqual(swipeOpens(-73, 144), true);
    assert.strictEqual(swipeOpens(-72, 144), false);
  });
});
