import { html } from '../../htm-preact-standalone.js';
import { bestWorstHour, burstKpi, enemyKpi, partnerKpi } from '../../analysis/stats.js';
import { num, pct, wrMark, wrTone } from '../../lib/format.js';
import { Summary } from '../parts.js';

// 非勝率系の tone。大きいほど良い(higher)かどうかで great/terrible を good/bad に写す
function tone(n, great, terrible, higher) {
  if (n == null) return '';
  if (higher) return n >= great ? 'good' : n <= terrible ? 'bad' : '';
  return n <= great ? 'good' : n >= terrible ? 'bad' : '';
}

function item(label, value, sub, t) { return { label: label, value: value, sub: sub, tone: t || '' }; }

// 勝率の行。n が 0 件(または勝率なし)のときは「データ不在」として '-' にする（stats-empty-group-zero-value）
function wrItem(label, wr, n, sub) {
  if (wr == null || !n) return item(label, '-');
  return item(label, wrMark(wr) + pct(wr), sub, wrTone(wr));
}

function overview(basic) {
  return {
    hero: { label: '勝率', value: num(basic.win_rate, 1), unit: '%', aside: basic.wins + '勝 ' + basic.losses + '敗' },
    items: [
      item('平均与ダメージ', num(basic.avg_dmg_given), '目安 1100 以上', tone(basic.avg_dmg_given, 1100, 700, true)),
      item('平均被ダメージ', num(basic.avg_dmg_taken), '目安 700 以下', tone(basic.avg_dmg_taken, 700, 900, false)),
      item('与被ダメ比', num(basic.dmg_efficiency, 2), '目安 1.20 以上', tone(basic.dmg_efficiency, 1.2, 0.8, true)),
      item('平均EXダメージ', num(basic.avg_ex_dmg), '目安 200 以上', tone(basic.avg_ex_dmg, 200, 100, true)),
    ],
  };
}

function playstyle(basic, fd) {
  var fo = fd.fall_order, dc = fd.dmg_contribution;
  var ff = fo && fo.first_fall, nf = fo && fo.no_fall;
  var hero = { label: '先落ち率', value: fo ? num(ff.rate, 1) : '-', unit: fo ? '%' : null };
  if (fo) hero.aside = ff.count + ' / ' + fo.total + '試合';
  if (ff && ff.count > 0) hero.note = '先落ちした試合の勝率 ' + pct(ff.win_rate);
  return {
    hero: hero,
    items: [
      wrItem('0落ち時の勝率', nf && nf.win_rate, nf && nf.count, nf && nf.count + '試合'),
      item('ダメージ貢献率', dc ? pct(dc.avg_contribution) : '-', 'チーム与ダメに占める割合'),
      item('勝利時の貢献率', dc ? pct(dc.avg_win_contribution) : '-'),
      item('K/D比', num(basic.kd_ratio, 2), '目安 1.20 以上', tone(basic.kd_ratio, 1.2, 0.8, true)),
    ],
  };
}

function burst(basic, fd) {
  var bk = burstKpi(fd.burst_count);
  return {
    hero: { label: '平均覚醒回数', value: basic.avg_bursts != null ? num(basic.avg_bursts, 2) : '-', unit: basic.avg_bursts != null ? '回' : null, aside: '1試合あたり' },
    items: [
      item('2回覚醒した割合', pct(bk.rate2), bk.matches2 != null ? bk.matches2 + '試合' : null),
      wrItem('2回覚醒時の勝率', bk.winRate2, bk.matches2),
      item('覚醒しなかった割合', pct(bk.rate0), bk.matches0 != null ? bk.matches0 + '試合' : null),
      wrItem('覚醒しなかった時の勝率', bk.winRate0, bk.matches0),
    ],
  };
}

function matchup(fd) {
  var em = fd.enemy_matchup, ek = enemyKpi(em), pk = partnerKpi(fd.partner);
  var best = pk.bestWinRate, worst = ek.worst;
  return {
    hero: {
      label: '得意な敵機 / 苦手な敵機',
      value: em ? em.strong.length + ' / ' + em.weak.length : '-',
      unit: em ? '機体' : null,
      aside: em ? '3試合以上対戦した ' + ek.total + ' 機体のうち' : null,
      note: '得意は勝率 60% 以上、苦手は 40% 以下',
    },
    items: [
      item('3試合以上組んだ僚機', pk.count),
      item('最も多く組んだ僚機', pk.top ? pk.top.ms : '-', pk.top ? pk.top.matches + '試合' : null),
      Object.assign(wrItem('僚機別の最高勝率', best && best.win_rate, best && best.matches), { sub: best ? best.ms : null }),
      Object.assign(wrItem('最も勝率が低い敵機', worst && worst.win_rate, worst && worst.matches), { sub: worst ? worst.ms : null }),
    ],
  };
}

function time(fd) {
  var bw = bestWorstHour(fd.time_of_day);
  var dow = fd.day_of_week, wd = dow && dow.weekday, we = dow && dow.weekend;
  var days = fd.daily_trend && fd.daily_trend.days ? fd.daily_trend.days.length : null;
  function hourSub(h) { return '勝率 ' + pct(h.win_rate) + '・' + h.matches + '試合'; }
  return {
    hero: { label: '最も勝率が高い時間帯', value: bw.best ? bw.best.hour : '-', unit: bw.best ? '時台' : null, aside: bw.best ? hourSub(bw.best) : null },
    items: [
      bw.worst ? item('最も勝率が低い時間帯', bw.worst.hour + '時台', hourSub(bw.worst), wrTone(bw.worst.win_rate)) : item('最も勝率が低い時間帯', '-'),
      item('プレイした日数', days != null ? days + '日' : '-'),
      wrItem('平日の勝率', wd && wd.win_rate, wd && wd.matches, wd && wd.matches + '試合'),
      wrItem('土日の勝率', we && we.win_rate, we && we.matches, we && we.matches + '試合'),
    ],
  };
}

// activeTab に応じた要約(主指標1つ + 指標4つ)。基本統計が無ければ null
export function buildSummary(activeTab, fd) {
  var basic = fd && fd.basic_stats;
  if (!basic) return null;
  if (activeTab === 'playstyle') return playstyle(basic, fd);
  if (activeTab === 'burst') return burst(basic, fd);
  if (activeTab === 'matchup') return matchup(fd);
  if (activeTab === 'time') return time(fd);
  return overview(basic);
}

export function ReportSummary({ activeTab, frontendData, scope }) {
  var s = buildSummary(activeTab, frontendData);
  if (!s) return null;
  return html`<div class="report-summary">
    <p class="report-scope" data-ui="report-scope">${scope}・${frontendData.basic_stats.matches}試合</p>
    <${Summary} hero=${s.hero} items=${s.items} />
  </div>`;
}
