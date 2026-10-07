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
  it('/analyze は username でジョブ id を選び、status と result がその筋書きを返す', async function () {
    var analyze = async function (username) {
      var r = await fetch(base + '/analyze', { method: 'POST', body: JSON.stringify({ username: username }) });
      return (await r.json()).id;
    };
    var get = async function (path) { return fetch(base + path); };
    var prelim = await analyze('prelim@example.com');
    assert.equal(prelim, 'preview-prelim');
    var st = await (await get('/status/' + prelim)).json();
    assert.deepEqual([st.status, st.logged_in, st.has_preliminary_report, st.preliminary_version], ['scraping', true, true, 1]);
    var rs = await (await get('/result/' + prelim)).json();
    assert.equal(rs.preliminary, true);
    assert.equal(rs.matches.length, MATCH_COUNT);

    var partial = await analyze('partial@example.com');
    assert.equal(partial, 'preview-partial');
    assert.equal((await (await get('/status/' + partial)).json()).status, 'done');
    assert.equal((await (await get('/result/' + partial)).json()).partial, true);

    var err = await analyze('error@example.com');
    var es = await (await get('/status/' + err)).json();
    assert.equal(es.status, 'error');
    assert.ok(es.error.length > 0);
    assert.equal((await get('/result/' + err)).status, 404);

    assert.equal(await analyze('other@example.com'), 'preview-job');
  });
  it('/session は Cookie preview_session=valid があるときだけ valid', async function () {
    var q = async function (cookie) { return (await (await fetch(base + '/session', { headers: cookie ? { Cookie: cookie } : {} })).json()).valid; };
    assert.equal(await q(null), false);
    assert.equal(await q('preview_session=valid'), true);
    assert.equal(await q('a=1; preview_session=valid'), true);
    assert.equal(await q('preview_session=other'), false);
  });
  it('/reanalyze は 401 でセッション失効の実文言を返す', async function () {
    var r = await fetch(base + '/reanalyze', { method: 'POST' });
    assert.equal(r.status, 401);
    assert.ok((await r.json()).error.includes('セッション'));
  });
});
