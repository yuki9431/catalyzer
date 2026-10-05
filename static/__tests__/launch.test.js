import { describe, it } from 'node:test';
import assert from 'node:assert';
import { navigationType, isStandalone, RELOAD_GUARD, shouldReanalyzeOnReload } from '../lib/launch.js';

describe('navigationType', () => {
  it('entry の type をそのまま返す', () => {
    assert.strictEqual(navigationType([{ type: 'reload' }], undefined), 'reload');
    assert.strictEqual(navigationType([{ type: 'navigate' }], 1), 'navigate');
    assert.strictEqual(navigationType([{ type: 'back_forward' }], 0), 'back_forward');
  });
  it('entry が無ければ legacy 1→reload・2→back_forward', () => {
    assert.strictEqual(navigationType([], 1), 'reload');
    assert.strictEqual(navigationType(undefined, 2), 'back_forward');
  });
  it('どちらも無ければ navigate', () => {
    assert.strictEqual(navigationType([], undefined), 'navigate');
    assert.strictEqual(navigationType([], 0), 'navigate');
  });
});

describe('isStandalone', () => {
  var mm = (v) => (q) => ({ matches: q === '(display-mode: standalone)' && v });
  it('standalone true なら真', () => assert.strictEqual(isStandalone({ standalone: true, matchMedia: mm(false) }), true));
  it('matchMedia が一致すれば真', () => assert.strictEqual(isStandalone({ standalone: undefined, matchMedia: mm(true) }), true));
  it('両方偽なら偽', () => assert.strictEqual(isStandalone({ standalone: false, matchMedia: mm(false) }), false));
  it('matchMedia が無くても落ちない', () => {
    assert.strictEqual(isStandalone({ standalone: undefined, matchMedia: null }), false);
  });
});

describe('shouldReanalyzeOnReload', () => {
  var now = 10_000_000;
  var base = { navType: 'reload', hasSession: true, now: now, startedAt: null, finishedAt: null };
  var t = (o) => shouldReanalyzeOnReload({ ...base, ...o });
  it('navigate は偽', () => assert.strictEqual(t({ navType: 'navigate' }), false));
  it('back_forward は偽', () => assert.strictEqual(t({ navType: 'back_forward' }), false));
  it('セッションが無ければ偽', () => assert.strictEqual(t({ hasSession: false }), false));
  it('記録なしの reload は真', () => assert.strictEqual(t({}), true));
  it('開始から 599999ms・未終了は偽、600000ms は真', () => {
    assert.strictEqual(t({ startedAt: String(now - RELOAD_GUARD.runningMs + 1) }), false);
    assert.strictEqual(t({ startedAt: String(now - RELOAD_GUARD.runningMs) }), true);
  });
  it('終了から 59999ms は偽、60000ms は真', () => {
    var s = String(now - 5 * 60 * 1000);
    assert.strictEqual(t({ startedAt: s, finishedAt: String(now - RELOAD_GUARD.cooldownMs + 1) }), false);
    assert.strictEqual(t({ startedAt: s, finishedAt: String(now - RELOAD_GUARD.cooldownMs) }), true);
  });
  it('終了が開始より後なら実行中扱いしない', () => {
    assert.strictEqual(t({ startedAt: String(now - 100000), finishedAt: String(now - 70000) }), true);
  });
  it('未来の時刻は0扱いで真', () => {
    assert.strictEqual(t({ startedAt: String(now + 1000) }), true);
    assert.strictEqual(t({ finishedAt: String(now + 1000) }), true);
  });
  it("'abc'・'1e999'・負・0 は0扱いで真", () => {
    ['abc', '1e999', '-5', '0', ''].forEach((v) => {
      assert.strictEqual(t({ startedAt: v, finishedAt: v }), true, v);
    });
  });
});
