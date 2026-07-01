// --- 分析関数 ---
// 試合データの配列を受け取り、各種統計・分析結果を返す純粋な計算関数群。
// Python scripts/analyze.py の data_* 関数に対応する。

export var PERIOD_DAYS = { '90d': 90, '60d': 60, '30d': 30, '14d': 14, '7d': 7, '3d': 3, '1d': 1 };

var COST_LABEL = {3000: '3000コスト', 2500: '2500コスト', 2000: '2000コスト', 1500: '1500コスト'};
var COST_FATAL_DEATHS = {3000: 2, 2500: 3, 2000: 3, 1500: 4};

// --- Internal Helpers ---

function jsWinRate(matches) {
  if (!matches.length) return 0;
  var w = 0;
  for (var i = 0; i < matches.length; i++) { if (matches[i].win) w++; }
  return w / matches.length * 100;
}

function jsDmgEfficiency(matches) {
  if (!matches.length) return 0;
  var g = 0, t = 0;
  for (var i = 0; i < matches.length; i++) { g += matches[i].dmg_given; t += matches[i].dmg_taken; }
  return t > 0 ? g / t : 0;
}

function round1(n) { return Math.round(n * 10) / 10; }
function round2(n) { return Math.round(n * 100) / 100; }
function round3(n) { return Math.round(n * 1000) / 1000; }

function jsAvg(arr) { return arr.length ? arr.reduce(function (a, b) { return a + b; }, 0) / arr.length : 0; }
function jsWinsLosses(ms) { var w = ms.filter(function (m) { return m.win; }).length; return [w, ms.length - w]; }
function jsKdRatio(ms) { var k = 0, d = 0; ms.forEach(function (m) { k += m.kills; d += m.deaths; }); return d > 0 ? k / d : 0; }
function jsAvgBursts(ms) {
  var valid = ms.filter(function (m) { return m.actions && m.actions.length > 0; });
  if (!valid.length) return null;
  return jsAvg(valid.map(function (m) { return m.bursts; }));
}

function jsGetDeathEvents(actions) {
  return (actions || []).filter(function (a) { return a.action === 'death'; });
}
function jsGetBurstEvents(actions) {
  return (actions || []).filter(function (a) { return a.action === 'exbst-f' || a.action === 'exbst-s' || a.action === 'exbst-e'; });
}
function jsGetExReadyEvents(actions) {
  return (actions || []).filter(function (a) { return a.action === 'ex'; });
}

// --- Exported Analysis Functions ---

export function filterByPlayDays(matches, days) {
  if (!matches.length) return [];
  var dateSet = {};
  for (var i = 0; i < matches.length; i++) {
    dateSet[matches[i].date.substring(0, 10)] = true;
  }
  var playDates = Object.keys(dateSet).sort().reverse();
  var targetDates = {};
  for (var i = 0; i < Math.min(days, playDates.length); i++) {
    targetDates[playDates[i]] = true;
  }
  return matches.filter(function (m) { return targetDates[m.date.substring(0, 10)]; });
}

export function computeTimeOfDay(matches) {
  var hourly = {};
  for (var i = 0; i < matches.length; i++) {
    var hour = parseInt(matches[i].date.substring(11, 13), 10);
    if (!hourly[hour]) hourly[hour] = [];
    hourly[hour].push(matches[i]);
  }
  var hours = [];
  for (var h = 0; h < 24; h++) {
    if (!hourly[h]) continue;
    var ms = hourly[h];
    var wr = jsWinRate(ms);
    hours.push({ hour: h, matches: ms.length, win_rate: round1(wr), dmg_efficiency: round3(jsDmgEfficiency(ms)), mark: wr >= 70 ? 'good' : wr <= 40 ? 'bad' : '' });
  }
  var tips = [];
  var good = [], bad = [];
  for (var h in hourly) {
    if (hourly[h].length >= 5) {
      var wr = jsWinRate(hourly[h]);
      if (wr >= 70) good.push(Number(h));
      if (wr <= 40) bad.push(Number(h));
    }
  }
  good.sort(function (a, b) { return a - b; });
  bad.sort(function (a, b) { return a - b; });
  if (good.length) tips.push('好調 → **' + good.map(function (h) { return h + '時台'; }).join('、') + '**');
  if (bad.length) tips.push('不調 → **' + bad.map(function (h) { return h + '時台'; }).join('、') + '**（強豪が多い or 疲労の影響）');
  return { hours: hours, tips: tips };
}

export function computeDayOfWeek(matches) {
  var DOW_NAMES = ['月', '火', '水', '木', '金', '土', '日'];
  var daily = {};
  var weekdayData = [], weekendData = [];
  for (var i = 0; i < matches.length; i++) {
    var m = matches[i];
    var d = new Date(m.date.replace(' ', 'T'));
    var dow = (d.getDay() + 6) % 7;
    if (!daily[dow]) daily[dow] = [];
    daily[dow].push(m);
    if (dow < 5) weekdayData.push(m); else weekendData.push(m);
  }
  var days = [];
  for (var dow = 0; dow < 7; dow++) {
    if (daily[dow]) {
      days.push({ dow: dow, name: DOW_NAMES[dow], matches: daily[dow].length, win_rate: round1(jsWinRate(daily[dow])), dmg_efficiency: round3(jsDmgEfficiency(daily[dow])) });
    }
  }
  var wdWr = weekdayData.length ? jsWinRate(weekdayData) : 0;
  var weWr = weekendData.length ? jsWinRate(weekendData) : 0;
  var diff = Math.abs(wdWr - weWr);
  var tips = [];
  if (diff >= 10) {
    var better = wdWr > weWr ? '平日' : '土日';
    var worse = wdWr > weWr ? '土日' : '平日';
    tips.push('**' + better + '**が' + worse + 'より勝率 **' + Math.round(diff) + '%** 高い');
  }
  return {
    weekday: weekdayData.length ? { matches: weekdayData.length, win_rate: round1(wdWr), dmg_efficiency: round3(jsDmgEfficiency(weekdayData)) } : { matches: 0, win_rate: 0, dmg_efficiency: 0 },
    weekend: weekendData.length ? { matches: weekendData.length, win_rate: round1(weWr), dmg_efficiency: round3(jsDmgEfficiency(weekendData)) } : { matches: 0, win_rate: 0, dmg_efficiency: 0 },
    days: days,
    tips: tips,
  };
}

