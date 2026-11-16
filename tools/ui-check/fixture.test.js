import { describe, it } from 'node:test';
import assert from 'node:assert';
import { testPattern } from '../../static/analysis/patterns.js';
import { generateMatches, MATCH_COUNT, msList, notes } from './fixture.js';
import { computeEnemyMatchup } from '../../static/analysis/stats.js';

describe('fixture', function () {
  it('is deterministic across calls', function () {
    assert.deepEqual(generateMatches(), generateMatches());
  });
  it('generates the fixed number of matches with unique match_id', function () {
    var ms = generateMatches();
    assert.equal(ms.length, MATCH_COUNT);
    assert.equal(new Set(ms.map(function (m) { return m.match_id; })).size, MATCH_COUNT);
  });
  it('has OL-without-burst and last-cost matches for the ui-check scenes', function () {
    var ms = generateMatches();
    var count = function (key) { return ms.filter(function (m) { return testPattern({ key: key }, m) === true; }).length; };
    assert.ok(count('ov_solo') >= 1);
    assert.ok(count('last_cost_burst') > 20);
  });
  it('ends every OL activation after it starts, like the real timeline', function () {
    generateMatches().forEach(function (m) {
      [m.actions, m.opponent1_actions].forEach(function (list) {
        list.filter(function (a) { return a.action === 'exbst-ov'; }).forEach(function (a) { assert.ok(a.action_end_sec > a.action_start_sec); });
      });
    });
  });
  it('uses local image URLs for every machine', function () {
    msList().forEach(function (m) { assert.match(m.ImageURL, /^\/__preview\/ms\/\d+\.svg$/); });
  });
  it('メモの敵機は先頭の試合の相手か相性タブの得意・苦手な敵機にいて、種類は enemy 4・date 1・free 1・ピン1', () => {
    var top = generateMatches().sort(function (a, b) { return a.date < b.date ? 1 : -1; })[0];
    assert.strictEqual(top.opponent1_ms, 'ストームレイダー');
    var ns = notes();
    var em = computeEnemyMatchup(generateMatches());
    var listed = em.strong.concat(em.weak).map(function (e) { return e.ms; });
    var inTop = function (n) { return [top.opponent1_ms, top.opponent2_ms].includes(n.enemy_ms); };
    ns.filter(function (n) { return n.kind === 'enemy'; }).forEach(function (n) {
      assert.ok(inTop(n) || listed.includes(n.enemy_ms), n.enemy_ms);
    });
    assert.ok(ns.some(function (n) { return n.kind === 'enemy' && inTop(n); }));
    assert.ok(ns.some(function (n) { return n.kind === 'enemy' && listed.includes(n.enemy_ms); }));
    var count = function (k) { return ns.filter(function (n) { return n.kind === k; }).length; };
    assert.deepEqual([count('enemy'), count('date'), count('free')], [4, 1, 1]);
    assert.equal(ns.filter(function (n) { return n.pinned; }).length, 1);
    assert.ok(ns.some(function (n) { return n.my_ms; }));
    assert.equal(new Set(ns.map(function (n) { return n.id; })).size, ns.length);
  });
});
