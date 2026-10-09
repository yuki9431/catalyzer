import { describe, it } from 'node:test';
import assert from 'node:assert';
import { testPattern } from '../../static/analysis/patterns.js';
import { generateMatches, MATCH_COUNT, msList } from './fixture.js';

describe('fixture', function () {
  it('is deterministic across calls', function () {
    assert.deepEqual(generateMatches(), generateMatches());
  });
  it('generates the fixed number of matches with unique match_id', function () {
    var ms = generateMatches();
    assert.equal(ms.length, MATCH_COUNT);
    assert.equal(new Set(ms.map(function (m) { return m.match_id; })).size, MATCH_COUNT);
  });
  it('has exactly one OL-without-burst match and last-cost matches for the ui-check scenes', function () {
    var ms = generateMatches();
    var count = function (key) { return ms.filter(function (m) { return testPattern({ key: key }, m) === true; }).length; };
    assert.equal(count('ov_solo'), 1);
    assert.ok(count('last_cost_burst') > 20);
  });
  it('uses local image URLs for every machine', function () {
    msList().forEach(function (m) { assert.match(m.ImageURL, /^\/__preview\/ms\/\d+\.svg$/); });
  });
});