export function computeDailyTrend(matches) {
  var DOW_NAMES = ['月', '火', '水', '木', '金', '土', '日'];
  var daily = {};
  var dateOrder = {};
  for (var i = 0; i < matches.length; i++) {
    var m = matches[i];
    var dateKey = m.date.substring(5, 10).replace('-', '/');
    if (!daily[dateKey]) { daily[dateKey] = []; dateOrder[dateKey] = m.date.substring(0, 10); }
    daily[dateKey].push(m);
  }
  var sortedKeys = Object.keys(daily).sort(function (a, b) {
    return dateOrder[a] < dateOrder[b] ? -1 : dateOrder[a] > dateOrder[b] ? 1 : 0;
  });
  var results = sortedKeys.map(function (dateStr) {
    var ms = daily[dateStr];
    var wr = jsWinRate(ms);
    var d = new Date(ms[0].date.replace(' ', 'T'));
    var dow = (d.getDay() + 6) % 7;
    return { date: dateStr, dow_name: DOW_NAMES[dow], matches: ms.length, win_rate: round1(wr), dmg_efficiency: round3(jsDmgEfficiency(ms)), mark: wr >= 70 ? 'good' : wr <= 45 ? 'bad' : '' };
  });
  var tips = [];
  var badDays = sortedKeys.filter(function (ds) { return jsWinRate(daily[ds]) <= 40 && daily[ds].length >= 5; });
  if (badDays.length) tips.push('不調日（勝率40%以下）→ **' + badDays.join(', ') + '**。早めの切り上げが有効');
  return { days: results, tips: tips };
}

export function computeBasicStats(matches) {
  var n = matches.length;
  var wl = jsWinsLosses(matches);
  var w = wl[0], l = wl[1];
  var wr = n > 0 ? w / n * 100 : 0;
  var kd = jsKdRatio(matches);
  var eff = jsDmgEfficiency(matches);
  var ab = jsAvgBursts(matches);

  var tips = [];
  if (eff < 1.0) {
    tips.push('与被ダメ比 **' + round3(eff) + '** → 被ダメ超過。被弾を減らす立ち回りを意識');
  } else if (eff >= 1.2) {
    tips.push('与被ダメ比 **' + round3(eff) + '** → 優秀。この調子を維持');
  }
  if (kd < 1.0) {
    tips.push('K/D比 **' + round2(kd) + '** → 1.0未満。撃墜↑ or 被撃墜↓を意識');
  }

  return {
    matches: n,
    wins: w,
    losses: l,
    win_rate: round1(wr),
    avg_dmg_given: Math.round(jsAvg(matches.map(function (m) { return m.dmg_given; }))),
    avg_dmg_taken: Math.round(jsAvg(matches.map(function (m) { return m.dmg_taken; }))),
    dmg_efficiency: round3(eff),
    avg_kills: round2(jsAvg(matches.map(function (m) { return m.kills; }))),
    avg_deaths: round2(jsAvg(matches.map(function (m) { return m.deaths; }))),
    kd_ratio: round2(kd),
    avg_ex_dmg: Math.round(jsAvg(matches.map(function (m) { return m.ex_dmg; }))),
    avg_bursts: ab !== null ? round2(ab) : null,
    tips: tips,
  };
}

