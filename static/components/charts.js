import { html } from '../htm-preact-standalone.js';
import { esc, pct, colorPct, colorDE, colorDmgGiven, colorDmgTaken, signed, wrBarTone, wrMark, wrTone } from '../lib/format.js';
import { RowList } from './parts.js';
import { Tips, SortableTable, SubSection, Table } from './ui.js';
import { ChartCanvas, winRateComboConfig, xAxis, pctAxis } from './chart-canvas.js';

// --- Report sections ---

export function EnemyMatchupSection({ matchup }) {
  if (!matchup) return null;
  var headers = ['機体名', '試合', '勝率', '与被ダメ比', '与ダメ', '被ダメ'];
  function matchupRows(list) {
    return (list || []).map(function (e) {
      return [esc(e.ms), e.matches, colorPct(e.win_rate), colorDE(e.dmg_efficiency, 3), colorDmgGiven(e.avg_dmg_given), colorDmgTaken(e.avg_dmg_taken)];
    });
  }
  return html`<div>
    ${matchup.strong && matchup.strong.length > 0 && html`<p><strong>得意な敵機:</strong></p><${SortableTable} headers=${headers} rows=${matchupRows(matchup.strong)} defaultLimit=${5} />`}
    ${matchup.weak && matchup.weak.length > 0 && html`<p><strong>苦手な敵機:</strong></p><${SortableTable} headers=${headers} rows=${matchupRows(matchup.weak)} defaultLimit=${5} />`}
    ${matchup.even && matchup.even.length > 0 && html`<p><strong>互角の敵機:</strong></p><${SortableTable} headers=${headers} rows=${matchupRows(matchup.even)} defaultLimit=${5} />`}
  </div>`;
}

export function PartnerSection({ partners }) {
  if (!partners || !partners.length) return null;
  var rows = partners.map(function (p) {
    return [esc(p.ms), p.matches, colorPct(p.win_rate), colorDE(p.dmg_efficiency, 3)];
  });
  return html`<div>
    <${SortableTable} headers=${['機体名', '試合', '勝率', '与被ダメ比']} rows=${rows} defaultLimit=${10} />
  </div>`;
}


export function MsPairSubSection({ msPair }) {
  if (!msPair) return null;
  var list = msPair.by_matches || [];
  if (!list.length) return null;
  var rows = list.map(function (p) {
    return [esc(p.pair), p.matches, colorPct(p.win_rate), colorDE(p.dmg_efficiency, 3)];
  });
  return html`<div>
    <${SortableTable} headers=${['編成', '試合数', '勝率', '与被ダメ比']} rows=${rows} defaultLimit=${10} />
  </div>`;
}

export function CostPairSubSection({ costPair }) {
  if (!costPair || !costPair.length) return null;
  var rows = costPair.map(function (p) {
    return [esc(p.pair), p.matches, colorPct(p.win_rate), colorDE(p.dmg_efficiency, 3)];
  });
  return html`<div>
    <${SortableTable} headers=${['コスト編成', '試合数', '勝率', '与被ダメ比']} rows=${rows} defaultLimit=${10} />
  </div>`;
}

export function DmgContributionSubSection({ dmg }) {
  if (!dmg) return null;
  function diffPct(win, lose) {
    if (win == null || lose == null) return '-';
    var d = win - lose;
    var s = d >= 0 ? '+' : '';
    return s + d.toFixed(1) + '%';
  }
  var rows = [];
  (dmg.by_cost || []).forEach(function (c) {
    rows.push([c.matches, pct(c.avg_contribution), pct(c.avg_win_contribution), pct(c.avg_lose_contribution), diffPct(c.avg_win_contribution, c.avg_lose_contribution)]);
  });
  return html`<div>
    <${Table} headers=${['試合数', '平均貢献率', '勝利時', '敗北時', '差分']} rows=${rows} />
  </div>`;
}

export function TeamDeathsImpactSection({ teamDeaths }) {
  if (!teamDeaths || !teamDeaths.groups || !teamDeaths.groups.length) return null;
  return html`<div>
    ${teamDeaths.groups.map(function (g) {
      var rows = (g.partners || []).map(function (p) {
        return [p.partner_label, p.matches + '戦', colorPct(p.win_rate)];
      }).concat([['全体', g.matches + '戦', colorPct(g.win_rate)]]);
      return html`<div>
        <h3>自機${g.self_label}</h3>
        <${Table} headers=${['僚機被撃墜', '試合数', '勝率']} rows=${rows} />
      </div>`;
    })}
  </div>`;
}

export function TimeOfDayChart({ hours }) {
  return html`<${ChartCanvas} deps=${[hours]} build=${function (cssVar) {
    if (!hours || !hours.length) return null;
    return winRateComboConfig(cssVar, {
      labels: hours.map(function (h) { return h.hour + '時'; }),
      winRates: hours.map(function (h) { return h.win_rate; }),
      matches: hours.map(function (h) { return h.matches; }),
    });
  }} />`;
}

