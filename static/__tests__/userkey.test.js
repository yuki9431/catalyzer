import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { userKeyOf } from '../lib/userkey.js';

describe('userKeyOf', function () {
  it('Go の model.UserKey と同じ値になる', async function () {
    assert.equal(await userKeyOf('pilot@example.com'), '65aef1213f473433');
  });
  it('空は空文字', async function () {
    assert.equal(await userKeyOf(''), '');
  });
});