export function computeWinLossPattern(matches) {
  var wins = matches.filter(function (m) { return m.win; });
  var losses = matches.filter(function (m) { return !m.win; });

  function kdOf(rows) {
    var tk = 0, td = 0;
    rows.forEach(function (d) { tk += d.kills; td += d.deaths; });
    return td > 0 ? tk / td : 0;
  }
  function avgOf(key, rows) { return rows.length ? jsAvg(rows.map(function (d) { return d[key]; })) : 0; }

  var metrics = [];
  function addMetric(label, w, l, nd) {
    var factor = Math.pow(10, nd);
    metrics.push({
      label: label,
      win_avg: w !== null ? Math.round(w * factor) / factor : null,
      loss_avg: l !== null ? Math.round(l * factor) / factor : null,
      diff: (w !== null && l !== null) ? Math.round((w - l) * factor) / factor : null,
    });
  }

  addMetric('平均与ダメージ', avgOf('dmg_given', wins), avgOf('dmg_given', losses), 1);
  addMetric('平均被ダメージ', avgOf('dmg_taken', wins), avgOf('dmg_taken', losses), 1);
  addMetric('与被ダメ比', wins.length ? jsDmgEfficiency(wins) : 0, losses.length ? jsDmgEfficiency(losses) : 0, 3);
  addMetric('平均撃墜', avgOf('kills', wins), avgOf('kills', losses), 2);
  addMetric('平均被撃墜', avgOf('deaths', wins), avgOf('deaths', losses), 2);
  addMetric('K/D比', wins.length ? kdOf(wins) : 0, losses.length ? kdOf(losses) : 0, 2);
  addMetric('平均EXダメージ', avgOf('ex_dmg', wins), avgOf('ex_dmg', losses), 1);
  addMetric('平均覚醒回数', jsAvgBursts(wins), jsAvgBursts(losses), 2);

  var tips = [];
  var lDeaths = losses.length ? jsAvg(losses.map(function (d) { return d.deaths; })) : 0;
  var lTaken = losses.length ? jsAvg(losses.map(function (d) { return d.dmg_taken; })) : 0;
  if (lDeaths >= 1.5) {
    tips.push('敗北時の平均被撃墜 **' + round1(lDeaths) + '回** → 耐久管理を意識');
  }
  if (lTaken >= 1100) {
    tips.push('敗北時の平均被ダメ **' + Math.round(lTaken) + '** → 無駄な被弾を減らすのが改善の鍵');
  }

  // コスト帯別
  var costGroups = {};
  matches.forEach(function (d) {
    var cost = d.ms_cost || 0;
    if (COST_LABEL[cost]) {
      if (!costGroups[cost]) costGroups[cost] = [];
      costGroups[cost].push(d);
    }
  });

  var costPatterns = [];
  var costKeys = Object.keys(costGroups).map(Number).sort(function (a, b) { return b - a; });
  costKeys.forEach(function (cost) {
    var data = costGroups[cost];
    if (data.length < 3) return;
    var cWins = data.filter(function (d) { return d.win; });
    var cLosses = data.filter(function (d) { return !d.win; });
    if (!cWins.length || !cLosses.length) return;

    var fatal = COST_FATAL_DEATHS[cost];
    var fatalLosses = cLosses.filter(function (d) { return d.deaths >= fatal; });

    var costMetrics = [];
    [['与ダメージ', 'dmg_given'], ['被ダメージ', 'dmg_taken'], ['撃墜', 'kills'], ['被撃墜', 'deaths']].forEach(function (pair) {
      var mLabel = pair[0], key = pair[1];
      var wV = jsAvg(cWins.map(function (d) { return d[key]; }));
      var lV = jsAvg(cLosses.map(function (d) { return d[key]; }));
      costMetrics.push({ label: mLabel, win_avg: round1(wV), loss_avg: round1(lV), diff: round1(wV - lV) });
    });
    var cWEff = jsDmgEfficiency(cWins);
    var cLEff = jsDmgEfficiency(cLosses);
    costMetrics.push({ label: '与被ダメ比', win_avg: round3(cWEff), loss_avg: round3(cLEff), diff: round3(cWEff - cLEff) });

    costPatterns.push({
      cost: cost,
      cost_label: COST_LABEL[cost],
      matches: data.length,
      win_rate: round1(jsWinRate(data)),
      metrics: costMetrics,
      fatal_deaths: fatal,
      fatal_loss_count: fatalLosses.length,
      fatal_loss_total: cLosses.length,
      fatal_loss_rate: cLosses.length ? Math.round(fatalLosses.length / cLosses.length * 100) : 0,
    });
  });

  return { metrics: metrics, tips: tips, cost_patterns: costPatterns };
}

export function computeEnemyMatchup(matches, minMatches) {
  if (minMatches === undefined) minMatches = 3;
  var enemyStats = {};
  matches.forEach(function (d) {
    [d.opponent1_ms, d.opponent2_ms].forEach(function (ems) {
      if (!ems) return;
      if (!enemyStats[ems]) enemyStats[ems] = [];
      enemyStats[ems].push(d);
    });
  });

  var results = [];
  Object.keys(enemyStats).forEach(function (ms) {
    var ms_matches = enemyStats[ms];
    if (ms_matches.length >= minMatches) {
      var wr = jsWinRate(ms_matches);
      var eff = jsDmgEfficiency(ms_matches);
      var avgGiven = jsAvg(ms_matches.map(function (d) { return d.dmg_given; }));
      var avgTaken = jsAvg(ms_matches.map(function (d) { return d.dmg_taken; }));
      results.push({
        ms: ms,
        matches: ms_matches.length,
        win_rate: round1(wr),
        dmg_efficiency: round3(eff),
        avg_dmg_given: Math.round(avgGiven),
        avg_dmg_taken: Math.round(avgTaken),
      });
    }
  });

  var strong = results.filter(function (r) { return r.win_rate >= 60; }).sort(function (a, b) { return b.matches - a.matches; });
  var weak = results.filter(function (r) { return r.win_rate <= 40; }).sort(function (a, b) { return b.matches - a.matches; });
  var even = results.filter(function (r) { return r.win_rate > 40 && r.win_rate < 60; }).sort(function (a, b) { return b.matches - a.matches; });

  var tips = [];
  if (weak.length) {
    var highDmgTaken = weak.filter(function (r) { return r.avg_dmg_taken >= 1200; });
    if (highDmgTaken.length) {
      tips.push({ text: '被ダメが多い相手 → 距離管理を見直し', details: highDmgTaken.slice(0, 3).map(function (r) { return '**' + r.ms + '** 被ダメ ' + r.avg_dmg_taken; }) });
    }
    var lowDmgGiven = weak.filter(function (r) { return r.avg_dmg_given <= 900; });
    if (lowDmgGiven.length) {
      tips.push({ text: '与ダメが低い相手 → 手数や当て方を工夫', details: lowDmgGiven.slice(0, 3).map(function (r) { return '**' + r.ms + '** 与ダメ ' + r.avg_dmg_given; }) });
    }
  }

  return { strong: strong, weak: weak, even: even, tips: tips };
}

export function computePartner(matches, minMatches) {
  if (minMatches === undefined) minMatches = 3;
  var partnerStats = {};
  matches.forEach(function (d) {
    var pms = d.partner_ms;
    if (!pms) return;
    if (!partnerStats[pms]) partnerStats[pms] = [];
    partnerStats[pms].push(d);
  });

  var results = [];
  Object.keys(partnerStats).forEach(function (ms) {
    var ms_matches = partnerStats[ms];
    if (ms_matches.length >= minMatches) {
      results.push({
        ms: ms,
        matches: ms_matches.length,
        win_rate: round1(jsWinRate(ms_matches)),
        dmg_efficiency: round3(jsDmgEfficiency(ms_matches)),
      });
    }
  });
  results.sort(function (a, b) { return b.matches - a.matches; });
  return results;
}

