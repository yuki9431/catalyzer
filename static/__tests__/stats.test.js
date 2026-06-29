import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  PERIOD_DAYS,
  filterByPlayDays,
  computeTimeOfDay,
  computeDayOfWeek,
  computeDailyTrend,
  computeBasicStats,
  computeWinLossPattern,
  computeEnemyMatchup,
  computePartner,
  computeCostPair,
  computeMsPair,
  computeDmgContribution,
  computeDeathsImpact,
  computeSeason,
  computeBurstCount,
  computeFallOrder,
  computeBurstHoldDeath,
  computeFixedPartners,
} from '../analysis/stats.js';

function makeMatch(overrides) {
  return Object.assign({
    date: '2025-06-15 14:30',
    win: true,
    ms: 'ガンダム',
    ms_cost: 3000,
    dmg_given: 1000,
    dmg_taken: 800,
    kills: 2,
    deaths: 1,
    ex_dmg: 150,
    bursts: 2,
    score: 500,
    actions: [],
    partner_actions: [],
    partner_ms: 'ザク',
    partner_cost: 2000,
    partner_name: 'パートナー',
    partner_dmg_given: 900,
    partner_dmg_taken: 700,
    partner_kills: 1,
    partner_deaths: 1,
    partner_ex_dmg: 100,
    opponent1_ms: 'シャアザク',
    opponent2_ms: 'ゲルググ',
  }, overrides);
}

function makeMatches(count, overrides) {
  var result = [];
  for (var i = 0; i < count; i++) {
    result.push(makeMatch(typeof overrides === 'function' ? overrides(i) : overrides));
  }
  return result;
}

// --- PERIOD_DAYS ---

describe('PERIOD_DAYS', function () {
  it('has expected keys and values', function () {
    assert.equal(PERIOD_DAYS['90d'], 90);
    assert.equal(PERIOD_DAYS['7d'], 7);
    assert.equal(PERIOD_DAYS['1d'], 1);
  });
});

// --- filterByPlayDays ---

describe('filterByPlayDays', function () {
  it('returns empty for empty input', function () {
    assert.deepEqual(filterByPlayDays([], 3), []);
  });

  it('filters to most recent N play days', function () {
    var matches = [
      makeMatch({ date: '2025-06-15 10:00' }),
      makeMatch({ date: '2025-06-15 14:00' }),
      makeMatch({ date: '2025-06-14 10:00' }),
      makeMatch({ date: '2025-06-13 10:00' }),
    ];
    var filtered = filterByPlayDays(matches, 2);
    assert.equal(filtered.length, 3);
    assert.ok(filtered.every(function (m) { return m.date.startsWith('2025-06-15') || m.date.startsWith('2025-06-14'); }));
  });

  it('returns all when days exceeds unique dates', function () {
    var matches = [makeMatch({ date: '2025-06-15 10:00' })];
    assert.equal(filterByPlayDays(matches, 100).length, 1);
  });
});

// --- computeTimeOfDay ---

describe('computeTimeOfDay', function () {
  it('groups matches by hour', function () {
    var matches = [
      makeMatch({ date: '2025-06-15 14:30' }),
      makeMatch({ date: '2025-06-15 14:45' }),
      makeMatch({ date: '2025-06-15 20:00', win: false }),
    ];
    var result = computeTimeOfDay(matches);
    assert.ok(Array.isArray(result.hours));
    var h14 = result.hours.find(function (h) { return h.hour === 14; });
    assert.ok(h14);
    assert.equal(h14.matches, 2);
    assert.equal(h14.win_rate, 100);
  });

  it('returns tips array', function () {
    var result = computeTimeOfDay([makeMatch()]);
    assert.ok(Array.isArray(result.tips));
  });
});

// --- computeDayOfWeek ---

describe('computeDayOfWeek', function () {
  it('separates weekday and weekend', function () {
    var matches = [
      makeMatch({ date: '2025-06-16 10:00' }), // Monday
      makeMatch({ date: '2025-06-14 10:00' }), // Saturday
    ];
    var result = computeDayOfWeek(matches);
    assert.equal(result.weekday.matches, 1);
    assert.equal(result.weekend.matches, 1);
    assert.ok(Array.isArray(result.days));
  });

  it('generates tips for large win rate diff', function () {
    var matches = [];
    for (var i = 0; i < 10; i++) matches.push(makeMatch({ date: '2025-06-16 10:00', win: true })); // Mon wins
    for (var i = 0; i < 10; i++) matches.push(makeMatch({ date: '2025-06-14 10:00', win: false })); // Sat losses
    var result = computeDayOfWeek(matches);
    assert.ok(result.tips.length > 0);
  });
});

