import { html } from '../../htm-preact-standalone.js';
import { Panel, SubSection, Tips } from '../ui.js';
import { CostPairSubSection, EnemyMatchupSection, MsPairSubSection, PartnerSection, WinRateRowList } from '../charts.js';

function entry(name, e) { return { name: name, winRate: e.win_rate, matches: e.matches }; }

export function MatchupPane({ frontendData }) {
  var enemyMatchup = frontendData.enemy_matchup;
  var partnerData = frontendData.partner;
  var costPairData = frontendData.cost_pair;
  var msPairData = frontendData.ms_pair;

  var enemyStrong = (enemyMatchup && enemyMatchup.strong || []).slice(0, 10).map(function (e) { return entry(e.ms, e); });
  var enemyWeak = (enemyMatchup && enemyMatchup.weak || []).slice(0, 10).map(function (e) { return entry(e.ms, e); });
  var partnerEntries = (partnerData || []).slice(0, 10).map(function (p) { return entry(p.ms, p); });
  var msPairEntries = (msPairData && msPairData.by_matches || []).slice(0, 10).map(function (p) { return entry(p.pair, p); });
  var costPairEntries = (costPairData || []).map(function (p) { return entry(p.pair, p); });

  return html`<div class="tabpane">
    ${enemyMatchup && html`<${Panel} title="敵機との相性">
      ${enemyStrong.length > 0 && html`<h3>得意な敵機</h3><${WinRateRowList} entries=${enemyStrong} />`}
      ${enemyWeak.length > 0 && html`<h3>苦手な敵機</h3><${WinRateRowList} entries=${enemyWeak} />`}
      <${SubSection} title="表で見る"><${EnemyMatchupSection} matchup=${enemyMatchup} /><//>
      <${Tips} tips=${enemyMatchup.tips} />
    <//>`}

    ${partnerData && partnerData.length > 0 && html`<${Panel} title="僚機との相性">
      <${WinRateRowList} entries=${partnerEntries} />
      <${SubSection} title="表で見る"><${PartnerSection} partners=${partnerData} /><//>
    <//>`}

    ${msPairData && html`<${Panel} title="編成別勝率">
      ${msPairEntries.length > 0 && html`<${WinRateRowList} entries=${msPairEntries} />`}
      <${SubSection} title="表で見る"><${MsPairSubSection} msPair=${msPairData} /><//>
    <//>`}

    ${costPairData && costPairData.length > 0 && html`<${Panel} title="コスト編成別勝率">
      <${WinRateRowList} entries=${costPairEntries} />
      <${SubSection} title="表で見る"><${CostPairSubSection} costPair=${costPairData} /><//>
    <//>`}
  </div>`;
}
