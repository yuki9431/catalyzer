// --- 今日の成績を前回プレイした日と比べる ---
import { jsWinRate as winRate, jsAvg as avg, jsDmgEfficiency as dmgEfficiency } from './stats.js';

// 深夜の試合を前日の続きとして扱うため、日付の切り替えを朝5時にする
var DAY_START_HOUR = 5;

function pad(n) { return String(n).padStart(2, '0'); }
function ymd(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }

// 'YYYY-MM-DD HH:MM' の試合日時が属するプレイ日
export function playDay(date) {
  var d = new Date(date.slice(0, 10) + 'T' + (date.slice(11, 16) || '12:00') + ':00');
  d.setHours(d.getHours() - DAY_START_HOUR);
  return ymd(d);
}

export function currentPlayDay(now) {
  var d = new Date(now.getTime());
  d.setHours(d.getHours() - DAY_START_HOUR);
  return ymd(d);
}

function dayStats(ms) {
  var wins = ms.filter(function (m) { return m.win; }).length;
  return { matches: ms.length, wins: wins, losses: ms.length - wins };
}

function byMs(ms) {
  var map = {};
  ms.forEach(function (m) {
    var e = map[m.ms] || (map[m.ms] = { ms: m.ms, matches: 0, wins: 0 });
    e.matches++;
    if (m.win) e.wins++;
  });
  return Object.keys(map).map(function (k) { return map[k]; }).sort(function (a, b) { return b.matches - a.matches; });
}

function mean(key) { return function (ms) { return avg(ms.map(function (m) { return m[key]; })); }; }
// 総合の要約欄と同じ項目に被撃墜を足す
var METRICS = [
  { key: 'win_rate', label: '勝率', unit: '%', higher: true, digits: 1, calc: winRate },
  { key: 'dmg_given', label: '平均与ダメージ', higher: true, digits: 0, calc: mean('dmg_given') },
  { key: 'dmg_taken', label: '平均被ダメージ', higher: false, digits: 0, calc: mean('dmg_taken') },
  { key: 'dmg_efficiency', label: '与被ダメ比', higher: true, digits: 2, calc: dmgEfficiency },
  { key: 'ex_dmg', label: '平均EXダメージ', higher: true, digits: 0, calc: mean('ex_dmg') },
  { key: 'deaths', label: '平均被撃墜', higher: false, digits: 1, calc: mean('deaths') },
];

function roundTo(n, digits) { var f = Math.pow(10, digits); return Math.round(n * f) / f; }

// 今日(試合が無ければ最後に遊んだ日)をその前に遊んだ日と比べる。試合が無ければ null、比べる日が無ければ metrics は null
export function compareToday(matches, now) {
  var today = currentPlayDay(now);
  var groups = {};
  (matches || []).forEach(function (m) {
    if (!m || !m.date) return;
    var day = playDay(m.date);
    if (day > today) return;
    (groups[day] || (groups[day] = [])).push(m);
  });
  var days = Object.keys(groups).sort();
  var day = groups[today] ? today : days[days.length - 1];
  if (!day) return null;
  var todayMs = groups[day];
  var prevDay = days.filter(function (d) { return d < day; }).pop() || null;
  var prevMs = prevDay ? groups[prevDay] : [];
  var metrics = null;
  if (prevMs.length) {
    metrics = METRICS.map(function (x) {
      var t = roundTo(x.calc(todayMs), x.digits), p = roundTo(x.calc(prevMs), x.digits);
      var diff = roundTo(t - p, x.digits);
      return { key: x.key, label: x.label, unit: x.unit || '', digits: x.digits, today: t, prev: p, diff: diff,
        better: diff === 0 ? null : (diff > 0) === x.higher };
    });
  }
  return {
    day: day, is_today: day === today, prev_day: prevDay,
    today: dayStats(todayMs), prev: prevDay ? dayStats(prevMs) : null,
    by_ms: byMs(todayMs), metrics: metrics,
  };
}
