import { html } from '../../htm-preact-standalone.js';
import { Panel } from '../ui.js';
import { CostPairSubSection, EnemyMatchupSection, MsCompareChart, MsPairSubSection, PartnerSection } from '../charts.js';

export function MatchupPane({ frontendData }) {
  var enemyMatchup = frontendData.enemy_matchup;
  var partnerData = frontendData.partner;
  var costPairData = frontendData.cost_pair;
  var msPairData = frontendData.ms_pair;

  var enemyStrong = (enemyMatchup && enemyMatchup.strong || []).slice(0, 10).map(function (e) { return { name: e.ms, winRate: e.win_rate }; });
  var enemyWeak = (enemyMatchup && enemyMatchup.weak || []).slice(0, 10).map(function (e) { return { name: e.ms, winRate: e.win_rate }; });
  var partnerEntries = (partnerData || []).slice(0, 10).map(function (p) { return { name: p.ms, winRate: p.win_rate }; });
  var msPairEntries = (msPairData && msPairData.by_matches || []).slice(0, 10).map(function (p) { return { name: p.pair, winRate: p.win_rate }; });
  var costPairEntries = (costPairData || []).map(function (p) { return { name: p.pair, winRate: p.win_rate }; });

  return html`<div class="tabpane">
    ${enemyMatchup && html`<${Panel} title="敵機との相性">
      ${enemyStrong.length > 0 && html`<h3>得意な相手</h3><${MsCompareChart} entries=${enemyStrong} />`}
      ${enemyWeak.length > 0 && html`<h3>苦手な相手</h3><${MsCompareChart} entries=${enemyWeak} />`}
      <${EnemyMatchupSection} matchup=${enemyMatchup} />
    <//>`}

    ${partnerData && partnerData.length > 0 && html`<${Panel} title="僚機との相性">
      <${MsCompareChart} entries=${partnerEntries} />
      <${PartnerSection} partners=${partnerData} />
    <//>`}

    ${msPairData && html`<${Panel} title="編成別勝率">
      ${msPairEntries.length > 0 && html`<${MsCompareChart} entries=${msPairEntries} />`}
      <${MsPairSubSection} msPair=${msPairData} />
    <//>`}

    ${costPairData && costPairData.length > 0 && html`<${Panel} title="コスト編成別勝率">
      <${MsCompareChart} entries=${costPairEntries} />
      <${CostPairSubSection} costPair=${costPairData} />
    <//>`}
  </div>`;
}
