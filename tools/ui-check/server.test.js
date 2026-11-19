import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import http from 'node:http';
import { listen } from './server.js';
import { MATCH_COUNT, SCHEMA_VERSION, notes as fixtureNotes, aiDiagnosis as fixtureAi } from './fixture.js';

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
  it('/notes は Cookie があれば fixture の件数、無ければ空(どちらも 200)', async function () {
    var q = async function (cookie) { var r = await fetch(base + '/notes', { headers: cookie ? { Cookie: cookie } : {} }); return [r.status, await r.json()]; };
    var withCookie = await q('preview_session=valid');
    assert.equal(withCookie[0], 200);
    assert.equal(withCookie[1].notes.length, fixtureNotes().length);
    assert.deepEqual(withCookie[1].limits, { text_max: 500, count_max: 2000, pinned_max: 3, enemies_max: 5 });
    var without = await q(null);
    assert.equal(without[0], 200);
    assert.deepEqual(without[1].notes, []);
  });
  it('/notes は Cookie preview_pins でピン留め件数を切り替える', async function () {
    var pins = async function (cookie) { var b = await (await fetch(base + '/notes', { headers: { Cookie: cookie } })).json(); return b.notes.filter(function (n) { return n.pinned; }).length; };
    assert.equal(await pins('preview_session=valid'), 1);
    assert.equal(await pins('preview_session=valid; preview_pins=0'), 0);
    assert.equal(await pins('preview_pins=3; preview_session=valid'), 3);
  });
  it('/notes の POST は通常 201 で id が付き、本文に「保存エラー」を含めば 500', async function () {
    var post = function (path, method, text) {
      return fetch(base + path, { method: method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: text }) });
    };
    var ok = await post('/notes', 'POST', 'メモ');
    assert.equal(ok.status, 201);
    assert.ok((await ok.json()).note.id);
    var put = await post('/notes/preview-note-1', 'PUT', 'メモ');
    assert.equal(put.status, 200);
    var bad = await post('/notes', 'POST', 'これは保存エラー');
    assert.equal(bad.status, 500);
    assert.ok((await bad.json()).error.includes('保存できませんでした'));
    assert.equal((await fetch(base + '/notes/preview-note-1', { method: 'DELETE' })).status, 200);
    assert.equal((await fetch(base + '/notes', { method: 'PATCH' })).status, 405);
  });
  it('/ai-diagnosis は Cookie が揃うときだけ状態を返し、それ以外は available:false(常に 200)。POST は 202', async function () {
    var get = async function (cookie) { var r = await fetch(base + '/ai-diagnosis', { headers: cookie ? { Cookie: cookie } : {} }); return [r.status, await r.json()]; };
    assert.deepEqual(await get(null), [200, { available: false }]);
    assert.deepEqual(await get('preview_ai=done'), [200, { available: false }]);
    assert.deepEqual(await get('preview_session=valid'), [200, { available: false }]);
    var none = await get('preview_session=valid; preview_ai=none');
    assert.deepEqual([none[0], none[1].available, none[1].status], [200, true, 'none']);
    assert.equal((await get('preview_ai=running; preview_session=valid'))[1].status, 'running');
    assert.deepEqual((await get('preview_session=valid; preview_ai=done'))[1], fixtureAi('done'));
    assert.equal((await get('preview_session=valid; preview_ai=error'))[1].retry, true);
    var post = await fetch(base + '/ai-diagnosis', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    assert.equal(post.status, 202);
    assert.equal((await post.json()).status, 'pending');
    assert.equal((await fetch(base + '/ai-diagnosis', { method: 'DELETE' })).status, 405);
  });
});
