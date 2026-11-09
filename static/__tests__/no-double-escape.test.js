import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { MsPairSubSection } from '../components/charts.js';

function jsFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(function (e) {
    var p = path.join(dir, e.name);
    return e.isDirectory() ? jsFiles(p) : e.name.endsWith('.js') ? [p] : [];
  });
}

// vnode ツリーから rows を持つ Table を探す
function findRows(v) {
  if (!v || typeof v !== 'object') return null;
  if (Array.isArray(v)) return v.reduce(function (a, c) { return a || findRows(c); }, null);
  if (v.props && Array.isArray(v.props.rows)) return v.props.rows;
  var kids = v.props && v.props.children;
  if (kids == null) return null;
  return [].concat(kids).reduce(function (a, c) { return a || findRows(c); }, null);
}

// Preact はテキストを自分でエスケープするので、HTML エスケープ済みの文字列を渡さない(#454)
describe('名前の二重エスケープ', function () {
  it('static/components/ は esc() を呼ばない', function () {
    var root = new URL('../components', import.meta.url).pathname;
    var bad = jsFiles(root).filter(function (f) { return /\besc\(/.test(fs.readFileSync(f, 'utf8')); });
    assert.deepEqual(bad, []);
  });
  it('& を含む名前はそのまま表に渡る', function () {
    var rows = findRows(MsPairSubSection({ msPair: { by_matches: [{ pair: 'A & B', matches: 3, win_rate: 50, dmg_efficiency: 1 }] } }));
    assert.equal(rows[0][0], 'A & B');
  });
});
