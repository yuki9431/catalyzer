// --- 集約関数 ---
// 複数MSの分析結果(msStats)を受け取り、「全機体」ビュー用にまとめて返す。
// stats.js の compute* 関数の出力を入力とする後工程。

export function aggregateDeathsImpact(msStats) {
  var bucketMap = {};
  Object.keys(msStats).forEach(function (ms) {
    var di = msStats[ms].deaths_impact;
    if (!di) return;
    di.forEach(function (d) {
      (d.buckets || []).forEach(function (b) {
        if (!bucketMap[b.label]) bucketMap[b.label] = { label: b.label, matches: 0, wins: 0 };
        bucketMap[b.label].matches += b.matches;
        bucketMap[b.label].wins += Math.round(b.win_rate / 100 * b.matches);
      });
    });
  });
  var buckets = Object.values(bucketMap).map(function (b) {
    return { label: b.label, matches: b.matches, win_rate: b.matches > 0 ? b.wins / b.matches * 100 : 0 };
  });
  if (!buckets.length) return null;
  return [{ buckets: buckets }];
}

export function aggregateFallOrder(msStats) {
  var total = 0;
  var cats = { no_fall: { count: 0, wins: 0 }, first_fall: { count: 0, wins: 0 }, second_fall: { count: 0, wins: 0 }, same_time: { count: 0, wins: 0 } };
  Object.keys(msStats).forEach(function (ms) {
    var fo = msStats[ms].fall_order;
    if (!fo) return;
    total += fo.total || 0;
    ['no_fall', 'first_fall', 'second_fall', 'same_time'].forEach(function (k) {
      if (fo[k]) {
        cats[k].count += fo[k].count || 0;
        cats[k].wins += Math.round((fo[k].win_rate || 0) / 100 * (fo[k].count || 0));
      }
    });
  });
  if (total === 0) return null;
  function mkCat(c) {
    return { count: c.count, rate: total > 0 ? (c.count / total * 100).toFixed(1) : '0.0', win_rate: c.count > 0 ? c.wins / c.count * 100 : 0, avg_dmg_given: null, avg_dmg_taken: null, dmg_efficiency: null };
  }
  return { total: total, no_fall: mkCat(cats.no_fall), first_fall: mkCat(cats.first_fall), second_fall: mkCat(cats.second_fall), same_time: mkCat(cats.same_time) };
}

export function aggregateDmgContribution(msStats) {
  var totalMatches = 0, totalContrib = 0, totalWinContrib = 0, totalWinMatches = 0, totalLoseContrib = 0, totalLoseMatches = 0;
  Object.keys(msStats).forEach(function (ms) {
    var dc = msStats[ms].dmg_contribution;
    if (!dc || !dc.by_cost) return;
    dc.by_cost.forEach(function (c) {
      var bs = msStats[ms].basic_stats;
      var wr = bs ? bs.win_rate / 100 : 0.5;
      var wm = Math.round(c.matches * wr);
      totalMatches += c.matches;
      totalContrib += (c.avg_contribution || 0) * c.matches;
      if (c.avg_win_contribution != null) {
        totalWinContrib += c.avg_win_contribution * wm;
        totalWinMatches += wm;
      }
      if (c.avg_lose_contribution != null) {
        totalLoseContrib += c.avg_lose_contribution * (c.matches - wm);
        totalLoseMatches += c.matches - wm;
      }
    });
  });
  if (totalMatches === 0) return null;
  return { by_cost: [{ matches: totalMatches, avg_contribution: totalContrib / totalMatches, avg_win_contribution: totalWinMatches > 0 ? totalWinContrib / totalWinMatches : null, avg_lose_contribution: totalLoseMatches > 0 ? totalLoseContrib / totalLoseMatches : null }] };
}

export function aggregateBurstCount(msStats) {
  var countMap = {};
  Object.keys(msStats).forEach(function (ms) {
    var bc = msStats[ms].burst_count;
    if (!bc || !bc.by_count) return;
    bc.by_count.forEach(function (c) {
      if (!countMap[c.label]) countMap[c.label] = { label: c.label, matches: 0, wins: 0 };
      countMap[c.label].matches += c.matches;
      countMap[c.label].wins += Math.round(c.win_rate / 100 * c.matches);
    });
  });
  var byCount = Object.values(countMap).map(function (c) {
    return { label: c.label, matches: c.matches, win_rate: c.matches > 0 ? c.wins / c.matches * 100 : 0 };
  });
  if (!byCount.length) return null;
  return { by_count: byCount };
}

