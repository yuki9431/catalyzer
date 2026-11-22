// --- AI エージェントに渡すレポート(Markdown)。選んだ範囲の集計だけを載せ、プレイヤー名・チーム名は出さない ---
import { computeBasicStats, computeBurstCount, computeBurstTiming, computeBurstType, computeConsecutiveFall, computeCostPair, computeDailyTrend, computeDayOfWeek, computeDmgContribution, computeEnemyMatchup, computeFallOrder, computeFixedPartners, computeGameDuration, computeMsPair, computeMsSummary, computeOpponentGrade, computeOverlimit, computePartner, computeTeamDeathsImpact, computeTimeOfDay, computeWinLossPattern, filterByMode, filterByPlayDays, jsWinRate, PERIOD_DAYS } from './stats.js';
import { computeActionPlan } from './coach.js';
import { MODE_LABELS } from '../lib/match.js';

var MIN_ROW = 5;
var MAX_ENEMY = 30;
var MAX_MS = 15;
var MAX_PARTNER = 20;
var MAX_PAIR = 10;
var MAX_DAYS = 14;
var MAX_FIXED = 10;

var GLOSSARY = [
  'EXVS2IB(機動戦士ガンダム エクストリームバーサス2 インフィニットブースト)の2対2のチーム対戦の戦績を、catalyzer が集計したもの。',
  '',
  '- 自機/僚機/敵機: 自分/味方/相手の機体。機体名は公式の表記',
  '- コスト: 機体の格(3000/2500/2000/1500)。チームで6000を共有し、撃墜されるたびに撃墜された機体のコスト分を失う。0になったチームの負け',
  '- 与ダメ/被ダメ: 与えた/受けたダメージ。与被ダメ比 = 与ダメ ÷ 被ダメ。EXダメ: 公式の戦績にある EXダメージ',
  '- 覚醒: ゲージを使う一時的な強化。F/S/E の3タイプ',
  '- 先落ち/後落ち: チームで自機が先に/僚機が先に撃墜されたこと(自機だけ撃墜されたら先落ち)',
  '- 順落ち: 自機と僚機が15秒以内に続けて撃墜されること',
  '- OL(オーバーリミット): 撃墜されたら負けるコストになるとそのチームの2機が自動でスタンバイし、被弾・命中で自動発動する強化',
  '- シャッフル/固定: 相方が毎回ランダム/固定の対戦形式。不明は形式の記録より前の試合',
  '- 勝率の差は「%」で書く。試合数の少ない行は偶然の偏りが大きい',
];

function cell(v) { return String(v == null ? '-' : v).replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\n/g, ' '); }
function pct(v) { return v == null ? '-' : v + '%'; }
function n0(v) { return v == null ? '-' : String(Math.round(v)); }
function n2(v) { return v == null ? '-' : (Math.round(v * 100) / 100).toString(); }

function table(headers, rows) {
  if (!rows.length) return '(該当なし)';
  var out = ['| ' + headers.map(cell).join(' | ') + ' |', '|' + headers.map(function () { return ' --- '; }).join('|') + '|'];
  rows.forEach(function (r) { out.push('| ' + r.map(cell).join(' | ') + ' |'); });
  return out.join('\n');
}

function section(title, body) { return '## ' + title + '\n\n' + body; }
// 試合経過の無い古い試合だけだと集計が null を返す
function listOf(x, key) { return (x && x[key]) || []; }

function pad2(v) { return (v < 10 ? '0' : '') + v; }
function stamp(d) { return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) + ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes()); }

function overall(ms) {
  var b = computeBasicStats(ms);
  return table(['項目', '値'], [
    ['試合数', b.matches], ['勝敗', b.wins + '勝' + b.losses + '敗'], ['勝率', pct(b.win_rate)],
    ['平均与ダメ', n0(b.avg_dmg_given)], ['平均被ダメ', n0(b.avg_dmg_taken)], ['与被ダメ比', n2(b.dmg_efficiency)],
    ['平均撃墜', n2(b.avg_kills)], ['平均被撃墜', n2(b.avg_deaths)], ['平均EXダメ', n0(b.avg_ex_dmg)], ['平均覚醒回数', n2(b.avg_bursts)],
  ]);
}