export function computeCostPair(matches, minMatches) {
  if (minMatches === undefined) minMatches = 3;
  var pairs = {};
  matches.forEach(function (d) {
    var msName = d.ms || '(不明)';
    var partnerCost = d.partner_cost || 0;
    if (msName && partnerCost) {
      var key = msName + ' + ' + partnerCost;
      if (!pairs[key]) pairs[key] = [];
      pairs[key].push(d);
    }
  });

  var results = [];
  Object.keys(pairs).forEach(function (pair) {
    var ms_matches = pairs[pair];
    if (ms_matches.length >= minMatches) {
      results.push({
        pair: pair,
        matches: ms_matches.length,
        win_rate: round1(jsWinRate(ms_matches)),
        dmg_efficiency: round3(jsDmgEfficiency(ms_matches)),
      });
    }
  });
  results.sort(function (a, b) { return b.matches - a.matches; });
  return results;
}

export function computeMsPair(matches, minMatches, topN) {
  if (minMatches === undefined) minMatches = 3;
  if (topN === undefined) topN = 10;
  var pairs = {};
  matches.forEach(function (d) {
    var key = d.ms + ' + ' + d.partner_ms;
    if (!pairs[key]) pairs[key] = [];
    pairs[key].push(d);
  });

  var results = [];
  Object.keys(pairs).forEach(function (pair) {
    var ms_matches = pairs[pair];
    if (ms_matches.length >= minMatches) {
      var wl = jsWinsLosses(ms_matches);
      results.push({
        pair: pair,
        matches: ms_matches.length,
        wins: wl[0],
        losses: wl[1],
        win_rate: round1(jsWinRate(ms_matches)),
        dmg_efficiency: round3(jsDmgEfficiency(ms_matches)),
      });
    }
  });

  var byWr = results.slice().sort(function (a, b) { return a.win_rate !== b.win_rate ? b.win_rate - a.win_rate : b.matches - a.matches; }).slice(0, topN);
  var byCount = results.slice().sort(function (a, b) { return a.matches !== b.matches ? b.matches - a.matches : b.win_rate - a.win_rate; }).slice(0, topN);

  return { by_win_rate: byWr, by_matches: byCount };
}

export function computeDmgContribution(matches, minMatches) {
  if (minMatches === undefined) minMatches = 3;
  var contribs = [];
  var winContribs = [];
  var loseContribs = [];
  matches.forEach(function (d) {
    var teamTotal = d.dmg_given + d.partner_dmg_given;
    if (teamTotal > 0) {
      var c = d.dmg_given / teamTotal * 100;
      contribs.push(c);
      if (d.win) { winContribs.push(c); } else { loseContribs.push(c); }
    }
  });
  var avgContrib = contribs.length ? jsAvg(contribs) : 0;
  var avgWin = winContribs.length ? jsAvg(winContribs) : 0;
  var avgLose = loseContribs.length ? jsAvg(loseContribs) : 0;

  // コスト帯別
  var costGroups = {};
  matches.forEach(function (d) {
    var cost = d.ms_cost || 0;
    if (COST_LABEL[cost]) {
      if (!costGroups[cost]) costGroups[cost] = [];
      costGroups[cost].push(d);
    }
  });

  var costData = [];
  var costKeys = Object.keys(costGroups).map(Number);
  var hasMultiple = costKeys.length > 1 || costKeys.some(function (k) { return costGroups[k].length >= minMatches; });
  if (hasMultiple) {
    costKeys.sort(function (a, b) { return b - a; }).forEach(function (cost) {
      var data = costGroups[cost];
      if (data.length < minMatches) return;
      var cAll = [], cWin = [], cLose = [];
      data.forEach(function (d) {
        var teamTotal = d.dmg_given + d.partner_dmg_given;
        if (teamTotal > 0) {
          var c = d.dmg_given / teamTotal * 100;
          cAll.push(c);
          if (d.win) { cWin.push(c); } else { cLose.push(c); }
        }
      });
      costData.push({
        cost: cost,
        cost_label: COST_LABEL[cost],
        matches: data.length,
        avg_contribution: cAll.length ? round1(jsAvg(cAll)) : 0,
        avg_win_contribution: cWin.length ? round1(jsAvg(cWin)) : 0,
        avg_lose_contribution: cLose.length ? round1(jsAvg(cLose)) : 0,
      });
    });
  }

  return {
    avg_contribution: round1(avgContrib),
    avg_win_contribution: round1(avgWin),
    avg_lose_contribution: round1(avgLose),
    by_cost: costData,
  };
}

export function computeDeathsImpact(matches) {
  var costGroups = {};
  matches.forEach(function (d) {
    var cost = d.ms_cost || 0;
    if (COST_FATAL_DEATHS[cost]) {
      if (!costGroups[cost]) costGroups[cost] = [];
      costGroups[cost].push(d);
    }
  });

  var results = [];
  var costKeys = Object.keys(costGroups).map(Number).sort(function (a, b) { return b - a; });
  costKeys.forEach(function (cost) {
    var data = costGroups[cost];
    var fatal = COST_FATAL_DEATHS[cost];
    var maxBucket = fatal + 1;

    var byDeaths = {};
    data.forEach(function (d) {
      var deaths = d.deaths;
      var key = deaths >= maxBucket ? (maxBucket + '+') : String(deaths);
      if (!byDeaths[key]) byDeaths[key] = [];
      byDeaths[key].push(d);
    });

    var buckets = [];
    for (var i = 0; i < fatal; i++) {
      var key = String(i);
      if (byDeaths[key]) {
        var bMatches = byDeaths[key];
        var wr = jsWinRate(bMatches);
        var eff = jsDmgEfficiency(bMatches);
        buckets.push({
          deaths: i,
          label: i + '落ち',
          matches: bMatches.length,
          win_rate: round1(wr),
          dmg_efficiency: round3(eff),
          status: i === fatal - 1 ? 'danger' : 'safe',
        });
      }
    }

    var fatalCount = 0;
    for (var j = fatal; j < maxBucket; j++) {
      fatalCount += (byDeaths[String(j)] || []).length;
    }
    fatalCount += (byDeaths[maxBucket + '+'] || []).length;

    var safeData = [];
    for (var k = 0; k < fatal; k++) {
      safeData = safeData.concat(byDeaths[String(k)] || []);
    }
    var safeWr = safeData.length ? jsWinRate(safeData) : 0;

    var tips = [];
    if (fatalCount > 0 && data.length > 0) {
      tips.push(fatal + '落ち以上 **' + fatalCount + '/' + data.length + '戦**（' + Math.round(fatalCount / data.length * 100) + '%）');
    }
    if (safeData.length) {
      tips.push((fatal - 1) + '落ち以内の勝率 **' + round1(safeWr) + '%**');
    }

    results.push({
      cost: cost,
      cost_label: COST_LABEL[cost],
      matches: data.length,
      fatal_deaths: fatal,
      fatal_cost: cost * fatal,
      buckets: buckets,
      tips: tips,
    });
  });

  return results;
}

