import { html } from '../htm-preact-standalone.js';
import { compareToday } from '../analysis/today.js';
import { ActionPlanPanel } from './report/action-plan.js';
import { Panel } from './ui.js';

var MS_CHIPS = 3;

function md(day) { return Number(day.slice(5, 7)) + '/' + Number(day.slice(8, 10)); }
function fmt(n, digits, unit) { return n.toFixed(digits) + unit; }
function signed(n, digits) { return (n > 0 ? '+' : '') + n.toFixed(digits); }

function WinLoss({ s }) {
  return html`<span class="today-wl"><span class="w">${s.wins}勝</span> <span class="l">${s.losses}敗</span></span>`;
}

function TodayCompare({ matches, selectedMs }) {
  var target = selectedMs ? (matches || []).filter(function (m) { return m.ms === selectedMs; }) : matches;
  var c = compareToday(target, new Date());
  if (!c) return html`<p class="today-empty" data-ui="today-empty">まだ試合がありません。</p>`;
  return html`<div data-ui="today-card">
    <div class="today-label">${c.is_today ? '今日' : '前回'} ${md(c.day)}${selectedMs ? '・' + selectedMs : ''}</div>
    <div class="today-title">${c.today.matches}戦 <${WinLoss} s=${c.today} /></div>
    ${!selectedMs && html`<div class="today-ms">${c.by_ms.slice(0, MS_CHIPS).map(function (e) {
      return html`<span class="today-chip">${e.ms} ${e.matches}戦 ${e.wins}勝</span>`;
    })}${c.by_ms.length > MS_CHIPS && html`<span class="today-chip more">ほか${c.by_ms.length - MS_CHIPS}機体</span>`}</div>`}
    ${c.metrics && html`<table class="today-cmp" data-ui="today-compare">
      <thead><tr><th></th><td class="prev">${c.is_today ? '前回' : 'その前'} ${md(c.prev_day)}</td><td>${c.is_today ? '今日' : md(c.day)}</td><td></td></tr></thead>
      <tbody>
        <tr><th>試合数</th><td class="prev">${c.prev.matches}戦</td><td class="now">${c.today.matches}戦</td><td></td></tr>
        ${c.metrics.map(function (x) {
          return html`<tr><th>${x.label}</th><td class="prev">${fmt(x.prev, x.digits, x.unit)}</td><td class="now">${fmt(x.today, x.digits, x.unit)}</td>
            <td class=${x.better === null ? 'flat' : x.better ? 'up' : 'down'}>${signed(x.diff, x.digits)}</td></tr>`;
        })}
      </tbody>
    </table>`}
  </div>`;
}

// ホーム画面: 勝率アップミッションと、今日(無ければ最後に遊んだ日)の成績と前回の比較
export function HomeView({ matches, selectedMs, userKey, plan }) {
  return html`<div class="tabpane home" data-ui="home">
    <${ActionPlanPanel} plan=${plan} selectedMs=${selectedMs} matches=${matches} userKey=${userKey} />
    <${Panel} title="前回との比較">
      <${TodayCompare} matches=${matches} selectedMs=${selectedMs} />
    <//>
  </div>`;
}
