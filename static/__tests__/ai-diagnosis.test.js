import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeStatus, nextAtLabel, shouldPoll, POLL_INTERVAL_MS, POLL_MAX } from '../lib/ai-diagnosis.js';
import { aiDiagnosis } from '../../tools/ui-check/fixture.js';

var RESULT = { headline: 'h', tendencies: ['a', 'b', 'c'], cautions: ['d', 'e', 'f'], strengths: ['g'] };

describe('sanitizeStatus', function () {
  it('不正な応答・使えない応答は available:false', function () {
    [null, undefined, 'x', 1, [], {}, { available: false }, { available: 'true', status: 'none' }, { available: true }, { available: true, status: 'bogus' }].forEach(function (b) {
      assert.deepEqual(sanitizeStatus(b), { available: false });
    });
  });

  it('none は min_matches を既定10で整える', function () {
    assert.deepEqual(sanitizeStatus({ available: true, status: 'none' }), { available: true, status: 'none', min_matches: 10 });
    assert.equal(sanitizeStatus({ available: true, status: 'none', min_matches: 30 }).min_matches, 30);
    assert.equal(sanitizeStatus({ available: true, status: 'none', min_matches: -1 }).min_matches, 10);
    assert.equal(sanitizeStatus({ available: true, status: 'none', min_matches: '5' }).min_matches, 10);
  });

  it('pending/running はそのまま通り、余計な項目は落とす', function () {
    var s = sanitizeStatus({ available: true, status: 'running', min_matches: 10, result: RESULT, secret: 'x' });
    assert.deepEqual(s, { available: true, status: 'running', min_matches: 10 });
  });

  it('done は result が揃うときだけ通り、崩れていれば available:false', function () {
    var ok = sanitizeStatus({ available: true, status: 'done', min_matches: 10, result: RESULT, next_at: '2026-11-19T05:00:00+09:00' });
    assert.deepEqual(ok.result, RESULT);
    assert.equal(ok.next_at, '2026-11-19T05:00:00+09:00');
    [undefined, null, {}, { headline: 'h' }, Object.assign({}, RESULT, { headline: '' }), Object.assign({}, RESULT, { tendencies: 'x' }),
      Object.assign({}, RESULT, { cautions: [1] }), Object.assign({}, RESULT, { strengths: ['a', 'b', 'c', 'd', 'e', 'f'] })].forEach(function (r) {
      assert.deepEqual(sanitizeStatus({ available: true, status: 'done', result: r }), { available: false });
    });
  });

  it('error は retry・attempts_left・error を整え、読めない next_at は捨てる', function () {
    var s = sanitizeStatus({ available: true, status: 'error', retry: true, attempts_left: 2, error: 'だめ', next_at: 'bogus' });
    assert.deepEqual(s, { available: true, status: 'error', min_matches: 10, retry: true, attempts_left: 2, error: 'だめ' });
    var d = sanitizeStatus({ available: true, status: 'error', retry: 'yes', attempts_left: -3 });
    assert.deepEqual([d.retry, d.attempts_left, d.error], [false, 0, '診断できませんでした']);
  });

  it('ui-check のモックの応答が全状態で通る', function () {
    ['none', 'running', 'done', 'error'].forEach(function (st) {
      var s = sanitizeStatus(aiDiagnosis(st));
      assert.equal(s.available, true, st);
      assert.equal(s.status, st);
    });
    var res = sanitizeStatus(aiDiagnosis('done')).result;
    assert.equal(res.tendencies.length + res.cautions.length + res.strengths.length, 8);
  });
});

describe('nextAtLabel', function () {
  it('文字列内の日付・時刻をそのまま M/D H:MM で返す(端末のタイムゾーンに依らない)', function () {
    assert.equal(nextAtLabel('2026-10-09T05:00:00+09:00'), '10/9 5:00');
    assert.equal(nextAtLabel('2026-01-02T05:30:00Z'), '1/2 5:30');
    assert.equal(nextAtLabel('2026-11-19T23:05:00+09:00'), '11/19 23:05');
  });
  it('読めなければ空文字', function () {
    ['', null, undefined, 5, 'bogus', '2026-10-09'].forEach(function (x) { assert.equal(nextAtLabel(x), ''); });
  });
});

describe('shouldPoll と定数', function () {
  it('pending と running だけポーリングする', function () {
    ['pending', 'running'].forEach(function (s) { assert.equal(shouldPoll(s), true, s); });
    ['none', 'done', 'error', undefined, ''].forEach(function (s) { assert.equal(shouldPoll(s), false, String(s)); });
  });
  it('5秒おき最大72回(6分)', function () {
    assert.equal(POLL_INTERVAL_MS, 5000);
    assert.equal(POLL_MAX, 72);
  });
});
