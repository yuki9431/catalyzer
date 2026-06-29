import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  aggregateDeathsImpact,
  aggregateFallOrder,
  aggregateDmgContribution,
  aggregateBurstCount,
  aggregateBurstHoldDeath,
  aggregateEnemyMatchup,
  aggregatePartner,
} from '../analysis/aggregate.js';

// --- aggregateDeathsImpact ---

describe('aggregateDeathsImpact', function () {
  it('merges buckets across MS', function () {
    var msStats = {
      'ガンダム': {
        deaths_impact: [{
          buckets: [
            { label: '0落ち', matches: 10, win_rate: 80 },
            { label: '1落ち', matches: 5, win_rate: 40 },
          ],
        }],
      },
      'ザク': {
        deaths_impact: [{
          buckets: [
            { label: '0落ち', matches: 8, win_rate: 60 },
            { label: '1落ち', matches: 3, win_rate: 30 },
          ],
        }],
      },
    };
    var result = aggregateDeathsImpact(msStats);
    assert.ok(result);
    assert.equal(result.length, 1);
    var b0 = result[0].buckets.find(function (b) { return b.label === '0落ち'; });
    assert.ok(b0);
    assert.equal(b0.matches, 18);
  });

  it('returns null for no data', function () {
    assert.equal(aggregateDeathsImpact({}), null);
    assert.equal(aggregateDeathsImpact({ 'ガンダム': {} }), null);
  });
});

// --- aggregateFallOrder ---

describe('aggregateFallOrder', function () {
  it('merges fall order across MS', function () {
    var msStats = {
      'ガンダム': {
        fall_order: {
          total: 10,
          no_fall: { count: 3, rate: '30.0', win_rate: 90 },
          first_fall: { count: 4, rate: '40.0', win_rate: 50 },
          second_fall: { count: 2, rate: '20.0', win_rate: 60 },
          same_time: { count: 1, rate: '10.0', win_rate: 0 },
        },
      },
      'ザク': {
        fall_order: {
          total: 5,
          no_fall: { count: 2, rate: '40.0', win_rate: 100 },
          first_fall: { count: 2, rate: '40.0', win_rate: 50 },
          second_fall: { count: 1, rate: '20.0', win_rate: 0 },
          same_time: { count: 0, rate: '0.0', win_rate: 0 },
        },
      },
    };
    var result = aggregateFallOrder(msStats);
    assert.ok(result);
    assert.equal(result.total, 15);
    assert.equal(result.no_fall.count, 5);
    assert.equal(result.first_fall.count, 6);
  });

  it('returns null for no data', function () {
    assert.equal(aggregateFallOrder({}), null);
  });
});

// --- aggregateDmgContribution ---

describe('aggregateDmgContribution', function () {
  it('aggregates damage contribution across MS', function () {
    var msStats = {
      'ガンダム': {
        basic_stats: { win_rate: 60 },
        dmg_contribution: {
          by_cost: [{ matches: 10, avg_contribution: 55, avg_win_contribution: 60, avg_lose_contribution: 48 }],
        },
      },
    };
    var result = aggregateDmgContribution(msStats);
    assert.ok(result);
    assert.ok(result.by_cost.length > 0);
    assert.equal(result.by_cost[0].matches, 10);
    assert.equal(result.by_cost[0].avg_contribution, 55);
  });

  it('returns null for no data', function () {
    assert.equal(aggregateDmgContribution({}), null);
    assert.equal(aggregateDmgContribution({ 'ガンダム': { dmg_contribution: { by_cost: [] } } }), null);
  });
});

// --- aggregateBurstCount ---

describe('aggregateBurstCount', function () {
  it('merges burst counts across MS', function () {
    var msStats = {
      'ガンダム': {
        burst_count: {
          by_count: [
            { label: '1回', matches: 5, win_rate: 40 },
            { label: '2回', matches: 8, win_rate: 70 },
          ],
        },
      },
      'ザク': {
        burst_count: {
          by_count: [
            { label: '1回', matches: 3, win_rate: 60 },
            { label: '2回', matches: 4, win_rate: 50 },
          ],
        },
      },
    };
    var result = aggregateBurstCount(msStats);
    assert.ok(result);
    var b1 = result.by_count.find(function (b) { return b.label === '1回'; });
    assert.ok(b1);
    assert.equal(b1.matches, 8);
    var b2 = result.by_count.find(function (b) { return b.label === '2回'; });
    assert.equal(b2.matches, 12);
  });

  it('returns null for no data', function () {
    assert.equal(aggregateBurstCount({}), null);
  });
});