function modes(ms) {
  var rows = Object.keys(MODE_LABELS).map(function (k) {
    var g = filterByMode(ms, k);
    return [MODE_LABELS[k], g.length, g.length ? pct(Math.round(jsWinRate(g) * 10) / 10) : '-'];
  });
  var unknown = ms.filter(function (m) { return !MODE_LABELS[m.mode]; });
  rows.push(['不明', unknown.length, unknown.length ? pct(Math.round(jsWinRate(unknown) * 10) / 10) : '-']);
  return table(['形式', '試合', '勝率'], rows.filter(function (r) { return r[1] > 0; }));
}

function recent(plan) {
  var r = plan.recent;
  if (!r) return '(比べられるだけの試合がない)';
  var lines = ['直近' + r.matches + '戦の勝率 ' + pct(r.win_rate) + '(それより前は ' + pct(r.before_win_rate) + ')'];
  if (r.worsened.length) {
    lines.push('', table(['悪化した指標', '直近', 'それより前', '差'], r.worsened.map(function (w) { return [w.label, n2(w.recent), n2(w.before), n2(w.delta)]; })));
  }
  return lines.join('\n');
}

function actions(plan) {
  if (plan.insufficient) return '(ミッションの判定は' + plan.min_matches + '試合以上で行う)';
  var body = table(['ミッション', '達成できなかった試合', '達成できなかった時の勝率', '達成した時の勝率', '全体の勝率の見込み上昇'], plan.actions.map(function (a) {
    return [a.title, a.unachieved + '/' + a.total, pct(a.bad_win_rate), pct(a.good_win_rate), pct(a.impact)];
  }));
  var notes = [];
  if (plan.weak_enemy) notes.push('- 苦手な敵機: ' + plan.weak_enemy.enemy + '(' + plan.weak_enemy.matches + '試合・勝率 ' + pct(plan.weak_enemy.win_rate) + '、それ以外 ' + pct(plan.weak_enemy.other_win_rate) + ')');
  if (plan.after_streak) notes.push('- ' + plan.after_streak.streak + '連敗直後の勝率 ' + pct(plan.after_streak.win_rate) + '(' + plan.after_streak.matches + '試合、それ以外 ' + pct(plan.after_streak.other_win_rate) + ')');
  return '試合を「ミッションを達成できたか」で二分した勝率。見込み上昇 = 勝率差 × 達成できなかった試合数 ÷ 全試合数(与ダメ・被ダメ・EXダメのミッションは半分に割り引く)。\n\n' + body + (notes.length ? '\n\n' + notes.join('\n') : '');
}

function myMs(ms) {
  var s = computeMsSummary(ms);
  var names = Object.keys(s).sort(function (a, b) { return s[b].matches - s[a].matches || (a < b ? -1 : 1); }).slice(0, MAX_MS);
  return table(['自機', '試合', '勝率', '与ダメ', '被ダメ', '与被ダメ比', '被撃墜', '覚醒回数'], names.map(function (k) {
    var b = s[k].basic_stats;
    return [k, b.matches, pct(b.win_rate), n0(b.avg_dmg_given), n0(b.avg_dmg_taken), n2(b.dmg_efficiency), n2(b.avg_deaths), n2(b.avg_bursts)];
  }));
}

function winLoss(ms) {
  var wins = ms.filter(function (m) { return m.win; }).length;
  if (!wins || wins === ms.length) return '(勝ち試合と負け試合の両方があるときだけ比べる)';
  var p = computeWinLossPattern(ms);
  return table(['指標', '勝ち試合の平均', '負け試合の平均', '差'], p.metrics.map(function (m) { return [m.label, n2(m.win_avg), n2(m.loss_avg), n2(m.diff)]; }));
}

