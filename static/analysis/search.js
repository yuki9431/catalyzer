// --- 試合検索ロジック ---
// IndexedDBキャッシュから読み込んだ試合データ配列を、条件で絞り込み・並べ替える純粋関数群。
// UI から切り離すことで単体テスト可能にしている。

import { PERIOD_DAYS } from './stats.js';
import { findPattern, goalPattern, testPattern, patternLabel } from './patterns.js';

// 並べ替えの選択肢。key はソート対象のフィールド。並び順（昇順/降順）はUI側のトグルで制御する。
export var SORT_OPTIONS = [
  { key: 'date', label: '日付' },
  { key: 'dmg_given', label: '与ダメージ' },
  { key: 'dmg_taken', label: '被ダメージ' },
  { key: 'kills', label: '撃墜数' },
  { key: 'deaths', label: '被撃墜数' },
  { key: 'ex_dmg', label: 'EXダメージ' },
  { key: 'score', label: 'スコア' },
];

// フィルタの初期値。UI側はこれを複製して状態の初期値に使う。
export function emptyFilters() {
  return {
    playDays: '',            // 期間プリセット（''=全データ / '1d','3d'... レポートと同じ直近プレイ日数）
    dateFrom: '', dateTo: '',
    myMsList: [],            // 自機（複数選択・OR）
    partnerMsList: [],       // 僚機（複数選択・OR）
    enemyMsList: [],         // 敵機（複数選択）
    enemyMsMode: 'or',       // 'and'=相手編成に全部いる / 'or'=どれかいる
    playerName: '',          // 相方・敵プレイヤー名の部分一致（曖昧検索）
    playerNameScope: 'both',  // 'both' | 'ally'(相方のみ) | 'enemy'(相手のみ)
    myTagList: [],           // 味方タッグ名（複数選択・OR）
    enemyTagName: '',        // 敵陣タッグ名の部分一致（曖昧検索）
    result: 'all',           // 'all' | 'win' | 'loss'
    myCostList: [],          // 自機コスト（複数選択・OR）
    partnerCostList: [],     // 僚機コスト（複数選択・OR）
    enemyCostPairList: [],   // 相手コスト編成（複数選択・OR）
    dmgGivenMin: '', dmgGivenMax: '',
    dmgTakenMin: '', dmgTakenMax: '',
    killsMin: '', killsMax: '',
    deathsMin: '', deathsMax: '',
    scoreMin: '', scoreMax: '',
    exDmgMin: '', exDmgMax: '',
    burstsMin: '', burstsMax: '',
    pattern: '',             // 試合の展開（シートで選ぶ patterns.js の key。''=指定なし）
    goal: null,              // ホームのミッションから渡る負け筋 {key, line?, avoid?}
    focusRange: null,        // 挑戦中カードから渡る範囲 {after, until}（until ''=上限なし）
  };
}

function validRange(r) { return !!r && typeof r.after === 'string' && r.after !== '' && typeof r.until === 'string'; }

// 当てはまりを調べる条件。ホームから来た goal と、シートで選んだ試合の展開（sheet 項目のみ）
export function activeConditions(filters) {
  var f = filters || {};
  var out = [];
  var g = goalPattern(f.goal);
  if (g) out.push(g);
  var def = typeof f.pattern === 'string' ? findPattern(f.pattern) : null;
  if (def && def.sheet === true) out.push({ key: def.key });
  return out;
}

// ×で外せるタグ（ホームから渡った条件）
export function removableFilterLabels(filters) {
  var f = filters || {};
  var out = [];
  var g = goalPattern(f.goal);
  if (g) out.push({ field: 'goal', label: '負け筋: ' + patternLabel(g) });
  if (validRange(f.focusRange)) out.push({ field: 'focusRange', label: '挑戦中のミッションの試合' });
  return out;
}

// 何らかの絞り込みが指定されているか（デフォルト状態でないか）を判定する。
export function hasActiveFilters(filters) {
  var f = filters || {};
  if (activeConditions(f).length || validRange(f.focusRange)) return true;
  if (f.result && f.result !== 'all') return true;
  var listKeys = ['myMsList', 'partnerMsList', 'enemyMsList', 'myTagList', 'myCostList', 'partnerCostList', 'enemyCostPairList'];
  for (var j = 0; j < listKeys.length; j++) {
    if (f[listKeys[j]] && f[listKeys[j]].length) return true;
  }
  var keys = ['playDays', 'dateFrom', 'dateTo', 'playerName', 'enemyTagName',
    'dmgGivenMin', 'dmgGivenMax', 'dmgTakenMin', 'dmgTakenMax',
    'killsMin', 'killsMax', 'deathsMin', 'deathsMax',
    'scoreMin', 'scoreMax', 'exDmgMin', 'exDmgMax', 'burstsMin', 'burstsMax'];
  for (var i = 0; i < keys.length; i++) {
    var v = f[keys[i]];
    if (v !== '' && v != null) return true;
  }
  return false;
}

