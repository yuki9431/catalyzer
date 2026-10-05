// 画面定義。必須要素 = [selector, 含むテキスト|null, 最小件数(既定1)]。操作 = { click | type | scroll | wait: [selector, ...] } | { scrollBy | pull: [dy, 'release'?] } | { release: true }(保持中のタッチを離す) | { absentNow: [selector] }(その時点で要素が無いこと) | { reload: true }。expectConsole = 許す console エラーの部分文字列(応答自体が主題の 4xx のみ)。inview = [[selector, テキスト?]...] 操作後に最初の可視一致要素が画面内で他に隠されていないことを検査 / outview = 同形式で、在るが画面内に見えないことを検査 / absent = 同形式で、レイアウトを持つ要素が1件も無いことを検査 / standalone = ホーム画面アプリ(navigator.standalone)として開く / fixedMax = 固定高さ(上部バー下端+タブバー)の上限px と帯 0px の検査 / tap = 高さ44px以上を検査する selector 群
export var THEMES = ['dark', 'light'];
var D = { width: 1280, height: 800 };
var M = { width: 390, height: 844 };
var HERO = { overview: '勝率', playstyle: '先落ち率', burst: '平均覚醒回数', matchup: '得意な敵機', time: '最も勝率が高い時間帯' };
var SUMMARY = function (tab) { return [['[data-ui="summary-hero"]', HERO[tab]], ['[data-ui="summary"] dt', null, 4], ['[data-ui="report-scope"]', '全期間・60試合']]; };
var TABS = { playstyle: '立ち回り', burst: '覚醒', matchup: '機体相性', time: '時間帯' };
var TABBAR_ITEM = '[data-ui="tabbar-item"]';
var CURRENT = TABBAR_ITEM + '[aria-current="page"]';
function goTab(label) { return { click: [TABBAR_ITEM, label] }; }
var OPEN_SEARCH = [goTab('試合検索')];
var COLLAPSED = ['[data-ui="topbar"][data-collapsed="true"]'];
var EXPANDED = ['[data-ui="topbar"][data-collapsed="false"]'];
var FILTERS = [['[data-ui="period-trigger"]'], ['[data-ui="ms-trigger"]'], ['[data-ui="lens-toggle"] button', '全体']];
var ACTIVE_TAB = ['[data-ui="tab"][aria-selected="true"]', '総合'];
var REANALYZE_BTN = ['[data-ui="reanalyze-button"]', '再分析'];
var TAP = [TABBAR_ITEM, '[data-ui="more"] button', '[data-ui="more"] a'];
var TAP_FORM = TAP.concat(['[data-ui="more"] input']);
var AUTO_INPUT = '[data-ui="auto-refresh"] input[type="password"]';
var AUTO_SUBMIT = '[data-ui="auto-refresh"] button';

function report(id, tab, h2s, extra, moreOps) {
  var required = [['[data-ui="tab"][aria-selected="true"]', TABS[tab]]].concat(h2s.map(function (t) { return ['[data-ui="panel"] h2', t]; }), SUMMARY(tab), extra || []);
  return { id: id, viewport: D, full: true, start: 'report', ops: [{ click: ['[data-ui="tab"]', TABS[tab]] }].concat(moreOps || []), required: required };
}

