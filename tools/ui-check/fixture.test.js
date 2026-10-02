import { describe, it } from 'node:test';
import assert from 'node:assert';
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
  it('uses local image URLs for every machine', function () {
    msList().forEach(function (m) { assert.match(m.ImageURL, /^\/__preview\/ms\/\d+\.svg$/); });
  });
});