// 出現「試合数」つきで機体名の一覧を作る内部ヘルパー。
// getters は各試合から機体名（複数可）を取り出す関数の配列。
// 同一試合内で同じ機体名が複数回出ても（例: 敵2機が同一機体）1試合として数える。
function tally(matches, getters) {
  var counts = {};
  for (var i = 0; i < matches.length; i++) {
    var m = matches[i];
    var seen = {};
    for (var g = 0; g < getters.length; g++) {
      var names = getters[g](m);
      for (var n = 0; n < names.length; n++) {
        var name = names[n];
        if (!name || seen[name]) continue;
        seen[name] = true;
        counts[name] = (counts[name] || 0) + 1;
      }
    }
  }
  return Object.keys(counts)
    .map(function (name) { return { name: name, matches: counts[name] }; })
    .sort(function (a, b) {
      return a.matches !== b.matches ? b.matches - a.matches : a.name.localeCompare(b.name);
    });
}

// 相手2機のコスト編成キー。高コスト+低コストで正規化（順不同で同一扱い）。
// どちらかが未取得(0)なら '' を返して集計・絞り込み対象外にする。
export function enemyCostPairKey(a, b) {
  var x = Number(a) || 0, y = Number(b) || 0;
  if (!x || !y) return '';
  return Math.max(x, y) + ' + ' + Math.min(x, y);
}

// 絞り込みドロップダウン用のリスト（自機・相方・敵の機体名／自陣・敵陣のタッグ名／相手コスト編成）を
// 出現頻度順で返す。
export function collectMsOptions(matches) {
  var ms = matches || [];
  // 相手コスト編成は出現数順ではなくコスト降順（3000+3000 → 3000+2500 → …）で並べる。
  var costPairs = tally(ms, [function (m) { return [enemyCostPairKey(m.opponent1_cost, m.opponent2_cost)]; }]);
  costPairs.sort(function (a, b) {
    var pa = a.name.split(' + '), pb = b.name.split(' + ');
    return (Number(pb[0]) - Number(pa[0])) || (Number(pb[1]) - Number(pa[1]));
  });
  return {
    mine: tally(ms, [function (m) { return [m.ms]; }]),
    partners: tally(ms, [function (m) { return [m.partner_ms]; }]),
    enemies: tally(ms, [function (m) { return [m.opponent1_ms, m.opponent2_ms]; }]),
    myTags: tally(ms, [function (m) { return [m.team_name]; }]),
    enemyCostPairs: costPairs,
    // 曖昧検索入力の候補用（相方・敵のプレイヤー名／相手タッグ名）。
    playerNames: tally(ms, [function (m) { return [m.partner_name, m.opponent1_name, m.opponent2_name]; }]),
    enemyTags: tally(ms, [function (m) { return [m.opponent_team_name]; }]),
  };
}

// 文字列・数値を数値に変換。空文字/null/変換不能は null。
function toNum(v) {
  if (v === '' || v == null) return null;
  var n = typeof v === 'number' ? v : parseFloat(v);
  return isNaN(n) ? null : n;
}

// value が [min, max]（各 null 許容）の範囲に収まるか。
function inRange(value, min, max) {
  if (min != null && value < min) return false;
  if (max != null && value > max) return false;
  return true;
}

// 試合内のプレイヤー名（相方・敵1・敵2）のいずれかが needle を部分一致で含むか。
// needle は呼び出し側で trim + toLowerCase 済みであること。
function nameMatches(m, needle, scope) {
  var names;
  if (scope === 'ally') names = [m.partner_name];
  else if (scope === 'enemy') names = [m.opponent1_name, m.opponent2_name];
  else names = [m.partner_name, m.opponent1_name, m.opponent2_name];
  for (var i = 0; i < names.length; i++) {
    if (String(names[i] || '').toLowerCase().indexOf(needle) >= 0) return true;
  }
  return false;
}


