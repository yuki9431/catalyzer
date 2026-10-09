import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  PATTERNS, findPattern, goalPattern, testPattern, patternLabel, patternHits, patternNote, patternReason, fmtSec,
} from '../analysis/patterns.js';

function death(t) { return { action: 'death', action_start_sec: t, action_end_sec: 0 }; }
function burst(s, e) { return { action: 'exbst-f', action_start_sec: s, action_end_sec: e }; }
function ov(s, e) { return { action: 'exbst-ov', action_start_sec: s, action_end_sec: e }; }
function ex(s, e) { return { action: 'ex', action_start_sec: s, action_end_sec: e }; }

function makeMatch(overrides) {
  return Object.assign({
    date: '2025-06-15 14:30', win: false, ms_cost: 3000, partner_cost: 3000,
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
  { key: 'ov_solo', t: { actions: [burst(10, 20), ov(30, 40)] }, f: { actions: [burst(10, 20), ov(15, 25)] }, n: { actions: [burst(10, 20)] } },
  { key: 'last_cost_burst', t: { actions: [death(30)] }, f: { actions: [death(30), ex(20, 60)] }, n: { actions: [burst(1, 2)] } },
  { key: 'fall_first', t: { actions: [death(30)], partner_actions: [death(40)] }, f: { actions: [death(50)], partner_actions: [death(40)] }, n: {} },
  { key: 'fall_second', t: { actions: [death(50)], partner_actions: [death(40)] }, f: { actions: [death(30)], partner_actions: [death(40)] }, n: { actions: [burst(1, 2)], partner_actions: [death(40)] } },
  { key: 'fall_first_one_burst', t: { actions: [burst(1, 2), death(30)], partner_actions: [death(40)] }, f: { actions: [burst(1, 2), death(50)], partner_actions: [death(40)] }, n: {} },
  { key: 'dmg_behind', t: { dmg_given: 100, dmg_taken: 200 }, f: { dmg_given: 300, dmg_taken: 200 }, n: { dmg_given: undefined } },
  { key: 'deaths', t: { deaths: 2 }, f: { deaths: 1 }, n: { ms_cost: 0 } },
  { key: 'dmg_taken', line: 800, t: { dmg_taken: 900 }, f: { dmg_taken: 800 }, n: { dmg_taken: undefined } },
  { key: 'dmg_given', line: 1000, t: { dmg_given: 900 }, f: { dmg_given: 1000 }, n: { dmg_given: undefined } },
  { key: 'burst_count', line: 2, t: { bursts: 1, actions: [death(5)] }, f: { bursts: 2, actions: [death(5)] }, n: { bursts: 0 } },
  { key: 'ex_dmg', line: 200, t: { bursts: 1, ex_dmg: 100 }, f: { bursts: 1, ex_dmg: 200 }, n: { bursts: 0 } },
];

describe('PATTERNS', function () {
  it('covers all 15 definitions with unique keys', function () {
    assert.equal(PATTERNS.length, 15);
    assert.equal(new Set(PATTERNS.map(function (p) { return p.key; })).size, 15);
    assert.deepEqual(CASES.map(function (c) { return c.key; }).sort(), PATTERNS.map(function (p) { return p.key; }).sort());
  });

  it('lists the sheet items in the specified order', function () {
    var labels = PATTERNS.filter(function (p) { return p.sheet; }).map(function (p) { return patternLabel({ key: p.key }); });
    assert.deepEqual(labels, ['1機目で覚醒せず落ちた', '覚醒を抱えたまま落ちた', '順落ちした', '覚醒中に撃墜された', 'オーバーリミットを覚醒と重ねずに使った', '最後のコストで覚醒が無かった', '先落ちした', '後落ちした', '先落ちして覚醒1回', '与ダメが被ダメを下回った']);
  });

  CASES.forEach(function (c) {
    var cond = { key: c.key, line: c.line };
    it(c.key + ': true / false / null', function () {
      assert.equal(testPattern(cond, makeMatch(c.t)), true);
      assert.equal(testPattern(cond, makeMatch(c.f)), false);
      assert.equal(testPattern(cond, makeMatch(c.n)), null);
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
  // 実データ: 撃墜で溜まったゲージの区間は撃墜の直後に始まり、使わなければ試合終了まで続く
  it('real data: interval opened by the death is not held', function () { assert.equal(held([ex(68.42, 92)], 68.4), false); });
  it('real data: finishing death at game end while holding is held', function () { assert.equal(held([ex(68.42, 92)], 92), true); });
  // 実データ: 試合終了時刻は秒で切り捨てられ、試合を終わらせた撃墜はその1秒以内に記録される
  function heldAtEnd(t) { return testPattern({ key: 'held_burst' }, makeMatch({ game_end_sec: 170, actions: [ex(135.03, 170), death(t)] })); }
  it('real data: finishing death just after the truncated game end is held', function () { assert.equal(heldAtEnd(170.52), true); });
  it('a death more than 1s after the game end is not held', function () { assert.equal(heldAtEnd(171.01), false); });
});

describe('fall_first_one_burst', function () {
  function one(bursts) { return testPattern({ key: 'fall_first_one_burst' }, makeMatch({ actions: bursts.concat([death(30)]), partner_actions: [death(40)] })); }
  it('is true only with exactly one burst', function () {
    assert.equal(one([burst(1, 2)]), true);
    assert.equal(one([]), false);
    assert.equal(one([burst(1, 2), burst(5, 8)]), false);
  });
  it('is not a mission goal and reports the first death', function () {
    assert.equal(goalPattern({ key: 'fall_first_one_burst' }), null);
    var m = makeMatch({ actions: [burst(1, 2), death(52.3)], partner_actions: [death(70)] });
    assert.equal(patternNote({ key: 'fall_first_one_burst' }, m), '0:52 で先に撃墜され、覚醒は1回でした');
    assert.equal(patternReason({ key: 'fall_first_one_burst' }, m), '撃墜 0:52');
  });
});

describe('ov_solo boundary (overlap > 0)', function () {
  function solo(ovs) { return testPattern({ key: 'ov_solo' }, makeMatch({ actions: [burst(10, 20)].concat(ovs) })); }
  it('touching the burst is not an overlap', function () {
    assert.equal(solo([ov(20, 30)]), true);
    assert.equal(solo([ov(5, 10)]), true);
  });
  it('overlapping by 0.01s is an overlap', function () {
    assert.equal(solo([ov(19.99, 30)]), false);
    assert.equal(solo([ov(5, 10.01)]), false);
  });
  it('absorbs float noise at the touching edge', function () {
    assert.equal(solo([ov(20.000000001, 30)]), true);
  });
  it('is false when any activation overlaps; hits are the non-overlapping ones', function () {
    var a = ov(30, 40), b = ov(15, 25);
    var m = makeMatch({ actions: [burst(10, 20), a, b] });
    assert.equal(testPattern({ key: 'ov_solo' }, m), false);
    assert.equal(patternHits({ key: 'ov_solo' }, makeMatch({ actions: [burst(10, 20), a] }))[0], a);
  });
  it('note and reason use the OL wording', function () {
    var m = makeMatch({ actions: [ov(52.3, 60), ov(100, 110)] });
    assert.equal(patternNote({ key: 'ov_solo' }, m), 'オーバーリミットを 0:52 に覚醒なしで発動しています');
    assert.equal(patternReason({ key: 'ov_solo' }, m), 'OL発動 0:52・1:40');
  });
});

describe('last_cost_burst', function () {
  function lcb(actions, extra) { return testPattern({ key: 'last_cost_burst' }, makeMatch(Object.assign({ actions: actions }, extra))); }
  it('burst boundary: start <= t + 2s counts as held, end > t', function () {
    assert.equal(lcb([death(30), ex(32, 60)]), false);
    assert.equal(lcb([death(30), ex(32.01, 60)]), true);
    assert.equal(lcb([ex(10, 30), death(30)]), true);
    assert.equal(lcb([ex(10, 30.01), death(30)]), false);
    assert.equal(lcb([death(30), burst(31, 40)]), false);
  });
  it('is null when the team cost goes to 0 without entering the last cost', function () {
    assert.equal(lcb([death(30), death(60)], { ms_cost: 3000, partner_cost: 1500 }), null);
  });
  it('is null when the last cost was never entered or costs are unknown', function () {
    assert.equal(lcb([death(30)], { ms_cost: 1500, partner_cost: 1500 }), null);
    assert.equal(lcb([death(30)], { partner_cost: 0 }), null);
    assert.equal(lcb([death(30)], { partner_cost: undefined }), null);
  });
  it('enters on the first fall by either player and highlights that action', function () {
    var pd = death(50);
    var m = makeMatch({ ms_cost: 2000, partner_cost: 3000, actions: [death(20), death(90)], partner_actions: [pd] });
    // 6000-2000=4000 > 2000, 4000-3000=1000 <= 2000 → 僚機の撃墜
    assert.equal(patternHits({ key: 'last_cost_burst' }, m)[0], pd);
    assert.equal(patternNote({ key: 'last_cost_burst' }, m), '0:50 に最後のコストに入りました。覚醒は使える状態ではありませんでした');
    assert.equal(patternReason({ key: 'last_cost_burst' }, m), '最後のコスト 0:50');
  });
  describe('(b) gauge filled and fell within 3.5s without bursting', function () {
    // t=30 で最後のコストに入り、そのとき覚醒は有る(100-200 の ex)。後の撃墜 90 が b の対象になるかを見る
    function fresh(exStart, extra) {
      return lcb([ex(10, 200), death(30), ex(exStart, 200), death(90)].concat(extra || []));
    }
    it('is true by (b) alone even when a burst was available at t', function () {
      assert.equal(lcb([ex(10, 40), death(30), ex(88, 200), death(90)]), true);
      assert.equal(lcb([ex(10, 40), death(30), death(90)]), false);
    });
    it('d - start of exactly 3.5s is included, 3.51s is not', function () {
      assert.equal(lcb([ex(10, 200), death(30), ex(86.5, 200), death(90)]), true);
      assert.equal(lcb([ex(10, 200), death(30), ex(86.49, 200), death(90)]), false);
    });
    it('is false when a burst was activated between the start and d', function () {
      assert.equal(fresh(88, [burst(89, 89.5)]), false);
      assert.equal(fresh(88, [burst(88, 89)]), false);
      assert.equal(lcb([ex(10, 200), death(30), ex(88, 200), burst(91, 95), death(90)]), true);
    });
    it('a burst activated before the gauge filled does not block (b)', function () {
      assert.equal(lcb([ex(10, 40), burst(15, 25), death(30), ex(88, 200), death(90)]), true);
    });
    it('ignores deaths before t and the entry death itself', function () {
      assert.equal(lcb([ex(10, 20), ex(28, 200), death(30)]), false);
    });
    it('the end boundary follows the held-burst rule (death just after game end)', function () {
      assert.equal(lcb([ex(10, 40), death(30), ex(168, 170), death(170.5)], { game_end_sec: 170 }), true);
      assert.equal(lcb([ex(10, 40), death(30), ex(168, 170), death(171.01)], { game_end_sec: 170 }), false);
    });
    it('hits are the entry plus the (b) deaths, entry first', function () {
      var entry = death(30), d = death(90);
      var m = makeMatch({ actions: [ex(10, 25), entry, ex(88, 200), d] });
      assert.deepEqual(patternHits({ key: 'last_cost_burst' }, m), [entry, d]);
      assert.equal(patternReason({ key: 'last_cost_burst' }, m), '最後のコスト 0:30');
    });
  });
  it('orders falls by time across both players', function () {
    var md = death(10);
    var m = makeMatch({ ms_cost: 1500, partner_cost: 3000, actions: [death(60)], partner_actions: [md] });
    // 僚機 3000 → 残り 3000 > floor 1500、自分 1500 → 1500 <= 1500
    assert.equal(patternHits({ key: 'last_cost_burst' }, m)[0].action_start_sec, 60);
  });
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
    assert.deepEqual(goalPattern({ key: 'ov_solo' }), { key: 'ov_solo' });
    assert.deepEqual(goalPattern({ key: 'last_cost_burst' }), { key: 'last_cost_burst' });
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
