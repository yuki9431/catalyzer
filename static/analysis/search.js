// --- 試合検索ロジック ---
// IndexedDBキャッシュから読み込んだ試合データ配列を、条件で絞り込み・並べ替える純粋関数群。
// UI（components/search.js）から切り離すことで単体テスト可能にしている。

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
    dateFrom: '', dateTo: '',
    myMs: '', partnerMs: '', enemyMs: '',
    result: 'all',           // 'all' | 'win' | 'loss'
    dmgGivenMin: '', dmgGivenMax: '',
    dmgTakenMin: '', dmgTakenMax: '',
    killsMin: '', killsMax: '',
    deathsMin: '', deathsMax: '',
  };
}

// 何らかの絞り込みが指定されているか（デフォルト状態でないか）を判定する。
export function hasActiveFilters(filters) {
  var f = filters || {};
  if (f.result && f.result !== 'all') return true;
  var keys = ['dateFrom', 'dateTo', 'myMs', 'partnerMs', 'enemyMs',
    'dmgGivenMin', 'dmgGivenMax', 'dmgTakenMin', 'dmgTakenMax',
    'killsMin', 'killsMax', 'deathsMin', 'deathsMax'];
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

// 絞り込みドロップダウン用の機体名リスト（自機・相方・敵）を出現頻度順で返す。
export function collectMsOptions(matches) {
  var ms = matches || [];
  return {
    mine: tally(ms, [function (m) { return [m.ms]; }]),
    partners: tally(ms, [function (m) { return [m.partner_ms]; }]),
    enemies: tally(ms, [function (m) { return [m.opponent1_ms, m.opponent2_ms]; }]),
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

// 試合配列を filters で絞り込む。元配列は変更しない。
export function filterMatches(matches, filters) {
  var f = filters || {};
  var dateFrom = f.dateFrom || '';
  var dateTo = f.dateTo || '';
  var myMs = f.myMs || '';
  var partnerMs = f.partnerMs || '';
  var enemyMs = f.enemyMs || '';
  var result = f.result || 'all';
  var dgMin = toNum(f.dmgGivenMin), dgMax = toNum(f.dmgGivenMax);
  var dtMin = toNum(f.dmgTakenMin), dtMax = toNum(f.dmgTakenMax);
  var kMin = toNum(f.killsMin), kMax = toNum(f.killsMax);
  var deMin = toNum(f.deathsMin), deMax = toNum(f.deathsMax);

  return (matches || []).filter(function (m) {
    var day = (m.date || '').substring(0, 10);
    if (dateFrom && day < dateFrom) return false;
    if (dateTo && day > dateTo) return false;
    if (myMs && m.ms !== myMs) return false;
    if (partnerMs && m.partner_ms !== partnerMs) return false;
    if (enemyMs && m.opponent1_ms !== enemyMs && m.opponent2_ms !== enemyMs) return false;
    if (result === 'win' && !m.win) return false;
    if (result === 'loss' && m.win) return false;
    if (!inRange(m.dmg_given, dgMin, dgMax)) return false;
    if (!inRange(m.dmg_taken, dtMin, dtMax)) return false;
    if (!inRange(m.kills, kMin, kMax)) return false;
    if (!inRange(m.deaths, deMin, deMax)) return false;
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
