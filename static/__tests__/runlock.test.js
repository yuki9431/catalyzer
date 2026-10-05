import { describe, it } from 'node:test';
import assert from 'node:assert';
import { createRunLock } from '../lib/runlock.js';

function deferred() {
  var d = {};
  d.promise = new Promise(function (res, rej) { d.resolve = res; d.reject = rej; });
  return d;
}

describe('createRunLock', () => {
  it('run 中は busy、終了後は false、戻り値は true', async () => {
    var l = createRunLock(), d = deferred();
    var p = l.run(function () { return d.promise; });
    assert.strictEqual(l.busy(), true);
    d.resolve();
    assert.strictEqual(await p, true);
    assert.strictEqual(l.busy(), false);
  });
  it('busy 中の run は false で fn を呼ばない', async () => {
    var l = createRunLock(), d = deferred(), called = false;
    var p = l.run(function () { return d.promise; });
    assert.strictEqual(await l.run(function () { called = true; }), false);
    assert.strictEqual(called, false);
    d.resolve();
    await p;
  });
  it('release 後に新しい run が始められ、古い run の完了で新しい run が解放されない', async () => {
    var l = createRunLock(), d1 = deferred(), d2 = deferred();
    var p1 = l.run(function () { return d1.promise; });
    l.release();
    assert.strictEqual(l.busy(), false);
    var p2 = l.run(function () { return d2.promise; });
    d1.resolve();
    await p1;
    assert.strictEqual(l.busy(), true);
    d2.resolve();
    await p2;
    assert.strictEqual(l.busy(), false);
  });
  it('fn の reject で busy false かつ reject が伝播', async () => {
    var l = createRunLock();
    await assert.rejects(l.run(function () { return Promise.reject(new Error('x')); }), /x/);
    assert.strictEqual(l.busy(), false);
  });
});
