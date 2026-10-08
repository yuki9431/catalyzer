import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  PATTERNS, findPattern, goalPattern, testPattern, patternLabel, patternHits, patternNote, patternReason, fmtSec,
} from '../analysis/patterns.js';

function death(t) { return { action: 'death', action_start_sec: t, action_end_sec: 0 }; }
function burst(s, e) { return { action: 'exbst-f', action_start_sec: s, action_end_sec: e }; }
function ex(s, e) { return { action: 'ex', action_start_sec: s, action_end_sec: e }; }

function makeMatch(overrides) {
  return Object.assign({
    date: '2025-06-15 14:30', win: false, ms_cost: 3000,
    dmg_given: 1000, dmg_taken: 800, deaths: 1, ex_dmg: 150, bursts: 1,
    actions: [], partner_actions: [], opponent1_actions: [], opponent2_actions: [],
  }, overrides);
}

// key ごとに 当てはまる(t) / 当てはまらない(f) / 判定不能(n) の試合を1つずつ。n が無い定義は null を返さない
var CASES = [
  { key: 'burst', t: { actions: [death(30)] }, f: { actions: [burst(10, 20), death(30)] }, n: {} },
  { key: 'held_burst', t: { actions: [ex(10, 50), death(30)] }, f: { actions: [ex(10, 20), death(30)] }, n: {} },
  { key: 'consecutive_fall', t: { actions: [death(30)], partner_actions: [death(40)] }, f: { actions: [death(30)], partner_actions: [death(100)] }, n: { actions: [burst(1, 2)] } },
  { key: 'burst_death', t: { actions: [burst(10, 20), death(15)] }, f: { actions: [burst(10, 20), death(50)] }, n: { actions: [death(30)] } },
  { key: 'fall_first', t: { actions: [death(30)], partner_actions: [death(40)] }, f: { actions: [death(50)], partner_actions: [death(40)] }, n: {} },
  { key: 'fall_second', t: { actions: [death(50)], partner_actions: [death(40)] }, f: { actions: [death(30)], partner_actions: [death(40)] }, n: { actions: [burst(1, 2)], partner_actions: [death(40)] } },
  { key: 'dmg_behind', t: { dmg_given: 100, dmg_taken: 200 }, f: { dmg_given: 300, dmg_taken: 200 }, n: { dmg_given: undefined } },
  { key: 'deaths', t: { deaths: 2 }, f: { deaths: 1 }, n: { ms_cost: 0 } },
  { key: 'dmg_taken', line: 800, t: { dmg_taken: 900 }, f: { dmg_taken: 800 } },
  { key: 'dmg_given', line: 1000, t: { dmg_given: 900 }, f: { dmg_given: 1000 } },
  { key: 'burst_count', line: 2, t: { bursts: 1, actions: [death(5)] }, f: { bursts: 2, actions: [death(5)] }, n: { bursts: 0 } },
  { key: 'ex_dmg', line: 200, t: { bursts: 1, ex_dmg: 100 }, f: { bursts: 1, ex_dmg: 200 }, n: { bursts: 0 } },
];

describe('PATTERNS', function () {
  it('covers all 12 definitions with unique keys', function () {
    assert.equal(PATTERNS.length, 12);
    assert.equal(new Set(PATTERNS.map(function (p) { return p.key; })).size, 12);
    assert.deepEqual(CASES.map(function (c) { return c.key; }).sort(), PATTERNS.map(function (p) { return p.key; }).sort());
  });

  it('lists the sheet items in the specified order', function () {
    var labels = PATTERNS.filter(function (p) { return p.sheet; }).map(function (p) { return patternLabel({ key: p.key }); });
    assert.deepEqual(labels, ['1機目で覚醒せず落ちた', '覚醒を抱えたまま落ちた', '順落ちした', '覚醒中に撃墜された', '先落ちした', '後落ちした', '与ダメが被ダメを下回った']);
  });

  CASES.forEach(function (c) {
    var cond = { key: c.key, line: c.line };
    it(c.key + ': true / false / null', function () {
      assert.equal(testPattern(cond, makeMatch(c.t)), true);
      assert.equal(testPattern(cond, makeMatch(c.f)), false);
      if (c.n) assert.equal(testPattern(cond, makeMatch(c.n)), null);
    });
  });

  it('line patterns are invalid without a finite line', function () {
    assert.equal(testPattern({ key: 'dmg_taken' }, makeMatch({ dmg_taken: 9999 })), null);
    assert.equal(testPattern({ key: 'dmg_given', line: Infinity }, makeMatch()), null);
    assert.equal(testPattern(null, makeMatch()), null);
    assert.equal(testPattern({ key: 'valueOf' }, makeMatch()), null);
  });
});

