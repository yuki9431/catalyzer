import { describe, it } from 'node:test';
import assert from 'node:assert';
import { deflateSync } from 'node:zlib';
import { decodePng, comparePng } from './png.js';

function crc32(buf) {
  var c, crc = 0xffffffff;
  for (var i = 0; i < buf.length; i++) {
    c = (crc ^ buf[i]) & 255;
    for (var k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, body) {
  var len = Buffer.alloc(4); len.writeUInt32BE(body.length);
  var td = Buffer.concat([Buffer.from(type, 'latin1'), body]);
  var crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
// rows: フィルタ済みバイト列(先頭にフィルタ種別を含む)
function buildPng(w, h, colorType, rows) {
  var ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = colorType;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(Buffer.from(rows))), chunk('IEND', Buffer.alloc(0))]);
}
function rgbaPng(w, h, fn) {
  var rows = [];
  for (var y = 0; y < h; y++) {
    rows.push(0);
    for (var x = 0; x < w; x++) rows.push.apply(rows, fn(x, y));
  }
  return buildPng(w, h, 6, rows);
}

describe('decodePng', function () {
  it('decodes RGBA filter 0', function () {
    var png = rgbaPng(2, 1, function (x) { return [x * 100, 1, 2, 255]; });
    var d = decodePng(png);
    assert.deepEqual([d.width, d.height], [2, 1]);
    assert.deepEqual([...d.data], [0, 1, 2, 255, 100, 1, 2, 255]);
  });
  it('decodes RGB into opaque RGBA', function () {
    var d = decodePng(buildPng(1, 1, 2, [0, 10, 20, 30]));
    assert.deepEqual([...d.data], [10, 20, 30, 255]);
  });
  it('reverses filters 1-4', function () {
    // 2x2 RGB。元画素: 行0=(10,10,10),(20,20,20) 行1=(30,30,30),(45,45,45)
    var rows = [
      1, 10, 10, 10, 10, 10, 10, // Sub: 2画素目は左との差
      2, 20, 20, 20, 25, 25, 25, // Up: 上との差
    ];
    var d = decodePng(buildPng(2, 2, 2, rows));
    assert.deepEqual([...d.data], [10, 10, 10, 255, 20, 20, 20, 255, 30, 30, 30, 255, 45, 45, 45, 255]);
    // Average(3) と Paeth(4): 1行目 raw=(8,8,8),(16,16,16)
    var rows2 = [0, 8, 8, 8, 16, 16, 16, 3, 4, 4, 4, 4, 4, 4];
    var d2 = decodePng(buildPng(2, 2, 2, rows2));
    // avg: x0 = 4+floor((0+8)/2)=8, x1 = 4+floor((8+16)/2)=16
    assert.deepEqual([...d2.data].slice(8, 12), [8, 8, 8, 255]);
    assert.deepEqual([...d2.data].slice(12, 16), [16, 16, 16, 255]);
    var rows3 = [0, 8, 8, 8, 16, 16, 16, 4, 1, 1, 1, 2, 2, 2];
    var d3 = decodePng(buildPng(2, 2, 2, rows3));
    // paeth x0: a=0,b=8,c=0 -> p=b=8 => 9。x1: a=9,b=16,c=8 -> p=17,pa=8,pb=1,pc=9 -> b=16 => 18
    assert.deepEqual([...d3.data].slice(8, 12), [9, 9, 9, 255]);
    assert.deepEqual([...d3.data].slice(12, 16), [18, 18, 18, 255]);
  });
  it('rejects non-PNG', function () {
    assert.throws(function () { decodePng(Buffer.from('hello world!')); });
  });
});

describe('comparePng', function () {
  var base = function (x, y) { return [x, y, 0, 255]; };
  it('equal for identical images', function () {
    var r = comparePng(rgbaPng(4, 3, base), rgbaPng(4, 3, base));
    assert.equal(r.equal, true);
    assert.equal(r.bbox, null);
  });
  it('reports a 1px difference with bbox', function () {
    var r = comparePng(rgbaPng(4, 3, base), rgbaPng(4, 3, function (x, y) { return x === 2 && y === 1 ? [0, 0, 0, 255] : base(x, y); }));
    assert.equal(r.equal, false);
    assert.equal(r.diffCount, 1);
    assert.deepEqual(r.bbox, { x: 2, y: 1, w: 1, h: 1 });
  });
  it('reports size mismatch', function () {
    var r = comparePng(rgbaPng(4, 3, base), rgbaPng(5, 3, base));
    assert.equal(r.equal, false);
    assert.equal(r.sizeMismatch, true);
  });
});
