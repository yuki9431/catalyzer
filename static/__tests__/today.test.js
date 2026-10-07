import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { compareToday, currentPlayDay, playDay } from '../analysis/today.js';

function m(date, o) {
  return Object.assign({ date: date, win: true, ms: 'ガンダム', dmg_given: 1000, dmg_taken: 800, ex_dmg: 200, deaths: 1 }, o);
}
var NOW = new Date('2026-10-08T22:00:00');

describe('playDay / currentPlayDay', function () {
  it('朝5時より前は前日のプレイ日に入る', function () {
    assert.equal(playDay('2026-10-08 04:59'), '2026-10-07');
    assert.equal(playDay('2026-10-08 05:00'), '2026-10-08');
    assert.equal(playDay('2026-10-01 00:30'), '2026-09-30');
    assert.equal(currentPlayDay(new Date('2026-10-08T03:00:00')), '2026-10-07');
    assert.equal(currentPlayDay(NOW), '2026-10-08');
  });
});

describe('compareToday', function () {
  it('今日を前回プレイした日と比べ、深夜の試合は前日に数える', function () {
    var ms = [
      m('2026-10-08 20:00', { win: true, dmg_given: 1200, dmg_taken: 600, deaths: 1 }),
      m('2026-10-08 21:00', { win: false, dmg_given: 800, dmg_taken: 1000, deaths: 3 }),
      m('2026-10-07 01:00', { win: false, dmg_given: 900, dmg_taken: 900, deaths: 2 }),
      m('2026-10-06 20:00', { win: true, dmg_given: 1100, dmg_taken: 700, deaths: 1 }),
      m('2026-10-04 20:00'),
    ];
    var c = compareToday(ms, NOW);
    assert.equal(c.day, '2026-10-08');
    assert.equal(c.is_today, true);
    assert.equal(c.prev_day, '2026-10-06');
    assert.deepEqual(c.today, { matches: 2, wins: 1, losses: 1 });
    assert.deepEqual(c.prev, { matches: 2, wins: 1, losses: 1 });
    var byKey = {};
    c.metrics.forEach(function (x) { byKey[x.key] = x; });
    assert.deepEqual([byKey.dmg_given.prev, byKey.dmg_given.today, byKey.dmg_given.better], [1000, 1000, null]);
    assert.deepEqual([byKey.dmg_taken.prev, byKey.dmg_taken.today, byKey.dmg_taken.diff, byKey.dmg_taken.better], [800, 800, 0, null]);
    assert.deepEqual([byKey.deaths.prev, byKey.deaths.today, byKey.deaths.better], [1.5, 2, false]);
    assert.deepEqual([byKey.dmg_efficiency.prev, byKey.dmg_efficiency.today], [1.25, 1.25]);
  });

  it('被ダメと被撃墜は減ると良い、それ以外は増えると良い', function () {
    var ms = [m('2026-10-08 20:00', { dmg_taken: 500, deaths: 0, dmg_given: 1500 }), m('2026-10-06 20:00')];
    var better = {};
    compareToday(ms, NOW).metrics.forEach(function (x) { better[x.key] = x.better; });
    assert.deepEqual(better, { win_rate: null, dmg_given: true, dmg_taken: true, dmg_efficiency: true, ex_dmg: null, deaths: true });
  });

  it('今日の試合が無ければ最後に遊んだ日をその前の日と比べる', function () {
    var c = compareToday([m('2026-10-06 20:00'), m('2026-10-04 20:00'), m('2026-10-04 21:00')], NOW);
    assert.deepEqual([c.day, c.is_today, c.prev_day, c.prev.matches], ['2026-10-06', false, '2026-10-04', 2]);
  });

  it('比べる日が無ければ metrics は null、試合が無ければ null', function () {
    var c = compareToday([m('2026-10-08 20:00')], NOW);
    assert.equal(c.metrics, null);
    assert.equal(c.prev, null);
    assert.equal(compareToday([], NOW), null);
  });

  it('未来の日付の試合は数えない', function () {
    var c = compareToday([m('2026-10-09 20:00'), m('2026-10-08 20:00')], NOW);
    assert.equal(c.today.matches, 1);
  });

  it('機体の内訳を試合数の多い順に返す', function () {
    var ms = [m('2026-10-08 20:00', { ms: 'ザク', win: false }), m('2026-10-08 20:10'), m('2026-10-08 20:20')];
    assert.deepEqual(compareToday(ms, NOW).by_ms, [{ ms: 'ガンダム', matches: 2, wins: 2 }, { ms: 'ザク', matches: 1, wins: 0 }]);
  });
});
