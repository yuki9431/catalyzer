// --- アクションプラン（今やるべきこと） ---
// 試合データを「悪い状態の試合」と「そうでない試合」に二分し、勝率差 × 悪い状態の頻度で
// 「改善したときに取り戻せる勝率」を見積もる。見積もりの大きい順に全件を処方として返す。
// 統計画面を読み解かなくても、次の試合で意識することが端的に分かることを目的とする。

var MIN_MATCHES = 10;     // これ未満は診断しない
var MIN_SIDE = 4;         // 二分した各側の最低試合数
var MIN_GAP = 8;          // 採用する最低勝率差（%pt）
var MIN_ENEMY = 5;        // 苦手機体として扱う最低対戦数
var RECENT_N = 20;        // 直近比較の試合数（上限）
var TILT_STREAK = 3;      // この回数連敗した直後の試合を「連敗直後」とみなす

// 自機コスト別の「自分だけでコストオーバーになる被撃墜数」
var COST_FATAL_DEATHS = { 3000: 2, 2500: 3, 2000: 3, 1500: 4 };
var CONSECUTIVE_FALL_SEC = 15;  // 自分と相方の撃墜がこの秒数以内なら順落ち（#407 と同じ定義）

function winRate(ms) {
  if (!ms.length) return 0;
  var w = 0;
  ms.forEach(function (m) { if (m.win) w++; });
  return w / ms.length * 100;
}
function avg(arr) { return arr.length ? arr.reduce(function (a, b) { return a + b; }, 0) / arr.length : 0; }
function median(arr) {
  if (!arr.length) return 0;
  var s = arr.slice().sort(function (a, b) { return a - b; });
  var mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}
function roundTo(n, step) { return Math.round(n / step) * step; }
function hasActions(m) { return m.actions && m.actions.length > 0; }
function events(actions, pred) {
  return (actions || []).filter(pred).slice().sort(function (a, b) { return a.action_start_sec - b.action_start_sec; });
}
function isDeath(a) { return a.action === 'death'; }
function isBurst(a) { return a.action === 'exbst-f' || a.action === 'exbst-s' || a.action === 'exbst-e'; }
function sortByDate(ms) {
  return ms.slice().sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
}

// 自分が相方より先に撃墜されたか。'first' / 'second' / 'none'（自分は撃墜なし）/ null（判定不能）
function fallOrder(m) {
  if (!hasActions(m)) return null;
  var mine = events(m.actions, isDeath);
  if (!mine.length) return 'none';
  var partner = events(m.partner_actions, isDeath);
  if (!partner.length || mine[0].action_start_sec < partner[0].action_start_sec) return 'first';
  if (mine[0].action_start_sec > partner[0].action_start_sec) return 'second';
  return null;
}

// 自分と相方が CONSECUTIVE_FALL_SEC 秒以内に続けて撃墜されたか（順不同）。判定不能は null
function consecutiveFall(m) {
  if (!hasActions(m)) return null;
  var mine = events(m.actions, isDeath), partner = events(m.partner_actions, isDeath);
  return mine.some(function (a) {
    return partner.some(function (b) { return Math.abs(a.action_start_sec - b.action_start_sec) <= CONSECUTIVE_FALL_SEC; });
  });
}

// 覚醒中（開始〜終了。撃墜で覚醒は終わるため終了時刻を含む）に撃墜されたか。覚醒していない・判定不能は null
function deathDuringBurst(m) {
  if (!hasActions(m)) return null;
  var bursts = events(m.actions, isBurst);
  if (!bursts.length) return null;
  var deaths = events(m.actions, isDeath);
  return bursts.some(function (b) {
    return deaths.some(function (d) { return d.action_start_sec >= b.action_start_sec && d.action_start_sec <= b.action_end_sec; });
  });
}

// 覚醒を1回目の被撃墜より前に使えたか（被撃墜なしは達成扱い）。判定不能は null
function burstBeforeDeath(m) {
  if (!hasActions(m)) return null;
  var deaths = events(m.actions, isDeath);
  if (!deaths.length) return true;
  var bursts = events(m.actions, isBurst);
  return bursts.length > 0 && bursts[0].action_start_sec < deaths[0].action_start_sec;
}

// 与ダメ・被ダメは勝敗の「結果」側でもあり（勝っている試合ほど被ダメが少ない）、
// 勝ち試合の中央値で切るため勝率差が構造的に大きく出る。行動指標（落ち方・覚醒・連敗）を
// 埋もれさせないよう、これらの影響度は割り引く。
var OUTCOME_WEIGHT = 0.5;