// --- computeDailyTrend ---

describe('computeDailyTrend', function () {
  it('returns daily results sorted', function () {
    var matches = [
      makeMatch({ date: '2025-06-13 10:00', win: false }),
      makeMatch({ date: '2025-06-15 10:00', win: true }),
      makeMatch({ date: '2025-06-14 10:00', win: true }),
    ];
    var result = computeDailyTrend(matches);
    assert.ok(result.days.length >= 2);
    assert.ok(Array.isArray(result.tips));
  });
});

// --- computeBasicStats ---

describe('computeBasicStats', function () {
  it('computes basic stats correctly', function () {
    var matches = [
      makeMatch({ win: true, kills: 3, deaths: 1, dmg_given: 1200, dmg_taken: 800 }),
      makeMatch({ win: false, kills: 1, deaths: 2, dmg_given: 700, dmg_taken: 1000 }),
    ];
    var result = computeBasicStats(matches);
    assert.equal(result.matches, 2);
    assert.equal(result.wins, 1);
    assert.equal(result.losses, 1);
    assert.equal(result.win_rate, 50);
    assert.equal(result.avg_dmg_given, 950);
    assert.equal(result.avg_dmg_taken, 900);
    assert.ok(result.kd_ratio > 0);
    assert.ok(Array.isArray(result.tips));
  });

  it('handles empty matches', function () {
    var result = computeBasicStats([]);
    assert.equal(result.matches, 0);
    assert.equal(result.win_rate, 0);
  });

  it('generates tips for low efficiency', function () {
    var matches = makeMatches(5, { dmg_given: 500, dmg_taken: 1000, kills: 0, deaths: 3 });
    var result = computeBasicStats(matches);
    assert.ok(result.tips.length > 0);
  });

  it('computes avg_bursts when actions present', function () {
    var matches = [
      makeMatch({ bursts: 2, actions: [{ action: 'exbst-f' }] }),
      makeMatch({ bursts: 1, actions: [{ action: 'exbst-s' }] }),
    ];
    var result = computeBasicStats(matches);
    assert.equal(result.avg_bursts, 1.5);
  });

  it('avg_bursts is null when no actions', function () {
    var result = computeBasicStats([makeMatch({ actions: [] })]);
    assert.equal(result.avg_bursts, null);
  });
});

// --- computeWinLossPattern ---

describe('computeWinLossPattern', function () {
  it('returns metrics comparing wins and losses', function () {
    var matches = [
      makeMatch({ win: true, dmg_given: 1200, dmg_taken: 600, kills: 3, deaths: 0, ex_dmg: 200 }),
      makeMatch({ win: false, dmg_given: 600, dmg_taken: 1100, kills: 0, deaths: 3, ex_dmg: 50 }),
    ];
    var result = computeWinLossPattern(matches);
    assert.ok(result.metrics.length >= 6);
    var dmgGiven = result.metrics.find(function (m) { return m.label === '平均与ダメージ'; });
    assert.ok(dmgGiven);
    assert.ok(dmgGiven.win_avg > dmgGiven.loss_avg);
  });

  it('includes cost patterns when data is available', function () {
    var matches = [];
    for (var i = 0; i < 5; i++) {
      matches.push(makeMatch({ win: i < 3, ms_cost: 3000 }));
    }
    var result = computeWinLossPattern(matches);
    assert.ok(result.cost_patterns.length > 0);
    assert.equal(result.cost_patterns[0].cost, 3000);
  });
});

// --- computeEnemyMatchup ---

describe('computeEnemyMatchup', function () {
  it('categorizes enemies into strong/weak/even', function () {
    var matches = [];
    for (var i = 0; i < 5; i++) matches.push(makeMatch({ win: true, opponent1_ms: '弱い敵', opponent2_ms: 'ザコ' }));
    for (var i = 0; i < 5; i++) matches.push(makeMatch({ win: false, opponent1_ms: '強い敵', opponent2_ms: 'ザコ' }));
    var result = computeEnemyMatchup(matches, 3);
    assert.ok(result.strong.length > 0 || result.weak.length > 0 || result.even.length > 0);
  });

  it('respects minMatches', function () {
    var matches = [
      makeMatch({ opponent1_ms: 'レア敵', opponent2_ms: '' }),
      makeMatch({ opponent1_ms: 'レア敵', opponent2_ms: '' }),
    ];
    var result = computeEnemyMatchup(matches, 5);
    assert.equal(result.strong.length + result.weak.length + result.even.length, 0);
  });

  it('generates tips for weak enemies with high damage taken', function () {
    var matches = [];
    for (var i = 0; i < 5; i++) {
      matches.push(makeMatch({ win: false, opponent1_ms: '天敵', opponent2_ms: '', dmg_taken: 1500 }));
    }
    var result = computeEnemyMatchup(matches, 3);
    assert.ok(result.tips.length > 0);
  });
});

