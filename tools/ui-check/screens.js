// 画面定義。必須要素 = [selector, 含むテキスト|null, 最小件数(既定1)]。操作 = { click | type | scroll | wait: [selector, ...] } | { scrollBy | pull: [dy, 'release'?] } | { release: true }(保持中のタッチを離す) | { absentNow: [selector] }(その時点で要素が無いこと) | { reload: true } | { colorScheme: ['dark'|'light'] }(端末の配色を切り替える)。expectConsole = 許す console エラーの部分文字列(応答自体が主題の 4xx のみ)。inview = [[selector, テキスト?]...] 操作後に最初の可視一致要素が画面内で他に隠されていないことを検査 / outview = 同形式で、在るが画面内に見えないことを検査 / absent = 同形式で、レイアウトを持つ要素が1件も無いことを検査 / clock = 画面の Date を指定 ISO 日時から進む時計に固定 / standalone = ホーム画面アプリ(navigator.standalone)として開く / fixedMax = 固定高さ(上部バー下端+タブバー)の上限px と帯 0px の検査 / tap = 高さ44px以上を検査する selector 群
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
// 起動時はホームが開くため、レポートを撮る画面は先にレポートへ移る
var REPORT_TAB = goTab('レポート');
var TABBAR = '[data-ui="tabbar"]';
var HOME_CLOCK = '2026-10-08T22:00:00+09:00';
var SORT_TRIGGER = '[data-ui="search-sort-trigger"]';
var SHEET = '[data-ui="search-filter-sheet"]';
var OPEN_FILTER = OPEN_SEARCH.concat([{ click: ['[data-ui="search-filter-toggle"]'] }, { click: ['[data-ui="search-winloss"] button', '勝利'] }]);
var COLLAPSED = ['[data-ui="topbar"][data-collapsed="true"]'];
var EXPANDED = ['[data-ui="topbar"][data-collapsed="false"]'];
var FILTERS = [['[data-ui="period-trigger"]'], ['[data-ui="ms-trigger"]'], ['[data-ui="lens-toggle"] button', '全体']];
var ACTIVE_TAB = ['[data-ui="tab"][aria-selected="true"]', '総合'];
var REANALYZE_BTN = ['[data-ui="reanalyze-button"]', '再分析'];
var TAP = [TABBAR_ITEM, '[data-ui="more"] button', '[data-ui="more"] a'];
var TAP_FORM = TAP.concat(['[data-ui="more"] input']);
var AUTO_INPUT = '[data-ui="auto-refresh"] input#autoRefreshPassphrase';
var THEME_BTN = '[data-ui="theme-toggle"] button';
var SCOPE = ['[data-ui="report-scope"]', '全期間・60試合'];
var AUTO_SUBMIT = '[data-ui="auto-refresh"] button';

// 日付指定(2026-06-03 だけの1日)で期間内を0件にする。この日は fixture に試合が無い
var EMPTY_OPS = [{ wait: ['[data-ui="report-scope"]'] }, { click: ['[data-ui="period-trigger"]'] }, { click: ['[data-ui="period-item"]', '日付指定'] },
  { click: ['[data-ui="cal-day"]', '3'] }, { click: ['[data-ui="cal-day"]', '3'] }, { click: ['[data-ui="period-apply"]'] }, { wait: ['[data-ui="empty-state"]'] }];

function analyzeOps(username) { return [{ type: ['#username', username] }, { type: ['#password', 'preview-pass'] }, { click: ['#analyzeBtn'] }]; }

function report(id, tab, h2s, extra, moreOps) {
  var required = [['[data-ui="tab"][aria-selected="true"]', TABS[tab]]].concat(h2s.map(function (t) { return ['[data-ui="panel"] h2', t]; }), SUMMARY(tab), extra || []);
  return { id: id, viewport: D, full: true, start: 'report', ops: [{ click: ['[data-ui="tab"]', TABS[tab]] }].concat(moreOps || []), required: required };
}