// 影響度（impact）のラベル分け閾値
var IMPACT_HIGH = 10;
var IMPACT_MID = 5;

// bad/good の二分から候補を作る。条件を満たさなければ null。
// total は頻度（share）の分母。impact は「bad側がgood側並みに勝てた場合に増える全体勝率(%pt)」の目安で、
// 相関ベースのため因果ではない。weight で指標の性質に応じて割り引く。
function candidate(key, bad, good, total, build, weight) {
  if (bad.length < MIN_SIDE || good.length < MIN_SIDE) return null;
  var badWr = winRate(bad), goodWr = winRate(good);
  var gap = goodWr - badWr;
  if (gap < MIN_GAP) return null;
  var share = bad.length / total * 100;
  var c = build({ badWr: Math.round(badWr), goodWr: Math.round(goodWr), count: total + '戦中' + bad.length + '戦', bad: bad, good: good });
  c.key = key;
  if (!c.goal) c.goal = { key: key };
  c.impact = Math.round(share * gap / 100 * (weight || 1) * 10) / 10;
  c.level = c.impact >= IMPACT_HIGH ? 'high' : c.impact >= IMPACT_MID ? 'mid' : 'low';
  c.gain_wins = bad.length * gap / 100 * (weight || 1);
  return c;
}

// コストオーバー（自分の被撃墜だけで敗北が確定する回数）
function deathCandidate(ms) {
  var valid = ms.filter(function (m) { return COST_FATAL_DEATHS[m.ms_cost]; });
  if (!valid.length) return null;
  var fatal = function (m) { return m.deaths >= COST_FATAL_DEATHS[m.ms_cost]; };
  var costs = {};
  valid.forEach(function (m) { costs[m.ms_cost] = true; });
  var costKeys = Object.keys(costs);
  // コストが混在する（全機体表示）と回数を1つに決められないため出さない
  if (costKeys.length !== 1) return null;
  var limit = COST_FATAL_DEATHS[costKeys[0]];
  return candidate('deaths', valid.filter(fatal), valid.filter(function (m) { return !fatal(m); }), valid.length, function (s) {
    return {
      title: '被撃墜を' + (limit - 1) + '回以内に抑える',
      condition: '被撃墜が' + (limit - 1) + '回以内',
      detail: limit + '回以上撃墜された試合は' + s.count + '（勝率' + s.badWr + '%）。' + (limit - 1) + '回以内の試合は勝率' + s.goodWr + '%',
    };
  });
}

// 相方より先に撃墜されたか／後に撃墜されたか：勝率の低い方を避ける
function fallOrderCandidate(ms) {
  var first = [], second = [];
  ms.forEach(function (m) {
    var o = fallOrder(m);
    if (o === 'first') first.push(m);
    else if (o === 'second') second.push(m);
  });
  var total = first.length + second.length;
  if (!total) return null;
  var firstWorse = winRate(first) < winRate(second);
  var bad = firstWorse ? first : second, good = firstWorse ? second : first;
  return candidate('fall_order', bad, good, total, function (s) {
    return firstWorse ? {
      title: '自分が後落ちする',
      condition: '相方より先に撃墜されない（撃墜されなかった試合も達成）',
      detail: '相方より先に撃墜された試合は' + s.count + '（勝率' + s.badWr + '%）。相方より後の試合は勝率' + s.goodWr + '%',
      goal: { key: 'fall_order', avoid: 'first' },
    } : {
      title: '自分が先落ちする',
      condition: '相方より先に撃墜される（自分が撃墜されなかった試合は対象外）',
      detail: '相方より後に撃墜された試合は' + s.count + '（勝率' + s.badWr + '%）。相方より先の試合は勝率' + s.goodWr + '%',
      goal: { key: 'fall_order', avoid: 'second' },
    };
  });
}

// 覚醒を1回目の被撃墜より前に使えているか
function burstCandidate(ms) {
  var valid = ms.filter(function (m) { return hasActions(m) && m.deaths > 0; });
  var early = [], late = [];
  valid.forEach(function (m) { (burstBeforeDeath(m) ? early : late).push(m); });
  return candidate('burst', late, early, valid.length, function (s) {
    return {
      title: '1機目で覚醒する',
      condition: '1回目の被撃墜より前に覚醒（撃墜されなかった試合も達成）',
      detail: '覚醒を使う前に撃墜された試合は' + s.count + '（勝率' + s.badWr + '%）。撃墜される前に覚醒を使えた試合は勝率' + s.goodWr + '%',
    };
  });
}

