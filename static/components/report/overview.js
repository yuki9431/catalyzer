import { html, useState } from '../../htm-preact-standalone.js';
import { themeReader } from '../../lib/theme.js';
import { clampMetric } from '../../analysis/stats.js';
import { cellDisplay, colorBursts, colorDE, colorDeaths, colorDmgGiven, colorDmgTaken, colorExDmg, colorKD, colorKills, colorPct, esc } from '../../lib/format.js';
import { Panel, SortableTable, SubSection, Table, Tips } from '../ui.js';
import { Popover, usePopover } from '../popover.js';
import { CompareRadar, SeasonChart, WinRateRowList } from '../charts.js';
import { ActionPlanPanel } from './action-plan.js';

// 2系列を重ねたレーダー（series: [{label, color, bg, data[]}]）
// 全体・勝利時・敗北時を下のボタンで単一選択し、レーダーとテーブルを連動して切り替える
// 軸はK/D比(頂点)→被ダメ(右)→EXダメ(下)→与ダメ(左)。勝率は分割で無意味なため含めない
function BasicLensSection({ basic, pattern, lens }) {
  if (!basic) return null;
  var cssVar = themeReader();
  if (!lens) lens = 'all';
  var metrics = (pattern && pattern.metrics) || [];
  function wmVal(label) {
    var m = metrics.find(function (m) { return m.label === label; });
    if (!m) return null;
    return lens === 'win' ? m.win_avg : m.loss_avg;
  }
  // 攻めを上半分・守りを下半分に固めつつ3ペアを対極配置: 与ダメ↔被ダメ, 撃墜↔被撃墜, EXダメ↔覚醒回数
  // 軸順(idx): 0=与ダメ(上), 1=撃墜(右上), 2=覚醒回数(右下), 3=被ダメ(下), 4=被撃墜(左下), 5=EXダメ(左上)
  function vec(dgv, kv, bv, dtv, dthv, exv) {
    return [clampMetric(dgv, 'dmgGiven'), clampMetric(kv, 'kills'), clampMetric(bv, 'bursts'), clampMetric(dtv, 'dmgTaken'), clampMetric(dthv, 'deaths'), clampMetric(exv, 'exDmg')];
  }
  var seriesByLens = {
    all: { label: '全体', color: cssVar('--accent-2'), bg: cssVar('--accent-2-a20'), data: vec(basic.avg_dmg_given, basic.avg_kills, basic.avg_bursts, basic.avg_dmg_taken, basic.avg_deaths, basic.avg_ex_dmg) },
    win: { label: '勝利時', color: cssVar('--great'), bg: cssVar('--great-a20'), data: vec(wmVal('平均与ダメージ'), wmVal('平均撃墜'), wmVal('平均覚醒回数'), wmVal('平均被ダメージ'), wmVal('平均被撃墜'), wmVal('平均EXダメージ')) },
    loss: { label: '敗北時', color: cssVar('--terrible'), bg: cssVar('--terrible-a18'), data: vec(wmVal('平均与ダメージ'), wmVal('平均撃墜'), wmVal('平均覚醒回数'), wmVal('平均被ダメージ'), wmVal('平均被撃墜'), wmVal('平均EXダメージ')) },
  };

  // [ラベル, 全体値, 色関数]。勝敗時はwin_loss_patternの同名metricから値を引く
  var specs = [
    ['平均与ダメージ', basic.avg_dmg_given, colorDmgGiven],
    ['平均被ダメージ', basic.avg_dmg_taken, colorDmgTaken],
    ['与被ダメ比', basic.dmg_efficiency, function (n) { return colorDE(n, 3); }],
    ['平均撃墜', basic.avg_kills, colorKills],
    ['平均被撃墜', basic.avg_deaths, colorDeaths],
    ['K/D比', basic.kd_ratio, colorKD],
    ['平均EXダメージ', basic.avg_ex_dmg, colorExDmg],
    ['平均覚醒回数', basic.avg_bursts, colorBursts],
  ];
  function valFor(label, allVal) {
    if (lens === 'all') return allVal;
    return wmVal(label);
  }
  var matchesLabel = lens === 'all' ? '試合数' : lens === 'win' ? '勝利数' : '敗北数';
  var matchesVal = lens === 'all' ? (basic.matches + '戦')
    : lens === 'win' ? (basic.wins + '戦') : (basic.losses + '戦');
  // 勝率は勝敗で割ると100%/0%の同語反復になるため、勝敗時は「ー」で行だけ維持
  var rows = [
    [matchesLabel, matchesVal],
    ['勝率', lens === 'all' ? colorPct(basic.win_rate) : '-'],
  ].concat(specs.map(function (s) {
    return [s[0], s[2](valFor(s[0], s[1]))];
  }));

  var lensLabel = seriesByLens[lens].label;
  return html`<div class="two-col">
    <div>
      <${CompareRadar} labels=${['与ダメ', '撃墜', '覚醒回数', '被ダメ', '被撃墜', 'EXダメ']} series=${[seriesByLens[lens]]} showLegend=${false} />
    </div>
    <div class="lens-table">
      <${Table} headers=${['項目', lensLabel]} rows=${rows} />
      <${Tips} tips=${basic.tips} />
    </div>
  </div>`;
}