export function DayOfWeekChart({ days }) {
  return html`<${ChartCanvas} deps=${[days]} build=${function (cssVar) {
    if (!days || !days.length) return null;
    return winRateComboConfig(cssVar, {
      labels: days.map(function (d) { return d.name + '曜'; }),
      winRates: days.map(function (d) { return d.win_rate; }),
      matches: days.map(function (d) { return d.matches; }),
    });
  }} />`;
}

export function DailyTrendChart({ days }) {
  return html`<${ChartCanvas} deps=${[days]} build=${function (cssVar) {
    if (!days || !days.length) return null;
    return winRateComboConfig(cssVar, {
      labels: days.map(function (d) { return d.date; }),
      winRates: days.map(function (d) { return d.win_rate; }),
      matches: days.map(function (d) { return d.matches; }),
      pointRadius: days.length > 30 ? 2 : 4,
      xTicks: { maxRotation: 45 },
      tooltipTitle: function (items) {
        var d = days[items[0].dataIndex];
        return d.date + ' (' + d.dow_name + ')';
      },
    });
  }} />`;
}

export function SeasonChart({ seasons }) {
  return html`<${ChartCanvas} deps=${[seasons]} build=${function (cssVar) {
    if (!seasons || !seasons.length) return null;
    var prevYear = null;
    var labels = seasons.map(function (s) {
      var m = s.name.match(/^(\d{4})年/);
      var label = (m && m[1] === prevYear) ? s.name.replace(/^\d{4}年/, '') : s.name;
      if (m) prevYear = m[1];
      var yi = label.indexOf('年');
      return yi === -1 ? label : [label.slice(0, yi + 1), label.slice(yi + 1)];
    });
    return winRateComboConfig(cssVar, {
      labels: labels,
      winRates: seasons.map(function (s) { return s.win_rate; }),
      matches: seasons.map(function (s) { return s.matches; }),
      xTicks: { maxRotation: 0, minRotation: 0 },
      tooltipTitle: function (items) { return seasons[items[0].dataIndex].name; },
    });
  }} />`;
}

export function WinRateBarChart({ items }) {
  return html`<${ChartCanvas} deps=${[items]} build=${function (cssVar) {
    if (!items || !items.length) return null;
    return winRateComboConfig(cssVar, {
      labels: items.map(function (i) { return i.label; }),
      winRates: items.map(function (i) { return i.win_rate; }),
      matches: items.map(function (i) { return i.matches; }),
      plain: true,
    });
  }} />`;
}

export function DmgContributionChart({ dmg }) {
  return html`<${ChartCanvas} deps=${[dmg]} build=${function (cssVar) {
    if (!dmg || !dmg.by_cost || !dmg.by_cost.length) return null;
    var c = dmg.by_cost[0];
    var labels = ['全体', '勝利時', '敗北時'];
    var values = [c.avg_contribution || 0, c.avg_win_contribution || 0, c.avg_lose_contribution || 0];
    var colors = [cssVar('--accent-2-a50'), cssVar('--great-a60'), cssVar('--terrible-a60')];
    return {
      type: 'bar',
      data: { labels: labels, datasets: [{ label: '貢献率 (%)', data: values, backgroundColor: colors, borderWidth: 0 }] },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: function (ctx) { return '貢献率: ' + ctx.parsed.y.toFixed(1) + '%'; } } } },
        scales: { x: xAxis(cssVar), y: pctAxis(cssVar) },
      },
    };
  }} />`;
}

// 勝率の行リスト。バーは絶対勝率(60/50)、値と▲▼は 60/40。全国平均は縦マーカーと差分テキストで示す
// entries: [{name, winRate, matches?, sub?, national?}]
export function WinRateRowList({ entries }) {
  return html`<${RowList} rows=${entries.map(function (e, i) {
    var sub = e.sub != null ? e.sub : e.matches != null ? e.matches + '試合' : null;
    var hasNatl = typeof e.national === 'number';
    if (hasNatl) {
      var diff = signed(e.winRate - e.national);
      sub = html`${sub ? sub + '・' : ''}全国平均 <span class=${diff[0] === '+' ? 'val-good' : 'val-bad'}>${diff}</span>`;
    }
    return {
      key: e.name + '-' + i, main: e.name, sub: sub,
      aside: wrMark(e.winRate) + pct(e.winRate), asideTone: wrTone(e.winRate),
      bar: { value: e.winRate, tone: wrBarTone(e.winRate), marker: hasNatl ? e.national : undefined },
    };
  })} />`;
}

