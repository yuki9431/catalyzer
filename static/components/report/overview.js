import { html } from '../../htm-preact-standalone.js';
import { themeReader } from '../../lib/theme.js';
import { clampMetric } from '../../analysis/stats.js';
import { colorBursts, colorDE, colorDeaths, colorDmgGiven, colorDmgTaken, colorExDmg, colorKD, colorKills, colorPct, signed } from '../../lib/format.js';
import { Panel, SortableTable, SubSection, Table, Tips } from '../ui.js';
import { useThemeName } from '../chart-canvas.js';
import { CompareRadar, WinRateRowList } from '../charts.js';

// 2系列を重ねたレーダー（series: [{label, color, bg, data[]}]）
// 全体・勝利時・敗北時を下のボタンで単一選択し、レーダーとテーブルを連動して切り替える
// 軸はK/D比(頂点)→被ダメ(右)→EXダメ(下)→与ダメ(左)。勝率は分割で無意味なため含めない
function BasicLensSection({ basic, pattern, lens }) {
  useThemeName();
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

// 機体別の勝率比較に並べる最低試合数
var msCompareMinMatches = 10;

export function OverviewPane({ pd, selectedMs, lens, frontendData, msNational }) {
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
    return [name, s.matches, s.basic_stats ? colorPct(s.basic_stats.win_rate) : '-', nw];
  });

  return html`<div class="tabpane">
    ${pd.basic_stats && html`<${Panel} title="基本データ">
      <${BasicLensSection} basic=${pd.basic_stats} pattern=${pd.win_loss_pattern} lens=${lens} />
    <//>`}

    ${selectedMs && selNatl && lens === 'all' && pd.basic_stats && html`<${Panel} title="全国平均との比較">
      <${Table} headers=${['機体名', '勝率', '全国平均', '差']} rows=${[[selectedMs, colorPct(pd.basic_stats.win_rate), colorPct(selNatl.win_rate), signed(pd.basic_stats.win_rate - selNatl.win_rate)]]} />
    <//>`}

    ${!selectedMs && compareEntries.length > 1 && html`<${Panel} title=${compareEntries.some(function (e) { return typeof e.national === 'number'; }) ? '機体別の勝率比較（全国平均と比較）' : '機体別の勝率比較'}>
      <${WinRateRowList} entries=${compareEntries} />
      <${SubSection} title="表で見る">
        <${SortableTable} headers=${['機体名', '試合', '勝率', '全国平均']} rows=${msTableRows} defaultLimit=${10} />
      <//>
    <//>`}
  </div>`;
}
