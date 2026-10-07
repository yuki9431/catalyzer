import { describe, it } from 'node:test';
import assert from 'node:assert';
import { progressView } from '../lib/progress.js';

var states = function (v) { return v.steps.map(function (s) { return s.state; }); };

describe('progressView', () => {
  it('pending は読み込み中', () => {
    var v = progressView({ status: 'pending' });
    assert.deepStrictEqual(states(v), ['now', 'wait', 'wait']);
    assert.deepStrictEqual([v.pct, v.searching, v.count], [null, false, '']);
  });
  it('scraping で総数不明・0件は検索中', () => {
    var v = progressView({ status: 'scraping', progress: 0, progress_total: 0 });
    assert.deepStrictEqual(states(v), ['done', 'now', 'wait']);
    assert.deepStrictEqual([v.pct, v.searching, v.count], [null, true, '']);
  });
  it('scraping で総数不明・12件は件数だけ出す', () => {
    var v = progressView({ status: 'scraping', progress: 12, progress_total: 0 });
    assert.deepStrictEqual([v.searching, v.count], [true, '12 件']);
    assert.strictEqual(v.steps[1].label, '新しい試合を取得（12 件）');
  });
  it('37/120 は取得中・31%', () => {
    var v = progressView({ status: 'scraping', progress: 37, progress_total: 120 });
    assert.deepStrictEqual(states(v), ['done', 'now', 'wait']);
    assert.deepStrictEqual([v.pct, v.searching, v.count], [31, false, '37 / 120 件']);
  });
  it('120/120 は集計中・100%', () => {
    var v = progressView({ status: 'scraping', progress: 120, progress_total: 120 });
    assert.deepStrictEqual(states(v), ['done', 'done', 'now']);
    assert.strictEqual(v.pct, 100);
  });
  it('done は全て done', () => {
    var v = progressView({ status: 'done', progress: 5, progress_total: 5 });
    assert.deepStrictEqual(states(v), ['done', 'done', 'done']);
    assert.strictEqual(v.count, '5 / 5 件');
    assert.strictEqual(progressView({ status: 'done' }).count, '');
  });
  it('件数は千区切り', () => {
    assert.strictEqual(progressView({ status: 'scraping', progress: 1234, progress_total: 2000 }).count, '1,234 / 2,000 件');
  });
  it('error・cancelled・未知は null', () => {
    ['error', 'cancelled', 'x'].forEach(function (st) { assert.strictEqual(progressView({ status: st }), null, st); });
    assert.strictEqual(progressView(null), null);
  });
  it('段階ラベル', () => {
    var v = progressView({ status: 'pending' });
    assert.deepStrictEqual(v.steps.map(function (s) { return s.label; }), ['保存済みのデータを読み込み', '新しい試合を取得', '集計してレポートを作成']);
  });
});