// 勝率のdivergingヒートカラー。50%を境に緑(高勝率)/赤(低勝率)へ濃度を上げる。
// 他グラフの「≥60緑 / <50赤」の警告色ルールと統一しつつ、連続グラデーションにする。
function heatColor(wr) {
  if (wr >= 50) {
    var tGood = (wr - 50) / 50;
    return 'rgba(var(--win-rgb),' + (0.15 + 0.7 * tGood).toFixed(3) + ')';
  }
  var tBad = (50 - wr) / 50;
  return 'rgba(var(--terrible-rgb),' + (0.15 + 0.7 * tBad).toFixed(3) + ')';
}

export function TeamDeathsHeatmap({ teamDeaths }) {
  var groups = (teamDeaths && teamDeaths.groups) || [];
  if (!groups.length) return null;

  // matrix[self][partner] = {win_rate, matches}
  var matrix = {};
  var partnerLabels = {};
  groups.forEach(function (g) {
    matrix[g.self] = {};
    (g.partners || []).forEach(function (p) {
      partnerLabels[p.partner] = p.partner_label;
      matrix[g.self][p.partner] = { win_rate: p.win_rate, matches: p.matches };
    });
  });
  var partnerKeys = Object.keys(partnerLabels).map(Number).sort(function (a, b) { return a - b; });

  return html`<div class="heatmap-wrap">
    <div class="table-wrap"><table class="heatmap">
      <thead><tr>
        <th>自機＼僚機</th>
        ${partnerKeys.map(function (pk) { return html`<th>僚機${partnerLabels[pk]}</th>`; })}
      </tr></thead>
      <tbody>
        ${groups.map(function (g) {
          return html`<tr>
            <th>自機${g.self_label}</th>
            ${partnerKeys.map(function (pk) {
              var cell = matrix[g.self][pk];
              if (!cell) {
                return html`<td class="heatmap-cell heatmap-cell-empty">−</td>`;
              }
              var title = '自機' + g.self_label + '×僚機' + partnerLabels[pk] + ': 勝率' + cell.win_rate + '% (' + cell.matches + '戦)';
              return html`<td class="heatmap-cell" style=${'background:' + heatColor(cell.win_rate) + ';'} title=${title}>
                <div class="heatmap-wr">${cell.win_rate}%</div>
                <div class="heatmap-matches">${cell.matches}戦</div>
              </td>`;
            })}
          </tr>`;
        })}
      </tbody>
    </table></div>
    <div class="heatmap-legend">
      <span>勝率 低</span>
      <span class="heatmap-legend-bar"></span>
      <span>高</span>
    </div>
  </div>`;
}

// --- Fall order / Burst before death ---

export function FallOrderContent({ fallOrder }) {
  if (!fallOrder) return null;
  // 0件の群は勝率0%と区別するため '-'（stats-empty-group-zero-value）
  function row(label, g) {
    var has = g.count > 0;
    return [label, g.count + '戦', colorPct(has ? g.win_rate : null), colorDmgGiven(has ? g.avg_dmg_given : null), colorDmgTaken(has ? g.avg_dmg_taken : null), colorDE(has ? g.dmg_efficiency : null, 3)];
  }
  var rows = [row('0落ち', fallOrder.no_fall), row('先落ち', fallOrder.first_fall), row('後落ち', fallOrder.second_fall)];
  if (fallOrder.same_time.count > 0) rows.push(row('同時落ち', fallOrder.same_time));
  return html`<div>
    <p>対象: ${fallOrder.total}戦</p>
    <${SubSection} title="表で見る">
      <${Table} headers=${['パターン', '試合数', '勝率', '与ダメ', '被ダメ', '与被ダメ比']} rows=${rows} />
    <//>
    <${Tips} tips=${fallOrder.tips} />
  </div>`;
}

export function ConsecutiveFallContent({ consecutiveFall }) {
  if (!consecutiveFall) return null;
  var cf = consecutiveFall;
  // 0戦の群は勝率0%と区別するため '-'。そのまま負けの群は定義上全敗なので勝率を出さない
  var rows = [
    { label: '順落ち（試合継続）', s: cf.mid_fall },
    { label: '順落ち（そのまま負け）', s: cf.finish_fall, hideWin: true },
    { label: '順落ちなし', s: cf.no_fall },
  ].map(function (r) {
    var has = r.s.count > 0;
    return [r.label, r.s.count + '戦', pct(r.s.rate), colorPct(has && !r.hideWin ? r.s.win_rate : null), colorDE(has ? r.s.dmg_efficiency : null, 3)];
  });
  return html`<div>
    <${SubSection} title="表で見る">
      <${Table} headers=${['パターン', '試合数', '割合', '勝率', '与被ダメ比']} rows=${rows} />
    <//>
  </div>`;
}

