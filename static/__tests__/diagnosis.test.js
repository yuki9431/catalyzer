import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildDiagnosisInput, MIN_MATCHES } from '../analysis/diagnosis.js';
import { generateMatches } from '../../tools/ui-check/fixture.js';

var SAMPLE = JSON.parse(fs.readFileSync(new URL('../../internal/aidiagnosis/prompt/sample_input.json', import.meta.url), 'utf8'));
var NOW = new Date('2026-06-16T12:00:00+09:00');
var BASE = generateMatches();

// 型を問わず、キーのパス(配列は [])を全部集める
function paths(v, prefix, out) {
  if (Array.isArray(v)) { v.forEach(function (x) { paths(x, prefix + '[]', out); }); return out; }
  if (v && typeof v === 'object') {
    Object.keys(v).forEach(function (k) { var p = prefix ? prefix + '.' + k : k; out.add(p); paths(v[k], p, out); });
  }
  return out;
}
function strings(v, out) {
  if (typeof v === 'string') out.push(v);
  else if (Array.isArray(v)) v.forEach(function (x) { strings(x, out); });
  else if (v && typeof v === 'object') Object.keys(v).forEach(function (k) { strings(v[k], out); });
  return out;
}
function many(n) {
  var out = [];
  for (var i = 0; i < n; i++) {
    var d = new Date(Date.UTC(2020, 0, 1) + i * 3600e3);
    var date = d.toISOString().slice(0, 10) + ' ' + d.toISOString().slice(11, 16);
    out.push(Object.assign({}, BASE[i % BASE.length], { date: date, win: i % 3 !== 0 }));
  }
  return out;
}

var ENUMS = new Set(['deaths', 'fall_first', 'fall_second', 'burst', 'dmg_taken', 'dmg_given', 'consecutive_fall', 'burst_death', 'ov_solo', 'last_cost_burst', 'burst_count', 'ex_dmg', 'bursts']);
var MS_NAMES = new Set();
BASE.forEach(function (m) { [m.ms, m.opponent1_ms, m.opponent2_ms].forEach(function (x) { if (x) MS_NAMES.add(x); }); });

