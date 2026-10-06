import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { FallOrderContent } from '../components/charts.js';

function stat(count, v) { return { count: count, rate: 0, win_rate: v, avg_dmg_given: v, avg_dmg_taken: v, dmg_efficiency: v }; }

// vnode ツリーから rows を持つ Table を探す
function findRows(v) {
  if (!v || typeof v !== 'object') return null;
  if (v.props && Array.isArray(v.props.rows)) return v.props.rows;
  var kids = v.props && v.props.children;
  if (kids == null) return null;
  return [].concat(kids).reduce(function (a, c) { return a || findRows(c); }, null);
}

describe('FallOrderContent', function () {
  it('0戦の行は勝率・与ダメ・被ダメ・与被ダメ比が "-"（色付けしない）', function () {
    var rows = findRows(FallOrderContent({ fallOrder: { total: 10, tips: [], no_fall: stat(4, 70), first_fall: stat(6, 40), second_fall: stat(0, 0), same_time: stat(0, 0) } }));
    var second = rows.find(function (r) { return r[0] === '後落ち'; });
    assert.deepEqual(second.slice(1), ['0戦', '-', '-', '-', '-']);
    var first = rows.find(function (r) { return r[0] === '先落ち'; });
    assert.equal(first[2].sortValue, 40);
    assert.ok(!rows.some(function (r) { return r[0] === '同時落ち'; }));
  });
});