// 試合配列を filters で絞り込む。元配列は変更しない。
export function filterMatches(matches, filters) {
  var f = filters || {};
  var dateFrom = f.dateFrom || '';
  var dateTo = f.dateTo || '';
  // 自機・僚機は複数選択・OR（選んだどれかに一致）。
  var myMsList = f.myMsList || [];
  var partnerMsList = f.partnerMsList || [];
  // 敵機は複数選択。and=相手2機に選んだ機体が全部いる（編成指定）、or=どれかいる。
  var enemyMsList = f.enemyMsList || [];
  var enemyMsMode = f.enemyMsMode || 'or';
  // プレイヤー名は部分一致・大小文字無視の曖昧検索。scopeで相方のみ/相手のみに絞れる。
  var playerName = (f.playerName || '').trim().toLowerCase();
  var playerNameScope = f.playerNameScope || 'both';
  // 味方タッグは複数選択・OR。敵タッグ名は部分一致・大小文字無視（敵陣）。
  var myTagList = f.myTagList || [];
  var enemyTagName = (f.enemyTagName || '').trim().toLowerCase();
  var result = f.result || 'all';
  // コスト系は複数選択・OR。コストは数値比較のため数値化しておく。
  var myCostList = (f.myCostList || []).map(Number);
  var partnerCostList = (f.partnerCostList || []).map(Number);
  var enemyCostPairList = f.enemyCostPairList || [];
  var dgMin = toNum(f.dmgGivenMin), dgMax = toNum(f.dmgGivenMax);
  var dtMin = toNum(f.dmgTakenMin), dtMax = toNum(f.dmgTakenMax);
  var kMin = toNum(f.killsMin), kMax = toNum(f.killsMax);
  var deMin = toNum(f.deathsMin), deMax = toNum(f.deathsMax);
  var scMin = toNum(f.scoreMin), scMax = toNum(f.scoreMax);
  var exMin = toNum(f.exDmgMin), exMax = toNum(f.exDmgMax);
  var buMin = toNum(f.burstsMin), buMax = toNum(f.burstsMax);
  var conds = activeConditions(f);
  var range = validRange(f.focusRange) ? f.focusRange : null;

  return (matches || []).filter(function (m) {
    var day = (m.date || '').substring(0, 10);
    if (dateFrom && day < dateFrom) return false;
    if (dateTo && day > dateTo) return false;
    if (myMsList.length && myMsList.indexOf(m.ms) < 0) return false;
    if (partnerMsList.length && partnerMsList.indexOf(m.partner_ms) < 0) return false;
    if (enemyMsList.length) {
      var es = [m.opponent1_ms, m.opponent2_ms];
      var hit = enemyMsMode === 'and'
        ? enemyMsList.every(function (x) { return es.indexOf(x) >= 0; })
        : enemyMsList.some(function (x) { return es.indexOf(x) >= 0; });
      if (!hit) return false;
    }
    if (playerName && !nameMatches(m, playerName, playerNameScope)) return false;
    if (myTagList.length && myTagList.indexOf(m.team_name) < 0) return false;
    if (enemyTagName && String(m.opponent_team_name || '').toLowerCase().indexOf(enemyTagName) < 0) return false;
    if (result === 'win' && !m.win) return false;
    if (result === 'loss' && m.win) return false;
    if (myCostList.length && myCostList.indexOf(m.ms_cost) < 0) return false;
    if (partnerCostList.length && partnerCostList.indexOf(m.partner_cost) < 0) return false;
    if (enemyCostPairList.length && enemyCostPairList.indexOf(enemyCostPairKey(m.opponent1_cost, m.opponent2_cost)) < 0) return false;
    if (!inRange(m.dmg_given, dgMin, dgMax)) return false;
    if (!inRange(m.dmg_taken, dtMin, dtMax)) return false;
    if (!inRange(m.kills, kMin, kMax)) return false;
    if (!inRange(m.deaths, deMin, deMax)) return false;
    if (!inRange(m.score, scMin, scMax)) return false;
    if (!inRange(m.ex_dmg, exMin, exMax)) return false;
    if (!inRange(m.bursts, buMin, buMax)) return false;
    if (range && !(m.date > range.after && (range.until === '' || m.date <= range.until))) return false;
    for (var c = 0; c < conds.length; c++) {
      if (testPattern(conds[c], m) !== true) return false;
    }
    return true;
  });
}

