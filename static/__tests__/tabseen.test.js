import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { markSeen, tabBadges } from '../lib/tabseen.js';

describe('tabBadges', function () {
  it('見ていないタブで値が変わったものだけに点を付ける', function () {
    var seen = { home: 50, report: 50, search: 60, classrecord: 1100 };
    var signals = { home: 60, report: 60, search: 60, classrecord: 1200 };
    assert.deepEqual(tabBadges(seen, signals, 'home'), { home: false, report: true, search: false, classrecord: true });
  });

  it('記録の無いタブ・値の無いタブ・初回には付けない', function () {
    assert.deepEqual(tabBadges(null, { home: 60, report: 60 }, 'home'), { home: false, report: false });
    assert.deepEqual(tabBadges({ home: 50 }, { home: 60, report: 60, classrecord: null }, 'search'),
      { home: true, report: false, classrecord: false });
  });
});

describe('markSeen', function () {
  it('表示中のタブと記録の無いタブを今の値で記録し、他は据え置く', function () {
    var next = markSeen({ home: 50, report: 50 }, { home: 60, report: 60, search: 60 }, 'home');
    assert.deepEqual(next, { home: 60, report: 50, search: 60 });
  });

  it('値の無いタブは記録せず、変化が無ければ同じオブジェクトを返す', function () {
    var seen = { home: 60, report: 50 };
    assert.equal(markSeen(seen, { home: 60, report: 60, classrecord: null }, 'home'), seen);
    assert.deepEqual(markSeen(null, { home: 60, classrecord: null }, 'home'), { home: 60 });
  });
});