function enemies(ms) {
  var e = computeEnemyMatchup(ms, MIN_ROW);
  var rows = e.strong.concat(e.even, e.weak).sort(function (a, b) { return b.matches - a.matches || (a.ms < b.ms ? -1 : 1); }).slice(0, MAX_ENEMY);
  return '敵機ごとに、その機体が相手チームにいた試合を数える(相手が2機とも同じ機体の試合は2回数える。' + MIN_ROW + '試合以上・試合数の多い順に' + MAX_ENEMY + '機まで)。\n\n' +
    table(['敵機', '試合', '勝率', '与被ダメ比'], rows.map(function (r) { return [r.ms, r.matches, pct(r.win_rate), n2(r.dmg_efficiency)]; }));
}

function grades(ms) {
  var g = computeOpponentGrade(ms) || {};
  var rows = listOf(g.by_partner, 'all');
  var body = table(['相手2人の平均階級', '試合', '勝率'], rows.map(function (r) { return [r.label, r.matches, pct(r.win_rate)]; }));
  return g.unknown ? body + '\n\n階級が記録されていない試合: ' + g.unknown : body;
}

function partners(ms) {
  return table(['僚機', '試合', '勝率', '与被ダメ比'], computePartner(ms, MIN_ROW).slice(0, MAX_PARTNER).map(function (r) { return [r.ms, r.matches, pct(r.win_rate), n2(r.dmg_efficiency)]; }));
}

function costPairs(ms) {
  return table(['編成(自機名 + 僚機のコスト)', '試合', '勝率', '与被ダメ比'], computeCostPair(ms).slice(0, MAX_PAIR).map(function (r) { return [r.pair, r.matches, pct(r.win_rate), n2(r.dmg_efficiency)]; }));
}

function msPairs(ms) {
  return table(['編成(自機 + 僚機)', '試合', '勝率'], computeMsPair(ms, 3, MAX_PAIR).by_matches.map(function (r) { return [r.pair, r.matches, pct(r.win_rate)]; }));
}

function fixed(ms, tagPartners) {
  var list = computeFixedPartners(ms, tagPartners || []).partners || [];
  var rows = list.slice().sort(function (a, b) { return b.matches - a.matches; }).slice(0, MAX_FIXED).map(function (p, i) {
    return ['固定相方' + String.fromCharCode(65 + i), p.matches, pct(p.win_rate), n2(p.my_stats.dmg_efficiency), n2(p.partner_stats.dmg_efficiency), n2(p.my_stats.avg_deaths), n2(p.partner_stats.avg_deaths)];
  });
  return table(['相方', '試合', '勝率', '自分の与被ダメ比', '相方の与被ダメ比', '自分の被撃墜', '相方の被撃墜'], rows);
}

function deaths(ms) {
  var t = computeTeamDeathsImpact(ms);
  var rows = [];
  t.groups.forEach(function (g) { g.partners.forEach(function (p) { rows.push([g.self_label, p.partner_label, p.matches, pct(p.win_rate)]); }); });
  var f = computeFallOrder(ms);
  var fall = (f ? [['被撃墜なし', f.no_fall], ['先落ち', f.first_fall], ['後落ち', f.second_fall], ['同時', f.same_time]] : [])
    .filter(function (r) { return r[1].count > 0; })
    .map(function (r) { return [r[0], r[1].count, pct(r[1].rate), pct(r[1].win_rate), n2(r[1].dmg_efficiency)]; });
  var c = computeConsecutiveFall(ms);
  var cons = (c ? [['試合継続', c.mid_fall], ['そのまま負け', c.finish_fall], ['なし', c.no_fall]] : []).filter(function (r) { return r[1].count > 0; }).map(function (r) { return [r[0], r[1].count, pct(r[1].rate), pct(r[1].win_rate)]; });
  return ['### 自機と僚機の被撃墜回数', table(['自機', '僚機', '試合', '勝率'], rows),
    '### 落ち順', table(['落ち順', '試合', '割合', '勝率', '与被ダメ比'], fall),
    '### 順落ち', table(['順落ち', '試合', '割合', '勝率'], cons)].join('\n\n');
}

