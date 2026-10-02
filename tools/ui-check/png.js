import { inflateSync } from 'node:zlib';

// 8bit の RGB(2)/RGBA(6) 非インターレース PNG を RGBA に展開する
export function decodePng(buf) {
  if (buf.length < 8 || buf.readUInt32BE(0) !== 0x89504e47) throw new Error('PNG ではない');
  var pos = 8, width = 0, height = 0, colorType = 0, idat = [];
  while (pos + 8 <= buf.length) {
    var len = buf.readUInt32BE(pos), type = buf.toString('latin1', pos + 4, pos + 8);
    var body = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      width = body.readUInt32BE(0); height = body.readUInt32BE(4); colorType = body[9];
      if (body[8] !== 8 || body[12] !== 0 || (colorType !== 2 && colorType !== 6)) throw new Error('未対応の PNG 形式');
    } else if (type === 'IDAT') idat.push(body);
    else if (type === 'IEND') break;
    pos += 12 + len;
  }
  var bpp = colorType === 6 ? 4 : 3, stride = width * bpp;
  var raw = inflateSync(Buffer.concat(idat));
  if (raw.length !== (stride + 1) * height) throw new Error('PNG データ長が不正');
  var cur = Buffer.alloc(stride * height);
  for (var y = 0; y < height; y++) {
    var f = raw[y * (stride + 1)], src = y * (stride + 1) + 1, row = y * stride;
    for (var x = 0; x < stride; x++) {
      var a = x >= bpp ? cur[row + x - bpp] : 0;
      var b = y > 0 ? cur[row - stride + x] : 0;
      var c = x >= bpp && y > 0 ? cur[row - stride + x - bpp] : 0;
      var p = 0;
      if (f === 1) p = a;
      else if (f === 2) p = b;
      else if (f === 3) p = (a + b) >> 1;
      else if (f === 4) {
        var pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c);
        p = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      } else if (f !== 0) throw new Error('不正なフィルタ ' + f);
      cur[row + x] = (raw[src + x] + p) & 255;
    }
  }
  if (bpp === 4) return { width: width, height: height, data: cur };
  var rgba = Buffer.alloc(width * height * 4);
  for (var i = 0; i < width * height; i++) {
    rgba[i * 4] = cur[i * 3]; rgba[i * 4 + 1] = cur[i * 3 + 1]; rgba[i * 4 + 2] = cur[i * 3 + 2]; rgba[i * 4 + 3] = 255;
  }
  return { width: width, height: height, data: rgba };
}

// ピクセル完全一致比較(許容0)。サイズ違いは sizeMismatch
export function comparePng(bufA, bufB) {
  var a = decodePng(bufA), b = decodePng(bufB);
  if (a.width !== b.width || a.height !== b.height) {
    return { equal: false, sizeMismatch: true, a: [a.width, a.height], b: [b.width, b.height], diffCount: 0, bbox: null };
  }
  var diff = 0, x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1;
  for (var i = 0; i < a.width * a.height; i++) {
    if (a.data.readUInt32LE(i * 4) !== b.data.readUInt32LE(i * 4)) {
      var x = i % a.width, y = (i / a.width) | 0;
      diff++;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
  }
  return { equal: diff === 0, sizeMismatch: false, diffCount: diff, bbox: diff ? { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 } : null };
}
