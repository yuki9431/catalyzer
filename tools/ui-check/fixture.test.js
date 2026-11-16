import { describe, it } from 'node:test';
import assert from 'node:assert';
import { testPattern } from '../../static/analysis/patterns.js';
import { generateMatches, MATCH_COUNT, msList, notes } from './fixture.js';

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
  it('メモの敵機は日付の新しい順で先頭の試合の相手にいて、種類は enemy 3・date 1・free 1・ピン1', () => {
    var top = generateMatches().sort(function (a, b) { return a.date < b.date ? 1 : -1; })[0];
    assert.strictEqual(top.opponent1_ms, 'ストームレイダー');
    var ns = notes();
    ns.filter(function (n) { return n.kind === 'enemy'; }).forEach(function (n) {
      assert.ok([top.opponent1_ms, top.opponent2_ms].includes(n.enemy_ms), n.enemy_ms);
    });
    var count = function (k) { return ns.filter(function (n) { return n.kind === k; }).length; };
    assert.deepEqual([count('enemy'), count('date'), count('free')], [3, 1, 1]);
    assert.equal(ns.filter(function (n) { return n.pinned; }).length, 1);
    assert.ok(ns.some(function (n) { return n.my_ms; }));
    assert.equal(new Set(ns.map(function (n) { return n.id; })).size, ns.length);
  });
});
