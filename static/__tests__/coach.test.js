import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { computeActionPlan, evaluateGoal } from '../analysis/coach.js';

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
    bursts: 1,
    actions: [],
    partner_actions: [],
    partner_ms: 'ザク',
    partner_cost: 2000,
    opponent1_ms: 'シャアザク',
    opponent2_ms: 'ゲルググ',
  }, overrides);
}

function dateAt(i) {
  // 1日5試合ずつ、日付・時刻が単調増加するように振る
  var day = 1 + Math.floor(i / 5);
  var min = i % 5;
  return '2025-06-' + String(day).padStart(2, '0') + ' 20:0' + min;
}

function keys(plan) { return plan.actions.map(function (a) { return a.key; }); }

describe('computeActionPlan', function () {
  it('returns insufficient when fewer than 10 matches', function () {
    var plan = computeActionPlan([makeMatch(), makeMatch()]);
    assert.equal(plan.insufficient, true);
    assert.equal(plan.matches, 2);
  });

  it('handles empty/undefined input', function () {
    assert.equal(computeActionPlan(undefined).insufficient, true);
    assert.equal(computeActionPlan([]).matches, 0);
  });

  it('returns no actions when nothing separates wins from losses', function () {
    var ms = [];
    for (var i = 0; i < 20; i++) ms.push(makeMatch({ date: dateAt(i), win: i % 2 === 0 }));
    var plan = computeActionPlan(ms);
    assert.equal(plan.insufficient, undefined);
    assert.equal(plan.win_rate, 50);
    assert.deepEqual(plan.actions, []);
  });

  it('flags cost-over deaths for a 3000 cost MS', function () {
    var ms = [];
    for (var i = 0; i < 20; i++) {
      // 6試合は2落ち(負け)、残りは1落ちで勝ち7割
      var fatal = i < 6;
      ms.push(makeMatch({ date: dateAt(i), deaths: fatal ? 2 : 1, win: fatal ? false : i % 10 !== 9 }));
    }
    var plan = computeActionPlan(ms);
    var death = plan.actions.find(function (a) { return a.key === 'deaths'; });
    assert.ok(death, 'deaths action expected');
    assert.equal(death.title, '被撃墜を1回以内に抑える');
    assert.match(death.detail, /^2回以上撃墜された試合は20戦中6戦（勝率0%）。/);
    // 20戦12勝。2回撃墜の6戦がそれ以外(14戦12勝)並みに勝てれば約17.1勝
    assert.equal(death.win_rate_from, 60);
    assert.equal(death.win_rate_to, 85.7);
    assert.ok(death.impact > 0);
    assert.ok(['high', 'mid', 'low'].indexOf(death.level) >= 0);
  });

  it('flags first-fall when it loses more than second-fall', function () {
    var ms = [];
    for (var i = 0; i < 20; i++) {
      var first = i < 10;
      ms.push(makeMatch({
        date: dateAt(i),
        win: first ? i % 5 === 0 : i % 5 !== 0,
        actions: [{ action: 'death', action_start_sec: first ? 50 : 100 }],
        partner_actions: [{ action: 'death', action_start_sec: first ? 100 : 50 }],
      }));
    }
    var plan = computeActionPlan(ms);
    var fo = plan.actions.find(function (a) { return a.key === 'fall_order'; });
    assert.ok(fo, 'fall_order action expected');
    assert.equal(fo.title, '自分が後落ちする');
    assert.deepEqual(fo.goal, { key: 'fall_order', avoid: 'first' });
    assert.match(fo.condition, /^相方より先に撃墜されない/);
  });

  it('flags holding burst until after the first death', function () {
    var ms = [];
    for (var i = 0; i < 20; i++) {
      var early = i % 2 === 0;
      ms.push(makeMatch({
        date: dateAt(i),
        win: early ? i % 10 !== 0 : i % 10 === 1,
        actions: [
          { action: 'exbst-f', action_start_sec: early ? 30 : 90 },
          { action: 'death', action_start_sec: 60 },
        ],
      }));
    }
    var plan = computeActionPlan(ms);
    assert.ok(keys(plan).indexOf('burst') >= 0);
  });

  it('omits the death-count mission when costs are mixed', function () {
    var ms = [];
    for (var i = 0; i < 20; i++) {
      var fatal = i < 6;
      ms.push(makeMatch({ date: dateAt(i), ms_cost: i % 2 ? 3000 : 2000, deaths: fatal ? 3 : 1, win: !fatal }));
    }
    assert.equal(keys(computeActionPlan(ms)).indexOf('deaths'), -1);
  });

  it('flags consecutive falls within 15 seconds', function () {
    var ms = [];
    for (var i = 0; i < 20; i++) {
      var cf = i < 8;
      ms.push(makeMatch({
        date: dateAt(i),
        win: cf ? i === 0 : i % 6 !== 0,
        actions: [{ action: 'death', action_start_sec: 60 }],
        partner_actions: [{ action: 'death', action_start_sec: cf ? 72 : 120 }],
      }));
    }
    var a = computeActionPlan(ms).actions.find(function (x) { return x.key === 'consecutive_fall'; });
    assert.ok(a, 'consecutive_fall action expected');
    assert.equal(a.title, '順落ちしない');
    assert.match(a.detail, /^順落ちした試合は20戦中8戦/);
  });

  it('flags deaths during burst and burst count / EX damage below win medians', function () {
    var ms = [];
    for (var i = 0; i < 20; i++) {
      var bad = i % 2 === 0;
      ms.push(makeMatch({
        date: dateAt(i),
        win: bad ? i % 10 === 0 : i % 10 !== 1,
        bursts: bad ? 1 : 2,
        ex_dmg: bad ? 100 : 400,
        actions: [
          { action: 'exbst-s', action_start_sec: 50, action_end_sec: bad ? 70 : 62 },
          { action: 'death', action_start_sec: 70 },
        ],
      }));
    }
    var plan = computeActionPlan(ms);
    var ks = keys(plan);
    ['burst_death', 'burst_count', 'ex_dmg'].forEach(function (k) { assert.ok(ks.indexOf(k) >= 0, k); });
    var count = plan.actions.find(function (x) { return x.key === 'burst_count'; });
    assert.equal(count.title, '覚醒を2回以上使う');
    assert.deepEqual(count.goal, { key: 'burst_count', line: 2 });
    var ex = plan.actions.find(function (x) { return x.key === 'ex_dmg'; });
    assert.match(ex.detail, /^覚醒した試合のうちEXダメ400未満は20戦中10戦/);
  });

  it('reports the worst enemy as info, not as a mission', function () {
    var ms = [];
    for (var i = 0; i < 20; i++) {
      var vsEnemy = i < 6;
      ms.push(makeMatch({
        date: dateAt(i),
        opponent1_ms: vsEnemy ? 'ストライクフリーダム' : 'シャアザク',
        dmg_taken: vsEnemy ? 1300 : 800,
        win: vsEnemy ? false : i % 7 !== 0,
      }));
    }
    var plan = computeActionPlan(ms);
    assert.equal(keys(plan).indexOf('enemy'), -1);
    assert.equal(plan.weak_enemy.enemy, 'ストライクフリーダム');
    assert.equal(plan.weak_enemy.matches, 6);
    assert.equal(plan.weak_enemy.win_rate, 0);
    assert.match(plan.weak_enemy.fact, /^被ダメは平均より\d+多い$/);
  });

  it('reports matches right after a 3-loss streak as info, not as a mission', function () {
    var ms = [];
    // 負けが続く日（3連敗後の2試合も負け）と勝ちが続く日を交互に
    for (var i = 0; i < 25; i++) ms.push(makeMatch({ date: dateAt(i), win: Math.floor(i / 5) % 2 === 1 }));
    var plan = computeActionPlan(ms);
    assert.equal(keys(plan).indexOf('tilt'), -1);
    assert.deepEqual(plan.after_streak, { streak: 3, total: 25, matches: 6, win_rate: 0, other_win_rate: 53 });
  });

  it('returns all actions sorted by impact', function () {
    var ms = [];
    for (var i = 0; i < 40; i++) {
      var bad = i % 3 === 0;
      ms.push(makeMatch({
        date: dateAt(i),
        win: !bad,
        deaths: bad ? 2 : 1,
        dmg_taken: bad ? 1200 : 700,
        dmg_given: bad ? 700 : 1100,
        opponent1_ms: bad ? 'ストライクフリーダム' : 'シャアザク',
      }));
    }
    var plan = computeActionPlan(ms);
    assert.deepEqual(keys(plan).slice().sort(), ['deaths', 'dmg_given', 'dmg_taken']);
    for (var j = 1; j < plan.actions.length; j++) {
      assert.ok(plan.actions[j - 1].impact >= plan.actions[j].impact);
    }
  });

  it('reports metrics that worsened in recent matches', function () {
    var ms = [];
    for (var i = 0; i < 40; i++) {
      var recent = i >= 20;
      ms.push(makeMatch({ date: dateAt(i), win: !recent || i % 3 === 0, dmg_taken: recent ? 1000 : 800 }));
    }
    var plan = computeActionPlan(ms);
    assert.equal(plan.recent.matches, 20);
    assert.ok(plan.recent.win_rate < plan.recent.before_win_rate);
    var taken = plan.recent.worsened.find(function (w) { return w.label === '被ダメ'; });
    assert.deepEqual(taken, { label: '被ダメ', recent: 1000, before: 800, delta: 200 });
  });

  it('omits recent trend when there are too few matches', function () {
    var ms = [];
    for (var i = 0; i < 12; i++) ms.push(makeMatch({ date: dateAt(i) }));
    assert.equal(computeActionPlan(ms).recent, null);
  });

  it('discounts outcome metrics (damage) relative to behavioral ones', function () {
    // 被ダメ超過と2落ちが同じ試合で起きる場合、同じ勝率差でも耐久管理(deaths)が上位に来る
    var ms = [];
    for (var i = 0; i < 30; i++) {
      var bad = i % 3 === 0;
      ms.push(makeMatch({ date: dateAt(i), win: !bad, deaths: bad ? 2 : 1, dmg_taken: bad ? 1200 : 700 }));
    }
    var plan = computeActionPlan(ms);
    var death = plan.actions.find(function (a) { return a.key === 'deaths'; });
    var taken = plan.actions.find(function (a) { return a.key === 'dmg_taken'; });
    assert.ok(death && taken);
    assert.ok(Math.abs(taken.impact - death.impact / 2) <= 0.1);
    assert.ok(plan.actions.indexOf(death) < plan.actions.indexOf(taken));
  });

  it('uses percentages only for win rates', function () {
    var ms = [];
    for (var i = 0; i < 40; i++) {
      var bad = i % 3 === 0;
      ms.push(makeMatch({ date: dateAt(i), win: !bad, deaths: bad ? 2 : 1, dmg_taken: bad ? 1200 : 700, dmg_given: bad ? 700 : 1100 }));
    }
    computeActionPlan(ms).actions.forEach(function (a) {
      var pcts = a.detail.match(/\d+%/g) || [];
      var rates = a.detail.match(/勝率\d+%/g) || [];
      assert.equal(pcts.length, rates.length, a.detail);
      assert.doesNotMatch(a.title + a.detail, /落ち/);
    });
  });
});