export var SCREENS = [
  { id: 'login', viewport: D, full: true, start: 'login', ops: [],
    required: [['#loginForm'], ['#username'], ['#password'], ['#analyzeBtn']] },
  { id: 'analyzing', viewport: D, full: true, start: 'login',
    ops: [{ type: ['#username', 'preview@example.com'] }, { type: ['#password', 'preview-pass'] }, { click: ['#analyzeBtn'] }],
    required: [[CURRENT, 'レポート'], ['#status'], ['#progressCount', '37/120件'], ['[data-ui="skeleton"]']] },
  { id: 'report-overview', viewport: D, full: true, start: 'report', ops: [],
    required: [[CURRENT, 'レポート'], ['[data-ui="tab"][aria-selected="true"]', '総合'], ['[data-ui="panel"] h2', '基本データ'], ['[data-ui="panel"] h2', 'シーズン別分析'], ['[data-ui="lens-toggle"] button[aria-pressed="true"]', '全体'], REANALYZE_BTN].concat(SUMMARY('overview')) },
  report('report-playstyle', 'playstyle', ['被撃墜と勝率', 'ダメージ貢献率']),
  report('report-burst', 'burst', ['覚醒回数と勝率', '覚醒タイミング']),
  report('report-matchup', 'matchup', ['敵機との相性', '僚機との相性'], [['details[open] table'], ['[data-ui="panel"] [data-ui="row-list"]', null, 3]], [{ click: ['summary', '表で見る'] }]),
  report('report-time', 'time', ['時間帯別の勝率', '曜日別の勝率'], [['canvas']]),
  { id: 'dropdown-period', viewport: D, full: false, start: 'report', ops: [{ click: ['[data-ui="period-trigger"]'] }],
    required: [['[data-ui="period-panel"]'], ['[data-ui="period-item"]', null, 2]] },
  { id: 'dropdown-ms', viewport: D, full: false, start: 'report', ops: [{ click: ['[data-ui="ms-trigger"]'] }],
    required: [['[data-ui="ms-panel"]'], ['[data-ui="ms-item"]', null, 2]] },
  { id: 'search', viewport: D, full: true, start: 'report', ops: OPEN_SEARCH,
    required: [[CURRENT, '試合検索'], REANALYZE_BTN, ['[data-ui="search-filter"]'], ['[data-ui="search-result"]', null, 2]] },
  { id: 'dropdown-search-filter', viewport: D, full: false, start: 'report',
    ops: OPEN_SEARCH.concat([{ click: ['[data-ui="search-filter-toggle"]'] }, { click: ['[data-ui="search-filter"] [data-ui="select-trigger"]'] }]),
    required: [['[data-ui="select-panel"]']] },
  { id: 'match-detail', viewport: D, full: false, start: 'report', ops: OPEN_SEARCH.concat([{ click: ['[data-ui="search-result"]'] }, { click: ['[data-ui="match-timeline-toggle"]'] }, { scroll: ['[data-ui="gantt"]'] }]),
    required: [['[data-ui="match-detail"] [data-ui="match-score-table"]'], ['[data-ui="gantt-bar"]']] },
  { id: 'classrecord', viewport: D, full: true, start: 'report',
    ops: [goTab('総合戦歴')],
    required: [[CURRENT, '総合戦歴'], REANALYZE_BTN, ['[data-ui="summary-hero"]', '通算勝率'], ['h2', 'クラスマッチG戦績'], ['h2', '通算記録']] },
  { id: 'mobile-report-overview', viewport: M, full: true, start: 'report', ops: [{ wait: ['[data-ui="report-scope"]'] }, { scrollBy: [600] }, { wait: COLLAPSED }],
    required: [['[data-ui="tab"][aria-selected="true"]', '総合']].concat(SUMMARY('overview')),
    inview: [ACTIVE_TAB], outview: FILTERS, absent: [['[data-ui="reanalyze-button"]']], fixedMax: 120,
    tap: ['[data-ui="period-trigger"]', '[data-ui="ms-trigger"]', '[data-ui="lens-toggle"] button'] },
  { id: 'mobile-report-scroll-up', viewport: M, full: false, start: 'report', ops: [{ wait: ['[data-ui="report-scope"]'] }, { scrollBy: [600] }, { wait: COLLAPSED }, { scrollBy: [-40] }, { wait: EXPANDED }], required: [ACTIVE_TAB], inview: FILTERS },
  { id: 'mobile-pull', viewport: M, full: false, start: 'report', standalone: true, ops: [{ wait: ['[data-ui="report-scope"]'] }, { pull: [40, 'release'] }, { pull: [200] }],
    required: [['[data-ui="pull-indicator"]', '離すと再分析'], ['[data-ui="report-scope"]', '全期間・60試合']] },
  { id: 'mobile-pull-release', viewport: M, full: false, start: 'report', standalone: true, ops: [{ wait: ['[data-ui="report-scope"]'] }, { pull: [200, 'release'] }], required: [['#loginForm'], ['#analyzeBtn']] },
  { id: 'mobile-search-pull', viewport: M, full: false, start: 'report', standalone: true, ops: OPEN_SEARCH.concat([{ wait: ['[data-ui="search-filter"]'] }, { pull: [200] }]),
    required: [['[data-ui="pull-indicator"]', '離すと再分析'], ['[data-ui="search-filter"]']], absent: [['[data-ui="reanalyze-button"]']] },
  { id: 'more-reanalyze', viewport: D, full: false, start: 'report', ops: [goTab('その他'), { click: ['[data-ui="more"] button', '再分析'] }], required: [['#loginForm'], ['#analyzeBtn']] },
  { id: 'mobile-pull-browser', viewport: M, full: false, start: 'report', ops: [{ wait: ['[data-ui="report-scope"]'] }, { pull: [200] }, { absentNow: ['[data-ui="pull-indicator"]'] }, { release: true }],
    required: [['[data-ui="report-scope"]', '全期間・60試合']] },
  { id: 'report-reanalyze', viewport: D, full: false, start: 'report', ops: [{ click: REANALYZE_BTN }], required: [['#loginForm'], ['#analyzeBtn']] },
  { id: 'mobile-dropdown-period', viewport: M, full: false, start: 'report', ops: [{ click: ['[data-ui="period-trigger"]'] }],
    required: [['[data-ui="period-panel"] h3', '期間'], ['[data-ui="sheet-close"]'], ['[data-ui="period-item"]', null, 2]],
    tap: ['[data-ui="period-item"]', '[data-ui="sheet-close"]'] },
  { id: 'mobile-dropdown-ms', viewport: M, full: false, start: 'report', ops: [{ click: ['[data-ui="ms-trigger"]'] }],
    required: [['[data-ui="ms-panel"] h3', '機体'], ['[data-ui="ms-item"]', null, 2]],
    tap: ['[data-ui="ms-item"]', '[data-ui="sheet-close"]'] },
  { id: 'more', viewport: D, full: true, start: 'report', ops: [goTab('その他')],
    required: [[CURRENT, 'その他'], ['[data-ui="more"]'], ['[data-ui="share-item"]', null, 4], ['[data-ui="more"] button', '再分析'], ['[data-ui="more-brand"] img']], tap: TAP_FORM },
  { id: 'mobile-more', viewport: M, full: true, start: 'report',
    ops: [goTab('試合検索'), { wait: ['[data-ui="search-filter"]'] }, goTab('総合戦歴'), { wait: ['h2', '通算記録'] }, goTab('その他'), { wait: ['[data-ui="more"]'] },
      goTab('レポート'), { wait: ['[data-ui="tab"][aria-selected="true"]', '総合'] }, goTab('その他'), { reload: true }],
    required: [[CURRENT, 'その他'], ['[data-ui="more"]'], ['[data-ui="share-item"]', null, 4], ['[data-ui="more"] [data-ui="row-list"]', null, 3], ['[data-ui="more"] button', '再分析'], ['[data-ui="more-brand"] img'], ['[data-ui="auto-refresh"] button', '有効にする'], ['[data-ui="auto-refresh"] input[type="password"]'], ['[data-ui="more"] a', 'ガンダムモバイルを開く'], ['[data-ui="more"] button', 'ログアウト'], ['footer', '非公式のファンツール']], tap: TAP_FORM },
  { id: 'mobile-more-confirm', viewport: M, full: true, start: 'report', ops: [goTab('その他'), { click: ['[data-ui="more"] button', '試合データを取得し直す'] }],
    required: [['[data-ui="more"] button[aria-expanded="true"]', '試合データを取得し直す'], ['[data-ui="refetch-confirm"] button', '取得し直す'], ['[data-ui="refetch-confirm"] button', 'やめる']], tap: TAP },
  { id: 'mobile-more-auto-refresh', viewport: M, full: true, start: 'report',
    ops: [goTab('その他'), { type: [AUTO_INPUT, 'preview-pass'] }, { click: [AUTO_SUBMIT, '有効にする'] }, { wait: [AUTO_SUBMIT, "無効にする"] }],
    required: [[CURRENT, 'その他'], ['[data-ui="more"] h2', '設定'], ['[data-ui="auto-refresh"] [data-ui="row-list"]', '有効'], ['[data-ui="auto-refresh"] button', '無効にする']], tap: TAP },
  { id: 'mobile-more-auto-refresh-error', viewport: M, full: true, start: 'report',
    ops: [goTab('その他'), { type: [AUTO_INPUT, 'wrong'] }, { click: [AUTO_SUBMIT, '有効にする'] }, { wait: ['[data-ui="notice"]', '合言葉が違います'] }], expectConsole: ['status of 403'],
    required: [[CURRENT, 'その他'], ['[data-ui="auto-refresh"] [data-ui="notice"][role="alert"]', '合言葉が違います'], ['[data-ui="auto-refresh"] button', '有効にする']], tap: TAP_FORM },
  { id: 'parts', viewport: D, full: true, start: 'parts', ops: [],
    required: [['[data-ui="parts-gallery"]'], ['[data-ui="chip"]', null, 2], ['[data-ui="toggle"]'], ['[data-ui="summary"]'], ['[data-ui="row-list"]'], ['[data-ui="notice"]', null, 3]] },
  { id: 'parts-sheet', viewport: M, full: false, start: 'parts',
    ops: [{ click: ['[data-ui="sheet-demo"] [data-ui="select-trigger"]'] }], required: [['[data-ui="select-panel"]']] },
];