describe('buildDiagnosisInput', function () {
  it('10戦未満は null、10戦で作る', function () {
    assert.equal(MIN_MATCHES, 10);
    assert.equal(buildDiagnosisInput([], NOW), null);
    assert.equal(buildDiagnosisInput(undefined, NOW), null);
    assert.equal(buildDiagnosisInput(BASE.slice(0, 9), NOW), null);
    assert.equal(buildDiagnosisInput(BASE.slice(0, 10), NOW).sample.matches, 10);
  });

  it('出力の全キーのパスが sample_input.json のキーのパスの集合に含まれる', function () {
    var allowed = paths(SAMPLE, '', new Set());
    [BASE, many(500), BASE.slice(0, 10)].forEach(function (ms) {
      var got = paths(buildDiagnosisInput(ms, NOW), '', new Set());
      assert.deepEqual(Array.from(got).filter(function (p) { return !allowed.has(p); }), []);
    });
  });

  it('fixture の60試合は主要な項目が全部入る', function () {
    var got = buildDiagnosisInput(BASE, NOW);
    assert.equal(got.v, 1);
    assert.equal(got.sample.matches, 60);
    assert.ok(got.actions.length > 0 && got.actions.length <= 5);
    assert.ok(got.my_ms.length > 0 && got.my_ms.length <= 3);
    assert.ok(got.last_day && got.last_day.matches > 0);
  });

  it('known を渡すと未知の機体名を my_ms・strong_enemies・weak_enemy から落とす(空・未指定は絞らない)', function () {
    var ms = many(500);
    var base = buildDiagnosisInput(ms, NOW);
    var keep = base.my_ms[0].ms;
    var got = buildDiagnosisInput(ms, NOW, new Set([keep]));
    assert.deepEqual(got.my_ms.map(function (e) { return e.ms; }), [keep]);
    got.strong_enemies.forEach(function (e) { assert.equal(e.ms, keep); });
    assert.equal(got.weak_enemy && got.weak_enemy.ms !== keep ? 'leak' : 'ok', 'ok');
    assert.deepEqual(buildDiagnosisInput(ms, NOW, new Set(['__none__'])).my_ms, []);
    assert.equal(buildDiagnosisInput(ms, NOW, new Set(['__none__'])).weak_enemy, null);
    assert.deepEqual(buildDiagnosisInput(ms, NOW, new Set()), base);
  });

  it('min を渡すとその試合数未満は null', function () {
    assert.equal(buildDiagnosisInput(BASE.slice(0, 12), NOW, null, 15), null);
    assert.equal(buildDiagnosisInput(BASE.slice(0, 15), NOW, null, 15).sample.matches, 15);
  });

  it('actions は key 規則(line は4種だけ)・差を先に計算・個数の整合を満たす', function () {
    var withLine = ['dmg_taken', 'dmg_given', 'burst_count', 'ex_dmg'];
    var seen = new Set();
    [BASE, many(500)].forEach(function (ms) {
      buildDiagnosisInput(ms, NOW).actions.forEach(function (a) {
        assert.ok(ENUMS.has(a.key) && a.key !== 'bursts', a.key);
        assert.notEqual(a.key, 'fall_order');
        assert.equal('line' in a, withLine.includes(a.key), a.key);
        assert.equal(a.gap, a.good_win_rate - a.bad_win_rate);
        assert.ok(a.bad_matches >= 1 && a.bad_matches <= a.total && a.total <= ms.length);
        assert.ok(!seen.has(a.key + ms.length), '重複');
        seen.add(a.key + ms.length);
      });
    });
  });

  it('weak_enemy・after_streak・recent の差は先に計算される', function () {
    var got = buildDiagnosisInput(many(500), NOW);
    ['weak_enemy', 'after_streak'].forEach(function (k) {
      if (got[k]) assert.equal(got[k].gap, got[k].other_win_rate - got[k].win_rate, k);
    });
    if (got.recent) {
      assert.ok(Math.abs(got.recent.diff - (got.recent.win_rate - got.recent.before_win_rate)) < 1e-9);
      got.recent.worsened.forEach(function (w) {
        assert.ok(['dmg_given', 'dmg_taken', 'deaths', 'bursts'].includes(w.metric));
        // recent/before は桁を丸めた値(与ダメ・被ダメは整数)なので、差とは丸め幅だけずれうる。fixture のダメージは範囲(10000)を超えて切り詰められるので除く
        if (w.recent >= 10000 || w.before >= 10000) return;
        assert.ok(Math.abs(w.delta - (w.recent - w.before)) <= 1);
      });
    }
  });

  it('last_day の prev_* と win_rate_diff は3つ揃って有るか無いか', function () {
    var withPrev = buildDiagnosisInput(BASE, NOW).last_day;
    assert.ok('prev_matches' in withPrev && 'prev_win_rate' in withPrev && 'win_rate_diff' in withPrev);
    var oneDay = BASE.slice(0, 12).map(function (m) { return Object.assign({}, m, { date: '2026-06-10 ' + m.date.slice(11) }); });
    var alone = buildDiagnosisInput(oneDay, NOW).last_day;
    assert.ok(!('prev_matches' in alone) && !('prev_win_rate' in alone) && !('win_rate_diff' in alone));
  });

  it('全ての文字列値は enum のキーか、試合データの機体名だけ(個人情報・日付・自然文なし)', function () {
    [BASE, many(500)].forEach(function (ms) {
      var all = strings(buildDiagnosisInput(ms, NOW), []);
      assert.ok(all.length > 0);
      all.forEach(function (s) { assert.ok(ENUMS.has(s) || MS_NAMES.has(s), '想定外の文字列: ' + s); });
    });
  });

  it('個人情報を載せない: @ も日付も出力に無い(試合に混ぜた個人情報も出ない)', function () {
    var dirty = BASE.map(function (m) { return Object.assign({}, m, { name: 'taro@example.com', username: 'bnid-12345', partner_name: 'ひみつ', opponent1_name: '2026-06-01' }); });
    var text = JSON.stringify(buildDiagnosisInput(dirty, NOW));
    assert.ok(!text.includes('@'));
    assert.ok(!/\d{4}-\d{2}-\d{2}/.test(text));
    assert.ok(!text.includes('ひみつ') && !text.includes('bnid'));
    assert.ok(!/\d{4}-\d{2}-\d{2}/.test(JSON.stringify(buildDiagnosisInput(BASE, NOW))));
  });

  it('5000試合の合成データでも 8192 byte 未満', function () {
    var got = buildDiagnosisInput(many(5000), NOW);
    assert.equal(got.sample.matches, 5000);
    assert.ok(Buffer.byteLength(JSON.stringify(got)) < 8192);
  });

  it('桁と範囲: 勝率は小数1桁・kills/deaths/効率は小数2桁・actions は5件以内', function () {
    var digits = function (v, n) { return Math.abs(v * Math.pow(10, n) - Math.round(v * Math.pow(10, n))) < 1e-6; };
    var got = buildDiagnosisInput(many(777), NOW);
    assert.ok(digits(got.sample.win_rate, 1));
    ['kills', 'deaths', 'dmg_efficiency'].forEach(function (k) { assert.ok(digits(got.basic[k], 2), k); });
    ['dmg_given', 'dmg_taken', 'ex_dmg'].forEach(function (k) { assert.ok(Number.isInteger(got.basic[k]), k); });
    got.my_ms.concat(got.strong_enemies).forEach(function (e) { assert.ok(digits(e.win_rate, 1)); });
    assert.ok(got.actions.length <= 5);
    assert.ok(got.sample.wins <= got.sample.matches);
  });
});