// --- computePartner ---

describe('computePartner', function () {
  it('groups by partner MS', function () {
    var matches = makeMatches(5, { partner_ms: 'ストライク' });
    var result = computePartner(matches, 3);
    assert.equal(result.length, 1);
    assert.equal(result[0].ms, 'ストライク');
    assert.equal(result[0].matches, 5);
  });

  it('filters below minMatches', function () {
    var matches = [makeMatch({ partner_ms: 'レア相方' })];
    assert.equal(computePartner(matches, 3).length, 0);
  });
});

// --- computeCostPair ---

describe('computeCostPair', function () {
  it('groups by MS + partner cost', function () {
    var matches = makeMatches(5, { ms: 'ガンダム', partner_cost: 2000 });
    var result = computeCostPair(matches, 3);
    assert.ok(result.length > 0);
    assert.ok(result[0].pair.includes('ガンダム'));
    assert.ok(result[0].pair.includes('2000'));
  });
});

// --- computeMsPair ---

describe('computeMsPair', function () {
  it('returns by_win_rate and by_matches', function () {
    var matches = makeMatches(5, { ms: 'ガンダム', partner_ms: 'ザク' });
    var result = computeMsPair(matches, 3);
    assert.ok(result.by_win_rate);
    assert.ok(result.by_matches);
    assert.ok(result.by_win_rate.length > 0);
  });
});

// --- computeDmgContribution ---

describe('computeDmgContribution', function () {
  it('computes average contributions', function () {
    var matches = [
      makeMatch({ dmg_given: 1000, partner_dmg_given: 1000 }),
      makeMatch({ dmg_given: 600, partner_dmg_given: 400 }),
    ];
    var result = computeDmgContribution(matches);
    assert.ok(result.avg_contribution > 0);
    assert.ok(result.avg_contribution <= 100);
  });

  it('handles zero team damage', function () {
    var matches = [makeMatch({ dmg_given: 0, partner_dmg_given: 0 })];
    var result = computeDmgContribution(matches);
    assert.equal(result.avg_contribution, 0);
  });

  it('includes cost breakdown when multiple costs', function () {
    var matches = [
      ...makeMatches(5, { ms_cost: 3000, dmg_given: 1200, partner_dmg_given: 800 }),
      ...makeMatches(5, { ms_cost: 2500, dmg_given: 800, partner_dmg_given: 1000 }),
    ];
    var result = computeDmgContribution(matches, 3);
    assert.ok(result.by_cost.length >= 2);
  });
});

// --- computeDeathsImpact ---

describe('computeDeathsImpact', function () {
  it('groups by cost and death count', function () {
    var matches = [
      makeMatch({ ms_cost: 3000, deaths: 0, win: true }),
      makeMatch({ ms_cost: 3000, deaths: 1, win: true }),
      makeMatch({ ms_cost: 3000, deaths: 2, win: false }),
      makeMatch({ ms_cost: 3000, deaths: 3, win: false }),
    ];
    var result = computeDeathsImpact(matches);
    assert.ok(result.length > 0);
    var cost3000 = result.find(function (r) { return r.cost === 3000; });
    assert.ok(cost3000);
    assert.equal(cost3000.fatal_deaths, 2);
    assert.ok(cost3000.buckets.length > 0);
  });

  it('handles matches without recognized cost', function () {
    var matches = [makeMatch({ ms_cost: 9999 })];
    assert.deepEqual(computeDeathsImpact(matches), []);
  });
});

// --- computeSeason ---

describe('computeSeason', function () {
  it('groups matches by 2-month seasons', function () {
    var matches = [
      makeMatch({ date: '2025-06-15 10:00' }),
      makeMatch({ date: '2025-06-20 10:00' }),
      makeMatch({ date: '2025-04-15 10:00' }),
    ];
    var result = computeSeason(matches);
    assert.ok(result.length >= 2);
    assert.ok(result[0].name.includes('年'));
  });

  it('includes half stats when both halves have data', function () {
    var matches = [
      makeMatch({ date: '2025-06-15 10:00' }), // 前半(6月)
      makeMatch({ date: '2025-07-15 10:00' }), // 後半(7月)
    ];
    var result = computeSeason(matches);
    var s = result.find(function (r) { return r.first_half && r.second_half; });
    assert.ok(s);
  });
});

// --- computeBurstCount ---