// 順落ち：自分と相方が続けて撃墜された試合
function consecutiveFallCandidate(ms) {
  var valid = ms.filter(function (m) { return consecutiveFall(m) !== null; });
  return candidate('consecutive_fall', valid.filter(consecutiveFall), valid.filter(function (m) { return !consecutiveFall(m); }), valid.length, function (s) {
    return {
      title: '順落ちしない',
      condition: '自分と相方が' + CONSECUTIVE_FALL_SEC + '秒以内に続けて撃墜されない',
      detail: '順落ちした試合は' + s.count + '（勝率' + s.badWr + '%）。順落ちしなかった試合は勝率' + s.goodWr + '%',
    };
  });
}

// 覚醒中に撃墜された試合
function burstDeathCandidate(ms) {
  var valid = ms.filter(function (m) { return deathDuringBurst(m) !== null; });
  return candidate('burst_death', valid.filter(deathDuringBurst), valid.filter(function (m) { return !deathDuringBurst(m); }), valid.length, function (s) {
    return {
      title: '覚醒中に撃墜されない',
      condition: '覚醒中に撃墜されない（覚醒しなかった試合は対象外）',
      detail: '覚醒中に撃墜された試合は' + s.count + '（勝率' + s.badWr + '%）。覚醒中に撃墜されなかった試合は勝率' + s.goodWr + '%',
    };
  });
}

// 覚醒回数：勝ち試合の中央値を目標回数にする
function burstCountCandidate(ms) {
  var valid = ms.filter(hasActions);
  var wins = valid.filter(function (m) { return m.win; });
  if (wins.length < MIN_SIDE) return null;
  var line = Math.round(median(wins.map(function (m) { return m.bursts; })));
  if (line < 1) return null;
  return candidate('burst_count', valid.filter(function (m) { return m.bursts < line; }),
    valid.filter(function (m) { return m.bursts >= line; }), valid.length, function (s) {
      return {
        title: '覚醒を' + line + '回以上使う',
        condition: '覚醒' + line + '回以上',
        detail: '覚醒' + line + '回未満の試合は' + s.count + '（勝率' + s.badWr + '%）。' + line + '回以上の試合は勝率' + s.goodWr + '%',
        goal: { key: 'burst_count', line: line },
      };
    });
}

// EXダメ（覚醒中の与ダメ）：覚醒した試合のうち勝ち試合の中央値を目標ラインにする
function exDmgCandidate(ms) {
  var valid = ms.filter(function (m) { return m.bursts > 0; });
  var wins = valid.filter(function (m) { return m.win; });
  if (wins.length < MIN_SIDE) return null;
  var line = roundTo(median(wins.map(function (m) { return m.ex_dmg; })), 50);
  if (line <= 0) return null;
  return candidate('ex_dmg', valid.filter(function (m) { return m.ex_dmg < line; }),
    valid.filter(function (m) { return m.ex_dmg >= line; }), valid.length, function (s) {
      return {
        title: 'EXダメ' + line + '以上を取る',
        condition: 'EXダメ' + line + '以上（覚醒しなかった試合は対象外）',
        detail: '覚醒した試合のうちEXダメ' + line + '未満は' + s.count + '（勝率' + s.badWr + '%）。' + line + '以上の試合は勝率' + s.goodWr + '%',
        goal: { key: 'ex_dmg', line: line },
      };
    }, OUTCOME_WEIGHT);
}

// 被ダメ：勝ち試合の中央値を目標ラインにする
function dmgTakenCandidate(ms) {
  var wins = ms.filter(function (m) { return m.win; });
  if (wins.length < MIN_SIDE) return null;
  var line = roundTo(median(wins.map(function (m) { return m.dmg_taken; })), 50);
  return candidate('dmg_taken', ms.filter(function (m) { return m.dmg_taken > line; }),
    ms.filter(function (m) { return m.dmg_taken <= line; }), ms.length, function (s) {
      return {
        title: '被ダメを' + line + '以下に抑える',
        condition: '被ダメ' + line + '以下',
        detail: '被ダメ' + line + '超の試合は' + s.count + '（勝率' + s.badWr + '%）。' + line + '以下の試合は勝率' + s.goodWr + '%',
        goal: { key: 'dmg_taken', line: line },
      };
    }, OUTCOME_WEIGHT);
}

