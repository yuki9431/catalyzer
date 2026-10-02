// 画面定義。必須要素 = [selector, 含むテキスト|null, 最小件数(既定1)]。操作 = { click: [selector, テキスト] } | { type: [selector, 値] } | { scroll: [selector] }
var D = { width: 1280, height: 800 };
var M = { width: 390, height: 844 };
var TABS = { playstyle: '立ち回り', burst: '覚醒', matchup: '機体相性', time: '時間帯' };
var OPEN_SEARCH = [{ click: ['.hamburger'] }, { click: ['.menu-item', '試合検索'] }];

function report(id, tab, h2s, extra) {
  var required = [['.tab.active', TABS[tab]]].concat(h2s.map(function (t) { return ['.panel h2', t]; }), extra || []);
  return { id: id, viewport: D, full: true, start: 'report', ops: [{ click: ['.tab', TABS[tab]] }], required: required };
}

export var SCREENS = [
  { id: 'login', viewport: D, full: true, start: 'login', ops: [],
    required: [['#loginForm'], ['#username'], ['#password'], ['#analyzeBtn']] },
  { id: 'analyzing', viewport: D, full: true, start: 'login',
    ops: [{ type: ['#username', 'preview@example.com'] }, { type: ['#password', 'preview-pass'] }, { click: ['#analyzeBtn'] }],
    required: [['#status'], ['#progressCount', '37/120件'], ['.skel']] },
  { id: 'report-overview', viewport: D, full: true, start: 'report', ops: [],
    required: [['.tab.active', '総合'], ['.kpi-grid'], ['.panel h2', '基本データ'], ['.panel h2', 'シーズン別分析'], ['.lens-btn']] },
  report('report-playstyle', 'playstyle', ['被撃墜と勝率', 'ダメージ貢献率']),
  report('report-burst', 'burst', ['覚醒回数と勝率', '覚醒タイミング']),
  report('report-matchup', 'matchup', ['敵機との相性', '僚機との相性']),
  report('report-time', 'time', ['時間帯別の勝率', '曜日別の勝率'], [['canvas']]),
  { id: 'dropdown-period', viewport: D, full: false, start: 'report', ops: [{ click: ['.period-trigger'] }],
    required: [['.period-dropdown'], ['.period-dropdown-item', null, 2]] },
  { id: 'dropdown-ms', viewport: D, full: false, start: 'report', ops: [{ click: ['.ms-topbar-trigger'] }],
    required: [['.ms-topbar-dropdown'], ['.ms-topbar-item', null, 2]] },
  { id: 'menu', viewport: D, full: false, start: 'report', ops: [{ click: ['.hamburger'] }],
    required: [['.menu-item', '試合検索'], ['.menu-item', 'モバイル総合戦歴']] },
  { id: 'search', viewport: D, full: true, start: 'report', ops: OPEN_SEARCH,
    required: [['.search-filter-panel'], ['.search-item', null, 2]] },
  { id: 'dropdown-search-filter', viewport: D, full: false, start: 'report',
    ops: OPEN_SEARCH.concat([{ click: ['.search-filter-head'] }, { click: ['.search-filter-panel .panel-select-trigger:not(.search-date-trigger)'] }]),
    required: [['.panel-select-dropdown']] },
  { id: 'match-detail', viewport: D, full: false, start: 'report', ops: OPEN_SEARCH.concat([{ click: ['.search-item'] }, { click: ['.search-detail-tl-toggle'] }, { scroll: ['.gantt'] }]),
    required: [['.modal-backdrop .search-detail-table'], ['.gantt-bar']] },
  { id: 'classrecord', viewport: D, full: true, start: 'report',
    ops: [{ click: ['.hamburger'] }, { click: ['.menu-item', 'モバイル総合戦歴'] }],
    required: [['.kpi-grid'], ['h2', 'クラスマッチG戦績'], ['h2', '通算記録']] },
  { id: 'mobile-report-overview', viewport: M, full: true, start: 'report', ops: [],
    required: [['.tab.active', '総合'], ['.kpi-grid']] },
  { id: 'mobile-dropdown-period', viewport: M, full: false, start: 'report', ops: [{ click: ['.period-trigger'] }],
    required: [['.period-dropdown']] },
];
