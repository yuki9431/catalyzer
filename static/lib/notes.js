// 敵機ごとのメモの純粋ロジック(import なし)。型・上限はサーバー(internal/server/notes.go)が正で、上限は limits で受け取る。
export var NOTE_KINDS = ['enemy', 'date', 'free'];

var DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// 2026-02-30 のように桁あふれで別の日になる日付を不正とする(往復して一致を見る)
function validDate(s) {
  if (!DATE_RE.test(s || '')) return false;
  var d = new Date(s + 'T00:00:00Z');
  return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

function str(v) { return typeof v === 'string' ? v : ''; }

// GET 応答の検証。id・text が文字列で kind が既知の項目だけ残す。他の文字列項目の欠けは '' にする
export function sanitizeNotes(list) {
  if (!Array.isArray(list)) return [];
  return list.filter(function (n) {
    return n && typeof n.id === 'string' && typeof n.text === 'string' && NOTE_KINDS.indexOf(n.kind) >= 0;
  }).map(function (n) {
    return {
      id: n.id, kind: n.kind, text: n.text, enemy_ms: str(n.enemy_ms), my_ms: str(n.my_ms), date: str(n.date),
      pinned: n.pinned === true, created_at: str(n.created_at), updated_at: str(n.updated_at),
    };
  });
}

// myMs が文字列なら、自機の指定が無いメモか同じ自機のメモだけ。null なら自機を問わない
export function notesForEnemy(notes, enemyMs, myMs) {
  return (notes || []).filter(function (n) {
    if (n.kind !== 'enemy' || n.enemy_ms !== enemyMs) return false;
    return typeof myMs !== 'string' || n.my_ms === '' || n.my_ms === myMs;
  });
}

// 敵機ごとに [{ enemy, notes }]。opponent1_ms・opponent2_ms の順で、同じ機体は1つにまとめる
export function notesForMatch(notes, match) {
  var seen = [];
  [match.opponent1_ms, match.opponent2_ms].forEach(function (e) {
    if (e && seen.indexOf(e) < 0) seen.push(e);
  });
  return seen.map(function (e) { return { enemy: e, notes: notesForEnemy(notes, e, match.ms) }; });
}

export function hasNoteForMatch(notes, match) {
  return notesForMatch(notes, match).some(function (g) { return g.notes.length > 0; });
}

// 更新の新しい順、同じなら id の昇順
function byUpdated(a, b) {
  if (a.updated_at !== b.updated_at) return a.updated_at < b.updated_at ? 1 : -1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export function groupByEnemy(notes) {
  var map = {};
  (notes || []).forEach(function (n) {
    if (n.kind !== 'enemy') return;
    (map[n.enemy_ms] = map[n.enemy_ms] || []).push(n);
  });
  return Object.keys(map).map(function (e) { return { enemy: e, count: map[e].length, notes: map[e] }; })
    .sort(function (a, b) { return b.count - a.count || a.enemy.localeCompare(b.enemy, 'ja'); });
}

// tab: 'all' | 'enemy' | 'date' | 'pin'
export function notesByTab(notes, tab) {
  var list = (notes || []).slice();
  if (tab === 'enemy') return list.filter(function (n) { return n.kind === 'enemy'; }).sort(byUpdated);
  if (tab === 'pin') return list.filter(function (n) { return n.pinned; }).sort(byUpdated);
  if (tab === 'date') {
    return list.filter(function (n) { return n.kind === 'date'; }).sort(function (a, b) {
      return a.date !== b.date ? (a.date < b.date ? 1 : -1) : byUpdated(a, b);
    });
  }
  return list.sort(byUpdated);
}

export function tabCounts(notes) {
  return {
    all: notesByTab(notes, 'all').length, enemy: notesByTab(notes, 'enemy').length,
    date: notesByTab(notes, 'date').length, pin: notesByTab(notes, 'pin').length,
  };
}

// 敵機名 / 'M/D' / 'メモ'
export function noteTargetLabel(note) {
  if (note.kind === 'enemy') return note.enemy_ms;
  if (note.kind === 'date' && DATE_RE.test(note.date)) return Number(note.date.slice(5, 7)) + '/' + Number(note.date.slice(8, 10));
  return 'メモ';
}

// ctx: { enemy_ms?, kind?, date? }。enemy_ms があれば kind は 'enemy'。自機は常に未指定
export function defaultDraft(ctx) {
  var c = ctx || {};
  return {
    id: null, kind: c.enemy_ms ? 'enemy' : (c.kind || 'enemy'), text: '',
    enemy_ms: c.enemy_ms || '', my_ms: '', date: c.date || '', pinned: false,
  };
}

export function draftFromNote(note) {
  return {
    id: note.id, kind: note.kind, text: note.text, enemy_ms: note.enemy_ms, my_ms: note.my_ms,
    date: note.date, pinned: !!note.pinned,
  };
}

function normalizeText(text) { return String(text || '').replace(/\r\n/g, '\n').trim(); }

// kind で使わない項目は '' にする
export function draftToRequest(draft) {
  var k = draft.kind;
  return {
    kind: k, text: normalizeText(draft.text),
    enemy_ms: k === 'enemy' ? String(draft.enemy_ms || '').trim() : '',
    my_ms: k === 'enemy' ? String(draft.my_ms || '').trim() : '',
    date: k === 'date' ? draft.date || '' : '',
    pinned: !!draft.pinned,
  };
}

// サーバーの rune 数と合わせる(絵文字などのサロゲートペアを1文字と数える)
export function textLength(text) { return Array.from(normalizeText(text)).length; }

// 保存できない理由の文言。保存できるなら ''。limits は GET /notes の limits
export function validateDraft(draft, limits, pinnedOthers) {
  var lim = limits || {};
  if (textLength(draft.text) === 0) return 'メモの本文を入力してください';
  if (lim.text_max && textLength(draft.text) > lim.text_max) return 'メモは' + lim.text_max + '文字までです';
  if (draft.kind === 'enemy' && !String(draft.enemy_ms || '').trim()) return '敵機を選んでください';
  if (draft.kind === 'date' && !validDate(draft.date)) return '日付の形式が正しくありません';
  if (draft.pinned && lim.pinned_max && pinnedOthers >= lim.pinned_max) return 'ピン留めは' + lim.pinned_max + '件までです';
  return '';
}

export function pinnedCount(notes, exceptId) {
  return (notes || []).filter(function (n) { return n.pinned && n.id !== exceptId; }).length;
}

// 同じ id は置き換え、無ければ先頭に足す
export function upsertNote(notes, note) {
  var list = notes || [];
  if (!list.some(function (n) { return n.id === note.id; })) return [note].concat(list);
  return list.map(function (n) { return n.id === note.id ? note : n; });
}

export function removeNoteById(notes, id) {
  return (notes || []).filter(function (n) { return n.id !== id; });
}

// 対戦した機体を試合数の多い順、続けて msImages にだけある機体を五十音順。{ enemies, mine }(どちらも [{value,label}])
export function msChoices(msImages, matches) {
  var enemyCount = {}, myCount = {};
  (matches || []).forEach(function (m) {
    if (m.ms) myCount[m.ms] = (myCount[m.ms] || 0) + 1;
    [m.opponent1_ms, m.opponent2_ms].forEach(function (e) { if (e) enemyCount[e] = (enemyCount[e] || 0) + 1; });
  });
  var rest = Object.keys(msImages || {}).sort(function (a, b) { return a.localeCompare(b, 'ja'); });
  function build(count) {
    var played = Object.keys(count).sort(function (a, b) { return count[b] - count[a] || a.localeCompare(b, 'ja'); });
    return played.concat(rest.filter(function (n) { return !count[n]; })).map(function (n) { return { value: n, label: n }; });
  }
  return { enemies: build(enemyCount), mine: build(myCount) };
}
