import { html, useState } from '../../htm-preact-standalone.js';
import { Panel, SubSection, Tips } from '../ui.js';
import { ToggleGroup } from '../parts.js';
import { CostPairSubSection, EnemyMatchupSection, MsPairSubSection, PartnerSection, WinRateRowList } from '../charts.js';

function entry(name, e) { return { name: name, winRate: e.win_rate, matches: e.matches }; }

var FEW_MATCHES = 10;

function OpponentGradePanel({ data }) {
  var state = useState('all');
  // 絞り込みを変えて選んだ相方の段が消えたら選択も全部に戻す
  var partner = data.by_partner[state[0]] ? state[0] : 'all';
  if (partner !== state[0]) state[1](partner);
  var entries = data.by_partner[partner].map(function (r) {
    return { name: r.label, winRate: r.win_rate, sub: r.matches + '試合' + (r.matches < FEW_MATCHES ? '（少ない）' : '') };
  });
  var options = [{ value: 'all', label: '全部' }].concat(data.partners.map(function (p) { return { value: p.key, label: p.label }; }));
  var tips = ['相手2人の階級の平均で分けています（固定はチーム階級、シャッフルはシャッフル階級）'];
  if (data.unknown > 0) tips.push('階級が分からない' + data.unknown + '試合は含めていません');
  return html`<${Panel} title="相手の階級別勝率">
    ${data.partners.length > 0 && html`<h3>相方の階級</h3><${ToggleGroup} options=${options} value=${partner} onChange=${state[1]} label="相方の階級" ui="grade-partner" />`}
    <${WinRateRowList} entries=${entries} />
    <${Tips} tips=${tips} />
  <//>`;
}

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

    ${frontendData.opponent_grade && html`<${OpponentGradePanel} data=${frontendData.opponent_grade} />`}

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
