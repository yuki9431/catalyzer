import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildSummary } from '../components/report/summary.js';

var BASIC = { matches: 40, wins: 24, losses: 16, win_rate: 60, avg_dmg_given: 1200, avg_dmg_taken: 950, dmg_efficiency: 1.26, avg_ex_dmg: 150, kd_ratio: 1.3, avg_bursts: 1.75 };

function fd(extra) { return Object.assign({ basic_stats: BASIC }, extra); }
function stat(count, rate, win_rate) { return { count: count, rate: rate, win_rate: win_rate }; }
function byLabel(s, label) { return s.items.find(function (i) { return i.label === label; }); }

describe('buildSummary', function () {
  it('基本統計が無ければ null', function () {
    assert.equal(buildSummary('overview', null), null);
    assert.equal(buildSummary('overview', { basic_stats: null }), null);
  });

  it('5タブとも hero ラベルと指標4件を返す', function () {
    var data = fd({
      fall_order: { total: 40, no_fall: stat(10, 25, 80), first_fall: stat(20, 50, 40), second_fall: stat(10, 25, 60), same_time: stat(0, 0, 0) },
      dmg_contribution: { avg_contribution: 55, avg_win_contribution: 58 },
      burst_count: { by_count: [{ count: 0, matches: 4, win_rate: 25 }, { count: 2, matches: 36, win_rate: 70 }] },
      enemy_matchup: { strong: [{ ms: 'A', matches: 5, win_rate: 80 }], weak: [{ ms: 'B', matches: 4, win_rate: 25 }], even: [] },
      partner: [{ ms: 'P', matches: 9, win_rate: 66.7 }],
      time_of_day: { hours: [{ hour: 21, matches: 8, win_rate: 75 }, { hour: 23, matches: 6, win_rate: 33.3 }] },
      day_of_week: { weekday: { matches: 20, win_rate: 55 }, weekend: { matches: 20, win_rate: 65 } },
      daily_trend: { days: [1, 2, 3] },
    });
    var want = { overview: '勝率', playstyle: '先落ち率', burst: '平均覚醒回数', matchup: '得意な敵機 / 苦手な敵機', time: '最も勝率が高い時間帯' };
    Object.keys(want).forEach(function (tab) {
      var s = buildSummary(tab, data);
      assert.equal(s.hero.label, want[tab], tab);
      assert.equal(s.items.length, 4, tab);
    });
  });

  it('overview の指標に目安と tone が付く', function () {
    var s = buildSummary('overview', fd());
    assert.equal(byLabel(s, '平均与ダメージ').sub, '目安 1100 以上');
    assert.equal(byLabel(s, '平均与ダメージ').tone, 'good');
    assert.equal(byLabel(s, '平均被ダメージ').tone, 'bad');
  });

  it('playstyle は先落ち0件で note なし・0落ち0件は - 、K/D の目安を持つ', function () {
    var data = fd({
      fall_order: { total: 10, no_fall: stat(0, 0, 0), first_fall: stat(0, 0, 0), second_fall: stat(10, 100, 50), same_time: stat(0, 0, 0) },
      dmg_contribution: { avg_contribution: 50, avg_win_contribution: 52 },
    });
    var s = buildSummary('playstyle', data);
    assert.equal(s.hero.note, undefined);
    assert.equal(byLabel(s, '0落ち時の勝率').value, '-');
    assert.equal(byLabel(s, 'K/D比').sub, '目安 1.20 以上');
    var withFall = buildSummary('playstyle', fd({ fall_order: { total: 10, no_fall: stat(5, 50, 80), first_fall: stat(5, 50, 40), second_fall: stat(0, 0, 0), same_time: stat(0, 0, 0) } }));
    assert.match(withFall.hero.note, /先落ちした試合の勝率 40\.0%/);
    assert.equal(byLabel(withFall, '0落ち時の勝率').value, '▲ 80.0%');
  });

  it('matchup は最も勝率が低い敵機の機体名を sub に持つ', function () {
    var s = buildSummary('matchup', fd({
      enemy_matchup: { strong: [{ ms: 'A', matches: 5, win_rate: 80 }], weak: [{ ms: 'B', matches: 4, win_rate: 25 }], even: [{ ms: 'C', matches: 3, win_rate: 50 }] },
      partner: [],
    }));
    var worst = byLabel(s, '最も勝率が低い敵機');
    assert.equal(worst.sub, 'B');
    assert.equal(worst.value, '▼ 25.0%');
    assert.equal(s.hero.aside, '3試合以上対戦した 3 機体のうち');
  });
});
