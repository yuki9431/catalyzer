import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  emptyFilters, hasActiveFilters, collectMsOptions,
  filterMatches, sortMatches, SORT_OPTIONS,
} from '../analysis/search.js';

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
    score: 500,
    bursts: 2,
    actions: [],
    partner_actions: [],
    partner_ms: 'ザク',
    partner_cost: 2000,
    partner_name: 'パートナー',
    opponent1_ms: 'シャアザク',
    opponent2_ms: 'ゲルググ',
  }, overrides);
}

describe('emptyFilters / hasActiveFilters', function () {
  it('empty filters are not active', function () {
    assert.equal(hasActiveFilters(emptyFilters()), false);
  });
  it('detects a set result filter', function () {
    var f = emptyFilters();
    f.result = 'win';
    assert.equal(hasActiveFilters(f), true);
  });
  it('detects a set text/number filter', function () {
    var f = emptyFilters();
    f.myMs = 'ガンダム';
    assert.equal(hasActiveFilters(f), true);
    var g = emptyFilters();
    g.dmgGivenMin = 500;
    assert.equal(hasActiveFilters(g), true);
  });
});

describe('collectMsOptions', function () {
  it('tallies mine/partners/enemies by frequency', function () {
    var matches = [
      makeMatch({ ms: 'A', partner_ms: 'P1', opponent1_ms: 'E1', opponent2_ms: 'E2' }),
      makeMatch({ ms: 'A', partner_ms: 'P2', opponent1_ms: 'E1', opponent2_ms: 'E3' }),
      makeMatch({ ms: 'B', partner_ms: 'P1', opponent1_ms: 'E1', opponent2_ms: '' }),
    ];
    var opts = collectMsOptions(matches);
    assert.equal(opts.mine[0].name, 'A');
    assert.equal(opts.mine[0].matches, 2);
    // E1 appears in all 3 matches → most frequent enemy
    assert.equal(opts.enemies[0].name, 'E1');
    assert.equal(opts.enemies[0].matches, 3);
    // empty opponent2 in third match is ignored
    var names = opts.enemies.map(function (e) { return e.name; });
    assert.equal(names.indexOf(''), -1);
  });
  it('counts a mirror matchup (same ms on both opponents) once per match', function () {
    var matches = [
      makeMatch({ opponent1_ms: 'ザクII', opponent2_ms: 'ザクII' }),
      makeMatch({ opponent1_ms: 'ザクII', opponent2_ms: 'グフ' }),
    ];
    var opts = collectMsOptions(matches);
    var zaku = opts.enemies.find(function (e) { return e.name === 'ザクII'; });
    // 1試合目で2回出現するが、試合数としては2（各試合1回）
    assert.equal(zaku.matches, 2);
  });
  it('handles empty input', function () {
    var opts = collectMsOptions([]);
    assert.deepEqual(opts, { mine: [], partners: [], enemies: [] });
  });
});

