import { describe, it } from 'node:test';
import assert from 'node:assert';
import { diffAfterParam, shouldPull, describeStatus, errorMessage, createPeriodicPull, PULL_MIN_INTERVAL_MS, PERIODIC_PULL_MS } from '../lib/autorefresh.js';

// 注入する時計。tick() で登録中のタイマーを1回ずつ発火する
function fakeClock() {
  var c = { timers: new Map(), next: 1, visible: true, pulls: [] };
  c.setInterval = function (fn, ms) { var id = c.next++; c.timers.set(id, { fn: fn, ms: ms }); return id; };
  c.clearInterval = function (id) { c.timers.delete(id); };
  c.isVisible = function () { return c.visible; };
  c.pull = function (opts) { c.pulls.push(opts); };
  c.tick = function () { c.timers.forEach(function (t) { t.fn(); }); };
  return c;
}

describe('createPeriodicPull', () => {
  it('表示中は PERIODIC_PULL_MS 間隔のタイマーを1本だけ張り、発火で取り込む', () => {
    var c = fakeClock(), p = createPeriodicPull(c);
    p.sync();
    p.sync();
    assert.strictEqual(c.timers.size, 1);
    assert.strictEqual([...c.timers.values()][0].ms, PERIODIC_PULL_MS);
    c.tick();
    assert.strictEqual(c.pulls.length, 1);
  });
  it('hidden になると止まり、visible に戻ると再開する', () => {
    var c = fakeClock(), p = createPeriodicPull(c);
    p.sync();
    c.visible = false;
    p.sync();
    assert.strictEqual(c.timers.size, 0);
    c.tick();
    assert.strictEqual(c.pulls.length, 0);
    c.visible = true;
    p.sync();
    c.tick();
    assert.strictEqual(c.pulls.length, 1);
  });
  it('hidden で開始したらタイマーを張らない', () => {
    var c = fakeClock();
    c.visible = false;
    createPeriodicPull(c).sync();
    assert.strictEqual(c.timers.size, 0);
  });
  it('sync より先に hidden になっていたら発火しても取り込まない', () => {
    var c = fakeClock(), p = createPeriodicPull(c);
    p.sync();
    c.visible = false;
    c.tick();
    assert.strictEqual(c.pulls.length, 0);
  });
  it('定期取得は touch を送らない', () => {
    var c = fakeClock(), p = createPeriodicPull(c);
    p.sync();
    c.tick();
    assert.deepStrictEqual(c.pulls, [{ touch: false }]);
  });
});

describe('diffAfterParam', () => {
  it('最新日時の1分前を返す(順不同でも最大を採る)', () => {
    assert.strictEqual(diffAfterParam([{ date: '2026-06-01 10:05' }, { date: '2026-06-03 21:30' }, { date: '2026-06-02 09:00' }]), '2026-06-03 21:29');
  });
  it('日付またぎ・月またぎで繰り下がる', () => {
    assert.strictEqual(diffAfterParam([{ date: '2026-06-02 00:00' }]), '2026-06-01 23:59');
    assert.strictEqual(diffAfterParam([{ date: '2026-07-01 00:00' }]), '2026-06-30 23:59');
  });
  it('空・日時なし・不正な形式は空文字', () => {
    assert.strictEqual(diffAfterParam([]), '');
    assert.strictEqual(diffAfterParam(null), '');
    assert.strictEqual(diffAfterParam([{ match_id: 'x' }, { date: 'invalid' }]), '');
  });
});

describe('shouldPull', () => {
  var base = { busy: false, pulling: false, lastPullAt: 1000 };
  it('間隔の境界: 19.999 秒は飛ばし、20 秒で取り込む', () => {
    assert.strictEqual(shouldPull({ ...base, now: 1000 + PULL_MIN_INTERVAL_MS - 1 }), false);
    assert.strictEqual(shouldPull({ ...base, now: 1000 + PULL_MIN_INTERVAL_MS }), true);
  });
  it('初回(lastPullAt=0)は取り込む', () => {
    assert.strictEqual(shouldPull({ ...base, lastPullAt: 0, now: Date.now() }), true);
  });
  it('分析・再構築中・取り込み実行中は飛ばす', () => {
    assert.strictEqual(shouldPull({ ...base, busy: true, now: 999999 }), false);
    assert.strictEqual(shouldPull({ ...base, pulling: true, now: 999999 }), false);
  });
});

describe('describeStatus', () => {
  it('無効・利用不可', () => {
    assert.strictEqual(describeStatus({ available: true, enabled: false, status: 'off' }, 0).aside, '無効');
    assert.strictEqual(describeStatus({ available: false, status: 'off' }, 0).aside, '利用不可');
    assert.strictEqual(describeStatus(null, 0).aside, '利用不可');
  });
  it('有効(active)・休止(idle)', () => {
    assert.strictEqual(describeStatus({ available: true, enabled: true, status: 'active' }, 0).aside, '有効');
    assert.match(describeStatus({ available: true, enabled: true, status: 'idle' }, 0).sub, /休止中/);
  });
  it('停止は理由ごとに文言が違う', () => {
    var subs = ['session_expired', 'access_denied', 'no_session', 'error'].map(function (r) {
      var d = describeStatus({ available: true, enabled: true, status: 'stopped', reason: r }, 0);
      assert.strictEqual(d.aside, '停止中');
      return d.sub;
    });
    assert.strictEqual(new Set(subs).size, 4);
  });
  it('最終取り込み時刻を出す', () => {
    var t = new Date(2026, 5, 1, 9, 7).getTime();
    assert.match(describeStatus({ available: true, enabled: true, status: 'active' }, t).sub, /最終取り込み 09:07/);
  });
  it('無効・有効・休止のどれでも動く時間帯を出す', () => {
    var t = new Date(2026, 5, 1, 9, 7).getTime();
    [['off', false, 0], ['active', true, 0], ['active', true, t], ['idle', true, t]].forEach(function (c) {
      assert.match(describeStatus({ available: true, enabled: c[1], status: c[0] }, c[2]).sub, /10:00〜翌1:00/);
    });
  });
});

describe('errorMessage', () => {
  it('403/429/409/401/503 はそれぞれ別の文', () => {
    var msgs = [403, 429, 409, 401, 503].map(errorMessage);
    assert.strictEqual(new Set(msgs).size, 5);
    assert.match(errorMessage(403), /合言葉が違います/);
  });
  it('通信失敗・未知は汎用文', () => {
    assert.strictEqual(errorMessage(0), errorMessage(500));
  });
});