describe('computeBurstCount', function () {
  it('groups by burst count', function () {
    var matches = [
      makeMatch({ bursts: 2, actions: [{ action: 'exbst-f' }] }),
      makeMatch({ bursts: 1, actions: [{ action: 'exbst-s' }] }),
      makeMatch({ bursts: 2, actions: [{ action: 'exbst-e' }] }),
    ];
    var result = computeBurstCount(matches);
    assert.ok(result);
    assert.ok(result.by_count.length >= 2);
    var burst2 = result.by_count.find(function (b) { return b.count === 2; });
    assert.ok(burst2);
    assert.equal(burst2.matches, 2);
  });

  it('returns null for no action data', function () {
    var result = computeBurstCount([makeMatch({ actions: [] })]);
    assert.equal(result, null);
  });

  it('labels zero bursts correctly', function () {
    var matches = [makeMatch({ bursts: 0, actions: [{ action: 'ex' }] })];
    var result = computeBurstCount(matches);
    assert.ok(result);
    var zero = result.by_count.find(function (b) { return b.count === 0; });
    assert.ok(zero);
    assert.ok(zero.label.includes('未覚醒'));
  });
});

// --- computeFallOrder ---

describe('computeFallOrder', function () {
  it('classifies no-fall, first-fall, second-fall', function () {
    var matches = [
      makeMatch({
        actions: [{ action: 'death', action_start_sec: 60 }],
        partner_actions: [{ action: 'death', action_start_sec: 90 }],
      }),
      makeMatch({
        actions: [{ action: 'death', action_start_sec: 90 }],
        partner_actions: [{ action: 'death', action_start_sec: 30 }],
      }),
      makeMatch({
        actions: [{ action: 'ex', action_start_sec: 10 }],
        partner_actions: [{ action: 'death', action_start_sec: 60 }],
      }),
    ];
    var result = computeFallOrder(matches);
    assert.ok(result);
    assert.equal(result.first_fall.count, 1);
    assert.equal(result.second_fall.count, 1);
    assert.equal(result.no_fall.count, 1);
  });

  it('returns null for no action data', function () {
    var result = computeFallOrder([makeMatch({ actions: [], partner_actions: [] })]);
    assert.equal(result, null);
  });
});

// --- computeBurstHoldDeath ---

describe('computeBurstHoldDeath', function () {
  it('detects burst hold before death', function () {
    var matches = [
      makeMatch({
        actions: [
          { action: 'ex', action_start_sec: 30 },
          { action: 'death', action_start_sec: 60 },
        ],
      }),
    ];
    var result = computeBurstHoldDeath(matches);
    assert.ok(result);
    assert.equal(result.total, 1);
    assert.ok(result.by_death.length > 0);
  });

  it('counts no_hold when burst was used', function () {
    var matches = [
      makeMatch({
        actions: [
          { action: 'ex', action_start_sec: 30 },
          { action: 'exbst-f', action_start_sec: 40 },
          { action: 'death', action_start_sec: 60 },
        ],
      }),
    ];
    var result = computeBurstHoldDeath(matches);
    assert.ok(result);
    assert.equal(result.no_hold.count, 1);
  });

  it('returns null for no death data', function () {
    var matches = [makeMatch({ actions: [{ action: 'ex', action_start_sec: 30 }] })];
    var result = computeBurstHoldDeath(matches);
    assert.equal(result, null);
  });
});

// --- computeFixedPartners ---

describe('computeFixedPartners', function () {
  it('returns notice when no tag partners', function () {
    var result = computeFixedPartners([makeMatch()], []);
    assert.ok(result.notice);
    assert.deepEqual(result.partners, []);
  });

  it('returns notice when tag partners is null', function () {
    var result = computeFixedPartners([makeMatch()], null);
    assert.ok(result.notice);
  });

  it('matches tag partners by name', function () {
    var tagPartners = [{ player_name: 'パートナー', team_name: 'チームA' }];
    var matches = makeMatches(5, { partner_name: 'パートナー' });
    var result = computeFixedPartners(matches, tagPartners);
    assert.equal(result.partners.length, 1);
    assert.equal(result.partners[0].partner_name, 'パートナー');
    assert.equal(result.partners[0].team_name, 'チームA');
    assert.equal(result.partners[0].matches, 5);
    assert.ok(result.partners[0].my_stats);
    assert.ok(result.partners[0].partner_stats);
  });

  it('returns empty partners when no matches with tag partners', function () {
    var tagPartners = [{ player_name: '誰か', team_name: 'チームX' }];
    var matches = makeMatches(5, { partner_name: '別の人' });
    var result = computeFixedPartners(matches, tagPartners);
    assert.deepEqual(result.partners, []);
  });
});