// 試合配列を key で並べ替える。元配列は変更しない。
// 日付は文字列比較（"YYYY-MM-DD HH:MM" は辞書順=時系列順）、それ以外は数値比較。
// 同値の場合は日付の新しい順で安定させる。
export function sortMatches(matches, key, desc) {
  var arr = (matches || []).slice();
  var dir = desc ? -1 : 1;
  arr.sort(function (a, b) {
    var va, vb;
    if (key === 'date') {
      va = a.date || ''; vb = b.date || '';
      if (va < vb) return -1 * dir;
      if (va > vb) return 1 * dir;
      return 0;
    }
    va = a[key] != null ? a[key] : 0;
    vb = b[key] != null ? b[key] : 0;
    if (va !== vb) return (va - vb) * dir;
    // タイブレーク: 新しい試合を先に
    var da = a.date || '', db = b.date || '';
    return da < db ? 1 : da > db ? -1 : 0;
  });
  return arr;
}

// 複数選択の表示。先頭 + ' ほか' + 残り件数。
function listLabel(list) {
  return list[0] + (list.length > 1 ? ' ほか' + (list.length - 1) : '');
}

var RANGE_LABELS = [
  ['dmgGiven', '与ダメージ'], ['dmgTaken', '被ダメージ'], ['kills', '撃墜数'], ['deaths', '被撃墜数'],
  ['score', 'スコア'], ['exDmg', 'EXダメージ'], ['bursts', '覚醒回数'],
];

// 適用中の条件を表示用の文字列配列にする。既定値・空・数値にならない範囲は出さない。
export function appliedFilterLabels(filters) {
  var f = filters || {};
  var out = [];
  var list = function (k) { return Array.isArray(f[k]) ? f[k] : []; };
  if (f.playDays && Object.prototype.hasOwnProperty.call(PERIOD_DAYS, f.playDays)) out.push('期間: 直近' + PERIOD_DAYS[f.playDays] + '日');
  if (list('myMsList').length) out.push('自機: ' + listLabel(list('myMsList')));
  if (list('partnerMsList').length) out.push('僚機: ' + listLabel(list('partnerMsList')));
  if (list('enemyMsList').length) {
    var multi = list('enemyMsList').length > 1;
    var mode = multi ? (f.enemyMsMode === 'and' ? '（すべて含む）' : '（どれかを含む）') : '';
    out.push('敵機' + mode + ': ' + listLabel(list('enemyMsList')));
  }
  var name = String(f.playerName || '').trim();
  if (name) {
    var scope = f.playerNameScope === 'ally' ? '（相方）' : f.playerNameScope === 'enemy' ? '（相手）' : '';
    out.push('プレイヤー名' + scope + ': ' + name);
  }
  if (f.result === 'win') out.push('勝敗: 勝利');
  else if (f.result === 'loss') out.push('勝敗: 敗北');
  var def = typeof f.pattern === 'string' ? findPattern(f.pattern) : null;
  if (def && def.sheet === true) out.push('試合の展開: ' + patternLabel({ key: def.key }));
  if (f.dateFrom && f.dateTo) out.push('日付: ' + f.dateFrom + '〜' + f.dateTo);
  else if (f.dateFrom) out.push('日付: ' + f.dateFrom + '以降');
  else if (f.dateTo) out.push('日付: ' + f.dateTo + '以前');
  if (list('myTagList').length) out.push('味方タッグ: ' + listLabel(list('myTagList')));
  var enemyTag = String(f.enemyTagName || '').trim();
  if (enemyTag) out.push('相手タッグ: ' + enemyTag);
  if (list('myCostList').length) out.push('自機コスト: ' + listLabel(list('myCostList')));
  if (list('partnerCostList').length) out.push('僚機コスト: ' + listLabel(list('partnerCostList')));
  if (list('enemyCostPairList').length) out.push('相手コスト編成: ' + listLabel(list('enemyCostPairList')));
  RANGE_LABELS.forEach(function (r) {
    var min = toNum(f[r[0] + 'Min']), max = toNum(f[r[0] + 'Max']);
    if (min != null && max != null) out.push(r[1] + ': ' + min + '〜' + max);
    else if (min != null) out.push(r[1] + ': ' + min + '以上');
    else if (max != null) out.push(r[1] + ': ' + max + '以下');
  });
  return out;
}

// 並び順の文言。日付は新しい順/古い順、他は大きい順/小さい順。
export function sortDirLabel(key, desc) {
  if (key === 'date') return desc ? '新しい順' : '古い順';
  return desc ? '大きい順' : '小さい順';
}

// 並べ替えトリガー用の文言（例: 与ダメージが大きい順）。未知 key は先頭（日付）。
export function sortLabel(key, desc) {
  var opt = SORT_OPTIONS.filter(function (o) { return o.key === key; })[0] || SORT_OPTIONS[0];
  return opt.label + 'が' + sortDirLabel(opt.key, desc);
}
