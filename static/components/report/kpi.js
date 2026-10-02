import { html } from '../../htm-preact-standalone.js';
import { bestWorstHour, burstKpi, partnerKpi } from '../../analysis/stats.js';
import { num, pct } from '../../lib/format.js';

// KPIカードの色クラス。higher=trueは大きいほど良い
function kpiClass(n, great, good, terrible, higher) {
  if (n == null) return '';
  if (higher) return n >= great ? 'great' : n >= good ? 'good' : n <= terrible ? 'terrible' : 'bad';
  return n <= great ? 'great' : n <= good ? 'good' : n >= terrible ? 'terrible' : 'bad';
}

function kpiCard(label, value, cls, sub) {
  return { label: label, value: value, cls: cls || '', sub: sub || '' };
}

var WR_KPI = [60, 50, 40, true]; // 勝率カード共通のしきい値（great/good/terrible/higher）
function wrClass(wr) { return kpiClass(wr, WR_KPI[0], WR_KPI[1], WR_KPI[2], WR_KPI[3]); }

// activeTab に応じた6枚のKPIカードを構築する。基本統計が無ければ null。
// 各タブの派生指標は frontendData 内のデータで完結し、欠損時は '-' 表示にする。
function buildKpiCards(activeTab, fd) {
  var basic = fd && fd.basic_stats;
  if (!basic) return null;
  var matchesCard = kpiCard('対戦数', basic.matches, '', basic.wins + '勝 ' + basic.losses + '敗');

  if (activeTab === 'playstyle') {
    var fo = fd.fall_order;
    var dc = fd.dmg_contribution;
    // buildStats は該当0件でも win_rate:0 を返すため、count で「データ不在」と「実績0%」を区別する
    var ff = fo && fo.first_fall.count ? fo.first_fall : null;
    var nf = fo && fo.no_fall.count ? fo.no_fall : null;
    return [
      kpiCard('先落ち率', fo ? pct(fo.first_fall.rate) : '-'),
      kpiCard('先落ち勝率', ff ? pct(ff.win_rate) : '-', ff ? wrClass(ff.win_rate) : ''),
      kpiCard('0落ち勝率', nf ? pct(nf.win_rate) : '-', nf ? wrClass(nf.win_rate) : ''),
      kpiCard('ダメ貢献率', dc ? pct(dc.avg_contribution) : '-'),
      kpiCard('勝ち時貢献率', dc ? pct(dc.avg_win_contribution) : '-'),
      kpiCard('K/D比', num(basic.kd_ratio, 2), kpiClass(basic.kd_ratio, 1.2, 1.0, 0.8, true)),
    ];
  }

  if (activeTab === 'burst') {
    var bk = burstKpi(fd.burst_count);
    return [
      kpiCard('平均覚醒回数', basic.avg_bursts != null ? num(basic.avg_bursts, 2) : '-'),
      kpiCard('2覚醒率', pct(bk.rate2)),
      kpiCard('2覚醒時勝率', pct(bk.winRate2), wrClass(bk.winRate2)),
      kpiCard('未覚醒率', pct(bk.rate0)),
      kpiCard('未覚醒時勝率', pct(bk.winRate0), wrClass(bk.winRate0)),
      matchesCard,
    ];
  }

  if (activeTab === 'matchup') {
    var em = fd.enemy_matchup;
    var pk = partnerKpi(fd.partner);
    return [
      kpiCard('得意機体数', em ? em.strong.length : '-', '', '勝率60%以上'),
      kpiCard('苦手機体数', em ? em.weak.length : '-', '', '勝率40%以下'),
      kpiCard('相方数', pk.count, '', '3戦以上'),
      kpiCard('最多相方', pk.top ? pk.top.matches : '-', '', pk.top ? pk.top.ms : ''),
      kpiCard('相方最高勝率', pk.bestWinRate ? pct(pk.bestWinRate.win_rate) : '-', pk.bestWinRate ? wrClass(pk.bestWinRate.win_rate) : '', pk.bestWinRate ? pk.bestWinRate.ms : ''),
      matchesCard,
    ];
  }

  if (activeTab === 'time') {
    var bw = bestWorstHour(fd.time_of_day);
    var dow = fd.day_of_week;
    var wd = dow && dow.weekday, we = dow && dow.weekend;
    var days = fd.daily_trend && fd.daily_trend.days ? fd.daily_trend.days.length : null;
    return [
      kpiCard('最高勝率時間帯', bw.best ? bw.best.hour + '時' : '-', bw.best ? wrClass(bw.best.win_rate) : '', bw.best ? pct(bw.best.win_rate) : ''),
      kpiCard('最低勝率時間帯', bw.worst ? bw.worst.hour + '時' : '-', bw.worst ? wrClass(bw.worst.win_rate) : '', bw.worst ? pct(bw.worst.win_rate) : ''),
      kpiCard('平日勝率', wd && wd.matches ? pct(wd.win_rate) : '-', wd && wd.matches ? wrClass(wd.win_rate) : ''),
      kpiCard('土日勝率', we && we.matches ? pct(we.win_rate) : '-', we && we.matches ? wrClass(we.win_rate) : ''),
      kpiCard('プレイ日数', days != null ? days : '-', '', '日'),
      matchesCard,
    ];
  }

  // overview（総合）: 現状維持
  return [
    matchesCard,
    kpiCard('勝率', pct(basic.win_rate), wrClass(basic.win_rate)),
    kpiCard('平均与ダメージ', num(basic.avg_dmg_given), kpiClass(basic.avg_dmg_given, 1100, 900, 700, true)),
    kpiCard('平均被ダメージ', num(basic.avg_dmg_taken), kpiClass(basic.avg_dmg_taken, 700, 800, 900, false)),
    kpiCard('平均EXダメージ', num(basic.avg_ex_dmg), kpiClass(basic.avg_ex_dmg, 200, 160, 100, true)),
    kpiCard('与被ダメ比', num(basic.dmg_efficiency, 2), kpiClass(basic.dmg_efficiency, 1.2, 1.0, 0.8, true)),
  ];
}

export function KpiGrid({ activeTab, frontendData }) {
  var cards = buildKpiCards(activeTab, frontendData);
  if (!cards) return null;
  return html`<div class="kpi-grid" data-ui="kpi-grid">${cards.map(function (c) {
    return html`<div class="kpi">
      <div class="kpi-label">${c.label}</div>
      <div class=${'kpi-value ' + c.cls}>${c.value}</div>
      ${c.sub && html`<div class="kpi-sub">${c.sub}</div>`}
    </div>`;
  })}</div>`;
}