describe('filterMatches', function () {
  var matches = [
    makeMatch({ date: '2025-06-10 10:00', ms: 'ガンダム', win: true, dmg_given: 1200, dmg_taken: 600, kills: 3, deaths: 0, partner_ms: 'ザク', opponent1_ms: 'X', opponent2_ms: 'Y' }),
    makeMatch({ date: '2025-06-15 12:00', ms: 'ズゴック', win: false, dmg_given: 700, dmg_taken: 1100, kills: 1, deaths: 2, partner_ms: 'グフ', opponent1_ms: 'Y', opponent2_ms: 'Z' }),
    makeMatch({ date: '2025-06-20 20:00', ms: 'ガンダム', win: true, dmg_given: 900, dmg_taken: 900, kills: 2, deaths: 1, partner_ms: 'ザク', opponent1_ms: 'Z', opponent2_ms: 'X' }),
  ];

  it('returns all with empty filters', function () {
    assert.equal(filterMatches(matches, emptyFilters()).length, 3);
  });
  it('filters by date range (inclusive, date-only)', function () {
    var f = emptyFilters(); f.dateFrom = '2025-06-15'; f.dateTo = '2025-06-20';
    var r = filterMatches(matches, f);
    assert.equal(r.length, 2);
    assert.equal(r[0].date, '2025-06-15 12:00');
  });
  it('filters by my ms', function () {
    var f = emptyFilters(); f.myMs = 'ガンダム';
    assert.equal(filterMatches(matches, f).length, 2);
  });
  it('filters by partner ms', function () {
    var f = emptyFilters(); f.partnerMs = 'グフ';
    assert.equal(filterMatches(matches, f).length, 1);
  });
  it('filters by enemy ms matching either opponent', function () {
    var f = emptyFilters(); f.enemyMs = 'Y';
    assert.equal(filterMatches(matches, f).length, 2);
  });
  it('filters by result', function () {
    var win = emptyFilters(); win.result = 'win';
    assert.equal(filterMatches(matches, win).length, 2);
    var loss = emptyFilters(); loss.result = 'loss';
    assert.equal(filterMatches(matches, loss).length, 1);
  });
  it('filters by damage range', function () {
    var f = emptyFilters(); f.dmgGivenMin = 800; f.dmgGivenMax = 1000;
    var r = filterMatches(matches, f);
    assert.equal(r.length, 1);
    assert.equal(r[0].dmg_given, 900);
  });
  it('filters by kills/deaths range', function () {
    var f = emptyFilters(); f.deathsMax = 0;
    var r = filterMatches(matches, f);
    assert.equal(r.length, 1);
    assert.equal(r[0].deaths, 0);
  });
  it('combines multiple conditions (AND)', function () {
    var f = emptyFilters();
    f.myMs = 'ガンダム'; f.result = 'win'; f.dmgGivenMin = 1000;
    var r = filterMatches(matches, f);
    assert.equal(r.length, 1);
    assert.equal(r[0].dmg_given, 1200);
  });
  it('does not mutate the input array', function () {
    var copy = matches.slice();
    filterMatches(matches, { myMs: 'ガンダム' });
    assert.deepEqual(matches, copy);
  });
});

describe('sortMatches', function () {
  var matches = [
    makeMatch({ date: '2025-06-10 10:00', dmg_given: 1200, kills: 3 }),
    makeMatch({ date: '2025-06-20 20:00', dmg_given: 700, kills: 1 }),
    makeMatch({ date: '2025-06-15 12:00', dmg_given: 900, kills: 3 }),
  ];

  it('sorts by date descending', function () {
    var r = sortMatches(matches, 'date', true);
    assert.deepEqual(r.map(function (m) { return m.date; }),
      ['2025-06-20 20:00', '2025-06-15 12:00', '2025-06-10 10:00']);
  });
  it('sorts by date ascending', function () {
    var r = sortMatches(matches, 'date', false);
    assert.equal(r[0].date, '2025-06-10 10:00');
  });
  it('sorts by numeric field descending', function () {
    var r = sortMatches(matches, 'dmg_given', true);
    assert.deepEqual(r.map(function (m) { return m.dmg_given; }), [1200, 900, 700]);
  });
  it('breaks ties by most recent date', function () {
    var r = sortMatches(matches, 'kills', true);
    // two matches have kills=3; the newer (06-15) comes before the older (06-10)
    assert.equal(r[0].kills, 3);
    assert.equal(r[0].date, '2025-06-15 12:00');
    assert.equal(r[1].date, '2025-06-10 10:00');
  });
  it('does not mutate the input array', function () {
    var copy = matches.slice();
    sortMatches(matches, 'dmg_given', true);
    assert.deepEqual(matches, copy);
  });
});

describe('SORT_OPTIONS', function () {
  it('every option has key and label', function () {
    SORT_OPTIONS.forEach(function (o) {
      assert.ok(o.key && o.label);
    });
  });
});
