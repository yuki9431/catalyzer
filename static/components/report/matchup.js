import { html, useState } from '../../htm-preact-standalone.js';
import { themeReader } from '../../lib/theme.js';
import { clampMetric } from '../../analysis/stats.js';
import { cellDisplay, colorBursts, colorDE, colorDeaths, colorDmgGiven, colorDmgTaken, colorExDmg, colorKD, colorKills, colorPct } from '../../lib/format.js';
import { Panel, SubSection, Table, Tips } from '../ui.js';
import { ToggleGroup } from '../parts.js';
import { Popover, usePopover } from '../popover.js';
import { useThemeName } from '../chart-canvas.js';
import { CompareRadar, CostPairSubSection, EnemyMatchupSection, MsPairSubSection, PartnerSection, WinRateRowList } from '../charts.js';

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

function PartnerDropdown({ items, idx, onSelect }) {
  var pop = usePopover({});
  var isOpen = pop.isOpen;
  var current = items[idx];
  var label = current.partner_name + (current.team_name ? ' 【' + current.team_name + '】' : '');
  return html`<div class="panel-select-wrap" ref=${pop.rootRef}>
    <button class="panel-select-trigger" data-ui="select-trigger" ref=${pop.triggerRef} onClick=${pop.toggle}>
      ${label} <span class="period-arrow">${isOpen ? '▲' : '▼'}</span>
    </button>
    <${Popover} pop=${pop} panelClass="panel-select-dropdown" ui="select-panel">
      ${items.map(function (item, i) {
        var itemLabel = item.partner_name + (item.team_name ? ' 【' + item.team_name + '】' : '');
        return html`<button data-ui="select-item" class=${'panel-select-item' + (i === idx ? ' active' : '')}
          onClick=${function () { onSelect(i); pop.close(); }}>${itemLabel}</button>`;
      })}
    </${Popover}>
  </div>`;
}

function FixedPartnerPanel({ fp, fpItems, lens }) {
  var idxRef = useState(0);
  var idx = idxRef[0], setIdx = idxRef[1];
  useThemeName();
  var p = fpItems[idx];
  if (!p) return null;
  if (!lens) lens = 'all';
  var cssVar = themeReader();

  var myWl = (p.my_win_loss_pattern && p.my_win_loss_pattern.metrics) || [];
  var partnerWl = (p.partner_win_loss_pattern && p.partner_win_loss_pattern.metrics) || [];
  function valFor(metrics, label, allVal) {
    if (lens === 'all') return allVal;
    var m = metrics.find(function (m) { return m.label === label; });
    if (!m) return null;
    return lens === 'win' ? m.win_avg : m.loss_avg;
  }

  var specs = [
    ['平均与ダメージ', p.my_stats.avg_dmg_given, p.partner_stats.avg_dmg_given, colorDmgGiven],
    ['平均被ダメージ', p.my_stats.avg_dmg_taken, p.partner_stats.avg_dmg_taken, colorDmgTaken],
    ['与被ダメ比', p.my_stats.dmg_efficiency, p.partner_stats.dmg_efficiency, function (n) { return colorDE(n, 3); }],
    ['平均撃墜', p.my_stats.avg_kills, p.partner_stats.avg_kills, colorKills],
    ['平均被撃墜', p.my_stats.avg_deaths, p.partner_stats.avg_deaths, colorDeaths],
    ['K/D比', p.my_stats.kd_ratio, p.partner_stats.kd_ratio, colorKD],
    ['平均EXダメージ', p.my_stats.avg_ex_dmg, p.partner_stats.avg_ex_dmg, colorExDmg],
    ['平均覚醒回数', p.my_stats.avg_bursts, p.partner_stats.avg_bursts, colorBursts],
  ];
  var statsRows = specs.map(function (s) {
    return [s[0], s[3](valFor(myWl, s[0], s[1])), s[3](valFor(partnerWl, s[0], s[2]))];
  });

  function pVec(stats, wlMetrics) {
    function v(label, allVal) { return valFor(wlMetrics, label, allVal); }
    return [
      clampMetric(v('平均与ダメージ', stats.avg_dmg_given), 'dmgGiven'),
      clampMetric(v('平均撃墜', stats.avg_kills), 'kills'),
      clampMetric(v('平均覚醒回数', stats.avg_bursts), 'bursts'),
      clampMetric(v('平均被ダメージ', stats.avg_dmg_taken), 'dmgTaken'),
      clampMetric(v('平均被撃墜', stats.avg_deaths), 'deaths'),
      clampMetric(v('平均EXダメージ', stats.avg_ex_dmg), 'exDmg'),
    ];
  }

  var matchesLabel = lens === 'all' ? '試合数' : lens === 'win' ? '勝利数' : '敗北数';
  var matchesVal = lens === 'all' ? (p.matches + '戦')
    : lens === 'win' ? (p.wins + '戦') : (p.losses + '戦');
  var lensLabel = lens === 'all' ? '全体' : lens === 'win' ? '勝利時' : '敗北時';

  var headerRows = [
    [matchesLabel, matchesVal, '-'],
    ['勝率', lens === 'all' ? colorPct(p.win_rate) : '-', '-'],
  ];

  var msRows = (p.partner_ms_breakdown || []).map(function (m) { return [m.ms, m.matches, colorPct(m.win_rate)]; });

  return html`<${Panel} title="固定相方">
    ${fp.notice && html`<p style="margin-bottom: 12px; color: var(--muted); font-size: 0.875rem;">${fp.notice}</p>`}
    ${fpItems.length > 1 ? html`<${PartnerDropdown} items=${fpItems} idx=${idx} onSelect=${setIdx} />` : html`<div class="ms-head">
      <span class="name">${p.partner_name}${p.team_name ? html` <span class="meta">【${p.team_name}】</span>` : ''}</span>
      <span>${p.matches}戦 ${cellDisplay(colorPct(p.win_rate))}</span>
    </div>`}
    <${CompareRadar} labels=${['与ダメ', '撃墜', '覚醒回数', '被ダメ', '被撃墜', 'EXダメ']} series=${[
      { label: '自機 (' + lensLabel + ')', color: cssVar('--accent'), bg: cssVar('--accent-a20'), data: pVec(p.my_stats, myWl) },
      { label: '僚機 (' + lensLabel + ')', color: cssVar('--bad'), bg: cssVar('--bad-a18'), data: pVec(p.partner_stats, partnerWl) },
    ]} />
    <${Table} headers=${['項目 (' + lensLabel + ')', '自機', '僚機']} rows=${headerRows.concat(statsRows)} />
    ${msRows.length > 0 && html`<p><strong>僚機の内訳:</strong></p><${Table} headers=${['機体', '試合', '勝率']} rows=${msRows} />`}
    <${Tips} tips=${p.tips} />
  <//>`;
}

export function MatchupPane({ frontendData, lens }) {
  var enemyMatchup = frontendData.enemy_matchup;
  var partnerData = frontendData.partner;
  var costPairData = frontendData.cost_pair;
  var msPairData = frontendData.ms_pair;
  var fp = frontendData.fixed_partners || {};
  var fpList = fp.partners || fp;
  var fpItems = Array.isArray(fpList) ? fpList : [];

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

    ${fpItems.length > 0 && html`<${FixedPartnerPanel} fp=${fp} fpItems=${fpItems} lens=${lens} />`}

    ${!fpItems.length && fp && fp.notice && html`<${Panel} title="固定相方">
      <p>${fp.notice}</p>
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
