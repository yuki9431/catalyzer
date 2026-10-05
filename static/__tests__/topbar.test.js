import { describe, it } from 'node:test';
import assert from 'node:assert';
import { PULL, PULL_IDLE, pullStep, pullReady, BAR, BAR_SHOWN, nextBar } from '../lib/topbar.js';

var start = { type: 'start', x: 100, y: 300, scrollY: 0, enabled: true };
function run(evs) {
  var s = PULL_IDLE, last = { state: s, fire: false, prevent: false };
  evs.forEach(function (e) { last = pullStep(s, e); s = last.state; });
  return last;
}
function mv(dx, dy, scrollY) { return { type: 'move', x: 100 + dx, y: 300 + dy, scrollY: scrollY || 0 }; }

describe('pullStep', () => {
  it('enabled=false の start は idle で以後 fire しない', () => {
    var r = run([{ ...start, enabled: false }, mv(0, 200), { type: 'end' }]);
    assert.strictEqual(r.state.phase, 'idle');
    assert.strictEqual(r.fire, false);
  });
  it('scrollY=1 の start は idle', () => {
    assert.strictEqual(pullStep(PULL_IDLE, { ...start, scrollY: 1 }).state.phase, 'idle');
  });
  it('slop 内の下向きは armed・prevent false', () => {
    var r = run([start, mv(0, 4)]);
    assert.strictEqual(r.state.phase, 'armed');
    assert.strictEqual(r.prevent, false);
  });
  it('slop 内の横優勢は prevent false', () => {
    var r = run([start, mv(5, 2)]);
    assert.strictEqual(r.state.phase, 'armed');
    assert.strictEqual(r.prevent, false);
  });
  it('横に slop 超は idle', () => {
    var r = run([start, mv(20, 5)]);
    assert.strictEqual(r.state.phase, 'idle');
    assert.strictEqual(r.prevent, false);
  });
  it('上向きに slop 超は idle', () => {
    assert.strictEqual(run([start, mv(0, -20)]).state.phase, 'idle');
  });
  it('slop 超の下向きは pulling・prevent true', () => {
    var r = run([start, mv(0, 20)]);
    assert.strictEqual(r.state.phase, 'pulling');
    assert.strictEqual(r.state.distance, 10);
    assert.strictEqual(r.prevent, true);
  });
  it('dy=127 の end は fire false', () => {
    assert.strictEqual(run([start, mv(0, 127), { type: 'end' }]).fire, false);
  });
  it('dy=128 の end は fire true(境界)', () => {
    assert.strictEqual(run([start, mv(0, 128), { type: 'end' }]).fire, true);
  });
  it('dy=400 で distance は max', () => {
    assert.strictEqual(run([start, mv(0, 400)]).state.distance, PULL.max);
  });
  it('pulling 中に scrollY>0 で idle・end で fire false', () => {
    var r = run([start, mv(0, 200), mv(0, 210, 3)]);
    assert.strictEqual(r.state.phase, 'idle');
    assert.strictEqual(pullStep(r.state, { type: 'end' }).fire, false);
  });
  it('pulling 中に dy<=0 で idle', () => {
    assert.strictEqual(run([start, mv(0, 200), mv(0, 0)]).state.phase, 'idle');
  });
  it('cancel で idle・fire false', () => {
    var r = run([start, mv(0, 200), { type: 'cancel' }]);
    assert.strictEqual(r.state.phase, 'idle');
    assert.strictEqual(r.fire, false);
  });
  it('idle の move は何もしない', () => {
    var r = pullStep(PULL_IDLE, mv(0, 200));
    assert.strictEqual(r.state.phase, 'idle');
    assert.strictEqual(r.prevent, false);
  });
  it('pullReady はしきい値以上の pulling だけ真', () => {
    assert.strictEqual(pullReady(PULL_IDLE), false);
    assert.strictEqual(pullReady(run([start, mv(0, 127)]).state), false);
    assert.strictEqual(pullReady(run([start, mv(0, 128)]).state), true);
  });
});

describe('nextBar', () => {
  var L = { top: 100, max: 2000 };
  var hidden = { hidden: true, anchor: 500 };
  var shown = { hidden: false, anchor: 500 };
  it('y<=top は hidden からでも shown', () => {
    assert.deepStrictEqual(nextBar(hidden, 100, L), { hidden: false, anchor: 100 });
  });
  it('shown から下へ23は shown・24で hidden', () => {
    assert.strictEqual(nextBar(shown, 500 + BAR.hideAfter - 1, L).hidden, false);
    assert.strictEqual(nextBar(shown, 500 + BAR.hideAfter, L).hidden, true);
  });
  it('max が縮んでも anchor が丸められ、上に戻したと誤認しない', () => {
    var s = nextBar({ hidden: true, anchor: 1000 }, 900, { top: 100, max: 900 });
    assert.strictEqual(s.hidden, true);
  });
  it('hidden から上へ15は hidden・16で shown', () => {
    assert.strictEqual(nextBar(hidden, 500 - BAR.showAfter + 1, L).hidden, true);
    assert.strictEqual(nextBar(hidden, 500 - BAR.showAfter, L).hidden, false);
  });
  it('hidden 中の更なる下降で anchor が上がり、そこから16戻すと shown', () => {
    var s = nextBar(hidden, 800, L);
    assert.deepStrictEqual(s, { hidden: true, anchor: 800 });
    assert.strictEqual(nextBar(s, 800 - BAR.showAfter, L).hidden, false);
  });
  it('shown 中の上昇で anchor が下がり、そこから24で hidden', () => {
    var s = nextBar(shown, 300, L);
    assert.deepStrictEqual(s, { hidden: false, anchor: 300 });
    assert.strictEqual(nextBar(s, 300 + BAR.hideAfter, L).hidden, true);
  });
  it('y>max は max に丸め、下端バウンスで shown にならない', () => {
    var s = nextBar(hidden, 2030, L);
    assert.deepStrictEqual(s, { hidden: true, anchor: 2000 });
    assert.strictEqual(nextBar(s, 2000, L).hidden, true);
  });
  it('負の y は0に丸めて shown', () => {
    assert.deepStrictEqual(nextBar(hidden, -30, L), { hidden: false, anchor: 0 });
  });
  it('±5 の往復列で状態が一度も変わらない', () => {
    [shown, hidden].forEach(function (s0) {
      var s = s0;
      [505, 500, 495, 500, 505, 500].forEach(function (y) {
        s = nextBar(s, y, L);
        assert.strictEqual(s.hidden, s0.hidden);
      });
    });
  });
  it('BAR_SHOWN は shown の初期値', () => {
    assert.strictEqual(BAR_SHOWN.hidden, false);
  });
});
