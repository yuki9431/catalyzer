// 画面定義。必須要素 = [selector, 含むテキスト|null, 最小件数(既定1)]。操作 = { click | type | scroll | wait: [selector, ...] } | { reload: true }。tap = 高さ44px以上を検査する selector 群
export var THEMES = ['dark', 'light'];
var D = { width: 1280, height: 800 };
var M = { width: 390, height: 844 };
var TABS = { playstyle: '立ち回り', burst: '覚醒', matchup: '機体相性', time: '時間帯' };
var TABBAR_ITEM = '[data-ui="tabbar-item"]';
var CURRENT = TABBAR_ITEM + '[aria-current="page"]';
function goTab(label) { return { click: [TABBAR_ITEM, label] }; }
var OPEN_SEARCH = [goTab('試合検索')];
var TAP = [TABBAR_ITEM, '[data-ui="more"] button', '[data-ui="more"] a'];

function report(id, tab, h2s, extra) {
  var required = [['[data-ui="tab"][aria-selected="true"]', TABS[tab]]].concat(h2s.map(function (t) { return ['[data-ui="panel"] h2', t]; }), extra || []);
  return { id: id, viewport: D, full: true, start: 'report', ops: [{ click: ['[data-ui="tab"]', TABS[tab]] }], required: required };
}

export var SCREENS = [
  { id: 'login', viewport: D, full: true, start: 'login', ops: [],
    required: [['#loginForm'], ['#username'], ['#password'], ['#analyzeBtn']] },
  { id: 'analyzing', viewport: D, full: true, start: 'login',
    ops: [{ type: ['#username', 'preview@example.com'] }, { type: ['#password', 'preview-pass'] }, { click: ['#analyzeBtn'] }],
    required: [[CURRENT, 'レポート'], ['#status'], ['#progressCount', '37/120件'], ['[data-ui="skeleton"]']] },
  { id: 'report-overview', viewport: D, full: true, start: 'report', ops: [],
    required: [[CURRENT, 'レポート'], ['[data-ui="tab"][aria-selected="true"]', '総合'], ['[data-ui="kpi-grid"]'], ['[data-ui="panel"] h2', '基本データ'], ['[data-ui="panel"] h2', 'シーズン別分析'], ['[data-ui="lens"]']] },
  report('report-playstyle', 'playstyle', ['被撃墜と勝率', 'ダメージ貢献率']),
  report('report-burst', 'burst', ['覚醒回数と勝率', '覚醒タイミング']),
  report('report-matchup', 'matchup', ['敵機との相性', '僚機との相性']),
  report('report-time', 'time', ['時間帯別の勝率', '曜日別の勝率'], [['canvas']]),
  { id: 'dropdown-period', viewport: D, full: false, start: 'report', ops: [{ click: ['[data-ui="period-trigger"]'] }],
    required: [['[data-ui="period-panel"]'], ['[data-ui="period-item"]', null, 2]] },
  { id: 'dropdown-ms', viewport: D, full: false, start: 'report', ops: [{ click: ['[data-ui="ms-trigger"]'] }],
    required: [['[data-ui="ms-panel"]'], ['[data-ui="ms-item"]', null, 2]] },
  { id: 'search', viewport: D, full: true, start: 'report', ops: OPEN_SEARCH,
    required: [[CURRENT, '試合検索'], ['[data-ui="search-filter"]'], ['[data-ui="search-result"]', null, 2]] },
  { id: 'dropdown-search-filter', viewport: D, full: false, start: 'report',
    ops: OPEN_SEARCH.concat([{ click: ['[data-ui="search-filter-toggle"]'] }, { click: ['[data-ui="search-filter"] [data-ui="select-trigger"]'] }]),
    required: [['[data-ui="select-panel"]']] },
  { id: 'match-detail', viewport: D, full: false, start: 'report', ops: OPEN_SEARCH.concat([{ click: ['[data-ui="search-result"]'] }, { click: ['[data-ui="match-timeline-toggle"]'] }, { scroll: ['[data-ui="gantt"]'] }]),
    required: [['[data-ui="match-detail"] [data-ui="match-score-table"]'], ['[data-ui="gantt-bar"]']] },
  { id: 'classrecord', viewport: D, full: true, start: 'report',
    ops: [goTab('総合戦歴')],
    required: [[CURRENT, '総合戦歴'], ['[data-ui="kpi-grid"]'], ['h2', 'クラスマッチG戦績'], ['h2', '通算記録']] },
  { id: 'mobile-report-overview', viewport: M, full: true, start: 'report', ops: [],
    required: [['[data-ui="tab"][aria-selected="true"]', '総合'], ['[data-ui="kpi-grid"]']] },
  { id: 'mobile-dropdown-period', viewport: M, full: false, start: 'report', ops: [{ click: ['[data-ui="period-trigger"]'] }],
    required: [['[data-ui="period-panel"]']] },
  { id: 'more', viewport: D, full: true, start: 'report', ops: [goTab('その他')],
    required: [[CURRENT, 'その他'], ['[data-ui="more"]'], ['[data-ui="share-item"]', null, 4]], tap: TAP },
  { id: 'mobile-more', viewport: M, full: true, start: 'report',
    ops: [goTab('試合検索'), { wait: ['[data-ui="search-filter"]'] }, goTab('総合戦歴'), { wait: ['h2', '通算記録'] }, goTab('その他'), { wait: ['[data-ui="more"]'] },
      goTab('レポート'), { wait: ['[data-ui="tab"][aria-selected="true"]', '総合'] }, goTab('その他'), { reload: true }],
    required: [[CURRENT, 'その他'], ['[data-ui="more"]'], ['[data-ui="share-item"]', null, 4], ['[data-ui="more"] [data-ui="row-list"]', null, 2], ['[data-ui="more"] a', 'ガンダムモバイルを開く'], ['[data-ui="more"] button', 'ログアウト'], ['footer', '非公式のファンツール']], tap: TAP },
  { id: 'mobile-more-confirm', viewport: M, full: true, start: 'report', ops: [goTab('その他'), { click: ['[data-ui="more"] button', '試合データを取得し直す'] }],
    required: [['[data-ui="more"] button[aria-expanded="true"]', '試合データを取得し直す'], ['[data-ui="refetch-confirm"] button', '取得し直す'], ['[data-ui="refetch-confirm"] button', 'やめる']], tap: TAP },
  { id: 'parts', viewport: D, full: true, start: 'parts', ops: [],
    required: [['[data-ui="parts-gallery"]'], ['[data-ui="chip"]', null, 2], ['[data-ui="toggle"]'], ['[data-ui="summary"]'], ['[data-ui="row-list"]'], ['[data-ui="notice"]', null, 3]] },
  { id: 'parts-sheet', viewport: M, full: false, start: 'parts',
    ops: [{ click: ['[data-ui="sheet-demo"] [data-ui="select-trigger"]'] }], required: [['[data-ui="select-panel"]']] },
];
