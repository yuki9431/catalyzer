import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as fx from './fixture.js';

var HERE = path.dirname(fileURLToPath(import.meta.url));
var STATIC = path.resolve(HERE, '../../static');
var TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.webmanifest': 'application/manifest+json',
};

function send(res, code, type, body) {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(body);
}
function json(res, code, obj) { send(res, code, 'application/json; charset=utf-8', JSON.stringify(obj)); }

function serveFile(res, root, rel) {
  var file = path.resolve(root, '.' + path.sep + rel);
  if (rel.split('/').includes('..') || (file !== root && !file.startsWith(root + path.sep))) return send(res, 404, 'text/plain', 'not found');
  fs.readFile(file, function (err, buf) {
    if (err) return send(res, 404, 'text/plain', 'not found');
    send(res, 200, TYPES[path.extname(file)] || 'application/octet-stream', buf);
  });
}

// 自動更新のモック。GET は常に「無効・合言葉あり」、POST は合言葉 preview-pass だけ成功する(状態を持たないので画面間で干渉しない)
export var AUTO_REFRESH_PASSPHRASE = 'preview-pass';
var AUTO_REFRESH_OFF = { available: true, passphrase_required: true, enabled: false, status: 'off' };

function readJson(req, cb) {
  var chunks = [];
  req.on('data', function (c) { chunks.push(c); });
  req.on('end', function () {
    var body = {};
    try { body = JSON.parse(Buffer.concat(chunks).toString() || '{}'); } catch (e) {}
    cb(body);
  });
}

export function createServer() {
  var matches = fx.generateMatches();
  return http.createServer(function (req, res) {
    var url = new URL(req.url, 'http://localhost');
    var p;
    try { p = decodeURIComponent(url.pathname); } catch (e) { return send(res, 400, 'text/plain', 'bad request'); }
    if (p.includes('\0')) return send(res, 404, 'text/plain', 'not found');
    var get = req.method === 'GET';
    if (p.startsWith('/__preview/')) {
      var rel = p.slice('/__preview/'.length) || 'index.html';
      var svg = /^ms\/(\d+)\.svg$/.exec(rel);
      if (svg) return send(res, 200, 'image/svg+xml', fx.msSvg(Number(svg[1])));
      if (rel === 'fixture.js') return serveFile(res, HERE, 'fixture.js');
      return serveFile(res, path.join(HERE, 'preview'), rel);
    }
    if (get && p === '/ms-list') return json(res, 200, fx.msList());
    if (get && p === '/national-ms-stats') return json(res, 200, fx.nationalStats());
    if (get && p === '/schema-version') return json(res, 200, { schema_version: fx.SCHEMA_VERSION });
    if (get && p === '/matches') {
      var after = url.searchParams.get('after');
      var list = after ? matches.filter(function (m) { return m.date > after; }) : matches;
      return json(res, 200, { user_key: fx.USER_KEY, matches: list, total: list.length, schema_version: fx.SCHEMA_VERSION });
    }
    if (get && p === '/auto-refresh') return json(res, 200, AUTO_REFRESH_OFF);
    if (p === '/auto-refresh' && req.method === 'POST') {
      return readJson(req, function (b) {
        if (!b.enabled) return json(res, 200, AUTO_REFRESH_OFF);
        if (b.passphrase !== AUTO_REFRESH_PASSPHRASE) return json(res, 403, { error: '合言葉が違います' });
        json(res, 200, { available: true, passphrase_required: true, enabled: true, status: 'active', active_until: '2099-01-01T00:00:00Z' });
      });
    }
    if (p === '/auto-refresh/touch' && req.method === 'POST') return json(res, 200, { enabled: false, status: 'off' });
    if (get && p === '/tag-partners') return json(res, 200, { user_key: fx.USER_KEY, tag_partners: fx.tagPartners() });
    if (get && p === '/session') return json(res, 200, { valid: false });
    if (p === '/session' && req.method === 'DELETE') return json(res, 200, {});
    if (p === '/analyze' && req.method === 'POST') return json(res, 202, { id: 'preview-job' });
    if (get && p.startsWith('/status/')) return json(res, 200, { status: 'scraping', progress: 37, progress_total: 120 });
    if (p.startsWith('/cancel/') && req.method === 'POST') return json(res, 200, {});
    if (get && p.startsWith('/result/')) return json(res, 404, { error: 'not found' });
    if (p === '/reanalyze' && req.method === 'POST') return json(res, 401, { error: 'unauthorized' });
    if (get && p === '/favicon.ico') return send(res, 204, 'image/x-icon', '');
    if (get && p === '/health') return send(res, 200, 'text/plain', 'ok');
    if (!get) return send(res, 405, 'text/plain', 'method not allowed');
    return serveFile(res, STATIC, p === '/' ? 'index.html' : p.slice(1));
  });
}

export function listen(port) {
  var server = createServer();
  return new Promise(function (resolve, reject) {
    server.once('error', reject);
    server.listen(port || 0, '127.0.0.1', function () { resolve({ server: server, port: server.address().port }); });
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  listen(Number(process.env.PORT) || 8090).then(function (s) {
    console.log('ui-preview: http://127.0.0.1:' + s.port + '/__preview/');
  });
}
