// 画面定義。必須要素 = [selector, 含むテキスト|null, 最小件数(既定1)]。操作 = { click: [selector, テキスト] } | { type: [selector, 値] } | { scroll: [selector] }
var D = { width: 1280, height: 800 };
var M = { width: 390, height: 844 };
var TABS = { playstyle: '立ち回り', burst: '覚醒', matchup: '機体相性', time: '時間帯' };
var OPEN_SEARCH = [{ click: ['[data-ui="menu-open"]'] }, { click: ['[data-ui="menu-item"]', '試合検索'] }];

function report(id, tab, h2s, extra) {
  var required = [['[data-ui="tab"][aria-selected="true"]', TABS[tab]]].concat(h2s.map(function (t) { return ['[data-ui="panel"] h2', t]; }), extra || []);
  return { id: id, viewport: D, full: true, start: 'report', ops: [{ click: ['[data-ui="tab"]', TABS[tab]] }], required: required };
}

export var SCREENS = [
  { id: 'login', viewport: D, full: true, start: 'login', ops: [],
    required: [['#loginForm'], ['#username'], ['#password'], ['#analyzeBtn']] },
  { id: 'analyzing', viewport: D, full: true, start: 'login',
    ops: [{ type: ['#username', 'preview@example.com'] }, { type: ['#password', 'preview-pass'] }, { click: ['#analyzeBtn'] }],
    required: [['#status'], ['#progressCount', '37/120件'], ['[data-ui="skeleton"]']] },
  { id: 'report-overview', viewport: D, full: true, start: 'report', ops: [],
    required: [['[data-ui="tab"][aria-selected="true"]', '総合'], ['[data-ui="kpi-grid"]'], ['[data-ui="panel"] h2', '基本データ'], ['[data-ui="panel"] h2', 'シーズン別分析'], ['[data-ui="lens"]']] },
  report('report-playstyle', 'playstyle', ['被撃墜と勝率', 'ダメージ貢献率']),
  report('report-burst', 'burst', ['覚醒回数と勝率', '覚醒タイミング']),
  report('report-matchup', 'matchup', ['敵機との相性', '僚機との相性']),
  report('report-time', 'time', ['時間帯別の勝率', '曜日別の勝率'], [['canvas']]),
  { id: 'dropdown-period', viewport: D, full: false, start: 'report', ops: [{ click: ['[data-ui="period-trigger"]'] }],
    required: [['[data-ui="period-panel"]'], ['[data-ui="period-item"]', null, 2]] },
  { id: 'dropdown-ms', viewport: D, full: false, start: 'report', ops: [{ click: ['[data-ui="ms-trigger"]'] }],
    required: [['[data-ui="ms-panel"]'], ['[data-ui="ms-item"]', null, 2]] },
  { id: 'menu', viewport: D, full: false, start: 'report', ops: [{ click: ['[data-ui="menu-open"]'] }],
    required: [['[data-ui="menu-item"]', '試合検索'], ['[data-ui="menu-item"]', 'モバイル総合戦歴']] },
  { id: 'search', viewport: D, full: true, start: 'report', ops: OPEN_SEARCH,
    required: [['[data-ui="search-filter"]'], ['[data-ui="search-result"]', null, 2]] },
  { id: 'dropdown-search-filter', viewport: D, full: false, start: 'report',
    ops: OPEN_SEARCH.concat([{ click: ['[data-ui="search-filter-toggle"]'] }, { click: ['[data-ui="search-filter"] [data-ui="select-trigger"]'] }]),
    required: [['[data-ui="select-panel"]']] },
  { id: 'match-detail', viewport: D, full: false, start: 'report', ops: OPEN_SEARCH.concat([{ click: ['[data-ui="search-result"]'] }, { click: ['[data-ui="match-timeline-toggle"]'] }, { scroll: ['[data-ui="gantt"]'] }]),
    required: [['[data-ui="match-detail"] [data-ui="match-score-table"]'], ['[data-ui="gantt-bar"]']] },
  { id: 'classrecord', viewport: D, full: true, start: 'report',
    ops: [{ click: ['[data-ui="menu-open"]'] }, { click: ['[data-ui="menu-item"]', 'モバイル総合戦歴'] }],
    required: [['[data-ui="kpi-grid"]'], ['h2', 'クラスマッチG戦績'], ['h2', '通算記録']] },
  { id: 'mobile-report-overview', viewport: M, full: true, start: 'report', ops: [],
    required: [['[data-ui="tab"][aria-selected="true"]', '総合'], ['[data-ui="kpi-grid"]']] },
  { id: 'mobile-dropdown-period', viewport: M, full: false, start: 'report', ops: [{ click: ['[data-ui="period-trigger"]'] }],
    required: [['[data-ui="period-panel"]']] },
  { id: 'parts', viewport: D, full: true, start: 'parts', ops: [],
    required: [['[data-ui="parts-gallery"]'], ['[data-ui="chip"]', null, 2], ['[data-ui="toggle"]'], ['[data-ui="summary"]'], ['[data-ui="row-list"]'], ['[data-ui="notice"]', null, 3]] },
  { id: 'parts-sheet', viewport: M, full: false, start: 'parts',
    ops: [{ click: ['[data-ui="sheet-demo"] [data-ui="select-trigger"]'] }], required: [['[data-ui="select-panel"]']] },
];
