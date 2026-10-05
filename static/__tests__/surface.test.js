import { describe, it } from 'node:test';
import assert from 'node:assert';
import { readFileSync, readdirSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const read = (rel) => readFileSync(new URL(rel, root), 'utf8');
const SURFACE = /\.(panel|kpi|card)(?![\w-])/;

// コメントを除いて「セレクタ { 本体 }」に分解する（@media の入れ子は内側の規則だけが取れる）
function rules(css) {
  return [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ selectors: m[1].split(','), body: m[2] }));
}

describe('surface', () => {
  it('.panel/.kpi/.card を対象とする規則に box-shadow と border-radius が無い', () => {
    const bad = [];
    readdirSync(new URL('styles/', root)).filter((f) => f.endsWith('.css')).forEach((f) => {
      rules(read('styles/' + f)).forEach((r) => {
        const hit = r.selectors.some((s) => SURFACE.test(s.trim().split(/[\s>+~]+/).pop()));
        if (hit && /(box-shadow|border-radius)\s*:/.test(r.body)) bad.push(`${f}: ${r.selectors.join(',').trim()}`);
      });
    });
    assert.deepStrictEqual(bad, []);
  });

  it('report.js はスクロール連動処理を持たない(shell.js に一元化)', () => {
    const src = read('components/report/report.js');
    assert.ok(!src.includes("addEventListener('scroll'"));
    assert.ok(!src.includes('.style.maxHeight'));
  });

  it('scroll リスナは shell.js の1か所だけ、.style.maxHeight はどこにも無い', () => {
    const files = readdirSync(new URL('./', root), { recursive: true }).filter((f) => f.endsWith('.js') && !f.startsWith('__tests__') && f !== 'htm-preact-standalone.js' && f !== 'chart.umd.min.js');
    const withScroll = files.filter((f) => read(f).includes("addEventListener('scroll'"));
    assert.deepStrictEqual(withScroll, ['components/shell.js']);
    assert.strictEqual((read('components/shell.js').match(/addEventListener\('scroll'/g) || []).length, 1);
    assert.deepStrictEqual(files.filter((f) => read(f).includes('.style.maxHeight')), []);
  });
});