var SCREEN_DEFS = [
  { id: 'login', viewport: D, full: true, start: 'login', ops: [{ click: ['[data-ui="remember-info"] summary'] }],
    required: [['#loginForm'], ['#username'], ['#password'], ['#analyzeBtn'], ['[data-ui="remember-info"][open] li', null, 3], ['footer', '非公式のファンツール']],
    tap: ['[data-ui="remember-info"] summary', '[data-ui="remember-label"]', '#analyzeBtn'] },
  { id: 'session-expired', viewport: D, full: false, start: 'report-session', ops: [{ wait: ['#loginForm[style*="display: block"]'] }, { reload: true }],
    required: [['#loginForm'], ['#analyzeBtn']], absent: [['[data-ui="tab"]'], ['[data-ui="report-scope"]']] },
  { id: 'analyzing', viewport: D, full: true, start: 'login',
    ops: [{ type: ['#username', 'preview@example.com'] }, { type: ['#password', 'preview-pass'] }, { click: ['#analyzeBtn'] }],
    required: [[CURRENT, 'ホーム'], ['#status'], ['#progressCount', '37 / 120 件'], ['[data-ui="skeleton"]'], ['[data-ui="status-steps"] [aria-current="step"]', '新しい試合を取得（37 / 120 件）']] },
  { id: 'analyzing-prelim', viewport: M, full: false, start: 'login', ops: analyzeOps('prelim@example.com').concat([REPORT_TAB, { wait: ['[data-ui="report-scope"]'] }]),
    required: [['[data-ui="report-scope"]', '全期間・60試合'], ['#status'], ['[data-ui="status-steps"] [aria-current="step"]', '新しい試合を取得']], absent: [['[data-ui="skeleton"]']] },
  { id: 'analyze-partial', viewport: M, full: false, start: 'login', ops: analyzeOps('partial@example.com').concat([REPORT_TAB]),
    required: [['#error [data-ui="notice"][role="status"]', 'アクセスが制限'], ['#error [data-ui="notice-action"]', '再分析'], ['[data-ui="report-scope"]']], tap: ['#error [data-ui="notice-action"]'] },
  { id: 'analyze-prelim-error', viewport: M, full: false, start: 'login', ops: analyzeOps('prelim-error@example.com').concat([REPORT_TAB, { wait: ['#error [data-ui="notice"]'] }]),
    required: [['#error [data-ui="notice"][role="alert"]', 'データの取得に失敗しました'], ['[data-ui="report-scope"]', '全期間・60試合']], absent: [['[data-ui="skeleton"]']] },
  { id: 'analyze-error', viewport: M, full: true, start: 'login', ops: analyzeOps('error@example.com'),
    required: [['#error [data-ui="notice"][role="alert"]', 'データの取得に失敗しました'], ['#loginForm']], absent: [['#error [data-ui="notice-action"]']] },
  { id: 'notice-session-expired', viewport: D, full: true, start: 'report-session-valid', ops: [{ wait: ['[data-ui="report-scope"]'] }, { click: REANALYZE_BTN }], expectConsole: ['status of 401'],
    required: [['#loginForm'], ['#error [data-ui="notice"][role="alert"]', 'セッションが見つかりません'], ['#error [data-ui="notice-action"]', 'ログイン']] },
  { id: 'report-overview', viewport: D, full: true, start: 'report', ops: [],
    required: [[CURRENT, 'レポート'], ['[data-ui="tab"][aria-selected="true"]', '総合'], ['[data-ui="panel"] h2', '基本データ'], ['[data-ui="panel"] h2', 'シーズン別分析'], ['[data-ui="lens-toggle"] button[aria-pressed="true"]', '全体'], REANALYZE_BTN].concat(SUMMARY('overview')) },
  { id: 'mobile-home-few', home: true, viewport: M, full: true, start: 'report-today-3', clock: '2026-10-08T22:00:00+09:00', ops: [goTab('ホーム'), { wait: ['[data-ui="today-card"]'] }],
    required: [[CURRENT, 'ホーム'], ['[data-ui="today-card"]', '今日 10/8'], ['[data-ui="today-compare"] tbody tr', null, 7]] },
  { id: 'mobile-home', home: true, viewport: M, full: true, start: 'report-today-12', clock: '2026-10-08T22:00:00+09:00', ops: [goTab('ホーム'), { wait: ['[data-ui="today-compare"]'] }],
    required: [[CURRENT, 'ホーム'], ['[data-ui="today-compare"] tbody tr', null, 7], ['[data-ui="panel"] h2', '勝率アップミッション'], ['[data-ui="mission-matches"]', '当てはまった試合を見る']], tap: [TABBAR_ITEM, '[data-ui="mission-matches"]'] },
  { id: 'home', home: true, viewport: D, full: true, start: 'report-today-12', clock: '2026-10-08T22:00:00+09:00', ops: [goTab('ホーム'), { wait: ['[data-ui="today-compare"]'] }],
    required: [[CURRENT, 'ホーム'], ['[data-ui="today-compare"] tbody tr', null, 7], REANALYZE_BTN] },
  { id: 'mobile-home-last-day', home: true, viewport: M, full: true, start: 'report', clock: '2026-10-08T22:00:00+09:00', ops: [{ wait: ['[data-ui="today-compare"]'] }],
    required: [[CURRENT, 'ホーム'], ['[data-ui="today-card"]', '前回 6/15'], ['[data-ui="today-compare"]', 'その前 6/10']] },
  { id: 'mobile-home-badges-cleared', home: true, viewport: M, full: false, start: 'report-seen', clock: '2026-10-08T22:00:00+09:00',
    ops: [{ wait: ['[data-ui="tabbar-dot"]'] }, REPORT_TAB, { wait: ['[data-ui="report-scope"]'] }, goTab('ホーム'), { wait: ['[data-ui="today-compare"]'] }],
    required: [[CURRENT, 'ホーム'], ['[data-ui="tabbar-dot"]', null, 2]], absent: [['[data-ui="tabbar-item"]:nth-child(2) [data-ui="tabbar-dot"]']] },
  { id: 'mobile-home-badges', home: true, viewport: M, full: false, start: 'report-seen', clock: '2026-10-08T22:00:00+09:00', ops: [{ wait: ['[data-ui="tabbar-dot"]'] }],
    required: [[CURRENT, 'ホーム'], ['[data-ui="tabbar-dot"]', null, 3]] },
  report('report-playstyle', 'playstyle', ['被撃墜と勝率', 'ダメージ貢献率']),
  report('report-burst', 'burst', ['覚醒回数と勝率', '覚醒タイミング']),
  report('report-matchup', 'matchup', ['敵機との相性', '僚機との相性'], [['details[open] table'], ['[data-ui="panel"] [data-ui="row-list"]', null, 3]], [{ click: ['summary', '表で見る'] }]),
  report('report-time', 'time', ['時間帯別の勝率', '曜日別の勝率'], [['canvas']]),
  { id: 'dropdown-period', viewport: D, full: false, start: 'report', ops: [{ click: ['[data-ui="period-trigger"]'] }],
    required: [['[data-ui="period-panel"]'], ['[data-ui="period-item"]', null, 2]] },
  { id: 'dropdown-ms', viewport: D, full: false, start: 'report', ops: [{ click: ['[data-ui="ms-trigger"]'] }],
    required: [['[data-ui="ms-panel"]'], ['[data-ui="ms-item"]', null, 2]] },
  { id: 'search', viewport: D, full: true, start: 'report', ops: OPEN_SEARCH,
    required: [[CURRENT, '試合検索'], REANALYZE_BTN, ['[data-ui="search-filter-toggle"]', '絞り込み'], ['[data-ui="search-result"]', null, 20], ['[data-ui="search-day"]'], ['[data-ui="search-sort-trigger"]', '日付が新しい順'], ['[data-ui="search-pager"]']] },
  { id: 'dropdown-search-sort', viewport: D, full: false, start: 'report', ops: OPEN_SEARCH.concat([{ click: [SORT_TRIGGER] }]),
    required: [['[data-ui="search-sort-panel"]'], ['[data-ui="search-sort-item"]', null, 7]] },
  { id: 'dropdown-search-filter', viewport: D, full: false, start: 'report',
    ops: OPEN_SEARCH.concat([{ click: ['[data-ui="search-filter-toggle"]'] }, { click: [SHEET + ' [data-ui="select-trigger"]'] }]),
    required: [['[data-ui="select-panel"]']] },
  { id: 'match-detail', viewport: D, full: false, start: 'report', ops: OPEN_SEARCH.concat([{ click: ['[data-ui="search-result"]'] }, { scroll: ['[data-ui="gantt"]'] }]),
    required: [['[data-ui="match-detail"] [data-ui="match-score-table"]'], ['[data-ui="gantt-bar"]'], ['[data-ui="gantt-end"]', '終了'], ['[data-ui="match-detail-back"]', '試合検索']],
    absent: [['[data-ui="match-timeline-toggle"]']], outview: [[TABBAR]] },
  { id: 'mobile-search-filter', viewport: M, full: false, start: 'report', ops: OPEN_FILTER,
    required: [[SHEET + ' h2', '絞り込み'], ['[data-ui="search-filter-foot"]', '27試合が該当'], ['[data-ui="search-filter-apply"]', '結果を見る'],
      ['[data-ui="search-enemy-mode"] button', 'すべて含む'], ['[data-ui="search-enemy-mode"] button[aria-pressed="true"]', 'どれかを含む'], ['[data-ui="search-winloss"] button[aria-pressed="true"]', '勝利']],
    inview: [['[data-ui="search-filter-apply"]'], ['[data-ui="search-filter-clear"]'], ['[data-ui="sheet-close"]']], outview: [[TABBAR]],
    tap: ['[data-ui="search-filter-apply"]', '[data-ui="search-filter-clear"]', '[data-ui="sheet-close"]', '[data-ui="search-enemy-mode"] button', '[data-ui="search-name-scope"] button', '[data-ui="search-winloss"] button', '[data-ui="search-pattern-item"]'] },
  { id: 'mobile-search-applied', viewport: M, full: false, start: 'report', ops: OPEN_FILTER.concat([{ click: ['[data-ui="search-filter-apply"]'] }, { wait: ['[data-ui="search-applied"]'] }]),
    required: [['[data-ui="search-applied"]', '勝敗: 勝利'], ['[data-ui="search-filter-toggle"]', '絞り込み（1件適用中）'], ['[data-ui="search-clear"]', '条件をクリア'],
      ['[data-ui="search-total"]', '27試合'], ['[data-ui="search-result"]', null, 20]],
    absent: [[SHEET]], tap: ['[data-ui="search-filter-toggle"]', '[data-ui="search-clear"]', SORT_TRIGGER, '[data-ui="search-result"]', '[data-ui="search-pager"] button'] },
  { id: 'mobile-search-sort', viewport: M, full: false, start: 'report', ops: OPEN_SEARCH.concat([{ click: [SORT_TRIGGER] }, { click: ['[data-ui="search-sort-item"]', '与ダメージ'] }]),
    required: [['[data-ui="search-sort-panel"] h3', '並べ替え'], ['[data-ui="search-sort-item"]', null, 7], ['[data-ui="search-sort-item"][aria-pressed="true"]', '与ダメージ'],
      ['[data-ui="search-sort-dir"] button[aria-pressed="true"]', '大きい順'], ['[data-ui="search-pagesize"] button[aria-pressed="true"]', '20'], [SORT_TRIGGER, '与ダメージが大きい順']],
    absent: [['[data-ui="search-day"]']],
    tap: ['[data-ui="search-sort-item"]', '[data-ui="search-sort-dir"] button', '[data-ui="search-pagesize"] button', '[data-ui="search-sort-panel"] [data-ui="sheet-close"]'] },
  { id: 'mobile-match-detail', viewport: M, full: false, start: 'report', ops: OPEN_SEARCH.concat([{ click: ['[data-ui="search-result"]'] }]),
    required: [['[data-ui="match-detail-back"][aria-label="試合検索に戻る"]'], ['[data-ui="search-filter"][inert]'], ['[inert] [data-ui="search-result"]'], [TABBAR + '[inert], [inert] ' + TABBAR], ['[data-ui="match-detail"]'], ['[data-ui="match-detail-back"]', '試合検索'], ['[data-ui="match-result"]', '敗北'], ['[data-ui="match-score-table"] thead th', 'テスト僚機1'], ['[data-ui="match-score-table"] thead th', 'テスト対戦者15'], ['[data-ui="gantt-bar"]'], ['[data-ui="gantt-end"]', '終了']],
    inview: [['[data-ui="match-detail-back"]']], absent: [['[data-ui="match-timeline-toggle"]']], outview: [[TABBAR]],
    tap: ['[data-ui="match-detail-back"]', '[data-ui="radar-toggle"]'] },
  { id: 'mobile-mission-search', viewport: M, full: false, start: 'report', home: true, clock: HOME_CLOCK,
    ops: [goTab('ホーム'), { wait: ['[data-ui="mission-matches"]'] }, { click: ['[data-ui="mission-matches"]'] }, { wait: ['[data-ui="search-goal"]'] }],
    required: [['[data-ui="search-goal"]', '負け筋: '], ['[data-ui="search-goal-remove"][aria-label$="を外す"]'], ['[data-ui="search-reason"]'], ['[data-ui="search-total"]', '39試合'], ['[data-ui="search-filter-toggle"]', '絞り込み（1件適用中）']],
    absent: [['[data-ui="mission-matches"]']], tap: ['[data-ui="search-goal-remove"]', '[data-ui="search-result"]'] },
  { id: 'mobile-mission-search-removed', viewport: M, full: false, start: 'report', home: true, clock: HOME_CLOCK,
    ops: [goTab('ホーム'), { wait: ['[data-ui="mission-matches"]'] }, { click: ['[data-ui="mission-matches"]'] }, { wait: ['[data-ui="search-goal"]'] }, { click: ['[data-ui="search-goal-remove"]'] }, { wait: ['[data-ui="search-total"]', '60試合'] }],
    required: [['[data-ui="search-total"]', '60試合'], ['[data-ui="search-filter-toggle"]', '絞り込み']], absent: [['[data-ui="search-goal"]'], ['[data-ui="search-reason"]']] },
  { id: 'mobile-search-pattern', viewport: M, full: false, start: 'report',
    ops: OPEN_SEARCH.concat([{ click: ['[data-ui="search-filter-toggle"]'] }, { click: ['[data-ui="search-pattern-item"]', '1機目で覚醒せず落ちた'] }, { wait: ['[data-ui="search-pattern-item"][aria-pressed="true"]', '1機目で覚醒せず落ちた'] },
      { click: ['[data-ui="search-filter-apply"]'] }, { wait: ['[data-ui="search-applied"]'] }]),
    required: [['[data-ui="search-applied"]', '試合の展開: 1機目で覚醒せず落ちた'], ['[data-ui="search-reason"]', '撃墜 ']], absent: [[SHEET]] },
  { id: 'mobile-match-detail-hit', viewport: M, full: false, start: 'report',
    ops: OPEN_SEARCH.concat([{ click: ['[data-ui="search-filter-toggle"]'] }, { click: ['[data-ui="search-pattern-item"]', '1機目で覚醒せず落ちた'] }, { click: ['[data-ui="search-filter-apply"]'] },
      { wait: ['[data-ui="search-reason"]'] }, { click: ['[data-ui="search-result"]'] }, { wait: ['[data-ui="match-note"]'] }, { scroll: ['[data-ui="gantt"]'] }]),
    required: [['[data-ui="match-note"]', '覚醒を使う前に'], ['[data-ui="gantt-death-hit"]']], inview: [['[data-ui="gantt-death-hit"]']] },
  { id: 'mobile-match-detail-ol-hit', viewport: M, full: false, start: 'report',
    ops: OPEN_SEARCH.concat([{ click: ['[data-ui="search-filter-toggle"]'] }, { click: ['[data-ui="search-pattern-item"]', 'オーバーリミットを覚醒と重ねずに使った'] }, { click: ['[data-ui="search-filter-apply"]'] },
      { wait: ['[data-ui="search-reason"]', 'OL発動 '] }, { click: ['[data-ui="search-result"]'] }, { wait: ['[data-ui="match-note"]'] }, { scroll: ['[data-ui="gantt"]'] }]),
    required: [['[data-ui="match-note"]', 'オーバーリミットを'], ['[data-ui="gantt-ov-hit"]']], absent: [['[data-ui="gantt-death-hit"]']], inview: [['[data-ui="gantt-ov-hit"]']] },
  { id: 'mobile-match-detail-lastcost-hit', viewport: M, full: false, start: 'report',
    ops: OPEN_SEARCH.concat([{ click: ['[data-ui="search-filter-toggle"]'] }, { click: ['[data-ui="search-pattern-item"]', '最後のコストで覚醒が無かった'] }, { click: ['[data-ui="search-filter-apply"]'] },
      { wait: ['[data-ui="search-reason"]', '最後のコスト '] }, { click: ['[data-ui="search-result"]', '23:10'] }, { wait: ['[data-ui="match-note"]'] }, { scroll: ['[data-ui="gantt"]'] }]),
    required: [['[data-ui="match-note"]', '最後のコストに入りました'], ['[data-ui="gantt-partner-row"] [data-ui="gantt-death-hit"]']], inview: [['[data-ui="gantt-partner-row"] [data-ui="gantt-death-hit"]']] },
  { id: 'mobile-home-focus', home: true, viewport: M, full: true, start: 'report-focus', clock: HOME_CLOCK, ops: [{ wait: ['[data-ui="focus-review"]'] }],
    required: [[CURRENT, 'ホーム'], ['[data-ui="focus-review"]', '✗ の試合を見返す'], ['[data-ui="focus-review"]', '3戦']], tap: ['[data-ui="focus-review"]'] },
  { id: 'mobile-focus-review', home: true, viewport: M, full: false, start: 'report-focus', clock: HOME_CLOCK, ops: [{ wait: ['[data-ui="focus-review"]'] }, { click: ['[data-ui="focus-review"]'] }, { wait: ['[data-ui="search-range"]'] }],
    required: [['[data-ui="search-range"]', '挑戦中のミッションの試合'], ['[data-ui="search-goal"]', '負け筋: 与ダメ12500未満'], ['[data-ui="search-total"]', '3試合']] },
  { id: 'mobile-match-gantt', viewport: M, full: false, start: 'report', ops: OPEN_SEARCH.concat([{ click: ['[data-ui="search-result"]'] }, { scroll: ['[data-ui="gantt"]'] }]),
    required: [['[data-ui="gantt-bar"]'], ['[data-ui="gantt-end"]', '終了']], inview: [['[data-ui="gantt-end"]']] },
  // 詳細を開いたまま絞り込みを開こうとしても層は1枚（絞り込みが残り詳細は閉じる）。
  { id: 'mobile-layer-exclusive', viewport: M, full: false, start: 'report',
    ops: OPEN_SEARCH.concat([{ click: ['[data-ui="search-result"]'] }, { wait: ['[data-ui="match-detail"]'] }, { click: ['[data-ui="search-filter-toggle"]'] }]),
    required: [[SHEET + ' h2', '絞り込み'], ['[data-ui="search-filter"][inert]']], absent: [['[data-ui="match-detail"]']], outview: [[TABBAR]] },
  { id: 'mobile-search-back', viewport: M, full: false, start: 'report',
    ops: OPEN_FILTER.concat([{ click: ['[data-ui="search-filter-apply"]'] }, { wait: ['[data-ui="search-applied"]'] }, { scrollBy: [600] }, { click: ['[data-ui="search-result"]'] },
      { wait: ['[data-ui="match-detail"]'] }, { click: ['[data-ui="match-detail-back"]'] }]),
    required: [['[data-ui="search-applied"]', '勝敗: 勝利'], ['[data-ui="search-total"]', '27試合']],
    absent: [['[data-ui="match-detail"]']], outview: [['[data-ui="search-result"]'], ['[data-ui="search-pager"]']], inview: [[TABBAR]] },
  { id: 'mobile-search-page-next', viewport: M, full: false, start: 'report',
    ops: OPEN_SEARCH.concat([{ wait: ['[data-ui="search-pager"]'] }, { scrollBy: [5000] }, { click: ['[data-ui="search-pager"] button', '次へ'] }, { wait: ['[data-ui="search-pager"]', '21〜40'] }]),
    required: [['[data-ui="search-pager"]', '21〜40']], inview: [['[data-ui="search-total"]']] },
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
      goTab('レポート'), { wait: ['[data-ui="tab"][aria-selected="true"]', '総合'] }, goTab('その他'), { reload: true }, { wait: [CURRENT, 'ホーム'] }, goTab('その他')],
    required: [[CURRENT, 'その他'], ['[data-ui="more"]'], ['[data-ui="share-item"]', null, 4], ['[data-ui="more"] [data-ui="row-list"]', null, 3], [THEME_BTN + '[aria-pressed="true"]', '端末に合わせる'], [THEME_BTN, null, 3], ['[data-ui="more"] button', '再分析'], ['[data-ui="more-brand"] img'], ['[data-ui="auto-refresh"] button', '有効にする'], ['[data-ui="auto-refresh"] input#autoRefreshPassphrase'], ['[data-ui="more"] a', 'ガンダムモバイルを開く'], ['[data-ui="more"] button', 'ログアウト'], ['footer', '非公式のファンツール']], tap: TAP_FORM },
  { id: 'mobile-more-confirm', viewport: M, full: true, start: 'report', ops: [goTab('その他'), { click: ['[data-ui="more"] button', '試合データを取得し直す'] }],
    required: [['[data-ui="more"] button[aria-expanded="true"]', '試合データを取得し直す'], ['[data-ui="refetch-confirm"] button', '取得し直す'], ['[data-ui="refetch-confirm"] button', 'やめる']], tap: TAP },
  { id: 'mobile-more-auto-refresh', viewport: M, full: true, start: 'report',
    ops: [goTab('その他'), { type: [AUTO_INPUT, 'preview-pass'] }, { click: [AUTO_SUBMIT, '有効にする'] }, { wait: [AUTO_SUBMIT, "無効にする"] }],
    required: [[CURRENT, 'その他'], ['[data-ui="more"] h2', '設定'], ['[data-ui="auto-refresh"] [data-ui="row-list"]', '有効'], ['[data-ui="auto-refresh"] button', '無効にする']], tap: TAP },
  { id: 'mobile-more-auto-refresh-error', viewport: M, full: true, start: 'report',
    ops: [goTab('その他'), { type: [AUTO_INPUT, 'wrong'] }, { click: [AUTO_SUBMIT, '有効にする'] }, { wait: ['[data-ui="notice"]', '合言葉が違います'] }], expectConsole: ['status of 403'],
    required: [[CURRENT, 'その他'], ['[data-ui="auto-refresh"] [data-ui="notice"][role="alert"]', '合言葉が違います'], ['[data-ui="auto-refresh"] button', '有効にする']], tap: TAP_FORM },
  { id: 'mobile-theme-light', viewport: M, full: true, start: 'report',
    ops: [{ wait: SCOPE }, goTab('その他'), { wait: ['[data-ui="more"]'] }, { click: [THEME_BTN, 'ライト'] }, { wait: [THEME_BTN + '[aria-pressed="true"]', 'ライト'] }, goTab('レポート'), { wait: SCOPE }],
    required: [['html[data-theme="light"]'], ACTIVE_TAB, SCOPE] },
  { id: 'mobile-theme-dark-reload', viewport: M, full: true, start: 'report',
    ops: [{ wait: SCOPE }, goTab('その他'), { wait: ['[data-ui="more"]'] }, { click: [THEME_BTN, 'ダーク'] }, { reload: true }, goTab('その他'), { wait: [THEME_BTN + '[aria-pressed="true"]', 'ダーク'] }, goTab('レポート'), { wait: SCOPE }],
    required: [['html[data-theme="dark"]'], ACTIVE_TAB, SCOPE] },
  { id: 'mobile-theme-os-switch', viewport: M, full: true, start: 'report', ops: [{ wait: SCOPE }, { click: ['[data-ui="tab"]', TABS.time] }, { wait: ['[data-ui="tab"][aria-selected="true"]', TABS.time] }, { scrollBy: [800] }, { scrollBy: [800] }, { scrollBy: [800] }, { scrollBy: [800] }, { scrollBy: [-3200] }, { colorScheme: ['light'] }, { wait: ['html[data-theme="light"]'] }],
    required: [['html[data-theme="light"]'], ['[data-ui="tab"][aria-selected="true"]', TABS.time], SCOPE] },
  { id: 'report-empty-period', viewport: M, full: false, start: 'report', clock: '2026-06-20T12:00:00+09:00', ops: EMPTY_OPS,
    required: [['[data-ui="empty-state"]', 'この期間の試合はありません'], ['[data-ui="empty-action"]', '期間を変更'], ['[data-ui="period-trigger"]', '06-03 ~ 06-03']],
    absent: [['[data-ui="skeleton"]']], tap: ['[data-ui="empty-action"]'] },
  { id: 'report-empty-period-back', viewport: M, full: false, start: 'report', clock: '2026-06-20T12:00:00+09:00',
    ops: EMPTY_OPS.concat([{ click: ['[data-ui="empty-action"]'] }, { wait: ['[data-ui="period-panel"]'] }, { click: ['[data-ui="period-item"]', '全データ'] }, { wait: ['[data-ui="report-scope"]'] },
      goTab('その他'), { wait: ['[data-ui="more"]'] }, goTab('レポート'), { wait: ['[data-ui="report-scope"]'] }]),
    required: [['[data-ui="report-scope"]', '全期間・60試合']], absent: [['[data-ui="empty-state"]'], ['[data-ui="skeleton"]'], ['[data-ui="period-panel"]']] },
  { id: 'parts', viewport: D, full: true, start: 'parts', ops: [],
    required: [['[data-ui="parts-gallery"]'], ['[data-ui="chip"]', null, 2], ['[data-ui="toggle"]'], ['[data-ui="summary"]'], ['[data-ui="row-list"]'], ['[data-ui="notice"]', null, 4], ['[data-ui="notice-action"]']] },
  { id: 'parts-sheet', viewport: M, full: false, start: 'parts',
    ops: [{ click: ['[data-ui="sheet-demo"] [data-ui="select-trigger"]'] }], required: [['[data-ui="select-panel"]']] },
];

// ホーム画面とログイン画面に戻る画面以外は、起動直後にレポートへ移ってから操作する
var STAY = { 'session-expired': true };
export var SCREENS = SCREEN_DEFS.map(function (sc) {
  if (!sc.start.startsWith('report') || sc.home || STAY[sc.id]) return sc;
  return Object.assign({}, sc, { ops: [REPORT_TAB].concat(sc.ops) });
});
