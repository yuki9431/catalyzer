import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { winStreaks, streakKey, streakLabel, STREAK_MAX } from '../lib/match.js';

function m(time, win, extra) {
  return Object.assign({ date: '2026-06-20 ' + time, win: win, partner_name: '相方A', mode: 'fixed' }, extra);
}

function streaksOf(matches) {
  var map = winStreaks(matches);
  return matches.map(function (x) { return map.get(streakKey(x)); });
}

describe('winStreaks', function () {
  it('公式の値があればそのまま使う', function () {
    // 公式一覧を模した並び。表示の無い勝ちは取得時に1になる
    var ms = [
      m('23:17', true, { partner_name: '相方Z', win_streak: 5 }),
      m('23:20', false, { partner_name: '相方Z' }),
      m('23:26', true, { win_streak: 1 }),
      m('23:29', true, { win_streak: 2 }),
      m('23:32', true, { win_streak: 3 }),
      m('23:35', false),
      m('23:39', true, { win_streak: 1 }),
    ];
    assert.deepEqual(streaksOf(ms), [5, 0, 1, 2, 3, 0, 1]);
  });

  it('公式の値が無い試合は同じ相方との続けての勝ちを数える', function () {
    assert.deepEqual(streaksOf([m('23:26', true), m('23:29', true), m('23:32', true)]), [1, 2, 3]);
  });

  it('負けで数え直す', function () {
    assert.deepEqual(streaksOf([m('23:26', true), m('23:29', false), m('23:32', true)]), [1, 0, 1]);
  });

  it('相方が変わったら途中で降りたとみなし数え直す', function () {
    assert.deepEqual(streaksOf([m('23:26', true), m('23:29', true, { partner_name: '相方B' })]), [1, 1]);
  });

  it('シャッフルは毎試合相方が変わるので相方を見ずに数える', function () {
    var ms = [
      m('23:26', true, { mode: 'shuffle', partner_name: '相方B' }),
      m('23:29', true, { mode: 'shuffle', partner_name: '相方C' }),
      m('23:32', true, { mode: 'shuffle', partner_name: '相方D' }),
    ];
    assert.deepEqual(streaksOf(ms), [1, 2, 3]);
  });

  it('形式不明が混ざるシャッフルは相方で判断する', function () {
    var ms = [m('23:26', true, { mode: 'shuffle', partner_name: '相方B' }), m('23:29', true, { mode: undefined, partner_name: '相方C' })];
    assert.deepEqual(streaksOf(ms), [1, 1]);
  });

  it('対戦形式が変わったら数え直す。形式不明なら相方と間隔だけで判断する', function () {
    assert.deepEqual(streaksOf([m('23:26', true), m('23:29', true, { mode: 'shuffle' })]), [1, 1]);
    assert.deepEqual(streaksOf([m('23:26', true), m('23:29', true, { mode: undefined })]), [1, 2]);
  });

  it('間が10分を超えたら数え直す', function () {
    assert.deepEqual(streaksOf([m('23:00', true), m('23:10', true), m('23:21', true)]), [1, 2, 1]);
  });

  it('日付を跨いでも間隔で判断する', function () {
    var ms = [m('23:58', true), { date: '2026-06-21 00:02', win: true, partner_name: '相方A', mode: 'fixed' }];
    assert.deepEqual(streaksOf(ms), [1, 2]);
  });

  it('10連勝の次は1から数え直す', function () {
    var ms = [];
    for (var i = 0; i < 12; i++) ms.push(m('22:' + String(i * 3).padStart(2, '0'), true));
    assert.deepEqual(streaksOf(ms), [1, 2, 3, 4, 5, 6, 7, 8, 9, STREAK_MAX, 1, 2]);
  });

  it('公式の値の続きを推定で数えられる', function () {
    assert.deepEqual(streaksOf([m('23:26', true, { win_streak: 4 }), m('23:29', true)]), [4, 5]);
  });

  it('入力の並び順によらず日時順で数える', function () {
    var ms = [m('23:32', true), m('23:26', true), m('23:29', true)];
    assert.deepEqual(streaksOf(ms), [3, 1, 2]);
  });

  it('作り直した同じ試合のオブジェクトでも引ける', function () {
    var map = winStreaks([m('23:26', true, { match_id: 'a' }), m('23:29', true, { match_id: 'b' })]);
    assert.equal(map.get(streakKey(m('23:29', true, { match_id: 'b' }))), 2);
  });

  it('空・未定義でも落ちない', function () {
    assert.equal(winStreaks([]).size, 0);
    assert.equal(winStreaks(undefined).size, 0);
  });
});

describe('streakLabel', function () {
  it('2連勝以上だけ表示する', function () {
    assert.equal(streakLabel(0), '');
    assert.equal(streakLabel(1), '');
    assert.equal(streakLabel(undefined), '');
    assert.equal(streakLabel(2), '2連勝');
    assert.equal(streakLabel(10), '10連勝');
  });
});