function damageShare(ms) {
  var d = computeDmgContribution(ms);
  // 勝ち(負け)の無いグループは平均が0で返るので出さない
  function row(label, n, r, group) {
    var w = group.filter(function (m) { return m.win; }).length;
    return [label, n, pct(r.avg_contribution), w ? pct(r.avg_win_contribution) : '-', w < group.length ? pct(r.avg_lose_contribution) : '-'];
  }
  var rows = [row('全体', ms.length, d, ms)];
  (d.by_cost || []).forEach(function (r) { rows.push(row(r.cost_label, r.matches, r, ms.filter(function (m) { return m.ms_cost === r.cost; }))); });
  return 'チームの与ダメのうち自分が出した割合。\n\n' + table(['自機のコスト', '試合', '平均', '勝ち試合', '負け試合'], rows);
}

function bursts(ms) {
  var cnt = listOf(computeBurstCount(ms), 'by_count').map(function (r) { return [r.label, r.matches, pct(r.win_rate)]; });
  var tim = listOf(computeBurstTiming(ms), 'by_timing').map(function (r) { return [r.label, r.count, pct(r.rate), pct(r.win_rate)]; });
  var typ = listOf(computeBurstType(ms), 'by_type').map(function (r) { return [r.label, r.count, r.matches, pct(r.win_rate)]; });
  var ol = listOf(computeOverlimit(ms), 'by_order').map(function (r) { return [r.label, r.matches, pct(r.win_rate)]; });
  return ['### 覚醒回数', table(['覚醒回数', '試合', '勝率'], cnt),
    '### 覚醒したタイミング(1機目=自機の被撃墜0回で発動。1試合が複数の段に入る。割合は覚醒した試合に占める割合)', table(['タイミング', '試合', '割合', '勝率'], tim),
    '### 覚醒タイプ', table(['タイプ', '発動回数', '使った試合', '勝率'], typ),
    '### OL スタンバイの順番(自分と相手の両方がスタンバイになった試合)', table(['順番', '試合', '勝率'], ol)].join('\n\n');
}

function duration(ms) {
  var d = computeGameDuration(ms);
  if (!d) return '(該当なし)';
  return table(['試合時間', '試合', '勝率'], d.by_duration.map(function (r) { return [r.label, r.matches, pct(r.win_rate)]; })) +
    '\n\n平均試合時間: 勝ち ' + n0(d.avg_win_sec) + '秒 / 負け ' + n0(d.avg_lose_sec) + '秒';
}

function times(ms) {
  var h = computeTimeOfDay(ms).hours.map(function (r) { return [r.hour + '時台', r.matches, pct(r.win_rate), n2(r.dmg_efficiency)]; });
  var w = computeDayOfWeek(ms);
  var days = w.days.filter(function (r) { return r.matches > 0; }).map(function (r) { return [r.name, r.matches, pct(r.win_rate), n2(r.dmg_efficiency)]; });
  [['平日', w.weekday], ['土日', w.weekend]].forEach(function (r) { if (r[1].matches > 0) days.push([r[0], r[1].matches, pct(r[1].win_rate), n2(r[1].dmg_efficiency)]); });
  var trend = computeDailyTrend(ms).days.slice(-MAX_DAYS).map(function (r) { return [r.date + '(' + r.dow_name + ')', r.matches, pct(r.win_rate), n2(r.dmg_efficiency)]; });
  return ['### 時間帯', table(['時間帯', '試合', '勝率', '与被ダメ比'], h),
    '### 曜日', table(['曜日', '試合', '勝率', '与被ダメ比'], days),
    '### 日別(プレイした直近' + MAX_DAYS + '日)', table(['日付', '試合', '勝率', '与被ダメ比'], trend)].join('\n\n');
}