export function aggregateBurstTiming(msStats) {
  var immCount = 0, immWins = 0, delCount = 0, delWins = 0;
  var delaySum = 0, medianSum = 0, activations = 0, total = 0;
  Object.keys(msStats).forEach(function (ms) {
    var bt = msStats[ms].burst_timing;
    if (!bt) return;
    total += bt.total || 0;
    if (bt.immediate) {
      immCount += bt.immediate.count || 0;
      immWins += Math.round((bt.immediate.win_rate || 0) / 100 * (bt.immediate.count || 0));
    }
    if (bt.delayed) {
      delCount += bt.delayed.count || 0;
      delWins += Math.round((bt.delayed.win_rate || 0) / 100 * (bt.delayed.count || 0));
    }
    var acts = bt.activations || 0;
    delaySum += (bt.avg || 0) * acts;
    medianSum += (bt.median || 0) * acts;
    activations += acts;
  });
  if (total === 0) return null;
  return {
    total: total,
    activations: activations,
    avg: activations > 0 ? Math.round(delaySum / activations * 10) / 10 : 0,
    median: activations > 0 ? Math.round(medianSum / activations * 10) / 10 : 0,
    immediate: { count: immCount, rate: (immCount / total * 100).toFixed(1), win_rate: immCount > 0 ? immWins / immCount * 100 : 0 },
    delayed: { count: delCount, rate: (delCount / total * 100).toFixed(1), win_rate: delCount > 0 ? delWins / delCount * 100 : 0 },
  };
}

export function aggregateBurstType(msStats) {
  var typeMap = {};
  var totalBursts = 0;
  Object.keys(msStats).forEach(function (ms) {
    var bt = msStats[ms].burst_type;
    if (!bt) return;
    totalBursts += bt.total_bursts || 0;
    (bt.by_type || []).forEach(function (t) {
      if (!typeMap[t.key]) typeMap[t.key] = { key: t.key, label: t.label, count: 0, matches: 0, wins: 0 };
      typeMap[t.key].count += t.count || 0;
      typeMap[t.key].matches += t.matches || 0;
      typeMap[t.key].wins += Math.round((t.win_rate || 0) / 100 * (t.matches || 0));
    });
  });
  if (totalBursts === 0) return null;
  var order = { F: 0, S: 1, E: 2 };
  var byType = Object.values(typeMap).map(function (t) {
    return {
      key: t.key,
      label: t.label,
      count: t.count,
      rate: (t.count / totalBursts * 100).toFixed(1),
      matches: t.matches,
      win_rate: t.matches > 0 ? t.wins / t.matches * 100 : 0,
    };
  }).sort(function (a, b) { return (order[a.key] || 0) - (order[b.key] || 0); });
  return { total_bursts: totalBursts, by_type: byType };
}

export function aggregateEnemyMatchup(msStats) {
  var enemyMap = {};
  Object.keys(msStats).forEach(function (ms) {
    var em = msStats[ms].enemy_matchup;
    if (!em) return;
    ['strong', 'weak', 'even'].forEach(function (cat) {
      (em[cat] || []).forEach(function (e) {
        if (!enemyMap[e.ms]) enemyMap[e.ms] = { ms: e.ms, matches: 0, wins: 0, dmgGiven: 0, dmgTaken: 0 };
        enemyMap[e.ms].matches += e.matches;
        enemyMap[e.ms].wins += Math.round(e.win_rate / 100 * e.matches);
        enemyMap[e.ms].dmgGiven += (e.avg_dmg_given || 0) * e.matches;
        enemyMap[e.ms].dmgTaken += (e.avg_dmg_taken || 0) * e.matches;
      });
    });
  });
  var all = Object.values(enemyMap).map(function (e) {
    var wr = e.matches > 0 ? e.wins / e.matches * 100 : 0;
    var dg = e.matches > 0 ? e.dmgGiven / e.matches : 0;
    var dt = e.matches > 0 ? e.dmgTaken / e.matches : 0;
    return { ms: e.ms, matches: e.matches, win_rate: wr, avg_dmg_given: dg, avg_dmg_taken: dt, dmg_efficiency: dt > 0 ? dg / dt : 0 };
  });
  return {
    strong: all.filter(function (e) { return e.win_rate >= 60; }).sort(function (a, b) { return b.matches - a.matches; }),
    weak: all.filter(function (e) { return e.win_rate <= 40; }).sort(function (a, b) { return b.matches - a.matches; }),
    even: all.filter(function (e) { return e.win_rate > 40 && e.win_rate < 60; }).sort(function (a, b) { return b.matches - a.matches; }),
  };
}

export function aggregatePartner(msStats) {
  var partnerMap = {};
  Object.keys(msStats).forEach(function (ms) {
    var partners = msStats[ms].partner;
    if (!partners) return;
    partners.forEach(function (p) {
      if (!partnerMap[p.ms]) partnerMap[p.ms] = { ms: p.ms, matches: 0, wins: 0, de: 0 };
      partnerMap[p.ms].matches += p.matches;
      partnerMap[p.ms].wins += Math.round(p.win_rate / 100 * p.matches);
      partnerMap[p.ms].de += (p.dmg_efficiency || 0) * p.matches;
    });
  });
  return Object.values(partnerMap).map(function (p) {
    return { ms: p.ms, matches: p.matches, win_rate: p.matches > 0 ? p.wins / p.matches * 100 : 0, dmg_efficiency: p.matches > 0 ? p.de / p.matches : 0 };
  }).sort(function (a, b) { return b.matches - a.matches; });
}
