import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { computeActionPlan } from '../analysis/coach.js';

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
    assert.match(death.title, /^2落ちしない/);
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
    assert.match(fo.title, /先に落ちない/);
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

  it('flags the worst enemy with a distance hint when damage taken is high', function () {
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
    var enemy = plan.actions.find(function (a) { return a.key === 'enemy'; });
    assert.ok(enemy, 'enemy action expected');
    assert.equal(enemy.enemy, 'ストライクフリーダム');
    assert.match(enemy.detail, /距離を取り/);
  });

  it('flags matches played right after a losing streak', function () {
    var ms = [];
    // 各日: 負, 負, (連敗直後)負, 負, 勝 のパターン + 勝ちが続く日
    for (var i = 0; i < 25; i++) {
      var pos = i % 5;
      var day = Math.floor(i / 5);
      var win = day % 2 === 0 ? pos === 4 : true;
      ms.push(makeMatch({ date: dateAt(i), win: win }));
    }
    var plan = computeActionPlan(ms);
    assert.ok(keys(plan).indexOf('tilt') >= 0);
  });

  it('returns at most 3 actions sorted by impact', function () {
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
    assert.ok(plan.actions.length <= 3);
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
});