export function computeSeason(matches) {
  function getSeason(dateStr) {
    var parts = dateStr.substring(0, 10).split('-');
    var year = parseInt(parts[0], 10);
    var m = parseInt(parts[1], 10);
    var startMonth, sYear;
    if (m === 12) {
      startMonth = 12; sYear = year;
    } else if (m % 2 === 0) {
      startMonth = m; sYear = year;
    } else {
      if (m === 1) { startMonth = 12; sYear = year - 1; }
      else { startMonth = m - 1; sYear = year; }
    }
    var endMonth = startMonth < 12 ? startMonth + 1 : 1;
    var endYear = startMonth < 12 ? sYear : sYear + 1;
    if (startMonth === 12) {
      return sYear + '年' + startMonth + '月-' + endYear + '年' + endMonth + '月';
    }
    return sYear + '年' + startMonth + '-' + endMonth + '月';
  }

  function getSeasonHalf(dateStr) {
    var m = parseInt(dateStr.substring(5, 7), 10);
    return (m === 12 || m % 2 === 0) ? '前半' : '後半';
  }

  var seasonData = {};
  var seasonHalf = {};

  matches.forEach(function (d) {
    var s = getSeason(d.date);
    var h = getSeasonHalf(d.date);
    if (!seasonData[s]) seasonData[s] = [];
    seasonData[s].push(d);
    if (!seasonHalf[s]) seasonHalf[s] = {};
    if (!seasonHalf[s][h]) seasonHalf[s][h] = [];
    seasonHalf[s][h].push(d);
  });

  var results = [];
  Object.keys(seasonData).sort().forEach(function (seasonName) {
    var data = seasonData[seasonName];
    var firstHalf = (seasonHalf[seasonName] && seasonHalf[seasonName]['前半']) || [];
    var secondHalf = (seasonHalf[seasonName] && seasonHalf[seasonName]['後半']) || [];

    var tips = [];
    if (firstHalf.length && secondHalf.length) {
      var fWr = jsWinRate(firstHalf);
      var sWr = jsWinRate(secondHalf);
      var diff = sWr - fWr;
      if (Math.abs(diff) >= 5) {
        if (diff > 0) {
          tips.push('後半が **+' + Math.round(diff) + '%** → シーズン後半に安定');
        } else {
          tips.push('前半が **+' + Math.round(-diff) + '%** → 後半は対戦環境が厳しくなった可能性');
        }
      }
    }

    var entry = {
      name: seasonName,
      matches: data.length,
      win_rate: round1(jsWinRate(data)),
      dmg_efficiency: round3(jsDmgEfficiency(data)),
      tips: tips,
    };
    if (firstHalf.length) {
      entry.first_half = {
        matches: firstHalf.length,
        win_rate: round1(jsWinRate(firstHalf)),
        dmg_efficiency: round3(jsDmgEfficiency(firstHalf)),
      };
    }
    if (secondHalf.length) {
      entry.second_half = {
        matches: secondHalf.length,
        win_rate: round1(jsWinRate(secondHalf)),
        dmg_efficiency: round3(jsDmgEfficiency(secondHalf)),
      };
    }
    results.push(entry);
  });

  return results;
}

export function computeBurstCount(matches) {
  var byCount = {};
  matches.forEach(function (d) {
    if (!d.actions || !d.actions.length) return;
    var count = d.bursts || 0;
    if (!byCount[count]) byCount[count] = [];
    byCount[count].push(d);
  });

  var countKeys = Object.keys(byCount).map(Number);
  if (!countKeys.length) return null;

  var results = [];
  countKeys.sort(function (a, b) { return a - b; }).forEach(function (count) {
    var bMatches = byCount[count];
    var wr = jsWinRate(bMatches);
    results.push({
      count: count,
      label: count > 0 ? count + '回' : '0回（未覚醒）',
      matches: bMatches.length,
      win_rate: round1(wr),
    });
  });

  var tips = [];
  if (byCount[2] && byCount[2].length >= 3) {
    var wr2 = jsWinRate(byCount[2]);
    var others = [];
    Object.keys(byCount).forEach(function (c) {
      if (Number(c) < 2) { others = others.concat(byCount[c]); }
    });
    if (others.length) {
      var wrOther = jsWinRate(others);
      var diff = wr2 - wrOther;
      if (diff > 0) {
        tips.push('2回覚醒できた試合の勝率が **' + Math.round(diff) + '%** 高い → ゲージ管理と耐久管理が重要');
      }
    }
  }

  return { by_count: results, tips: tips };
}