// 与ダメ：勝ち試合の中央値を目標ラインにする
function dmgGivenCandidate(ms) {
  var wins = ms.filter(function (m) { return m.win; });
  if (wins.length < MIN_SIDE) return null;
  var line = roundTo(median(wins.map(function (m) { return m.dmg_given; })), 50);
  return candidate('dmg_given', ms.filter(function (m) { return m.dmg_given < line; }),
    ms.filter(function (m) { return m.dmg_given >= line; }), ms.length, function (s) {
      return {
        title: '与ダメ' + line + '以上を取る',
        condition: '与ダメ' + line + '以上',
        detail: '与ダメ' + line + '未満の試合は' + s.count + '（勝率' + s.badWr + '%）。' + line + '以上の試合は勝率' + s.goodWr + '%',
        goal: { key: 'dmg_given', line: line },
      };
    }, OUTCOME_WEIGHT);
}

// 苦手機体：最も勝率を落としている相手1機。対戦相手に依存し自分で取り組めないため、ミッションにせず参考情報として返す
function weakEnemy(ms) {
  var byEnemy = {};
  ms.forEach(function (m) {
    var seen = {};
    [m.opponent1_ms, m.opponent2_ms].forEach(function (e) {
      if (!e || seen[e]) return;
      seen[e] = true;
      if (!byEnemy[e]) byEnemy[e] = [];
      byEnemy[e].push(m);
    });
  });
  var avgTaken = avg(ms.map(function (m) { return m.dmg_taken; }));
  var avgGiven = avg(ms.map(function (m) { return m.dmg_given; }));
  var best = null, bestScore = 0;
  Object.keys(byEnemy).forEach(function (enemy) {
    var vs = byEnemy[enemy];
    if (vs.length < MIN_ENEMY) return;
    var others = ms.filter(function (m) { return m.opponent1_ms !== enemy && m.opponent2_ms !== enemy; });
    if (others.length < MIN_SIDE) return;
    var gap = winRate(others) - winRate(vs);
    var score = vs.length * gap;
    if (gap < MIN_GAP || score <= bestScore) return;
    var taken = avg(vs.map(function (m) { return m.dmg_taken; }));
    var given = avg(vs.map(function (m) { return m.dmg_given; }));
    bestScore = score;
    best = {
      enemy: enemy,
      matches: vs.length,
      win_rate: Math.round(winRate(vs)),
      other_win_rate: Math.round(winRate(others)),
      fact: taken - avgTaken >= 100 ? '被ダメは平均より' + Math.round(taken - avgTaken) + '多い'
        : avgGiven - given >= 100 ? '与ダメは平均より' + Math.round(avgGiven - given) + '少ない' : '',
    };
  });
  return best;
}

// 連敗直後の試合（同日内で TILT_STREAK 連敗した次の試合）の勝率。休憩の有無をデータで判定できないため、ミッションにせず参考情報として返す
function afterStreak(ms) {
  var after = [], normal = [];
  var streak = 0, day = null;
  sortByDate(ms).forEach(function (m) {
    var d = m.date.substring(0, 10);
    if (d !== day) { day = d; streak = 0; }
    (streak >= TILT_STREAK ? after : normal).push(m);
    streak = m.win ? 0 : streak + 1;
  });
  if (after.length < MIN_SIDE || normal.length < MIN_SIDE) return null;
  if (winRate(normal) - winRate(after) < MIN_GAP) return null;
  return { streak: TILT_STREAK, total: ms.length, matches: after.length, win_rate: Math.round(winRate(after)), other_win_rate: Math.round(winRate(normal)) };
}