// 期間の選択肢。日数は試合のあった日で数える(レポート画面の期間と同じ)
export var EXPORT_PERIODS = [{ value: 'all', label: '全期間' }].concat(Object.keys(PERIOD_DAYS).map(function (k) { return { value: k, label: '直近' + PERIOD_DAYS[k] + '日' }; }));

// 選んだ期間で遊んだ機体の選択肢。試合数の多い順
export function exportMsOptions(matches, period) {
  var counts = {};
  scopeMatches(matches || [], scopeOf({ period: period })).forEach(function (m) { if (m.ms) counts[m.ms] = (counts[m.ms] || 0) + 1; });
  return Object.keys(counts).sort(function (a, b) { return counts[b] - counts[a] || (a < b ? -1 : 1); })
    .map(function (k) { return { value: k, label: k + '(' + counts[k] + '戦)' }; });
}

// 選択肢に無い機体は全機体('')にする
export function keepMs(options, ms) {
  return ms && options.some(function (o) { return o.value === ms; }) ? ms : '';
}

function scopeOf(scope) {
  var s = scope || {};
  return { days: Object.prototype.hasOwnProperty.call(PERIOD_DAYS, s.period) ? PERIOD_DAYS[s.period] : 0, ms: s.ms || '' };
}

function scopeMatches(matches, sc) {
  var out = sc.days ? filterByPlayDays(matches, sc.days) : matches;
  return sc.ms ? out.filter(function (m) { return m.ms === sc.ms; }) : out;
}

function scopeLabel(sc) {
  return (sc.days ? '直近' + sc.days + '日(全機体で試合のあった日を新しい順に' + sc.days + '日分)' : '全期間') + '・全形式・' + (sc.ms ? '自機 ' + sc.ms : '全機体');
}

export function reportFileName(now) {
  var d = now || new Date();
  return 'catalyzer-report-' + d.getFullYear() + pad2(d.getMonth() + 1) + pad2(d.getDate()) + '.md';
}

// scope({period, ms})で絞った試合からレポートを作る。試合が無ければ null。tagPartners は固定相方の判定に使い、名前は出さない
export function buildReportMarkdown(matches, tagPartners, now, scope) {
  var sc = scopeOf(scope);
  var ms = scopeMatches(matches || [], sc);
  if (!ms.length) return null;
  var dates = ms.map(function (m) { return String(m.date || '').substring(0, 10); }).filter(Boolean).sort();
  var plan = computeActionPlan(ms);
  return [
    '# catalyzer 戦績レポート',
    ['- 出力日時: ' + stamp(now || new Date()),
      '- 対象: ' + scopeLabel(sc) + 'の ' + ms.length + '試合' + (dates.length ? '(' + dates[0] + ' 〜 ' + dates[dates.length - 1] + ')' : ''),
      '- プレイヤー名・チーム名は含めていない'].join('\n'),
    section('このレポートについて', GLOSSARY.join('\n')),
    section('全体', overall(ms)),
    section('対戦形式', modes(ms)),
    section('直近の変化', recent(plan)),
    section('勝率アップの候補', actions(plan)),
    section('自機別', myMs(ms)),
    section('勝ち試合と負け試合の差', winLoss(ms)),
    section('敵機との相性', enemies(ms)),
    section('相手の階級', grades(ms)),
    section('僚機', partners(ms)),
    section('コスト編成(3試合以上・多い順)', costPairs(ms)),
    section('機体編成(3試合以上・多い順)', msPairs(ms)),
    section('固定相方(名前は伏せている)', fixed(ms, tagPartners)),
    section('被撃墜', deaths(ms)),
    section('ダメージ貢献', damageShare(ms)),
    section('覚醒と OL', bursts(ms)),
    section('試合時間', duration(ms)),
    section('時間帯・曜日・日別', times(ms)),
  ].join('\n\n') + '\n';
}
