import { html } from '../../htm-preact-standalone.js';
import { colorDE, colorPct } from '../../lib/format.js';
import { Panel, SortableTable, SubSection, Table, Tips } from '../ui.js';
import { DailyTrendChart, DayOfWeekChart, SeasonChart, TimeOfDayChart } from '../charts.js';

export function TimePane({ pd }) {
  var time = pd.time_of_day, dow = pd.day_of_week, daily = pd.daily_trend, seasons = pd.season || [];
  var timeRows = time && time.hours ? time.hours.map(function (h) {
    return [{ sortValue: h.hour, display: h.hour + '時' }, h.matches, colorPct(h.win_rate), colorDE(h.dmg_efficiency, 3)];
  }) : [];
  var dowSummary = [];
  if (dow && dow.weekday) dowSummary.push(['平日', dow.weekday.matches, colorPct(dow.weekday.win_rate), colorDE(dow.weekday.dmg_efficiency, 3)]);
  if (dow && dow.weekend) dowSummary.push(['土日', dow.weekend.matches, colorPct(dow.weekend.win_rate), colorDE(dow.weekend.dmg_efficiency, 3)]);
  var dowDays = (dow && dow.days || []).map(function (d) {
    return [d.name + '曜', d.matches, colorPct(d.win_rate), colorDE(d.dmg_efficiency, 3)];
  });
  var dailyRows = (daily && daily.days || []).map(function (d) {
    return [{ sortValue: d.sort_key, display: d.date + ' (' + d.dow_name + ')' }, d.matches, colorPct(d.win_rate), colorDE(d.dmg_efficiency, 3)];
  });

  return html`<div class="tabpane">
    ${time && time.hours && time.hours.length > 0 && html`<${Panel} title="時間帯別の勝率">
      <${TimeOfDayChart} hours=${time.hours} />
      <${Tips} tips=${time.tips} />
      <${SubSection} title="表で見る">
        <${SortableTable} headers=${['時間帯', '試合', '勝率', '与被ダメ比']} rows=${timeRows} />
      <//>
    <//>`}
    ${dow && dow.days && dow.days.length > 0 && html`<${Panel} title="曜日別の勝率">
      <${DayOfWeekChart} days=${dow.days} />
      <${Tips} tips=${dow.tips} />
      <${SubSection} title="表で見る">
        ${dowSummary.length > 0 && html`<h3>平日 vs 土日</h3><${Table} headers=${['区分', '試合', '勝率', '与被ダメ比']} rows=${dowSummary} />`}
        ${dowDays.length > 0 && html`<h3>曜日別</h3><${Table} headers=${['曜日', '試合', '勝率', '与被ダメ比']} rows=${dowDays} />`}
      <//>
    <//>`}
    ${daily && daily.days && daily.days.length > 0 && html`<${Panel} title="日別勝率">
      <${DailyTrendChart} days=${daily.days} />
      <${Tips} tips=${daily.tips} />
      <${SubSection} title="表で見る">
        <${SortableTable} headers=${['日付', '試合', '勝率', '与被ダメ比']} rows=${dailyRows} />
      <//>
    <//>`}
    ${seasons.length > 0 && html`<${Panel} title="シーズン別分析">
      ${seasons.length > 1 && html`<${SeasonChart} seasons=${seasons} />`}
      ${seasons.map(function (s) {
        var rows = [['全体', s.matches, colorPct(s.win_rate), colorDE(s.dmg_efficiency, 3)]];
        if (s.first_half) rows.push(['前半', s.first_half.matches, colorPct(s.first_half.win_rate), colorDE(s.first_half.dmg_efficiency, 3)]);
        if (s.second_half) rows.push(['後半', s.second_half.matches, colorPct(s.second_half.win_rate), colorDE(s.second_half.dmg_efficiency, 3)]);
        return html`<${SubSection} title=${s.name}>
          <${Table} headers=${['期間', '試合', '勝率', '与被ダメ比']} rows=${rows} />
          <${Tips} tips=${s.tips} />
        <//>`;
      })}
    <//>`}
  </div>`;
}
