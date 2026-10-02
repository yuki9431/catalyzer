import { html } from '../../htm-preact-standalone.js';
import { Panel } from '../ui.js';
import { ConsecutiveFallContent, DmgContributionChart, DmgContributionSubSection, FallOrderContent, MsCompareChart, TeamDeathsHeatmap, TeamDeathsImpactSection } from '../charts.js';

export function PlaystylePane({ frontendData }) {
  var teamDeaths = frontendData.team_deaths;
  var dmg = frontendData.dmg_contribution;
  var fallOrder = frontendData.fall_order;
  var consecutiveFall = frontendData.consecutive_fall;

  var fallItems = [];
  if (fallOrder) {
    ['no_fall', 'first_fall', 'second_fall', 'same_time'].forEach(function (k) {
      if (fallOrder[k] && fallOrder[k].count > 0) {
        var labels = { no_fall: '0落ち', first_fall: '先落ち', second_fall: '後落ち', same_time: '同時落ち' };
        fallItems.push({ name: labels[k], winRate: fallOrder[k].win_rate });
      }
    });
  }

  var consecutiveFallItems = [];
  if (consecutiveFall) {
    [['mid_fall', '順落ち（試合継続）'], ['no_fall', '順落ちなし']].forEach(function (r) {
      var s = consecutiveFall[r[0]];
      if (s.count > 0) consecutiveFallItems.push({ name: r[1], winRate: s.win_rate });
    });
  }

  return html`<div class="tabpane">
    ${teamDeaths && teamDeaths.groups.length > 0 && html`<${Panel} title="被撃墜と勝率（自機×僚機）">
      <${TeamDeathsHeatmap} teamDeaths=${teamDeaths} />
      <${TeamDeathsImpactSection} teamDeaths=${teamDeaths} />
    <//>`}

    ${fallOrder && html`<${Panel} title="先落ち/後落ち分析">
      ${fallItems.length > 0 && html`<${MsCompareChart} entries=${fallItems} />`}
      <${FallOrderContent} fallOrder=${fallOrder} />
    <//>`}

    ${consecutiveFall && html`<${Panel} title="順落ち分析">
      <p>順落ち：${consecutiveFall.window_sec}秒以内に2機とも撃墜</p>
      ${consecutiveFallItems.length > 0 && html`<${MsCompareChart} entries=${consecutiveFallItems} />`}
      <${ConsecutiveFallContent} consecutiveFall=${consecutiveFall} />
    <//>`}

    ${dmg && html`<${Panel} title="ダメージ貢献率">
      <${DmgContributionChart} dmg=${dmg} />
      <${DmgContributionSubSection} dmg=${dmg} />
    <//>`}

    ${!(teamDeaths && teamDeaths.groups.length > 0) && !fallOrder && !consecutiveFall && !dmg && html`<${Panel}><p>立ち回りデータがありません。</p><//>`}
  </div>`;
}
