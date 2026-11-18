// --- AI診断に送る要約JSON v1: 数値・列挙キー・機体名だけ。範囲と桁はサーバーの aidiagnosis.ValidateInput と揃える ---
import { computeActionPlan } from './coach.js';
import { jsWinRate as winRate, jsAvg as avg, jsDmgEfficiency as dmgEfficiency, computeEnemyMatchup } from './stats.js';
import { compareToday } from './today.js';

export var MIN_MATCHES = 10;
var MIN_ENEMY = 5;
var TOP_MS = 3;
var MAX_ACTIONS = 5;
var LINE_KEYS = { dmg_taken: true, dmg_given: true, burst_count: true, ex_dmg: true };

// 範囲に収めて小数 digits 桁に丸める(サーバーの範囲・桁の検査に落ちないように)
function num(v, lo, hi, digits) {
  var f = Math.pow(10, digits || 0);
  return Math.min(hi, Math.max(lo, Math.round(v * f) / f));
}
function pct(v) { return num(v, 0, 100, 0); }

function actionKey(a) {
  if (a.key !== 'fall_order') return a.key;
  return a.goal && a.goal.avoid === 'first' ? 'fall_first' : 'fall_second';
}

function actionEntry(a, matches) {
  var e = { key: actionKey(a) };
  if (LINE_KEYS[e.key]) e.line = num(a.goal.line, 0, 10000, 0);
  e.total = num(a.total, 1, matches, 0);
  e.bad_matches = num(a.unachieved, 1, e.total, 0);
  e.bad_win_rate = pct(a.bad_win_rate);
  e.good_win_rate = pct(a.good_win_rate);
  e.gap = pct(a.good_win_rate - a.bad_win_rate);
  e.impact = num(a.impact, 0, 100, 1);
  return e;
}

function recentEntry(r) {
  if (!r) return null;
  return {
    matches: num(r.matches, 1, 100, 0),
    win_rate: num(r.win_rate, 0, 100, 1),
    before_win_rate: num(r.before_win_rate, 0, 100, 1),
    diff: num(r.win_rate - r.before_win_rate, -100, 100, 1),
    worsened: r.worsened.map(function (w) {
      return { metric: w.key, recent: num(w.recent, 0, 10000, 2), before: num(w.before, 0, 10000, 2), delta: num(w.delta, -10000, 10000, 2) };
    }),
  };
}

// 既知の機体名の集合が無い・空なら絞らない(ms_list の現行名と合わない名前はサーバーが400にするため)
function isKnown(name, known) { return !known || known.size === 0 || known.has(name); }

function weakEnemyEntry(w, known) {
  if (!w || !isKnown(w.enemy, known)) return null;
  return { ms: w.enemy, matches: num(w.matches, 1, 100000, 0), win_rate: pct(w.win_rate), other_win_rate: pct(w.other_win_rate), gap: pct(w.other_win_rate - w.win_rate) };
}

function afterStreakEntry(a) {
  if (!a) return null;
  return { streak: num(a.streak, 2, 10, 0), matches: num(a.matches, 1, 100000, 0), win_rate: pct(a.win_rate), other_win_rate: pct(a.other_win_rate), gap: pct(a.other_win_rate - a.win_rate) };
}

// 試合数の多い順(同数は機体名順)に上位 TOP_MS 機の使用実績
function myMsEntries(matches, known) {
  var groups = {};
  matches.forEach(function (m) { if (m.ms && isKnown(m.ms, known)) (groups[m.ms] || (groups[m.ms] = [])).push(m); });
  return Object.keys(groups)
    .sort(function (a, b) { return groups[b].length - groups[a].length || (a < b ? -1 : 1); })
    .slice(0, TOP_MS)
    .map(function (ms) { return { ms: ms, matches: num(groups[ms].length, 1, 100000, 0), win_rate: num(winRate(groups[ms]), 0, 100, 1) }; });
}

function strongEnemyEntries(matches, known) {
  return computeEnemyMatchup(matches, MIN_ENEMY).strong
    .filter(function (e) { return isKnown(e.ms, known); })
    .slice().sort(function (a, b) { return b.matches - a.matches || (a.ms < b.ms ? -1 : 1); })
    .slice(0, TOP_MS)
    .map(function (e) { return { ms: e.ms, matches: num(e.matches, 1, 100000, 0), win_rate: num(e.win_rate, 0, 100, 1) }; });
}

// 最後に遊んだ日(今日とは限らない)。比べる日があれば前の日の値と差も付ける
function lastDayEntry(matches, now) {
  var c = compareToday(matches, now);
  if (!c || c.today.matches < 1 || c.today.matches > 1000) return null;
  var e = { matches: c.today.matches, win_rate: num(c.today.wins / c.today.matches * 100, 0, 100, 1) };
  var wr = c.metrics && c.metrics.find(function (x) { return x.key === 'win_rate'; });
  if (wr && c.prev.matches <= 1000) {
    e.prev_matches = c.prev.matches;
    e.prev_win_rate = num(wr.prev, 0, 100, 1);
    e.win_rate_diff = num(wr.diff, -100, 100, 1);
  }
  return e;
}

// 全試合から要約を作る。試合数が min(既定 MIN_MATCHES)未満なら null。known は既知の機体名の Set(任意)。期間・機体・形式では絞らない
export function buildDiagnosisInput(matches, now, known, min) {
  var ms = matches || [];
  if (ms.length < (min || MIN_MATCHES)) return null;
  var plan = computeActionPlan(ms);
  var wins = ms.filter(function (m) { return m.win; }).length;
  function mean(key) { return avg(ms.map(function (m) { return m[key]; })); }
  return {
    v: 1,
    sample: { matches: num(ms.length, 1, 100000, 0), wins: wins, win_rate: num(winRate(ms), 0, 100, 1) },
    basic: {
      dmg_given: num(mean('dmg_given'), 0, 10000, 0),
      dmg_taken: num(mean('dmg_taken'), 0, 10000, 0),
      ex_dmg: num(mean('ex_dmg'), 0, 10000, 0),
      kills: num(mean('kills'), 0, 10, 2),
      deaths: num(mean('deaths'), 0, 10, 2),
      dmg_efficiency: num(dmgEfficiency(ms), 0, 100, 2),
    },
    actions: plan.actions.slice(0, MAX_ACTIONS).map(function (a) { return actionEntry(a, ms.length); }),
    recent: recentEntry(plan.recent),
    weak_enemy: weakEnemyEntry(plan.weak_enemy, known),
    after_streak: afterStreakEntry(plan.after_streak),
    my_ms: myMsEntries(ms, known),
    strong_enemies: strongEnemyEntries(ms, known),
    last_day: lastDayEntry(ms, now),
  };
}