export function computeFallOrder(matches) {
  var noFall = [], firstFall = [], secondFall = [], sameTime = [];
  matches.forEach(function (d) {
    if (!d.actions || !d.actions.length) return;
    var myDeaths = jsGetDeathEvents(d.actions);
    var partnerDeaths = jsGetDeathEvents(d.partner_actions);
    if (!myDeaths.length) {
      noFall.push(d);
    } else if (!partnerDeaths.length) {
      firstFall.push(d);
    } else {
      var myFirst = myDeaths[0].action_start_sec;
      var partnerFirst = partnerDeaths[0].action_start_sec;
      if (myFirst < partnerFirst) firstFall.push(d);
      else if (myFirst > partnerFirst) secondFall.push(d);
      else sameTime.push(d);
    }
  });
  var total = noFall.length + firstFall.length + secondFall.length + sameTime.length;
  if (total === 0) return null;
  function buildStats(ms) {
    var tg = 0, tt = 0;
    ms.forEach(function (d) { tg += d.dmg_given; tt += d.dmg_taken; });
    return {
      count: ms.length,
      rate: round1(ms.length / total * 100),
      win_rate: ms.length ? round1(jsWinRate(ms)) : 0,
      avg_dmg_given: ms.length ? Math.round(jsAvg(ms.map(function (d) { return d.dmg_given; }))) : 0,
      avg_dmg_taken: ms.length ? Math.round(jsAvg(ms.map(function (d) { return d.dmg_taken; }))) : 0,
      dmg_efficiency: ms.length ? round3(tt > 0 ? tg / tt : 0) : 0,
    };
  }
  var noFallWr = noFall.length ? jsWinRate(noFall) : 0;
  var firstWr = firstFall.length ? jsWinRate(firstFall) : 0;
  var secondWr = secondFall.length ? jsWinRate(secondFall) : 0;
  var tips = [];
  if (firstFall.length && secondFall.length) {
    var diff = secondWr - firstWr;
    if (Math.abs(diff) >= 5) {
      var better = diff > 0 ? '後落ち' : '先落ち';
      tips.push('**' + better + '**の方が勝率 **' + Math.round(Math.abs(diff)) + '%** 高い');
    }
  }
  var fallTotal = firstFall.length + secondFall.length + sameTime.length;
  if (firstFall.length && fallTotal > 0) {
    var firstRate = firstFall.length / fallTotal * 100;
    if (firstRate >= 60) tips.push('先落ち率 **' + Math.round(firstRate) + '%** → 前に出すぎている可能性');
  }
  if (noFall.length && firstFall.length) {
    var d2 = noFallWr - firstWr;
    if (d2 >= 10) tips.push('0落ちの試合は先落ちより勝率 **' + Math.round(d2) + '%** 高い → 耐久管理が重要');
  }
  return {
    total: total,
    no_fall: buildStats(noFall),
    first_fall: buildStats(firstFall),
    second_fall: buildStats(secondFall),
    same_time: buildStats(sameTime),
    tips: tips,
  };
}

export function computeBurstHoldDeath(matches) {
  var holdByDeath = {};
  var noHold = [];
  var total = 0;
  matches.forEach(function (d) {
    if (!d.actions || !d.actions.length) return;
    var deaths = jsGetDeathEvents(d.actions).sort(function (a, b) { return a.action_start_sec - b.action_start_sec; });
    var bursts = jsGetBurstEvents(d.actions);
    var exReadies = jsGetExReadyEvents(d.actions);
    if (!deaths.length) return;
    total++;
    var hasAnyHold = false;
    deaths.forEach(function (death, i) {
      var deathTime = death.action_start_sec;
      var relevantEx = exReadies.filter(function (e) { return e.action_start_sec < deathTime; });
      if (!relevantEx.length) return;
      var lastExTime = Math.max.apply(null, relevantEx.map(function (e) { return e.action_start_sec; }));
      var burstUsed = bursts.some(function (b) {
        return b.action_start_sec >= lastExTime && b.action_start_sec < deathTime;
      });
      if (!burstUsed) {
        var nth = i + 1;
        if (!holdByDeath[nth]) holdByDeath[nth] = [];
        holdByDeath[nth].push(d);
        hasAnyHold = true;
      }
    });
    if (!hasAnyHold) noHold.push(d);
  });
  if (total === 0) return null;
  function buildStats(ms) {
    return {
      count: ms.length,
      rate: round1(ms.length / total * 100),
      win_rate: ms.length ? round1(jsWinRate(ms)) : 0,
    };
  }
  var byDeath = [];
  Object.keys(holdByDeath).map(Number).sort(function (a, b) { return a - b; }).forEach(function (nth) {
    var stats = buildStats(holdByDeath[nth]);
    stats.label = nth + '機目に抱え落ち';
    byDeath.push(stats);
  });
  var tips = [];
  if (byDeath.length && noHold.length) {
    var holdSet = new Set();
    Object.keys(holdByDeath).forEach(function (k) {
      holdByDeath[k].forEach(function (d) { holdSet.add(d); });
    });
    var uniqueHold = Array.from(holdSet);
    var diff = jsWinRate(noHold) - jsWinRate(uniqueHold);
    if (diff > 0) tips.push('抱え落ちなしの試合の方が勝率 **' + Math.round(diff) + '%** 高い');
  }
  return { total: total, by_death: byDeath, no_hold: buildStats(noHold), tips: tips };
}

