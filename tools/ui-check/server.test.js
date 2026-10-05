import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import http from 'node:http';
import { listen } from './server.js';
import { MATCH_COUNT, SCHEMA_VERSION } from './fixture.js';

var srv, base;
before(async function () { srv = await listen(0); base = 'http://127.0.0.1:' + srv.port; });
after(function () { srv.server.close(); });

describe('preview server', function () {
  it('serves / byte-identical to static/index.html', async function () {
    var res = await fetch(base + '/');
    var buf = Buffer.from(await res.arrayBuffer());
    assert.ok(buf.equals(fs.readFileSync(new URL('../../static/index.html', import.meta.url))));
  });
  it('serves /matches with fixture count and schema_version', async function () {
    var d = await (await fetch(base + '/matches')).json();
    assert.equal(d.matches.length, MATCH_COUNT);
    assert.equal(d.schema_version, SCHEMA_VERSION);
  });
  it('rejects path traversal', async function () {
    var status = function (p) {
      return new Promise(function (resolve) {
        http.get({ host: '127.0.0.1', port: srv.port, path: p }, function (r) { r.resume(); resolve(r.statusCode); });
      });
    };
    assert.equal(await status('/..%2fCLAUDE.md'), 404);
    assert.equal(await status('/__preview/..%2fserver.js'), 404);
    assert.equal(await status('/__preview/..%2f..%2f..%2fCLAUDE.md'), 404);
  });
  it('does not crash on malformed or NUL paths', async function () {
    var status = function (p) {
      return new Promise(function (resolve) {
        http.get({ host: '127.0.0.1', port: srv.port, path: p }, function (r) { r.resume(); resolve(r.statusCode); });
      });
    };
    assert.equal(await status('/%'), 400);
    assert.equal(await status('/%00'), 404);
    assert.equal(await status('/'), 200);
  });
});
