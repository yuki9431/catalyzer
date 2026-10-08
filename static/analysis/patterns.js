// --- 試合の展開（負け筋）の定義一覧: ミッション判定・試合検索・詳細の強調が同じ test を使う（設計: docs/design/2026-10-08-loss-pattern-search.md） ---
import { COST_FATAL_DEATHS, jsGetDeathEvents, jsGetBurstEvents, consecutiveFallPairs } from './stats.js';

function byStart(arr) { return arr.slice().sort(function (a, b) { return a.action_start_sec - b.action_start_sec; }); }
function deathsOf(actions) { return byStart(jsGetDeathEvents(actions)); }
function burstsOf(actions) { return byStart(jsGetBurstEvents(actions)); }
// 自機 actions が空でも 0落ち0覚醒の可能性があるため、4人分のどれかにイベントがあればタイムラインありとみなす
export function hasTimeline(m) {
  return [m.actions, m.partner_actions, m.opponent1_actions, m.opponent2_actions].some(function (a) { return a && a.length > 0; });
}
// 時刻はセンチ秒精度。浮動小数誤差で境界ちょうどが外れないよう整数に丸めて比べる
function cs(sec) { return Math.round(sec * 100); }
function first(arr) { return arr.length ? [arr[0]] : []; }

// 自分が相方より先に撃墜されたか。'first' / 'second' / 'none'（自分は撃墜なし）/ null（判定不能）
function fallOrder(m) {
  if (!hasTimeline(m)) return null;
  var mine = deathsOf(m.actions);
  if (!mine.length) return 'none';
  var partner = deathsOf(m.partner_actions);
  if (!partner.length || mine[0].action_start_sec < partner[0].action_start_sec) return 'first';
  if (mine[0].action_start_sec > partner[0].action_start_sec) return 'second';
  return null;
}

// 順落ちしたか（定義は stats.js の consecutiveFallPairs）。チーム0落ちは null
function consecutiveFall(m) {
  var pairs = consecutiveFallPairs(m);
  return pairs === null ? null : pairs.length > 0;
}

// 覚醒中（撃墜で覚醒は終わるため終了時刻を含む）の自分の撃墜
function burstDeaths(m) {
  var bursts = burstsOf(m.actions);
  return deathsOf(m.actions).filter(function (d) {
    return bursts.some(function (b) { return d.action_start_sec >= b.action_start_sec && d.action_start_sec <= b.action_end_sec; });
  });
}
// 覚醒中に撃墜されたか。覚醒なし・判定不能は null
function deathDuringBurst(m) {
  if (!hasTimeline(m) || !burstsOf(m.actions).length) return null;
  return burstDeaths(m).length > 0;
}

// 覚醒を1回目の被撃墜より前に使えたか（被撃墜なしは達成扱い）。判定不能は null
function burstBeforeDeath(m) {
  if (!hasTimeline(m)) return null;
  var deaths = deathsOf(m.actions);
  if (!deaths.length) return true;
  var bursts = burstsOf(m.actions);
  return bursts.length > 0 && bursts[0].action_start_sec < deaths[0].action_start_sec;
}

// 覚醒可能域（ex 区間）の内側で撃墜された自分の撃墜。境界は start < t <= end
function heldBurstDeaths(m) {
  var ex = (m.actions || []).filter(function (a) { return a.action === 'ex'; });
  return deathsOf(m.actions).filter(function (d) {
    return ex.some(function (e) { return cs(e.action_start_sec) < cs(d.action_start_sec) && cs(d.action_start_sec) <= cs(e.action_end_sec); });
  });
}

function limitDeath(m) {
  var limit = COST_FATAL_DEATHS[m.ms_cost];
  return limit ? deathsOf(m.actions).slice(limit - 1, limit) : [];
}

function neg(b) { return b === null ? null : !b; }
function hasBursts(m) { return m.bursts > 0; }

