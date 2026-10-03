import { describe, it } from 'node:test';
import assert from 'node:assert';
import { readFileSync, readdirSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const read = (rel) => readFileSync(new URL(rel, root), 'utf8');
const list = (dir, ext) => readdirSync(new URL(dir, root), { recursive: true }).filter((f) => f.endsWith(ext)).map((f) => dir + f);
const FONT_SIZE_RE = /font-size:\s*([^;}"'`]+)/g;

// font-size の値が inherit・0.875rem 以上の rem・14px 以上の px のどれでもないものを返す
function violations(files) {
  const bad = [];
  files.forEach((f) => {
    [...read(f).matchAll(FONT_SIZE_RE)].forEach((m) => {
      const v = m[1].trim();
      const num = parseFloat(v);
      const ok = v === 'inherit' || (/^[\d.]+rem$/.test(v) && num >= 0.875) || (/^[\d.]+px$/.test(v) && num >= 14);
      if (!ok) bad.push(`${f}: ${m[0].trim()}`);
    });
  });
  return bad;
}

describe('typography', () => {
  it('styles/*.css の font-size は inherit か 14px 以上の rem/px', () => {
    assert.deepStrictEqual(violations(list('styles/', '.css')), []);
  });

  it('app.js・components・lib のインライン font-size も同じ条件', () => {
    assert.deepStrictEqual(violations(['app.js', ...list('components/', '.js'), ...list('lib/', '.js')]), []);
  });

  it('base.css の body が OS 標準フォントと等幅数字を指定する', () => {
    const body = read('styles/base.css').match(/\nbody \{([^}]*)\}/)[1];
    assert.match(body, /font-family: var\(--font-sans\)/);
    assert.match(body, /font-variant-numeric: tabular-nums/);
  });
});