export function computeFixedPartners(matches, tagPartners) {
  if (!tagPartners || !tagPartners.length) {
    return { notice: 'タッグ情報が見つかりませんでした。フレンドを登録してタッグを組むと、固定相方の詳細分析が利用できます。', partners: [] };
  }
  // player_name -> team_name（team_nameは空文字の場合あり）
  var teamOf = {};
  tagPartners.forEach(function (tp) { teamOf[tp.player_name] = tp.team_name; });
  // 相方の試合をグループ化する。チーム名があれば同一チームで統合し（このゲームは名前が可変
  // のため、名前変更をまたいで同一相方として扱える）、チーム名が未設定（空 or デフォルトの
  // NO_NAME_TAG）の相方は別々の相方なので統合せずプレイヤー名ごとに集計する。
  var NO_NAME_TAG = 'NO_NAME_TAG';
  var fixedMatches = {};   // key -> matches[]
  matches.forEach(function (d) {
    if (!Object.prototype.hasOwnProperty.call(teamOf, d.partner_name)) return;
    var team = teamOf[d.partner_name];
    var named = team && team !== NO_NAME_TAG;
    var key = named ? 'team:' + team : 'player:' + d.partner_name;
    if (!fixedMatches[key]) fixedMatches[key] = [];
    fixedMatches[key].push(d);
  });
  var partnerKeys = Object.keys(fixedMatches).sort(function (a, b) { return fixedMatches[b].length - fixedMatches[a].length; });
  if (!partnerKeys.length) return { partners: [] };

  var results = [];
  partnerKeys.forEach(function (key) {
    var data = fixedMatches[key];
    var n = data.length;
    // 表示名は最新の試合で使われていた相方のプレイヤー名（名前が可変のため最新を採用）
    var latestName = data[0].partner_name, latestDate = data[0].date;
    data.forEach(function (d) { if (d.date > latestDate) { latestDate = d.date; latestName = d.partner_name; } });
    var wl = jsWinsLosses(data);
    var w = wl[0], l = wl[1];
    var wr = w / n * 100;

    var myTg = 0, myTt = 0;
    data.forEach(function (d) { myTg += d.dmg_given; myTt += d.dmg_taken; });
    var myEff = myTt > 0 ? myTg / myTt : 0;
    var myAvgGiven = jsAvg(data.map(function (d) { return d.dmg_given; }));
    var myAvgTaken = jsAvg(data.map(function (d) { return d.dmg_taken; }));
    var myTotalKills = 0, myTotalDeaths = 0;
    data.forEach(function (d) { myTotalKills += d.kills; myTotalDeaths += d.deaths; });
    var myKd = myTotalDeaths > 0 ? myTotalKills / myTotalDeaths : 0;
    var myAvgEx = jsAvg(data.map(function (d) { return d.ex_dmg; }));
    var myBursts = jsAvgBursts(data);

    var pTg = 0, pTt = 0, pTk = 0, pTd = 0;
    data.forEach(function (d) { pTg += d.partner_dmg_given; pTt += d.partner_dmg_taken; pTk += d.partner_kills; pTd += d.partner_deaths; });
    var pEff = pTt > 0 ? pTg / pTt : 0;
    var pAvgGiven = jsAvg(data.map(function (d) { return d.partner_dmg_given; }));
    var pAvgTaken = jsAvg(data.map(function (d) { return d.partner_dmg_taken; }));
    var pAvgKills = jsAvg(data.map(function (d) { return d.partner_kills; }));
    var pAvgDeaths = jsAvg(data.map(function (d) { return d.partner_deaths; }));
    var pKd = pTd > 0 ? pTk / pTd : 0;
    var pAvgEx = jsAvg(data.map(function (d) { return d.partner_ex_dmg; }));
    var pBurstCounts = data.filter(function (d) { return d.partner_actions && d.partner_actions.length; }).map(function (d) { return jsGetBurstEvents(d.partner_actions).length; });
    var pBursts = pBurstCounts.length ? jsAvg(pBurstCounts) : null;

    var partnerMsMap = {};
    data.forEach(function (d) {
      if (!partnerMsMap[d.partner_ms]) partnerMsMap[d.partner_ms] = [];
      partnerMsMap[d.partner_ms].push(d);
    });
    var msBreakdown = [];
    var msKeys = Object.keys(partnerMsMap);
    if (msKeys.length > 1 || msKeys.some(function (k) { return partnerMsMap[k].length >= 2; })) {
      msKeys.sort(function (a, b) { return partnerMsMap[b].length - partnerMsMap[a].length; }).forEach(function (ms) {
        var msList = partnerMsMap[ms];
        var msPTg = 0, msPTt = 0;
        msList.forEach(function (d) { msPTg += d.partner_dmg_given; msPTt += d.partner_dmg_taken; });
        msBreakdown.push({
          ms: ms,
          matches: msList.length,
          win_rate: round1(jsWinRate(msList)),
          partner_dmg_efficiency: round3(msPTt > 0 ? msPTg / msPTt : 0),
        });
      });
    }

    var winData = data.filter(function (d) { return d.win; });
    var lossData = data.filter(function (d) { return !d.win; });
    function avgOf(key, rows) { return rows.length ? jsAvg(rows.map(function (d) { return d[key]; })) : 0; }
    function kdOf(kKey, dKey, rows) { var tk = 0, td = 0; rows.forEach(function (d) { tk += d[kKey]; td += d[dKey]; }); return td > 0 ? tk / td : 0; }
    function effOf(gKey, tKey, rows) { var tg2 = 0, tt2 = 0; rows.forEach(function (d) { tg2 += d[gKey]; tt2 += d[tKey]; }); return tt2 > 0 ? tg2 / tt2 : 0; }
    function burstsOf(actKey, rows) {
      var c = rows.filter(function (d) { return d[actKey] && d[actKey].length; }).map(function (d) { return jsGetBurstEvents(d[actKey]).length; });
      return c.length ? jsAvg(c) : null;
    }
    function rnd(v, nd) { if (v == null) return null; var f = Math.pow(10, nd); return Math.round(v * f) / f; }
    function makeWlMetrics(gKey, tKey, kKey, dKey, exKey, actKey) {
      var metrics = [];
      function add(label, wv, lv, nd) { metrics.push({ label: label, win_avg: rnd(wv, nd), loss_avg: rnd(lv, nd) }); }
      add('平均与ダメージ', avgOf(gKey, winData), avgOf(gKey, lossData), 1);
      add('平均被ダメージ', avgOf(tKey, winData), avgOf(tKey, lossData), 1);
      add('与被ダメ比', effOf(gKey, tKey, winData), effOf(gKey, tKey, lossData), 3);
      add('平均撃墜', avgOf(kKey, winData), avgOf(kKey, lossData), 2);
      add('平均被撃墜', avgOf(dKey, winData), avgOf(dKey, lossData), 2);
      add('K/D比', kdOf(kKey, dKey, winData), kdOf(kKey, dKey, lossData), 2);
      add('平均EXダメージ', avgOf(exKey, winData), avgOf(exKey, lossData), 1);
      add('平均覚醒回数', burstsOf(actKey, winData), burstsOf(actKey, lossData), 2);
      return { metrics: metrics };
    }
    var myWl = makeWlMetrics('dmg_given', 'dmg_taken', 'kills', 'deaths', 'ex_dmg', 'actions');
    var partnerWl = makeWlMetrics('partner_dmg_given', 'partner_dmg_taken', 'partner_kills', 'partner_deaths', 'partner_ex_dmg', 'partner_actions');

    var tips = [];
    if (pEff < 0.8) tips.push('相方の与被ダメ比 **' + pEff.toFixed(3) + '** → カットやライン維持を意識');
    if (wr < 45 && n >= 5) tips.push('勝率 **' + Math.round(wr) + '%** → 連携や機体の組み合わせを見直し');
    if (n >= 5) {
      if (wr >= 90) tips.push('勝率 **' + Math.round(wr) + '%** → 驚異的！全国大会優勝レベル');
      else if (wr >= 80) tips.push('勝率 **' + Math.round(wr) + '%** → 圧巻！勝ちパターンの再現性を高めよう');
      else if (wr >= 70) tips.push('勝率 **' + Math.round(wr) + '%** → 素晴らしい相性。この相方を軸に苦手機体の対策を');
      else if (wr >= 60) tips.push('勝率 **' + Math.round(wr) + '%** → 好調。役割分担を意識してさらに上へ');
    }

    var entry = {
      partner_name: latestName,
      matches: n, wins: w, losses: l,
      win_rate: round1(wr),
      my_stats: {
        avg_dmg_given: Math.round(myAvgGiven), avg_dmg_taken: Math.round(myAvgTaken),
        dmg_efficiency: round3(myEff),
        avg_kills: round2(jsAvg(data.map(function (d) { return d.kills; }))),
        avg_deaths: round2(jsAvg(data.map(function (d) { return d.deaths; }))),
        kd_ratio: round2(myKd), avg_ex_dmg: Math.round(myAvgEx),
        avg_bursts: myBursts != null ? round2(myBursts) : null,
      },
      partner_stats: {
        avg_dmg_given: Math.round(pAvgGiven), avg_dmg_taken: Math.round(pAvgTaken),
        dmg_efficiency: round3(pEff),
        avg_kills: round2(pAvgKills), avg_deaths: round2(pAvgDeaths),
        kd_ratio: round2(pKd), avg_ex_dmg: Math.round(pAvgEx),
        avg_bursts: pBursts != null ? round2(pBursts) : null,
      },
      my_win_loss_pattern: myWl,
      partner_win_loss_pattern: partnerWl,
      partner_ms_breakdown: msBreakdown,
      tips: tips,
    };
    // 表示名（最新のプレイヤー名）は partner_name に格納済み。team_name は使わない。
    results.push(entry);
  });
  return { partners: results };
}