function PartnerDropdown({ items, idx, onSelect }) {
  var pop = usePopover({});
  var isOpen = pop.isOpen;
  var current = items[idx];
  var label = current.partner_name + (current.team_name ? ' 【' + current.team_name + '】' : '');
  return html`<div class="panel-select-wrap" ref=${pop.rootRef}>
    <button class="panel-select-trigger" data-ui="select-trigger" ref=${pop.triggerRef} onClick=${pop.toggle}>
      ${esc(label)} <span class="period-arrow">${isOpen ? '▲' : '▼'}</span>
    </button>
    <${Popover} pop=${pop} panelClass="panel-select-dropdown" ui="select-panel">
      ${items.map(function (item, i) {
        var itemLabel = item.partner_name + (item.team_name ? ' 【' + item.team_name + '】' : '');
        return html`<button data-ui="select-item" class=${'panel-select-item' + (i === idx ? ' active' : '')}
          onClick=${function () { onSelect(i); pop.close(); }}>${esc(itemLabel)}</button>`;
      })}
    </${Popover}>
  </div>`;
}

function FixedPartnerPanel({ fp, fpItems, lens }) {
  var idxRef = useState(0);
  var idx = idxRef[0], setIdx = idxRef[1];
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

  var msRows = (p.partner_ms_breakdown || []).map(function (m) { return [esc(m.ms), m.matches, colorPct(m.win_rate)]; });

  return html`<${Panel} title="固定相方">
    ${fp.notice && html`<p style="margin-bottom: 12px; color: var(--muted); font-size: 0.875rem;">${esc(fp.notice)}</p>`}
    ${fpItems.length > 1 ? html`<${PartnerDropdown} items=${fpItems} idx=${idx} onSelect=${setIdx} />` : html`<div class="ms-head">
      <span class="name">${esc(p.partner_name)}${p.team_name ? html` <span class="meta">【${esc(p.team_name)}】</span>` : ''}</span>
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

function signed(n) { return (n >= 0 ? '+' : '') + n.toFixed(1); }

// 機体別の勝率比較に並べる最低試合数
var msCompareMinMatches = 10;

export function OverviewPane({ pd, selectedMs, lens, frontendData, msNational, allMatches, userKey }) {
  var seasons = (frontendData && frontendData.season) || [];
  var msSummary = (frontendData && frontendData.ms_summary) || {};
  var natl = msNational || {};
  var msEntries = Object.keys(msSummary).sort(function (a, b) { return msSummary[b].matches - msSummary[a].matches; });
  // 母数の小さい機体と勝ち星0の機体は比較の材料にならないので並べない
  var compareEntries = msEntries.filter(function (name) {
    var s = msSummary[name];
    return s.matches >= msCompareMinMatches && s.basic_stats && s.basic_stats.wins > 0;
  }).map(function (name) {
    var s = msSummary[name];
    var e = { name: name, winRate: msSummary[name].basic_stats.win_rate, matches: s.matches };
    // 全国側の win_rate 0 は抽出失敗なので重ねない
    if (natl[name] && natl[name].win_rate > 0) e.national = natl[name].win_rate;
    return e;
  });

  // 特定機体を選択中は、その機体の全国平均勝率と自分の勝率を比較表示する（勝率>0のデータのみ）。
  var selNatl = (selectedMs && natl[selectedMs] && natl[selectedMs].win_rate > 0) ? natl[selectedMs] : null;

  var msTableRows = msEntries.map(function (name) {
    var s = msSummary[name];
    var nw = natl[name] && natl[name].win_rate > 0 ? colorPct(natl[name].win_rate) : '-';
    return [esc(name), s.matches, s.basic_stats ? colorPct(s.basic_stats.win_rate) : '-', nw];
  });

  var fp = (frontendData && frontendData.fixed_partners) || {};
  var fpList = fp ? (fp.partners || fp) : [];
  var fpItems = Array.isArray(fpList) ? fpList : [];

  return html`<div class="tabpane">
    <${ActionPlanPanel} plan=${frontendData && frontendData.action_plan} selectedMs=${selectedMs} matches=${allMatches} userKey=${userKey} />

    ${pd.basic_stats && html`<${Panel} title="基本データ">
      <${BasicLensSection} basic=${pd.basic_stats} pattern=${pd.win_loss_pattern} lens=${lens} />
    <//>`}

    ${selectedMs && selNatl && lens === 'all' && pd.basic_stats && html`<${Panel} title="全国平均との比較">
      <${Table} headers=${['機体名', '勝率', '全国平均', '差']} rows=${[[esc(selectedMs), colorPct(pd.basic_stats.win_rate), colorPct(selNatl.win_rate), signed(pd.basic_stats.win_rate - selNatl.win_rate)]]} />
    <//>`}

    ${seasons.length > 0 && html`<${Panel} title="シーズン別分析">
      ${seasons.length > 1 && html`<${SeasonChart} seasons=${seasons} />`}
      ${seasons.map(function (s) {
        var rows = [['全体', s.matches, colorPct(s.win_rate), colorDE(s.dmg_efficiency, 3)]];
        if (s.first_half) rows.push(['前半', s.first_half.matches, colorPct(s.first_half.win_rate), colorDE(s.first_half.dmg_efficiency, 3)]);
        if (s.second_half) rows.push(['後半', s.second_half.matches, colorPct(s.second_half.win_rate), colorDE(s.second_half.dmg_efficiency, 3)]);
        return html`<${SubSection} title=${esc(s.name)}>
          <${Table} headers=${['期間', '試合', '勝率', '与被ダメ比']} rows=${rows} />
          <${Tips} tips=${s.tips} />
        <//>`;
      })}
    <//>`}

    ${!selectedMs && compareEntries.length > 1 && html`<${Panel} title=${compareEntries.some(function (e) { return typeof e.national === 'number'; }) ? '機体別の勝率比較（全国平均と比較）' : '機体別の勝率比較'}>
      <${WinRateRowList} entries=${compareEntries} />
      <${SubSection} title="表で見る">
        <${SortableTable} headers=${['機体名', '試合', '勝率', '全国平均']} rows=${msTableRows} defaultLimit=${10} />
      <//>
    <//>`}

    ${fpItems.length > 0 && html`<${FixedPartnerPanel} fp=${fp} fpItems=${fpItems} lens=${lens} />`}

    ${!fpItems.length && fp && fp.notice && html`<${Panel} title="固定相方">
      <p>${esc(fp.notice)}</p>
    <//>`}
  </div>`;
}