describe('evaluateGoal', function () {
  it('counts achieved matches and the current streak', function () {
    var ms = [1, 2, 1, 1].map(function (d, i) { return makeMatch({ date: dateAt(i), deaths: d }); });
    assert.deepEqual(evaluateGoal({ key: 'deaths' }, ms), {
      total: 4, achieved: 3, streak: 2,
      marks: [
        { date: dateAt(0), ok: true }, { date: dateAt(1), ok: false },
        { date: dateAt(2), ok: true }, { date: dateAt(3), ok: true },
      ],
    });
  });

  it('judges consecutive falls and deaths during burst per match', function () {
    var cf = makeMatch({ actions: [{ action: 'death', action_start_sec: 60 }], partner_actions: [{ action: 'death', action_start_sec: 75 }] });
    var apart = makeMatch({ actions: [{ action: 'death', action_start_sec: 60 }], partner_actions: [{ action: 'death', action_start_sec: 76 }] });
    var ev = evaluateGoal({ key: 'consecutive_fall' }, [cf, apart]);
    assert.deepEqual(ev.marks.map(function (x) { return x.ok; }), [false, true]);
    // 撃墜で覚醒が終わるため、終了時刻ちょうどの撃墜は覚醒中とみなす
    var inBurst = makeMatch({ actions: [{ action: 'exbst-f', action_start_sec: 50, action_end_sec: 70 }, { action: 'death', action_start_sec: 70 }] });
    var after = makeMatch({ actions: [{ action: 'exbst-f', action_start_sec: 50, action_end_sec: 62 }, { action: 'death', action_start_sec: 70 }] });
    var noBurst = makeMatch({ actions: [{ action: 'death', action_start_sec: 70 }] });
    ev = evaluateGoal({ key: 'burst_death' }, [inBurst, after, noBurst]);
    assert.deepEqual(ev.marks.map(function (x) { return x.ok; }), [false, true]);
  });

  it('excludes matches without burst from the EX damage goal', function () {
    var ms = [makeMatch({ bursts: 0, ex_dmg: 0 }), makeMatch({ bursts: 1, ex_dmg: 250 }), makeMatch({ bursts: 2, ex_dmg: 300 })];
    var ev = evaluateGoal({ key: 'ex_dmg', line: 300 }, ms);
    assert.equal(ev.total, 2);
    assert.equal(ev.achieved, 1);
  });

  it('treats a match without deaths as achieving burst/first-fall goals', function () {
    var m = makeMatch({ deaths: 0, actions: [{ action: 'exbst-f', action_start_sec: 30 }] });
    assert.equal(evaluateGoal({ key: 'burst' }, [m]).achieved, 1);
    assert.equal(evaluateGoal({ key: 'fall_order', avoid: 'first' }, [m]).achieved, 1);
    assert.equal(evaluateGoal({ key: 'fall_order', avoid: 'second' }, [m]).total, 0);
  });
});