export var PATTERNS = [
  {
    key: 'burst', label: '1機目で覚醒せず落ちた', sheet: true, goal: true,
    test: function (m) { return neg(burstBeforeDeath(m)); },
    hits: function (m) { return first(deathsOf(m.actions)); },
    note: '覚醒を使う前に {t} で撃墜されています',
  },
  {
    key: 'held_burst', label: '覚醒を抱えたまま落ちた', sheet: true,
    test: function (m) { return hasTimeline(m) ? heldBurstDeaths(m).length > 0 : null; },
    hits: heldBurstDeaths,
    note: '覚醒を使えるまま {t} で撃墜されています',
  },
  {
    key: 'consecutive_fall', label: '順落ちした', sheet: true, goal: true,
    test: consecutiveFall,
    hits: function (m) {
      var seen = [];
      (consecutiveFallPairs(m) || []).forEach(function (p) { if (seen.indexOf(p[0]) < 0) seen.push(p[0]); });
      return byStart(seen);
    },
    note: '{t} に相方と続けて撃墜されています',
  },
  {
    key: 'burst_death', label: '覚醒中に撃墜された', sheet: true, goal: true,
    test: deathDuringBurst,
    hits: burstDeaths,
    note: '覚醒中に {t} で撃墜されています',
  },
  {
    key: 'fall_first', label: '先落ちした', sheet: true,
    test: function (m) { var o = fallOrder(m); return o === null ? null : o === 'first'; },
    hits: function (m) { return first(deathsOf(m.actions)); },
    note: '相方より先に {t} で撃墜されています',
  },
  {
    key: 'fall_second', label: '後落ちした', sheet: true,
    test: function (m) { var o = fallOrder(m); return o === null || o === 'none' ? null : o === 'second'; },
    hits: function (m) { return first(deathsOf(m.actions)); },
    note: '相方より後に {t} で撃墜されています',
  },
  {
    key: 'dmg_behind', label: '与ダメが被ダメを下回った', sheet: true,
    test: function (m) { return Number.isFinite(m.dmg_given) && Number.isFinite(m.dmg_taken) ? m.dmg_given < m.dmg_taken : null; },
    reason: function (m) { return '与ダメ ' + m.dmg_given + '・被ダメ ' + m.dmg_taken; },
  },
  {
    key: 'deaths', label: '被撃墜でコストオーバー', goal: true,
    test: function (m) { return COST_FATAL_DEATHS[m.ms_cost] ? m.deaths >= COST_FATAL_DEATHS[m.ms_cost] : null; },
    hits: limitDeath,
    note: '{t} の撃墜でコストオーバーしています',
    reason: function (m) { return '被撃墜 ' + m.deaths + '回'; },
  },
  {
    key: 'dmg_taken', label: function (line) { return '被ダメ' + line + '超'; }, goal: true, line: true,
    test: function (m, line) { return Number.isFinite(m.dmg_taken) ? m.dmg_taken > line : null; },
    reason: function (m) { return '被ダメ ' + m.dmg_taken; },
  },
  {
    key: 'dmg_given', label: function (line) { return '与ダメ' + line + '未満'; }, goal: true, line: true,
    test: function (m, line) { return Number.isFinite(m.dmg_given) ? m.dmg_given < line : null; },
    reason: function (m) { return '与ダメ ' + m.dmg_given; },
  },
  {
    key: 'burst_count', label: function (line) { return '覚醒' + line + '回未満'; }, goal: true, line: true,
    test: function (m, line) { return hasTimeline(m) ? m.bursts < line : null; },
    reason: function (m) { return '覚醒 ' + m.bursts + '回'; },
  },
  {
    key: 'ex_dmg', label: function (line) { return 'EXダメ' + line + '未満'; }, goal: true, line: true,
    test: function (m, line) { return hasBursts(m) ? m.ex_dmg < line : null; },
    reason: function (m) { return 'EXダメ ' + m.ex_dmg; },
  },
];

var BY_KEY = {};
PATTERNS.forEach(function (p) { BY_KEY[p.key] = p; });

export function findPattern(key) {
  return Object.prototype.hasOwnProperty.call(BY_KEY, key) ? BY_KEY[key] : null;
}

// ミッションの goal を判定条件 {key, line?} にする。判定に必要な項目が欠けていれば null
export function goalPattern(goal) {
  if (!goal) return null;
  if (goal.key === 'fall_order') {
    return goal.avoid === 'first' ? { key: 'fall_first' } : goal.avoid === 'second' ? { key: 'fall_second' } : null;
  }
  var def = findPattern(goal.key);
  if (!def || def.goal !== true) return null;
  if (def.line) return Number.isFinite(goal.line) ? { key: goal.key, line: goal.line } : null;
  return { key: goal.key };
}

// 当てはまれば true、当てはまらなければ false、判定不能・cond 無効は null
export function testPattern(cond, m) {
  var def = cond && findPattern(cond.key);
  if (!def || (def.line && !Number.isFinite(cond.line))) return null;
  return def.test(m, cond.line);
}

export function patternLabel(cond) {
  var def = cond && findPattern(cond.key);
  if (!def) return '';
  return typeof def.label === 'function' ? def.label(cond.line) : def.label;
}

// 自分の撃墜のうち、当てはまる原因になったもの
export function patternHits(cond, m) {
  var def = cond && findPattern(cond.key);
  if (!def || !def.hits || testPattern(cond, m) !== true) return [];
  return def.hits(m);
}

export function fmtSec(sec) {
  var s = Math.floor(sec);
  var r = s % 60;
  return Math.floor(s / 60) + ':' + (r < 10 ? '0' : '') + r;
}

export function patternNote(cond, m) {
  var def = cond && findPattern(cond.key);
  var hits = patternHits(cond, m);
  if (!def || !def.note || !hits.length) return '';
  return def.note.replace('{t}', fmtSec(hits[0].action_start_sec));
}

export function patternReason(cond, m) {
  var def = cond && findPattern(cond.key);
  if (!def) return '';
  var hits = patternHits(cond, m);
  if (hits.length) return '撃墜 ' + hits.map(function (h) { return fmtSec(h.action_start_sec); }).join('・');
  return def.reason ? def.reason(m, cond.line) : '';
}
