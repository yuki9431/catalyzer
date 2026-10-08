import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import { SCREENS, THEMES } from './screens.js';
import { PULL } from '../../static/lib/topbar.js';

// クラス名セレクタ(`.foo`・`div.foo`)を検出する(属性値内は除く)。data-ui・id・タグ・ARIA だけで探す規約
var CLASS_SEL = /\.[A-Za-z_-]/;
function hasClassSel(sel) { return CLASS_SEL.test(sel.replace(/\[[^\]]*\]/g, '[]')); }

function selectors(screen) {
  var ops = screen.ops.map(function (op) { var a = op.click || op.type || op.scroll || op.wait || op.absentNow; return a && a[0]; }).filter(Boolean);
  return ops.concat(screen.required.map(function (r) { return r[0]; }), (screen.inview || []).map(function (r) { return r[0]; }), (screen.outview || []).map(function (r) { return r[0]; }), (screen.absent || []).map(function (r) { return r[0]; }), screen.tap || []);
}

describe('screens', () => {
  it('クラスセレクタ検出が h2.title 等を拾い、属性値内の . は拾わない', () => {
    ['h2.title', 'div.panel', '.foo', '[data-ui="x"].active'].forEach(function (x) { assert.ok(hasClassSel(x), x); });
    ['[data-ui="a.b"]', 'input[value="0.5"]', '[data-ui="x"] > button'].forEach(function (x) { assert.ok(!hasClassSel(x), x); });
  });

  it('全画面の操作・必須要素がクラス名セレクタを使わない', () => {
    var bad = [];
    SCREENS.forEach(function (s) {
      selectors(s).forEach(function (sel) { if (hasClassSel(sel)) bad.push(s.id + ': ' + sel); });
    });
    assert.deepStrictEqual(bad, []);
  });

  it('selectors() が inview のセレクタも検査対象に含める', () => {
    var sel = selectors({ ops: [], required: [['a']], inview: [['[data-ui="x"]', 't']], outview: [['[data-ui="y"]']], absent: [['[data-ui="z"]']], tap: ['b'] });
    assert.deepStrictEqual(sel, ['a', '[data-ui="x"]', '[data-ui="y"]', '[data-ui="z"]', 'b']);
    assert.deepStrictEqual(selectors({ ops: [{ absentNow: ['.bad'] }], required: [] }), ['.bad']);
  });

  it('mobile-report-overview は正の scrollBy の後に絞り込み行が画面外・タブ行が画面内で、固定高さが 120px 以下', () => {
    var s = SCREENS.find(function (x) { return x.id === 'mobile-report-overview'; });
    assert.ok(s.ops.some(function (op) { return op.scrollBy && op.scrollBy[0] > 0; }));
    ['[data-ui="period-trigger"]', '[data-ui="ms-trigger"]', '[data-ui="lens-toggle"] button'].forEach(function (sel) {
      assert.ok(s.outview.some(function (r) { return r[0] === sel; }), sel);
    });
    assert.ok(s.inview.some(function (r) { return r[0] === '[data-ui="tab"][aria-selected="true"]'; }));
    assert.ok(s.fixedMax <= 120);
  });

  it('レポート5画面は要約の主指標が種別ごとに違う', () => {
    var heroes = ['report-overview', 'report-playstyle', 'report-burst', 'report-matchup', 'report-time'].map(function (id) {
      var s = SCREENS.find(function (x) { return x.id === id; });
      return s.required.find(function (r) { return r[0] === '[data-ui="summary-hero"]'; })[1];
    });
    assert.strictEqual(new Set(heroes).size, 5);
  });

  it('部品一覧ページの styles link が index.html と同じ順', () => {
    var read = function (f, re) { return Array.from(fs.readFileSync(new URL(f, import.meta.url), 'utf8').matchAll(re)).map(function (m) { return m[1]; }); };
    var app = read('../../static/index.html', /href="styles\/([a-z-]+\.css)"/g);
    var parts = read('./preview/parts.html', /href="\/styles\/([a-z-]+\.css)"/g);
    assert.deepStrictEqual(parts, app);
  });

  it('基準画像が SCREENS × THEMES の <id>-<theme>.png と過不足なく一致する', () => {
    var want = [];
    SCREENS.forEach(function (s) { THEMES.forEach(function (t) { want.push(s.id + '-' + t + '.png'); }); });
    var have = fs.readdirSync(new URL('./baseline/', import.meta.url)).filter(function (f) { return f.endsWith('.png'); });
    assert.deepStrictEqual(have.sort(), want.sort());
  });

  it('mobile-more は 4 項目を巡回して再読み込みでホームに戻ることを確かめ、その他を開いてタップ領域を検査する', () => {
    var s = SCREENS.find(function (x) { return x.id === 'mobile-more'; });
    var clicked = s.ops.filter(function (op) { return op.click; }).map(function (op) { return op.click[1]; });
    ['レポート', '試合検索', '総合戦歴', 'その他'].forEach(function (l) { assert.ok(clicked.includes(l), l); });
    var r = s.ops.findIndex(function (op) { return op.reload; });
    assert.ok(r > 0);
    assert.deepStrictEqual(s.ops[r + 1].wait[1], 'ホーム');
    assert.deepStrictEqual(s.ops[r + 2].click[1], 'その他');
    assert.ok(s.required.some(function (r) { return r[0].includes('aria-current') && r[1] === 'その他'; }));
    assert.ok(s.tap && s.tap.length > 0);
  });

  var get = function (id) { return SCREENS.find(function (x) { return x.id === id; }); };
  var pulls = function (s) { return s.ops.filter(function (o) { return o.pull; }).map(function (o) { return o.pull; }); };

  it('mobile-report-scroll-up は正→負の scrollBy の後に絞り込み行が画面内に見える', () => {
    var d = get('mobile-report-scroll-up').ops.filter(function (o) { return o.scrollBy; }).map(function (o) { return o.scrollBy[0]; });
    assert.ok(d[0] > 0 && d[1] < 0);
    assert.ok(get('mobile-report-scroll-up').inview.length >= 3);
  });

  it('mobile-pull はしきい値未満を離して再分析せず、以上を保持する。mobile-pull-release は以上を離して #loginForm を必須にする', () => {
    var min = PULL.threshold / PULL.resist;
    var p = pulls(get('mobile-pull'));
    assert.ok(p[0][0] < min && p[0][1] === 'release');
    assert.ok(p[1][0] >= min && p[1][1] !== 'release');
    var r = pulls(get('mobile-pull-release'))[0];
    assert.ok(r[0] >= min && r[1] === 'release');
    assert.ok(get('mobile-pull-release').required.some(function (x) { return x[0] === '#loginForm'; }));
  });

  it('mobile-pull・mobile-pull-release はホーム画面アプリ(standalone)として開く', () => {
    ['mobile-pull', 'mobile-pull-release'].forEach(function (id) { assert.strictEqual(get(id).standalone, true, id); });
  });

  it('mobile-pull-browser はタブ(standalone でない)で引っ張り表示が無いことを検査する', () => {
    var s = get('mobile-pull-browser');
    assert.ok(!s.standalone);
    var kinds = s.ops.map(function (o) { return Object.keys(o)[0]; });
    assert.ok(kinds.indexOf('pull') < kinds.indexOf('absentNow') && kinds.indexOf('absentNow') < kinds.indexOf('release'));
    assert.deepStrictEqual(s.ops[kinds.indexOf('absentNow')].absentNow, ['[data-ui="pull-indicator"]']);
  });

  it('report-overview は再分析ボタンを必須にし、mobile-report-overview は不在を検査する', () => {
    assert.ok(get('report-overview').required.some(function (r) { return r[0] === '[data-ui="reanalyze-button"]'; }));
    assert.ok(get('mobile-report-overview').absent.some(function (r) { return r[0] === '[data-ui="reanalyze-button"]'; }));
  });

  it('mobile-search-back は「scrollBy 正→結果クリック→戻る」の順で、戻った後に結果先頭とページ送りが画面外', () => {
    var s = get('mobile-search-back');
    var idx = function (f) { return s.ops.findIndex(f); };
    var sb = idx(function (o) { return o.scrollBy && o.scrollBy[0] > 0; });
    var open = idx(function (o) { return o.click && o.click[0] === '[data-ui="search-result"]'; });
    var back = idx(function (o) { return o.click && o.click[0] === '[data-ui="match-detail-back"]'; });
    assert.ok(sb >= 0 && sb < open && open < back);
    ['[data-ui="search-result"]', '[data-ui="search-pager"]'].forEach(function (sel) { assert.ok(s.outview.some(function (r) { return r[0] === sel; }), sel); });
  });

  it('試合詳細・絞り込みの全画面は下部タブバーを覆い、試合経過は常時表示', () => {
    ['match-detail', 'mobile-match-detail', 'mobile-search-filter'].forEach(function (id) {
      assert.ok(get(id).outview.some(function (r) { return r[0] === '[data-ui="tabbar"]'; }), id);
    });
    ['match-detail', 'mobile-match-detail'].forEach(function (id) {
      assert.ok(get(id).absent.some(function (r) { return r[0] === '[data-ui="match-timeline-toggle"]'; }), id);
    });
  });

  it('試合詳細の画面は試合経過の終了ラベルを要求する', () => {
    ['match-detail', 'mobile-match-detail', 'mobile-match-gantt'].forEach(function (id) {
      assert.ok(get(id).required.some(function (r) { return r[0] === '[data-ui="gantt-end"]' && r[1] === '終了'; }), id);
    });
  });

  it('日付区切りは日付順の search で必須、指標順の mobile-search-sort では出ない', () => {
    assert.ok(get('search').required.some(function (r) { return r[0] === '[data-ui="search-day"]'; }));
    assert.ok(get('mobile-search-sort').absent.some(function (r) { return r[0] === '[data-ui="search-day"]'; }));
  });

  it('mobile-search-applied は適用中タグ・結果20件を要求し、絞り込みシートが無い', () => {
    var s = get('mobile-search-applied');
    var min = function (sel) { return (s.required.find(function (r) { return r[0] === sel; }) || [])[2]; };
    assert.strictEqual(min('[data-ui="search-result"]'), 20);
    assert.ok(s.absent.some(function (r) { return r[0].includes('search-filter-sheet'); }));
  });

  it('analyze-partial は warn(role=status)・analyze-error と notice-session-expired は error(role=alert)の #error 通知を必須にする', () => {
    var has = function (id, role) { return get(id).required.some(function (r) { return r[0] === '#error [data-ui="notice"][role="' + role + '"]'; }); };
    assert.ok(has('analyze-partial', 'status'));
    assert.ok(has('analyze-error', 'alert'));
    assert.ok(has('notice-session-expired', 'alert'));
  });

  it('テーマ画面は選択中のテーマを html[data-theme] で必須にする。os-switch は colorScheme で light へ切り替える', () => {
    [['mobile-theme-light', 'light'], ['mobile-theme-dark-reload', 'dark'], ['mobile-theme-os-switch', 'light']].forEach(function (x) {
      assert.ok(get(x[0]).required.some(function (r) { return r[0] === 'html[data-theme="' + x[1] + '"]'; }), x[0]);
    });
    var os = get('mobile-theme-os-switch');
    assert.deepStrictEqual(os.ops.find(function (o) { return o.colorScheme; }), { colorScheme: ['light'] });
  });

  it('report-empty-period(-back) は clock で日付を固定し、日付指定の日を選んで空の状態を検査する', () => {
    ['report-empty-period', 'report-empty-period-back'].forEach(function (id) {
      var s = get(id);
      assert.ok(!Number.isNaN(Date.parse(s.clock)), id);
      assert.ok(s.ops.some(function (o) { return o.click && o.click[0] === '[data-ui="cal-day"]'; }), id);
      assert.ok(s.absent.some(function (r) { return r[0] === '[data-ui="skeleton"]'; }), id);
    });
    assert.ok(get('report-empty-period').required.some(function (r) { return r[0] === '[data-ui="empty-state"]'; }));
    assert.ok(get('report-empty-period-back').absent.some(function (r) { return r[0] === '[data-ui="empty-state"]'; }));
  });
});