export function computeShareData(matches) {
  if (!matches.length) return [];
  var msGroups = {};
  matches.forEach(function (m) {
    if (!msGroups[m.ms]) msGroups[m.ms] = [];
    msGroups[m.ms].push(m);
  });
  var topMs = Object.keys(msGroups).sort(function (a, b) { return msGroups[b].length - msGroups[a].length; })[0];
  if (!topMs) return [];

  var items = [];
  items.push({ type: 'top_ms', ms: topMs, count: msGroups[topMs].length });

  var topData = msGroups[topMs];
  var enemyStats = {};
  topData.forEach(function (d) {
    [d.opponent1_ms, d.opponent2_ms].forEach(function (ems) {
      if (!ems) return;
      if (!enemyStats[ems]) enemyStats[ems] = [];
      enemyStats[ems].push(d);
    });
  });

  var bestEnemy = null, worstEnemy = null;
  Object.keys(enemyStats).forEach(function (ems) {
    var ms = enemyStats[ems];
    if (ms.length < 3) return;
    var wr = jsWinRate(ms);
    if (!bestEnemy || wr > bestEnemy.wr) bestEnemy = { enemy: ems, wr: wr, count: ms.length };
    if (!worstEnemy || wr < worstEnemy.wr) worstEnemy = { enemy: ems, wr: wr, count: ms.length };
  });
  if (bestEnemy && bestEnemy.wr >= 60) {
    items.push({ type: 'strong_enemy', enemy: bestEnemy.enemy, wr: Math.round(bestEnemy.wr), count: bestEnemy.count });
  }
  if (worstEnemy && worstEnemy.wr <= 40) {
    items.push({ type: 'weak_enemy', enemy: worstEnemy.enemy, wr: Math.round(worstEnemy.wr), count: worstEnemy.count });
  }

  if (topData.length >= 3) {
    items.push({ type: 'dmg_efficiency', ms: topMs, value: round3(jsDmgEfficiency(topData)) });
  }
  return items;
}

export function computeMsSummary(matches) {
  var msGroups = {};
  matches.forEach(function (m) {
    if (!m.ms) return;
    if (!msGroups[m.ms]) msGroups[m.ms] = [];
    msGroups[m.ms].push(m);
  });
  var summary = {};
  Object.keys(msGroups).forEach(function (ms) {
    var data = msGroups[ms];
    summary[ms] = {
      matches: data.length,
      basic_stats: computeBasicStats(data),
      win_loss_pattern: computeWinLossPattern(data),
    };
  });
  return summary;
}