// --- aggregateBurstHoldDeath ---

describe('aggregateBurstHoldDeath', function () {
  it('merges burst hold death across MS', function () {
    var msStats = {
      'ガンダム': {
        burst_hold_death: {
          total: 10,
          no_hold: { count: 6, rate: '60.0', win_rate: 70 },
          by_death: [
            { label: '1機目に抱え落ち', count: 4, rate: '40.0', win_rate: 30 },
          ],
        },
      },
    };
    var result = aggregateBurstHoldDeath(msStats);
    assert.ok(result);
    assert.equal(result.total, 10);
    assert.equal(result.no_hold.count, 6);
    assert.ok(result.by_death.length > 0);
  });

  it('returns null for no data', function () {
    assert.equal(aggregateBurstHoldDeath({}), null);
  });
});

// --- aggregateEnemyMatchup ---

describe('aggregateEnemyMatchup', function () {
  it('categorizes aggregated enemies', function () {
    var msStats = {
      'ガンダム': {
        enemy_matchup: {
          strong: [{ ms: '弱い敵', matches: 10, win_rate: 80, avg_dmg_given: 1200, avg_dmg_taken: 700 }],
          weak: [{ ms: '強い敵', matches: 8, win_rate: 20, avg_dmg_given: 600, avg_dmg_taken: 1200 }],
          even: [],
        },
      },
    };
    var result = aggregateEnemyMatchup(msStats);
    assert.ok(result.strong.length > 0);
    assert.ok(result.weak.length > 0);
    assert.equal(result.strong[0].ms, '弱い敵');
    assert.equal(result.weak[0].ms, '強い敵');
  });

  it('merges same enemy across MS', function () {
    var msStats = {
      'ガンダム': {
        enemy_matchup: {
          strong: [{ ms: '共通の敵', matches: 5, win_rate: 80, avg_dmg_given: 1000, avg_dmg_taken: 700 }],
          weak: [], even: [],
        },
      },
      'ザク': {
        enemy_matchup: {
          strong: [{ ms: '共通の敵', matches: 3, win_rate: 60, avg_dmg_given: 900, avg_dmg_taken: 800 }],
          weak: [], even: [],
        },
      },
    };
    var result = aggregateEnemyMatchup(msStats);
    var found = result.strong.concat(result.even).find(function (e) { return e.ms === '共通の敵'; });
    assert.ok(found);
    assert.equal(found.matches, 8);
  });
});

// --- aggregatePartner ---

describe('aggregatePartner', function () {
  it('merges partner stats across MS', function () {
    var msStats = {
      'ガンダム': {
        partner: [
          { ms: 'ストライク', matches: 5, win_rate: 60, dmg_efficiency: 1.2 },
        ],
      },
      'ザク': {
        partner: [
          { ms: 'ストライク', matches: 3, win_rate: 80, dmg_efficiency: 1.5 },
        ],
      },
    };
    var result = aggregatePartner(msStats);
    assert.equal(result.length, 1);
    assert.equal(result[0].ms, 'ストライク');
    assert.equal(result[0].matches, 8);
  });

  it('sorts by match count descending', function () {
    var msStats = {
      'ガンダム': {
        partner: [
          { ms: '少ない', matches: 3, win_rate: 50, dmg_efficiency: 1.0 },
          { ms: '多い', matches: 10, win_rate: 50, dmg_efficiency: 1.0 },
        ],
      },
    };
    var result = aggregatePartner(msStats);
    assert.equal(result[0].ms, '多い');
    assert.equal(result[1].ms, '少ない');
  });

  it('handles empty input', function () {
    var result = aggregatePartner({});
    assert.deepEqual(result, []);
  });
});