describe('held_burst boundary (start < t <= end)', function () {
  function held(exs, t) { return testPattern({ key: 'held_burst' }, makeMatch({ actions: exs.concat([death(t)]) })); }
  it('death at end is held', function () { assert.equal(held([ex(10, 50)], 50), true); });
  it('death at start is not held', function () { assert.equal(held([ex(10, 50)], 10), false); });
  it('death inside is held', function () { assert.equal(held([ex(10, 50)], 30), true); });
  it('absorbs float noise at the end', function () { assert.equal(held([ex(41.75, 57.48)], 57.480000001), true); });
  it('no ex interval is not held', function () { assert.equal(held([], 30), false); });
});

describe('goalPattern', function () {
  it('maps fall_order by avoid', function () {
    assert.deepEqual(goalPattern({ key: 'fall_order', avoid: 'first' }), { key: 'fall_first' });
    assert.deepEqual(goalPattern({ key: 'fall_order', avoid: 'second' }), { key: 'fall_second' });
    assert.equal(goalPattern({ key: 'fall_order' }), null);
  });
  it('passes goal keys and line values, rejects the rest', function () {
    assert.deepEqual(goalPattern({ key: 'burst' }), { key: 'burst' });
    assert.deepEqual(goalPattern({ key: 'dmg_given', line: 1500 }), { key: 'dmg_given', line: 1500 });
    assert.equal(goalPattern({ key: 'dmg_given', line: Infinity }), null);
    assert.equal(goalPattern({ key: 'dmg_given' }), null);
    assert.equal(goalPattern({ key: 'fall_first' }), null);
    assert.equal(goalPattern({ key: 'held_burst' }), null);
    assert.equal(goalPattern({ key: 'valueOf' }), null);
    assert.equal(goalPattern(null), null);
    assert.equal(findPattern('valueOf'), null);
  });
});

describe('hits / note / reason', function () {
  it('formats seconds', function () {
    assert.equal(fmtSec(52.3), '0:52');
    assert.equal(fmtSec(125), '2:05');
  });
  it('burst: first death, note and reason', function () {
    var m = makeMatch({ actions: [death(52.3), death(100)] });
    var cond = { key: 'burst' };
    assert.deepEqual(patternHits(cond, m).map(function (h) { return h.action_start_sec; }), [52.3]);
    assert.equal(patternNote(cond, m), '覚醒を使う前に 0:52 で撃墜されています');
    assert.equal(patternReason(cond, m), '撃墜 0:52');
  });
  it('held_burst: lists every held death', function () {
    var m = makeMatch({ actions: [ex(10, 50), death(20), death(40), death(90)] });
    assert.equal(patternReason({ key: 'held_burst' }, m), '撃墜 0:20・0:40');
  });
  it('no hits when the pattern does not apply', function () {
    var m = makeMatch({ actions: [burst(10, 20), death(30)] });
    assert.deepEqual(patternHits({ key: 'burst' }, m), []);
    assert.equal(patternNote({ key: 'burst' }, m), '');
    assert.equal(patternReason({ key: 'burst' }, m), '');
  });
  it('numeric patterns use their reason text; deaths falls back to the count', function () {
    assert.equal(patternReason({ key: 'dmg_given', line: 1500 }, makeMatch({ dmg_given: 900 })), '与ダメ 900');
    assert.equal(patternReason({ key: 'dmg_behind' }, makeMatch({ dmg_given: 100, dmg_taken: 200 })), '与ダメ 100・被ダメ 200');
    assert.equal(patternReason({ key: 'deaths' }, makeMatch({ deaths: 2 })), '被撃墜 2回');
    assert.equal(patternReason({ key: 'deaths' }, makeMatch({ deaths: 2, actions: [death(20), death(60)] })), '撃墜 1:00');
    assert.equal(patternNote({ key: 'deaths' }, makeMatch({ deaths: 2, actions: [death(20), death(60)] })), '1:00 の撃墜でコストオーバーしています');
  });
  it('labels', function () {
    assert.equal(patternLabel({ key: 'dmg_given', line: 1500 }), '与ダメ1500未満');
    assert.equal(patternLabel({ key: 'nope' }), '');
  });
});
