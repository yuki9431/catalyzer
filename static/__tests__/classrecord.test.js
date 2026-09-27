import { describe, it } from 'node:test';
import assert from 'node:assert';
import { classRecordCoverage, classRecordKD } from '../analysis/classrecord.js';

describe('classRecordCoverage', () => {
  it('通算に対する分析済み試合数の割合を返す', () => {
    assert.strictEqual(classRecordCoverage(200, 50), 25);
  });
  it('分析済みが通算を超えても100%で頭打ち', () => {
    assert.strictEqual(classRecordCoverage(100, 120), 100);
  });
  it('通算が0や不明ならnull', () => {
    assert.strictEqual(classRecordCoverage(0, 10), null);
    assert.strictEqual(classRecordCoverage(undefined, 10), null);
  });
});

describe('classRecordKD', () => {
  it('敵撃破数/被撃破数を返す', () => {
    var counts = [{ label: '敵撃破数', value: 300, unit: '機' }, { label: '被撃破数', value: 200, unit: '機' }];
    assert.strictEqual(classRecordKD(counts), 1.5);
  });
  it('被撃破0や項目欠落ならnull', () => {
    assert.strictEqual(classRecordKD([{ label: '敵撃破数', value: 3 }, { label: '被撃破数', value: 0 }]), null);
    assert.strictEqual(classRecordKD([{ label: '敵撃破数', value: 3 }]), null);
    assert.strictEqual(classRecordKD(null), null);
  });
});