export function BurstTimingContent({ timingData }) {
  if (!timingData || !timingData.by_timing || !timingData.by_timing.length) return null;
  var rows = timingData.by_timing.map(function (t) {
    return [t.label, t.count + '戦', colorPct(t.win_rate)];
  });
  return html`<div>
    <p>覚醒発動時の被撃墜数で分類（対象: ${timingData.total}戦）<br />1試合で複数のタイミングに覚醒した場合は各タイミングに計上</p>
    <${Table} headers=${['タイミング', '試合数', '勝率']} rows=${rows} />
    <${Tips} tips=${timingData.tips} />
  </div>`;
}

export function BurstTypeContent({ typeData }) {
  if (!typeData || !typeData.by_type || !typeData.by_type.length) return null;
  var rows = typeData.by_type.map(function (t) {
    return [t.label, t.count + '回', t.matches + '戦', colorPct(t.win_rate)];
  });
  return html`<div>
    <p>F/S/E覚醒の使用傾向（対象: ${typeData.total_bursts}回発動）</p>
    <${Table} headers=${['覚醒タイプ', '発動数', '試合数', '勝率']} rows=${rows} />
    <${Tips} tips=${typeData.tips} />
  </div>`;
}

export function BurstCountContent({ countData }) {
  if (!countData || !countData.by_count || !countData.by_count.length) return null;
  var rows = countData.by_count.map(function (c) {
    return [c.label, c.matches + '戦', colorPct(c.win_rate)];
  });
  return html`<div>
    <${Table} headers=${['覚醒回数', '試合数', '勝率']} rows=${rows} />
    <${Tips} tips=${countData.tips} />
  </div>`;
}

export function OverlimitContent({ overlimit }) {
  if (!overlimit || !overlimit.by_state.length) return null;
  var toRows = function (groups) {
    return groups.map(function (s) { return [s.label, s.matches + '戦', colorPct(s.win_rate)]; });
  };
  var rows = toRows(overlimit.by_state);
  var orderRows = toRows(overlimit.by_order);
  return html`<div>
    <p>EXオーバーリミットの到達度で分類（対象: ${overlimit.total}戦）</p>
    <${Table} headers=${['区分', '試合数', '勝率']} rows=${rows} />
    ${orderRows.length > 0 && html`<p>発動した試合を、相手の最初の発動との前後で分類</p>
    <${Table} headers=${['発動順', '試合数', '勝率']} rows=${orderRows} />`}
  </div>`;
}

export function GameDurationContent({ duration }) {
  if (!duration || !duration.by_duration.length) return null;
  var rows = duration.by_duration.map(function (b) {
    return [b.label, b.matches + '戦', colorPct(b.win_rate)];
  });
  var avg = function (sec) { return sec == null ? '-' : sec + '秒'; };
  return html`<div>
    <p>決着までの時間で分類（対象: ${duration.total}戦）<br />平均試合時間: 勝ち ${avg(duration.avg_win_sec)} / 負け ${avg(duration.avg_lose_sec)}</p>
    <${Table} headers=${['試合時間', '試合数', '勝率']} rows=${rows} />
  </div>`;
}

// レーダーの最低描画半径(%)。全軸が最低評価(0)でも中心の点に潰れず六角形の厚みを残すための底上げ。
var RADAR_FLOOR_PCT = 15;
// 0-100の正規化値を [RADAR_FLOOR_PCT, 100] に写像する（順序は保つ）。
function radarFloor(v) {
  var n = Math.max(0, Math.min(100, Number(v) || 0));
  return RADAR_FLOOR_PCT + n / 100 * (100 - RADAR_FLOOR_PCT);
}

// 基本データ比較レーダー（複数系列を重ねて表示）。series は {label,data,color,bg,hidden} の配列。
// 軸は0-100正規化済みの値を渡す前提。最低評価でも六角形を保つため内部で底上げする。
export function CompareRadar({ labels, series, showLegend }) {
  return html`<${ChartCanvas} className="chart-container chart-radar" deps=${[labels, series, showLegend]} build=${function (cssVar) {
    return {
      type: 'radar',
      data: {
        labels: labels,
        datasets: series.map(function (s) {
          return {
            label: s.label, data: s.data.map(radarFloor), hidden: !!s.hidden,
            backgroundColor: s.bg, borderColor: s.color,
            pointBackgroundColor: s.color, borderWidth: 2,
          };
        }),
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: showLegend === false ? { display: false } : { labels: { color: cssVar('--muted') } } },
        scales: {
          r: {
            min: 0, max: 100, ticks: { display: false, stepSize: 25 },
            grid: { color: cssVar('--chart-radar-grid') }, angleLines: { color: cssVar('--chart-radar-grid') },
            pointLabels: { color: cssVar('--chart-text'), font: { size: 12 } },
          },
        },
      },
    };
  }} />`;
}