// 直近 RECENT_N 試合とそれ以前を比較し、悪化した指標を返す
function recentTrend(ms) {
  var sorted = sortByDate(ms);
  var n = Math.min(RECENT_N, Math.floor(sorted.length / 2));
  if (n < 8) return null;
  var recent = sorted.slice(-n), before = sorted.slice(0, -n);
  function mean(rows, key) { return avg(rows.map(function (m) { return m[key]; })); }
  var specs = [
    // [ラベル, キー, 悪化判定の閾値, 大きいほど悪いか, 小数桁]
    ['与ダメ', 'dmg_given', 60, false, 0],
    ['被ダメ', 'dmg_taken', 60, true, 0],
    ['被撃墜', 'deaths', 0.2, true, 2],
    ['覚醒回数', 'bursts', 0.2, false, 2],
  ];
  var worsened = [];
  specs.forEach(function (sp) {
    var rows = sp[1] === 'bursts' ? { r: recent.filter(hasActions), b: before.filter(hasActions) } : { r: recent, b: before };
    if (!rows.r.length || !rows.b.length) return;
    var r = mean(rows.r, sp[1]), b = mean(rows.b, sp[1]);
    var delta = r - b;
    if ((sp[3] ? delta : -delta) >= sp[2]) {
      var f = Math.pow(10, sp[4]);
      worsened.push({ label: sp[0], recent: Math.round(r * f) / f, before: Math.round(b * f) / f, delta: Math.round(delta * f) / f });
    }
  });
  return {
    matches: n,
    win_rate: Math.round(winRate(recent) * 10) / 10,
    before_win_rate: Math.round(winRate(before) * 10) / 10,
    worsened: worsened,
  };
}

// 試合配列から「今やるべきこと」を影響度の大きい順に返す。
// 戻り値: { matches, win_rate, actions: [{key,title,detail,impact,level}], recent } / データ不足時は { matches, insufficient: true }
export function computeActionPlan(matches) {
  var ms = matches || [];
  if (ms.length < MIN_MATCHES) return { matches: ms.length, insufficient: true, min_matches: MIN_MATCHES };
  var candidates = [
    deathCandidate(ms),
    fallOrderCandidate(ms),
    burstCandidate(ms),
    dmgTakenCandidate(ms),
    dmgGivenCandidate(ms),
    consecutiveFallCandidate(ms),
    burstDeathCandidate(ms),
    burstCountCandidate(ms),
    exDmgCandidate(ms),
  ].filter(Boolean);
  candidates.sort(function (a, b) { return b.impact - a.impact; });
  var wr = winRate(ms);
  // 課題の試合がそれ以外の試合と同じ勝率で勝てた場合の全体勝率（割り引き後）
  candidates.forEach(function (c) {
    c.win_rate_from = Math.round(wr * 10) / 10;
    c.win_rate_to = Math.round(Math.min(100, wr + c.gain_wins / ms.length * 100) * 10) / 10;
    delete c.gain_wins;
  });
  return {
    matches: ms.length,
    win_rate: Math.round(wr * 10) / 10,
    actions: candidates,
    recent: recentTrend(ms),
    weak_enemy: weakEnemy(ms),
    after_streak: afterStreak(ms),
  };
}

// 1試合ごとの達成判定。対象外の試合は null
var GOAL_JUDGES = {
  deaths: function (g, m) { return COST_FATAL_DEATHS[m.ms_cost] ? m.deaths < COST_FATAL_DEATHS[m.ms_cost] : null; },
  fall_order: function (g, m) {
    var o = fallOrder(m);
    if (o === null) return null;
    if (g.avoid === 'first') return o !== 'first';
    return o === 'none' ? null : o === 'first';
  },
  burst: function (g, m) { return burstBeforeDeath(m); },
  dmg_taken: function (g, m) { return m.dmg_taken <= g.line; },
  dmg_given: function (g, m) { return m.dmg_given >= g.line; },
  consecutive_fall: function (g, m) { var c = consecutiveFall(m); return c === null ? null : !c; },
  burst_death: function (g, m) { var c = deathDuringBurst(m); return c === null ? null : !c; },
  burst_count: function (g, m) { return hasActions(m) ? m.bursts >= g.line : null; },
  ex_dmg: function (g, m) { return m.bursts > 0 ? m.ex_dmg >= g.line : null; },
};

// 選択した課題（goal）について、渡された試合での達成状況を返す。
// 戻り値: { total, achieved, streak（直近から連続で達成した回数）, marks: [{date, ok}]（古い順） }
export function evaluateGoal(goal, matches) {
  var sorted = sortByDate(matches || []);
  var judge = GOAL_JUDGES[goal.key];
  var marks = [];
  if (judge) {
    sorted.forEach(function (m) {
      var ok = judge(goal, m);
      if (ok !== null) marks.push({ date: m.date, ok: ok });
    });
  }
  var achieved = marks.filter(function (x) { return x.ok; }).length;
  var streak = 0;
  for (var i = marks.length - 1; i >= 0 && marks[i].ok; i--) streak++;
  return { total: marks.length, achieved: achieved, streak: streak, marks: marks };
}
