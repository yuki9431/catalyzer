// メモの純粋ロジック(import なし)。型・上限はサーバー(internal/server/notes.go)が正で、上限は limits で受け取る。

var DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// 2026-02-30 のように桁あふれで別の日になる日付を不正とする(往復して一致を見る)
function validDate(s) {
  if (!DATE_RE.test(s || '')) return false;
  var d = new Date(s + 'T00:00:00Z');
  return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

function str(v) { return typeof v === 'string' ? v : ''; }

// 取得を始めるか。'off'=使えない / 'skip'=取得済みか同じユーザーを取得中 / 'load'
export function loadDecision(userKey, available, settledKey, loadingKey) {
  if (!userKey || !available) return 'off';
  if (settledKey === userKey || loadingKey === userKey) return 'skip';
  return 'load';
}

// 取得の応答の扱い。取得中にユーザーが替わっていれば 'stale' で捨てる
export function responseOutcome(requestedKey, currentKey, res) {
  if (requestedKey !== currentKey) return 'stale';
  if (res.status === 401) return 'off';
  var b = res.body;
  return res.status === 200 && b && b.user_key === requestedKey ? 'on' : 'error';
}

// GET 応答の検証。id・text が文字列の項目だけ残す。enemies は空でない文字列だけの配列にし、他の文字列項目の欠けは '' にする
export function sanitizeNotes(list) {
  if (!Array.isArray(list)) return [];
  return list.filter(function (n) {
    return n && typeof n.id === 'string' && typeof n.text === 'string';
  }).map(function (n) {
    return {
      id: n.id, text: n.text,
      enemies: Array.isArray(n.enemies) ? n.enemies.filter(function (e) { return typeof e === 'string' && e !== ''; }) : [],
      my_ms: str(n.my_ms), partner_ms: str(n.partner_ms), date: str(n.date),
      pinned: n.pinned === true, created_at: str(n.created_at), updated_at: str(n.updated_at),
    };
  });
}

// enemies に enemyMs を含むメモ(どれか1機で当たる)。myMs が文字列なら、自機の指定が無いメモか同じ自機のメモだけ。null なら自機を問わない
export function notesForEnemy(notes, enemyMs, myMs) {
  return (notes || []).filter(function (n) {
    if (n.enemies.indexOf(enemyMs) < 0) return false;
    return typeof myMs !== 'string' || n.my_ms === '' || n.my_ms === myMs;
  });
}

// 試合の相手の機体。opponent1_ms・opponent2_ms の順で、空と同じ機体は除く
export function matchEnemies(match) {
  var seen = [];
  [match.opponent1_ms, match.opponent2_ms].forEach(function (e) {
    if (e && seen.indexOf(e) < 0) seen.push(e);
  });
  return seen;
}

// 自機・僚機を指定したメモは、その試合の機体と同じときだけ当たる
function fitsMs(n, match) {
  return (!n.my_ms || n.my_ms === match.ms) && (!n.partner_ms || n.partner_ms === match.partner_ms);
}

// [{ head, notes }]。各メモは当たった相手の機体の組(head は '・' 区切り)に1回だけ入る。相手1機ずつの組は常に、2機の組は有れば出す。
// 敵機が無く自機か僚機で当たるメモは末尾の { head: '', notes } に入れる(無ければ出さない)
export function notesForMatch(notes, match) {
  var list = (notes || []).filter(function (n) { return fitsMs(n, match); });
  var enemies = matchEnemies(match);
  var hitsOf = function (n) { return enemies.filter(function (e) { return n.enemies.indexOf(e) >= 0; }); };
  var groups = enemies.map(function (e) {
    return { head: e, notes: list.filter(function (n) { var h = hitsOf(n); return h.length === 1 && h[0] === e; }) };
  });
  var both = list.filter(function (n) { return enemies.length > 1 && hitsOf(n).length === enemies.length; });
  if (both.length) groups.push({ head: enemies.join('・'), notes: both });
  var own = list.filter(function (n) { return n.enemies.length === 0 && (n.my_ms || n.partner_ms); });
  return own.length ? groups.concat([{ head: '', notes: own }]) : groups;
}

export function hasNoteForMatch(notes, match) {
  return notesForMatch(notes, match).some(function (g) { return g.notes.length > 0; });
}

// 更新の新しい順、同じなら id の昇順
function byUpdated(a, b) {
  if (a.updated_at !== b.updated_at) return a.updated_at < b.updated_at ? 1 : -1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

// field の機体ごとにまとめる。'enemies' は各敵機の下に入れる(複数の敵機を持つメモは複数の下に出る)。'my_ms'・'partner_ms' は空を除く
export function groupByMs(notes, field) {
  var map = {};
  (notes || []).forEach(function (n) {
    var names = field === 'enemies' ? n.enemies : n[field] ? [n[field]] : [];
    names.forEach(function (e) { (map[e] = map[e] || []).push(n); });
  });
  return Object.keys(map).map(function (e) { return { ms: e, count: map[e].length, notes: map[e] }; })
    .sort(function (a, b) { return b.count - a.count || a.ms.localeCompare(b.ms, 'ja'); });
}

// 機体でまとめる一覧タブと、まとめる項目
export var MS_TABS = { enemy: 'enemies', mine: 'my_ms', partner: 'partner_ms' };

// tab: 'all' | 'enemy' | 'mine' | 'partner' | 'date' | 'pin'。all はピン留めを先頭に置く
export function notesByTab(notes, tab) {
  var list = (notes || []).slice();
  if (tab === 'enemy') return list.filter(function (n) { return n.enemies.length > 0; }).sort(byUpdated);
  if (tab === 'mine') return list.filter(function (n) { return n.my_ms !== ''; }).sort(byUpdated);
  if (tab === 'partner') return list.filter(function (n) { return n.partner_ms !== ''; }).sort(byUpdated);
  if (tab === 'pin') return list.filter(function (n) { return n.pinned; }).sort(byUpdated);
  if (tab === 'date') {
    return list.filter(function (n) { return n.date !== ''; }).sort(function (a, b) {
      return a.date !== b.date ? (a.date < b.date ? 1 : -1) : byUpdated(a, b);
    });
  }
  return list.sort(function (a, b) { return (b.pinned - a.pinned) || byUpdated(a, b); });
}

// メモタブの各タブの件数。ピンはタブにせず all の先頭に並べる
export function tabCounts(notes) {
  var out = {};
  ['all', 'enemy', 'mine', 'partner', 'date'].forEach(function (t) { out[t] = notesByTab(notes, t).length; });
  return out;
}

// 'M/D' と敵機の '・' 区切りを半角空白でつなぐ。どちらも無ければ 'メモ'
export function noteTargetLabel(note) {
  var parts = [];
  if (DATE_RE.test(note.date)) parts.push(Number(note.date.slice(5, 7)) + '/' + Number(note.date.slice(8, 10)));
  if (note.enemies.length) parts.push(note.enemies.join('・'));
  return parts.length ? parts.join(' ') : 'メモ';
}

// ctx: { enemies?, my_ms?, date?, pinned? }。僚機は常に未指定
export function defaultDraft(ctx) {
  var c = ctx || {};
  return { id: null, text: '', enemies: (c.enemies || []).slice(), my_ms: c.my_ms || '', partner_ms: '', date: c.date || '', pinned: !!c.pinned };
}

export function draftFromNote(note) {
  return { id: note.id, text: note.text, enemies: note.enemies.slice(), my_ms: note.my_ms, partner_ms: note.partner_ms, date: note.date, pinned: !!note.pinned };
}

function normalizeText(text) { return String(text || '').replace(/\r\n/g, '\n').trim(); }

function filledEnemies(draft) {
  return (draft.enemies || []).map(function (e) { return String(e || '').trim(); }).filter(function (e) { return e !== ''; });
}

// 未選択の敵機の欄は落とす。重複は落とさない(validateDraft で止める)
export function draftToRequest(draft) {
  return {
    text: normalizeText(draft.text), enemies: filledEnemies(draft),
    my_ms: String(draft.my_ms || '').trim(), partner_ms: String(draft.partner_ms || '').trim(), date: draft.date || '', pinned: !!draft.pinned,
  };
}

// サーバーの rune 数と合わせる(絵文字などのサロゲートペアを1文字と数える)
export function textLength(text) { return Array.from(normalizeText(text)).length; }

// 保存できない理由の文言。保存できるなら ''。limits は GET /notes の limits
export function validateDraft(draft, limits, pinnedOthers) {
  var lim = limits || {};
  if (textLength(draft.text) === 0) return 'メモの本文を入力してください';
  if (lim.text_max && textLength(draft.text) > lim.text_max) return 'メモは' + lim.text_max + '文字までです';
  var enemies = filledEnemies(draft);
  if (lim.enemies_max && enemies.length > lim.enemies_max) return '敵機は' + lim.enemies_max + '機までです';
  if (enemies.some(function (e, i) { return enemies.indexOf(e) !== i; })) return '同じ敵機が重複しています';
  if (draft.date && !validDate(draft.date)) return '日付の形式が正しくありません';
  if (draft.pinned && lim.pinned_max && pinnedOthers >= lim.pinned_max) return 'ピン留めは' + lim.pinned_max + '件までです';
  return '';
}

// 敵機を足せるか。未選択の欄も数える。上限が分からなければ足せない
export function canAddEnemy(draft, limits) {
  return !!(limits && limits.enemies_max) && draft.enemies.length < limits.enemies_max;
}

// 選択肢に無い機体(編集中のメモの機体など)も値として選べるよう足す
export function withValue(options, value) {
  return value && !options.some(function (o) { return o.value === value; }) ? options.concat([{ value: value, label: value }]) : options;
}

// index 以外の欄で選んだ機体を選択肢から除く(重複を作らせない)。自分の値が選択肢に無ければ足す
export function enemyOptions(options, enemies, index) {
  var taken = enemies.filter(function (e, i) { return i !== index && e; });
  var rest = options.filter(function (o) { return taken.indexOf(o.value) < 0; });
  return withValue(rest, enemies[index]);
}

export function pinnedCount(notes, exceptId) {
  return (notes || []).filter(function (n) { return n.pinned && n.id !== exceptId; }).length;
}

// ピン留めしたメモを新しい順に。max が正の数なら先頭 max 件
export function pinnedNotes(notes, max) {
  var list = notesByTab(notes, 'pin');
  return max > 0 ? list.slice(0, max) : list;
}

// ピン留めの上限に空きがあるか。limits が無ければ偽
export function canPinMore(notes, limits) {
  return !!(limits && limits.pinned_max) && pinnedCount(notes) < limits.pinned_max;
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

// 最後に遊んだ試合の自機。試合が無ければ ''
export function lastPlayedMs(matches) {
  var last = null;
  (matches || []).forEach(function (m) { if (m.ms && (!last || m.date > last.date)) last = m; });
  return last ? last.ms : '';
}

// 対戦した機体を試合数の多い順、続けて msImages にだけある機体を五十音順。{ enemies, mine, partners }(どれも [{value,label}])
export function msChoices(msImages, matches) {
  var enemyCount = {}, myCount = {}, partnerCount = {};
  (matches || []).forEach(function (m) {
    if (m.ms) myCount[m.ms] = (myCount[m.ms] || 0) + 1;
    if (m.partner_ms) partnerCount[m.partner_ms] = (partnerCount[m.partner_ms] || 0) + 1;
    [m.opponent1_ms, m.opponent2_ms].forEach(function (e) { if (e) enemyCount[e] = (enemyCount[e] || 0) + 1; });
  });
  var rest = Object.keys(msImages || {}).sort(function (a, b) { return a.localeCompare(b, 'ja'); });
  function build(count) {
    var played = Object.keys(count).sort(function (a, b) { return count[b] - count[a] || a.localeCompare(b, 'ja'); });
    return played.concat(rest.filter(function (n) { return !count[n]; })).map(function (n) { return { value: n, label: n }; });
  }
  return { enemies: build(enemyCount), mine: build(myCount), partners: build(partnerCount) };
}
