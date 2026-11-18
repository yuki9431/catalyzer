// 画面定義。必須要素 = [selector, 含むテキスト|null, 最小件数(既定1)]。操作 = { click | type | scroll | wait: [selector, ...] } | { scrollBy | pull: [dy, 'release'?] } | { swipe: [selector, dx] }(要素の中央から横に dx px 指を滑らせて離す) | { touchTap: [selector, テキスト?] }(指で1回タップする) | { release: true }(保持中のタッチを離す) | { absentNow: [selector] }(その時点で要素が無いこと) | { waitGone: [selector, テキスト?] }(要素が消えるまで待つ) | { reload: true } | { colorScheme: ['dark'|'light'] }(端末の配色を切り替える)。expectConsole = 許す console エラーの部分文字列(応答自体が主題の 4xx のみ)。inview = [[selector, テキスト?]...] 操作後に最初の可視一致要素が画面内で他に隠されていないことを検査 / outview = 同形式で、在るが画面内に見えないことを検査 / absent = 同形式で、レイアウトを持つ要素が1件も無いことを検査 / clock = 画面の Date を指定 ISO 日時から進む時計に固定 / standalone = ホーム画面アプリ(navigator.standalone)として開く / fixedMax = 固定高さ(上部バー下端+タブバー)の上限px と帯 0px の検査 / oneRow = 可視の子が1段に並ぶことを検査する selector 群 / tap = 高さ44px以上を検査する selector 群
export var THEMES = ['dark', 'light'];
var D = { width: 1280, height: 800 };
var M = { width: 390, height: 844 };
var HERO = { overview: '勝率', playstyle: '先落ち率', burst: '平均覚醒回数', matchup: '得意な敵機', time: '最も勝率が高い時間帯' };
var SUMMARY = function (tab) { return [['[data-ui="summary-hero"]', HERO[tab]], ['[data-ui="summary"] dt', null, 4], ['[data-ui="report-scope"]', '全期間・60試合']]; };
var TABS = { playstyle: '立ち回り', burst: '覚醒', matchup: '相性', time: '時間帯' };
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
var OPEN_DETAIL = OPEN_SEARCH.concat([{ click: ['[data-ui="search-result"]'] }]);
var OPEN_MATCH_NOTES = OPEN_DETAIL.concat([{ click: ['[data-ui="match-notes-toggle"]'] }]);
var OPEN_NOTE_SHEET = OPEN_MATCH_NOTES.concat([{ click: ['[data-ui="note-write"]'] }]);
var NOTE_TEXT = 'ui-check で書いたメモ';
var WRITE_NOTE = [{ type: ['[data-ui="note-sheet"] textarea', NOTE_TEXT] }];
// 自機は最初から機体が入る(指定しないで始まらない)
var MY_MS_FILLED = ['[data-ui="note-my"] [data-ui="select-trigger"]', '指定しない'];
var NOTE_SHEET_REQUIRED = [['[data-ui="note-sheet"] textarea'], ['[data-ui="note-enemy"]', null, 2], ['[data-ui="note-enemy"] [data-ui="select-trigger"]', 'ストームレイダー'], ['[data-ui="note-enemy"] [data-ui="select-trigger"]', 'ヴァルキュリア'],
  ['[data-ui="note-pin"]', 'ホームにピン留めする（最大3件）'], ['[data-ui="note-pin"] input:not(:checked)'], ['[data-ui="note-date-clear"]'],
  ['[data-ui="note-enemy-add"]'], ['[data-ui="note-my"] [data-ui="select-trigger"]'], ['[data-ui="note-partner"] [data-ui="select-trigger"]', '指定しない'], ['[data-ui="note-save"]'], ['[data-ui="match-detail"][inert], [inert] [data-ui="match-detail"]']];
var OPEN_FILTER = OPEN_SEARCH.concat([{ click: ['[data-ui="search-filter-toggle"]'] }, { click: ['[data-ui="search-winloss"] button', '勝利'] }]);
var COLLAPSED = ['[data-ui="topbar"][data-collapsed="true"]'];
var EXPANDED = ['[data-ui="topbar"][data-collapsed="false"]'];
var FILTER_ROW = '[data-ui="filter-bar"]';
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

var SHARED_SCOPE_OPS = [{ wait: ['[data-ui="report-scope"]'] }, { click: ['[data-ui="period-trigger"]'] }, { click: ['[data-ui="period-item"]', '7日'] },
  { click: ['[data-ui="ms-trigger"]'] }, { click: ['[data-ui="mode-toggle"] button', 'シャッフル'] }, { click: ['[data-ui="sheet-close"]'] },
  goTab('試合検索'), { wait: ['[data-ui="search-applied"]'] }];

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
    required: [[CURRENT, 'レポート'], ['[data-ui="tab"][aria-selected="true"]', '総合'], ['[data-ui="panel"] h2', '基本データ'], ['[data-ui="lens-toggle"] button[aria-pressed="true"]', '全体'], REANALYZE_BTN].concat(SUMMARY('overview')), absent: [['[data-ui="panel"] h2', 'シーズン別分析'], ['[data-ui="panel"] h2', '固定相方']] },
  { id: 'mobile-home-few', home: true, viewport: M, full: true, start: 'report-today-3', clock: '2026-10-08T22:00:00+09:00', ops: [goTab('ホーム'), { wait: ['[data-ui="today-card"]'] }],
    required: [[CURRENT, 'ホーム'], ['[data-ui="today-card"]', '今日 10/8'], ['[data-ui="today-compare"] tbody tr', null, 7]] },
  { id: 'mobile-home', home: true, viewport: M, full: true, start: 'report-today-12', clock: '2026-10-08T22:00:00+09:00', ops: [goTab('ホーム'), { wait: ['[data-ui="today-compare"]'] }],
    required: [[CURRENT, 'ホーム'], ['[data-ui="today-compare"] tbody tr', null, 7], ['[data-ui="panel"] h2', '勝率アップミッション'], ['[data-ui="mission-matches"]', '達成できなかった試合を見る']], tap: [TABBAR_ITEM, '[data-ui="mission-matches"]'] },
  { id: 'home', home: true, viewport: D, full: true, start: 'report-today-12', clock: '2026-10-08T22:00:00+09:00', ops: [goTab('ホーム'), { wait: ['[data-ui="today-compare"]'] }],
    required: [[CURRENT, 'ホーム'], ['[data-ui="today-compare"] tbody tr', null, 7], REANALYZE_BTN] },
  { id: 'mobile-home-last-day', home: true, viewport: M, full: true, start: 'report', clock: '2026-10-08T22:00:00+09:00', ops: [{ wait: ['[data-ui="today-compare"]'] }],
    required: [[CURRENT, 'ホーム'], ['[data-ui="today-card"]', '前回 6/15'], ['[data-ui="today-compare"]', 'その前 6/10']] },
  { id: 'mobile-home-badges-cleared', home: true, viewport: M, full: false, start: 'report-seen', clock: '2026-10-08T22:00:00+09:00',
    ops: [{ wait: ['[data-ui="tabbar-dot"]'] }, REPORT_TAB, { wait: ['[data-ui="report-scope"]'] }, goTab('ホーム'), { wait: ['[data-ui="today-compare"]'] }],
    required: [[CURRENT, 'ホーム'], ['[data-ui="tabbar-dot"]', null, 2]], absent: [['[data-ui="tabbar-item"]:nth-child(2) [data-ui="tabbar-dot"]']] },
  { id: 'mobile-home-badges', home: true, viewport: M, full: false, start: 'report-seen', clock: '2026-10-08T22:00:00+09:00', ops: [{ wait: ['[data-ui="tabbar-dot"]'] }],
    required: [[CURRENT, 'ホーム'], ['[data-ui="tabbar-dot"]', null, 3], ['[data-ui="tabbar-item"]:nth-child(5) [data-ui="tabbar-dot"]']],
    absent: [['[data-ui="tabbar-item"]:nth-child(4) [data-ui="tabbar-dot"]']] },
  report('report-playstyle', 'playstyle', ['被撃墜と勝率', 'ダメージ貢献率', '試合時間と勝率']),
  report('report-burst', 'burst', ['覚醒回数と勝率', '覚醒タイミング', 'OLスタンバイの順番と勝率']),
  report('report-matchup', 'matchup', ['敵機との相性', '相手の階級別勝率', '僚機との相性', '固定相方'], [['details[open] table'], ['[data-ui="panel"] [data-ui="row-list"]', null, 3]], [{ click: ['summary', '表で見る'] }]),
  { id: 'mobile-report-grade', viewport: M, full: false, start: 'report',
    ops: [{ wait: ['[data-ui="report-scope"]'] }, { click: ['[data-ui="tab"]', TABS.matchup] }, { scroll: ['[data-ui="grade-partner"]'] }, { click: ['[data-ui="grade-partner"] button', '∞'] }],
    required: [['[data-ui="panel"] h2', '相手の階級別勝率'], ['[data-ui="grade-partner"] button', null, 5], ['[data-ui="grade-partner"] button[aria-pressed="true"]', '∞'], ['[data-ui="facts"]', '階級が分からない']],
    inview: [['[data-ui="grade-partner"]']], tap: ['[data-ui="grade-partner"] button'] },
  report('report-time', 'time', ['時間帯別の勝率', '曜日別の勝率', 'シーズン別分析'], [['canvas']]),
  { id: 'dropdown-period', viewport: D, full: false, start: 'report', ops: [{ click: ['[data-ui="period-trigger"]'] }],
    required: [['[data-ui="period-panel"]'], ['[data-ui="period-item"]', null, 2]] },
  { id: 'dropdown-ms', viewport: D, full: false, start: 'report', ops: [{ click: ['[data-ui="ms-trigger"]'] }],
    required: [['[data-ui="ms-panel"]'], ['[data-ui="ms-item"]', null, 2]] },
  { id: 'search', viewport: D, full: true, start: 'report', ops: OPEN_SEARCH,
    required: [[CURRENT, '試合検索'], REANALYZE_BTN, ['[data-ui="search-filter-toggle"]', '絞り込み'], ['[data-ui="search-result"]', null, 20], ['[data-ui="search-result"] [data-ui="win-streak"]', '2連勝'], ['[data-ui="search-day"]'], ['[data-ui="search-sort-trigger"]', '日付が新しい順'], ['[data-ui="search-pager"]']] },
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
    tap: ['[data-ui="search-filter-apply"]', '[data-ui="search-filter-clear"]', '[data-ui="sheet-close"]', '[data-ui="search-enemy-mode"] button', '[data-ui="search-name-scope"] button', '[data-ui="search-winloss"] button', '[data-ui="search-mode"] button', '[data-ui="search-pattern-mode"] button', '[data-ui="search-pattern-item"]'] },
  // 詳細な条件の熟練度は⭐表記でランク順に並ぶ。自分・相方・相手の欄が揃う(#361)
  { id: 'mobile-search-proficiency', viewport: M, full: false, start: 'report',
    ops: OPEN_SEARCH.concat([{ click: ['[data-ui="search-filter-toggle"]'] }, { click: ['[data-ui="search-adv-toggle"]'] },
      { scroll: ['[data-ui="search-proficiency"]'] }, { click: ['[data-ui="search-proficiency"] [data-ui="select-trigger"]'] }]),
    required: [['[data-ui="search-proficiency"]', '自機熟練度'], ['[data-ui="search-partner-proficiency"]', '僚機熟練度'],
      ['[data-ui="search-rank"]', '自分の順位'], ['[data-ui="search-partner-rank"]', '相方の順位'],
      ['[data-ui="search-my-grade"]', '自分の階級'], ['[data-ui="search-partner-grade"]', '相方の階級'], ['[data-ui="search-enemy-grade"]', '相手の階級'],
      ['[data-ui="select-item"]', 'Legend'], ['[data-ui="select-item"]', 'Master'], ['[data-ui="select-item"]', '⭐17'], ['[data-ui="select-item"]', '⭐6']],
    inview: [['[data-ui="select-panel"]']] },
  // 他の画面へ移って戻っても条件が残る
  { id: 'mobile-search-applied', viewport: M, full: false, start: 'report', ops: OPEN_FILTER.concat([{ click: ['[data-ui="search-filter-apply"]'] }, { wait: ['[data-ui="search-applied"]'] }, goTab('ホーム'), { wait: [CURRENT, 'ホーム'] }, goTab('試合検索'), { wait: ['[data-ui="search-applied"]'] }]),
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
    inview: [['[data-ui="match-detail-back"]']], absent: [['[data-ui="match-timeline-toggle"]'], ['[data-ui="match-detail"] [data-ui="win-streak"]']], outview: [[TABBAR]],
    tap: ['[data-ui="match-detail-back"]', '[data-ui="radar-toggle"]'] },
  // 連勝中の勝ちは詳細にも連勝数を出す。負けの詳細には出さない(mobile-match-detail)
  { id: 'mobile-match-detail-streak', viewport: M, full: false, start: 'report', ops: OPEN_SEARCH.concat([{ click: ['[data-ui="search-result"]', '2連勝'] }]),
    required: [['[data-ui="match-result"]', '勝利'], ['[data-ui="match-result"] [data-ui="win-streak"]', '2連勝']], outview: [[TABBAR]] },
  // メモ(#389)。ログイン状態を保持した端末(report-session-valid)で、先頭の試合(ストームレイダー・ヴァルキュリア戦)の詳細から書く
  // 試合詳細のメモ欄は既定で閉じ、見出しに件数を出す。先頭の試合はストームレイダー2・ヴァルキュリア1・自機・僚機1の4件
  // 開く→閉じる→また開き、開いたまま試合詳細を出て開き直すと、閉じた状態に戻る
  { id: 'mobile-match-detail-notes-closed', viewport: M, full: false, start: 'report-session-valid',
    ops: OPEN_MATCH_NOTES.concat([{ wait: ['[data-ui="match-notes"]'] }, { click: ['[data-ui="match-notes-toggle"]'] }, { waitGone: ['[data-ui="match-notes"]'] },
      { click: ['[data-ui="match-notes-toggle"]'] }, { wait: ['[data-ui="match-notes"]'] }, { click: ['[data-ui="match-detail-back"]'] }, { waitGone: ['[data-ui="match-detail"]'] }, { click: ['[data-ui="search-result"]'] }, { wait: ['[data-ui="match-notes-toggle"]'] }]),
    required: [['[data-ui="match-notes-toggle"][aria-expanded="false"]', 'メモ'], ['[data-ui="match-notes-toggle"] small', '4件']], absent: [['[data-ui="match-notes"]']],
    tap: ['[data-ui="match-notes-toggle"]'] },
  { id: 'mobile-match-detail-notes', viewport: M, full: false, start: 'report-session-valid', ops: OPEN_MATCH_NOTES,
    required: [['[data-ui="match-notes-toggle"][aria-expanded="true"]', 'メモ'], ['[data-ui="match-notes"] [data-ui="note-item"]', '着地を見てから射撃を合わせる'], ['[data-ui="match-notes"] [data-ui="note-write"]'], ['[data-ui="match-notes"] h3', '自機・僚機'], ['[data-ui="match-notes"] [data-ui="note-item"]', '開幕は前に出すぎない']],
    absent: [['[data-ui="panel"] h2', '敵機のメモ'], ['[data-ui="note-pinned"]']], inview: [['[data-ui="match-notes"]']], tap: ['[data-ui="match-notes-toggle"]', '[data-ui="note-item"]', '[data-ui="note-write"]'] },
  // メモの印と絞り込み(#389)。先頭の試合の相手(ストームレイダー等)とガルーダ零にメモがある
  { id: 'mobile-search-notes', viewport: M, full: false, start: 'report-session-valid', ops: OPEN_SEARCH.concat([{ wait: ['[data-ui="search-result"] [data-ui="note-mark"]'] }]),
    required: [['[data-ui="search-result"] [data-ui="note-mark"]']] },
  { id: 'mobile-search-filter-notes', viewport: M, full: false, start: 'report-session-valid',
    ops: OPEN_SEARCH.concat([{ click: ['[data-ui="search-filter-toggle"]'] }, { click: ['[data-ui="search-note-filter"]'] }, { wait: ['[data-ui="search-applied"]'] }]),
    required: [['[data-ui="search-applied"]', 'メモがある試合'], ['[data-ui="search-result"] [data-ui="note-mark"]']],
    absent: [['[data-ui="search-result"]:not(:has([data-ui="note-mark"]))']], tap: ['[data-ui="search-note-filter"]'] },
  { id: 'mobile-report-matchup-notes', viewport: M, full: false, start: 'report-session-valid',
    ops: [{ wait: ['[data-ui="report-scope"]'] }, { click: ['[data-ui="tab"]', TABS.matchup] }, { click: ['[data-ui="row-list"] button', 'ガルーダ零'] }, { wait: ['[data-ui="enemy-notes"]'] }],
    required: [['[data-ui="panel"] [data-ui="note-mark"]'], ['[data-ui="enemy-notes"] [data-ui="note-item"]', '距離を詰められたら'], ['[data-ui="enemy-notes"] [data-ui="note-item"]', '格闘の間合いに入らない'], ['[data-ui="enemy-notes"] [data-ui="note-write"][aria-label="書く"] svg'], ['[data-ui="enemy-notes-head"]', 'メモ'], ['[data-ui="enemy-notes-head"] small', '2件']],
    inview: [['[data-ui="enemy-notes"]'], ['[data-ui="enemy-notes"] [data-ui="note-write"]']], tap: ['[data-ui="enemy-notes"] [data-ui="note-item"]', '[data-ui="enemy-notes"] [data-ui="note-write"]'] },
  { id: 'mobile-note-sheet', viewport: M, full: false, start: 'report-session-valid', ops: OPEN_NOTE_SHEET, required: NOTE_SHEET_REQUIRED, absent: [MY_MS_FILLED],
    tap: ['[data-ui="note-save"]', '[data-ui="note-enemy-remove"]', '[data-ui="note-enemy-add"]', '[data-ui="note-date-clear"]'] },
  { id: 'mobile-note-sheet-enemies', viewport: M, full: false, start: 'report-session-valid',
    ops: OPEN_NOTE_SHEET.concat([{ click: ['[data-ui="note-enemy-add"]'] }, { click: ['[data-ui="note-enemy"] [data-ui="select-trigger"]', '選んでください'] }, { click: ['[data-ui="select-item"]', 'ガルーダ零'] }]),
    required: [['[data-ui="note-enemy"]', null, 3], ['[data-ui="note-enemy"] [data-ui="select-trigger"]', 'ストームレイダー'], ['[data-ui="note-enemy"] [data-ui="select-trigger"]', 'ヴァルキュリア'], ['[data-ui="note-enemy"] [data-ui="select-trigger"]', 'ガルーダ零'],
      ['[data-ui="note-enemy-remove"]', null, 3], ['[data-ui="note-enemy-add"]'], ['[data-ui="note-date-clear"]']],
    tap: ['[data-ui="note-enemy-remove"]', '[data-ui="note-enemy-add"]', '[data-ui="note-date-clear"]'] },
  { id: 'note-sheet', viewport: D, full: false, start: 'report-session-valid', ops: OPEN_NOTE_SHEET, required: NOTE_SHEET_REQUIRED, absent: [MY_MS_FILLED] },
  { id: 'mobile-note-saved', viewport: M, full: false, start: 'report-session-valid', ops: OPEN_NOTE_SHEET.concat(WRITE_NOTE, [{ click: ['[data-ui="note-save"]'] }]),
    required: [['[data-ui="match-notes"] [data-ui="note-item"]', NOTE_TEXT], ['[data-ui="match-notes"] h3', 'ストームレイダー・ヴァルキュリア']], absent: [['[data-ui="note-sheet"]']] },
  { id: 'mobile-note-sheet-error', viewport: M, full: false, start: 'report-session-valid', ops: OPEN_NOTE_SHEET.concat([{ type: ['[data-ui="note-sheet"] textarea', '保存エラー'] }, { click: ['[data-ui="note-save"]'] }]), expectConsole: ['status of 500'],
    required: [['[data-ui="note-sheet"] [data-ui="notice"][role="alert"]', 'メモを保存できませんでした'], ['[data-ui="note-save"]:not([disabled])']] },
  // ホームのピン留めしたメモ(#689)。pins3=ピン3件・pins0=ピン0件
  { id: 'mobile-home-notes', home: true, viewport: M, full: false, start: 'report-session-pins3', clock: HOME_CLOCK, ops: [{ wait: ['[data-ui="home-notes"] [data-ui="note-item"]'] }],
    required: [['[data-ui="home-notes"] h2', 'ピン留めしたメモ'], ['[data-ui="home-notes"] [data-ui="note-item"]', null, 3], ['[data-ui="note-item"]', '6/15 ヴァルキュリア・ガルーダ零'], ['[data-ui="home-note-write"][aria-label="書く"] svg'], ['[data-ui="today-card"]']],
    absent: [['[data-ui="home-notes-all"]'], ['[data-ui="note-pinned"]']], inview: [['[data-ui="home-notes"]']], tap: ['[data-ui="home-notes"] [data-ui="note-item"]', '[data-ui="home-note-write"]'] },
  { id: 'home-notes', home: true, viewport: D, full: false, start: 'report-session-pins3', clock: HOME_CLOCK, ops: [{ wait: ['[data-ui="home-notes"] [data-ui="note-item"]'] }],
    required: [['[data-ui="home-notes"] h2', 'ピン留めしたメモ'], ['[data-ui="home-notes"] [data-ui="note-item"]', null, 3]],
    absent: [['[data-ui="note-pinned"]']] },
  { id: 'mobile-home-notes-swipe', home: true, viewport: M, full: false, start: 'report-session-pins3', clock: HOME_CLOCK,
    ops: [{ wait: ['[data-ui="home-notes"] [data-ui="note-item"]'] }, { swipe: ['[data-ui="home-notes"] [data-ui="note-swipe"]', -200] }, { touchTap: ['[data-ui="note-swipe-pin"]', 'ピンを外す'] }, { waitGone: ['[data-ui="home-notes"] [data-ui="note-item"]', '着地を見てから射撃を合わせる'] }],
    required: [['[data-ui="home-notes"] [data-ui="note-item"]', null, 2]], absent: [['[data-ui="home-notes"] [data-ui="note-item"]', '着地を見てから射撃を合わせる']] },
  { id: 'mobile-home-notes-empty', home: true, viewport: M, full: false, start: 'report-session-pins0', clock: HOME_CLOCK, ops: [{ wait: ['[data-ui="home-note-write"]'] }],
    required: [['[data-ui="home-notes"]', 'ピン留めすると'], ['[data-ui="home-note-write"][aria-label="書く"] svg'], ['[data-ui="today-card"]']],
    absent: [['[data-ui="home-notes"] h2'], ['[data-ui="home-notes-all"]'], ['[data-ui="home-notes"] [data-ui="note-item"]']], oneRow: ['[data-ui="home-notes"]'], tap: ['[data-ui="home-note-write"]'] },
  { id: 'mobile-home-note-sheet', home: true, viewport: M, full: false, start: 'report-session-valid', clock: HOME_CLOCK, ops: [{ wait: ['[data-ui="home-note-write"]'] }, { click: ['[data-ui="home-note-write"]'] }, { wait: ['[data-ui="note-sheet"]'] }],
    required: [['[data-ui="note-sheet"] textarea'], ['[data-ui="note-pin"] input:checked'], ['[data-ui="note-pin"]', 'ホームにピン留めする（最大3件）'], ['[data-ui="note-date-clear"]'], ['[data-ui="note-enemy-add"]'],
      ['[data-ui="note-my"] [data-ui="select-trigger"]'], ['[data-ui="home-notes"][inert], [inert] [data-ui="home-notes"]']],
    absent: [['[data-ui="note-enemy"]'], ['[data-ui="note-delete"]'], MY_MS_FILLED], tap: ['[data-ui="note-save"]', '[data-ui="note-enemy-add"]', '[data-ui="note-date-clear"]'] },
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
  // 試合の展開は複数選べ、すべて／どれかを切り替えられる
  { id: 'mobile-search-pattern-multi', viewport: M, full: false, start: 'report',
    ops: OPEN_SEARCH.concat([{ click: ['[data-ui="search-filter-toggle"]'] }, { click: ['[data-ui="search-pattern-item"]', '1機目で覚醒せず落ちた'] }, { click: ['[data-ui="search-pattern-item"]', '先落ちした'] },
      { click: ['[data-ui="search-pattern-mode"] button', 'どれかに当てはまる'] }, { wait: ['[data-ui="search-pattern-item"][aria-pressed="true"]', '先落ちした'] },
      { click: ['[data-ui="search-filter-apply"]'] }, { wait: ['[data-ui="search-applied"]'] }]),
    required: [['[data-ui="search-applied"]', '試合の展開（どれかに当てはまる）: 1機目で覚醒せず落ちた ほか1'], ['[data-ui="search-reason"]', '撃墜 ']], absent: [[SHEET]] },
  { id: 'mobile-match-detail-hit', viewport: M, full: false, start: 'report',
    ops: OPEN_SEARCH.concat([{ click: ['[data-ui="search-filter-toggle"]'] }, { click: ['[data-ui="search-pattern-item"]', '1機目で覚醒せず落ちた'] }, { click: ['[data-ui="search-filter-apply"]'] },
      { wait: ['[data-ui="search-reason"]'] }, { click: ['[data-ui="search-result"]'] }, { wait: ['[data-ui="match-note"]'] }, { scroll: ['[data-ui="gantt"]'] }]),
    required: [['[data-ui="match-note"]', '覚醒を使う前に'], ['[data-ui="gantt-death-hit"]']], inview: [['[data-ui="gantt-death-hit"]']] },
  { id: 'mobile-match-detail-ol-hit', viewport: M, full: false, start: 'report',
    ops: OPEN_SEARCH.concat([{ click: ['[data-ui="search-filter-toggle"]'] }, { click: ['[data-ui="search-pattern-item"]', 'オーバーリミットを覚醒と重ねずに使った'] }, { click: ['[data-ui="search-filter-apply"]'] },
      { wait: ['[data-ui="search-reason"]', 'OL発動 '] }, { click: ['[data-ui="search-result"]', '23:25'] }, { wait: ['[data-ui="match-note"]'] }, { scroll: ['[data-ui="gantt"]'] }]),
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
    ops: [goTab('その他'), { click: ['[data-ui="more-classrecord"] button'] }, { wait: ['h2', '通算記録'] }],
    required: [[CURRENT, 'その他'], ['[data-ui="classrecord-back"]', 'その他'], REANALYZE_BTN, ['[data-ui="summary-hero"]', '通算勝率'], ['h2', 'クラスマッチG戦績'], ['h2', '通算記録']] },
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
  { id: 'mobile-dropdown-mode', viewport: M, full: false, start: 'report', ops: [{ click: ['[data-ui="ms-trigger"]'] }, { click: ['[data-ui="mode-toggle"] button', 'シャッフル'] }, { wait: ['[data-ui="report-scope"]', '全期間・シャッフル・'] }],
    required: [['[data-ui="ms-panel"] h3', '対戦形式・機体'], ['[data-ui="mode-toggle"] button[aria-pressed="true"]', 'シャッフル'], ['[data-ui="ms-trigger"]', 'シャフ'], ['[data-ui="report-scope"]', '全期間・シャッフル・'], ['[data-ui="ms-item"]', null, 2]],
    tap: ['[data-ui="mode-toggle"] button', '[data-ui="ms-item"]', '[data-ui="sheet-close"]'] },
  { id: 'mobile-report-empty-mode', viewport: M, full: false, start: 'report-legacy',
    ops: [{ wait: ['[data-ui="report-scope"]'] }, { click: ['[data-ui="ms-trigger"]'] }, { click: ['[data-ui="mode-toggle"] button', '固定'] }, { click: ['[data-ui="sheet-close"]'] }, { wait: ['[data-ui="empty-state"]'] }],
    required: [['[data-ui="empty-state"] b', 'この対戦形式の試合はありません'], ['[data-ui="empty-action"]', '全形式に戻す'], ['[data-ui="ms-trigger"]', '固定']], inview: FILTERS,
    tap: ['[data-ui="empty-action"]'] },
  // レポートで選んだ期間・対戦形式が試合検索に適用中タグで出て、試合検索でクリアするとレポートも戻る
  { id: 'mobile-search-shared-scope', viewport: M, full: false, start: 'report', ops: SHARED_SCOPE_OPS,
    required: [['[data-ui="search-applied"]', '期間: 直近7日'], ['[data-ui="search-applied"]', '対戦形式: シャッフル'], ['[data-ui="search-clear"]', '条件をクリア']] },
  { id: 'mobile-report-shared-scope-cleared', viewport: M, full: false, start: 'report',
    ops: SHARED_SCOPE_OPS.concat([{ click: ['[data-ui="search-clear"]'] }, REPORT_TAB, { wait: SCOPE }]),
    required: [SCOPE, ['[data-ui="period-trigger"]', '全期間'], ['[data-ui="ms-trigger"]', '機体・形式']], oneRow: [FILTER_ROW] },
  // 試合検索のカレンダーで選んだ日付がレポートの期間に入る(1クリックで開始・終了の2更新が続いても消えない)
  { id: 'mobile-report-shared-dates', viewport: M, full: false, start: 'report', clock: '2026-06-20T12:00:00+09:00',
    ops: OPEN_SEARCH.concat([{ click: ['[data-ui="search-filter-toggle"]'] }, { click: ['[data-ui="search-adv-toggle"]'] }, { click: ['[data-ui="date-trigger"]'] },
      { click: ['[data-ui="cal-day"]', '1'] }, { click: ['[data-ui="cal-day"]', '5'] }, { click: ['[data-ui="search-filter-apply"]'] },
      { wait: ['[data-ui="search-applied"]', '日付: 2026-06-01〜2026-06-05'] }, REPORT_TAB, { wait: ['[data-ui="report-scope"]', '6/1~6/5'] }]),
    required: [['[data-ui="period-trigger"]', '6/1~6/5'], ['[data-ui="report-scope"]', '6/1~6/5・']], oneRow: [FILTER_ROW] },
  { id: 'mobile-home-mode', home: true, viewport: M, full: false, start: 'report', clock: HOME_CLOCK,
    ops: [{ wait: ['[data-ui="today-compare"]'] }, { click: ['[data-ui="ms-trigger"]'] }, { click: ['[data-ui="mode-toggle"] button', 'シャッフル'] }, { click: ['[data-ui="sheet-close"]'] }],
    required: [['[data-ui="ms-trigger"]', 'シャフ'], ['[data-ui="today-card"]', '4戦 2勝 2敗'], ['[data-ui="home"]', '35戦 勝率']], absent: [['[data-ui="ms-panel"]']] },
  { id: 'mobile-home-empty-mode', home: true, viewport: M, full: false, start: 'report-legacy', clock: HOME_CLOCK,
    ops: [{ wait: ['[data-ui="today-card"]'] }, { click: ['[data-ui="ms-trigger"]'] }, { click: ['[data-ui="mode-toggle"] button', '固定'] }, { click: ['[data-ui="sheet-close"]'] }, { wait: ['[data-ui="empty-state"]'] }],
    required: [['[data-ui="empty-state"] b', 'この対戦形式の試合はありません'], ['[data-ui="empty-action"]', '全形式に戻す']], absent: [['[data-ui="today-card"]']], tap: ['[data-ui="empty-action"]'] },
  // 機体と形式の両方を選ぶとチップに両方出る(絞り込み行は1段のまま)
  { id: 'mobile-ms-mode-chip', viewport: M, full: false, start: 'report',
    ops: [{ wait: ['[data-ui="report-scope"]'] }, { click: ['[data-ui="ms-trigger"]'] }, { click: ['[data-ui="mode-toggle"] button', 'シャッフル'] }, { click: ['[data-ui="ms-item"]', '戦)'] }, { wait: ['[data-ui="ms-trigger"]', '1機・シャフ'] }],
    required: [['[data-ui="ms-trigger"]', '1機・シャフ']], inview: FILTERS, absent: [['[data-ui="ms-panel"]']], oneRow: [FILTER_ROW] },
  { id: 'mobile-dropdown-ms', viewport: M, full: false, start: 'report', ops: [{ click: ['[data-ui="ms-trigger"]'] }],
    required: [['[data-ui="ms-panel"] h3', '機体'], ['[data-ui="ms-item"]', null, 2]],
    tap: ['[data-ui="ms-item"]', '[data-ui="sheet-close"]'] },
  { id: 'more', viewport: D, full: true, start: 'report', ops: [goTab('その他')],
    required: [[CURRENT, 'その他'], ['[data-ui="more"]'], ['[data-ui="share-item"]', null, 4], ['[data-ui="more-classrecord"] button', '総合戦歴'], ['[data-ui="more"] button', '再分析'], ['[data-ui="more-brand"] img']], tap: TAP_FORM },
  { id: 'mobile-more', viewport: M, full: true, start: 'report',
    ops: [goTab('試合検索'), { wait: ['[data-ui="search-filter"]'] }, goTab('メモ'), { wait: ['[data-ui="notes-view"] [data-ui="notice"]', 'ログイン状態を保持すると使えます'] }, goTab('その他'),
      { click: ['[data-ui="more-classrecord"] button', '総合戦歴'] }, { wait: ['h2', '通算記録'] }, { click: ['[data-ui="classrecord-back"]'] }, { wait: ['[data-ui="more-classrecord"]'] },
      { click: ['[data-ui="more-classrecord"] button', '総合戦歴'] }, { wait: ['h2', '通算記録'] }, { reload: true }, { wait: [CURRENT, 'ホーム'] }, goTab('その他')],
    required: [[CURRENT, 'その他'], ['[data-ui="more"]'], ['[data-ui="share-item"]', null, 4], ['[data-ui="more"] [data-ui="row-list"]', null, 3], [THEME_BTN + '[aria-pressed="true"]', '端末に合わせる'], [THEME_BTN, null, 3], ['[data-ui="more-classrecord"] button', '総合戦歴'], ['[data-ui="more"] button', '再分析'], ['[data-ui="more-brand"] img'], ['[data-ui="auto-refresh"] button', '有効にする'], ['[data-ui="auto-refresh"] input#autoRefreshPassphrase'], ['[data-ui="more"] a', 'ガンダムモバイルを開く'], ['[data-ui="more"] button', 'ログアウト'], ['footer', '非公式のファンツール']], absent: [['[data-ui="more-notes"]']], tap: TAP_FORM },
  // メモ一覧(#389)。fixture のメモ6件(敵機4件=3機体・日付1件・敵機と日付なし1件(僚機あり))
  { id: 'mobile-notes', viewport: M, full: false, start: 'report-session-valid', ops: [goTab('メモ'), { wait: ['[data-ui="note-list"] [data-ui="note-item"]'] }],
    required: [[CURRENT, 'メモ'], ['[data-ui="notes-view"] h2', 'メモ'], ['[data-ui="note-write"][aria-label="書く"] svg'], ['[data-ui="note-tabs"] button', null, 5], ['[data-ui="note-tabs"] button[aria-pressed="true"]', 'すべて'], ['[data-ui="note-list"] [data-ui="note-item"]', null, 6], ['[data-ui="note-tabs"] button', '日付 2'], ['[data-ui="note-tabs"] button', '自機 1'], ['[data-ui="note-tabs"] button', '僚機 1'], ['[data-ui="note-list"] > [data-ui="note-swipe"]:nth-of-type(2) [data-ui="note-pinned"][aria-label="ピン留め"] svg'], ['[data-ui="note-item"]', '6/15 ヴァルキュリア・ガルーダ零'], ['[data-ui="note-item"]', '僚機: ガルーダ零']],
    absent: [['[data-ui="note-list-back"]'], REANALYZE_BTN.slice(0, 1)], tap: ['[data-ui="note-tabs"] button', '[data-ui="note-item"]', '[data-ui="note-write"]'] },
  { id: 'mobile-notes-enemy', viewport: M, full: false, start: 'report-session-valid',
    ops: [goTab('メモ'), { wait: ['[data-ui="note-list"] [data-ui="note-item"]'] }, { click: ['[data-ui="note-tabs"] button', '敵機'] }],
    required: [['[data-ui="note-tabs"] button[aria-pressed="true"]', '敵機'], ['[data-ui="note-group"]', null, 3], ['[data-ui="note-group"]', '2件'], ['[data-ui="note-group"]', 'ガルーダ零'], ['[data-ui="note-list"] [data-ui="note-item"]', '格闘の間合いに入らない', 2], ['[data-ui="note-group"] ~ [data-ui="note-swipe"] [data-ui="note-pinned"]']],
    tap: ['[data-ui="note-tabs"] button', '[data-ui="note-item"]'] },
  // メモの行の左スワイプ。先頭はピン留めの preview-note-1。削除は2回目のタップで消える
  { id: 'mobile-notes-swipe', viewport: M, full: false, start: 'report-session-valid',
    ops: [goTab('メモ'), { wait: ['[data-ui="note-list"] [data-ui="note-item"]'] }, { swipe: ['[data-ui="note-swipe"]', -200] }, { wait: ['[data-ui="note-swipe-delete"]', '削除'] }],
    required: [['[data-ui="note-swipe-pin"]', 'ピンを外す'], ['[data-ui="note-swipe-delete"]', '削除']], inview: [['[data-ui="note-swipe-pin"]'], ['[data-ui="note-swipe-delete"]']],
    tap: ['[data-ui="note-swipe-pin"]', '[data-ui="note-swipe-delete"]'] },
  { id: 'mobile-notes-swipe-delete', viewport: M, full: false, start: 'report-session-valid',
    ops: [goTab('メモ'), { wait: ['[data-ui="note-list"] [data-ui="note-item"]'] }, { swipe: ['[data-ui="note-swipe"]', -200] }, { touchTap: ['[data-ui="note-swipe-delete"]', '削除'] },
      { wait: ['[data-ui="note-tabs"] button', 'すべて 5'] }],
    required: [['[data-ui="note-tabs"] button', 'すべて 5']], absent: [['[data-ui="note-item"]', '着地を見てから射撃を合わせる'], ['[data-ui="note-swipe-delete"]']] },
  // ピンが上限(3件)のとき、ピン無しの4件目をスワイプしてピン留めすると止まる。div の4つ目までは タブ行と先頭3件
  { id: 'mobile-notes-swipe-pin-limit', viewport: M, full: false, start: 'report-session-pins3',
    ops: [goTab('メモ'), { wait: ['[data-ui="note-list"] [data-ui="note-item"]'] }, { swipe: ['[data-ui="note-list"] > [data-ui="note-swipe"]:nth-of-type(5)', -200] }, { click: ['[data-ui="note-swipe-pin"]', 'ピン留め'] }, { wait: ['[data-ui="notice"]', 'ピン留めは3件までです'] }],
    required: [['[data-ui="note-list"] [data-ui="notice"]', 'ピン留めは3件までです'], ['[data-ui="note-swipe-pin"]', 'ピン留め']] },
  { id: 'mobile-notes-partner', viewport: M, full: false, start: 'report-session-valid',
    ops: [goTab('メモ'), { wait: ['[data-ui="note-list"] [data-ui="note-item"]'] }, { click: ['[data-ui="note-tabs"] button', '僚機'] }],
    required: [['[data-ui="note-tabs"] button[aria-pressed="true"]', '僚機'], ['[data-ui="note-group"]', null, 1], ['[data-ui="note-group"]', 'ガルーダ零'], ['[data-ui="note-list"] [data-ui="note-item"]', '開幕は前に出すぎない']],
    tap: ['[data-ui="note-tabs"] button', '[data-ui="note-item"]'] },
  { id: 'notes', viewport: D, full: false, start: 'report-session-valid', ops: [goTab('メモ'), { wait: ['[data-ui="note-list"] [data-ui="note-item"]'] }],
    required: [[CURRENT, 'メモ'], ['[data-ui="note-list"] [data-ui="note-item"]', null, 6], ['[data-ui="note-write"]']], absent: [REANALYZE_BTN.slice(0, 1)] },
  { id: 'mobile-notes-write', viewport: M, full: false, start: 'report-session-valid', clock: HOME_CLOCK, ops: [goTab('メモ'), { click: ['[data-ui="note-write"]'] }, { wait: ['[data-ui="note-sheet"]'] }],
    required: [['[data-ui="note-sheet"] textarea'], ['[data-ui="note-date-clear"]'], ['[data-ui="note-pin"] input:not(:checked)'], ['[data-ui="note-my"] [data-ui="select-trigger"]'], ['[data-ui="note-partner"] [data-ui="select-trigger"]', '指定しない'], ['[data-ui="note-enemy-add"]'], ['[data-ui="notes-view"][inert], [inert] [data-ui="notes-view"]']],
    absent: [['[data-ui="note-enemy"]'], ['[data-ui="note-delete"]'], MY_MS_FILLED], tap: ['[data-ui="note-save"]', '[data-ui="note-enemy-add"]', '[data-ui="note-date-clear"]'] },
  { id: 'mobile-classrecord', viewport: M, full: false, start: 'report-seen',
    ops: [goTab('その他'), { wait: ['[data-ui="more-classrecord"] [data-ui="row-dot"]'] }, { absentNow: ['[data-ui="tabbar-item"]:nth-child(5) [data-ui="tabbar-dot"]'] }, { click: ['[data-ui="more-classrecord"] button'] }, { wait: ['[data-ui="classrecord-back"]'] }],
    required: [[CURRENT, 'その他'], ['[data-ui="classrecord-back"]', 'その他'], ['[data-ui="summary-hero"]', '通算勝率'], ['h2', '通算記録']],
    absent: [REANALYZE_BTN.slice(0, 1), ['[data-ui="tabbar-item"]:nth-child(5) [data-ui="tabbar-dot"]']], tap: ['[data-ui="classrecord-back"]'] },
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
    required: [['[data-ui="empty-state"]', 'この期間の試合はありません'], ['[data-ui="empty-action"]', '期間を変更'], ['[data-ui="period-trigger"]', '6/3~6/3']],
    absent: [['[data-ui="skeleton"]']], tap: ['[data-ui="empty-action"]'] },
  { id: 'report-empty-period-back', viewport: M, full: false, start: 'report', clock: '2026-06-20T12:00:00+09:00',
    ops: EMPTY_OPS.concat([{ click: ['[data-ui="empty-action"]'] }, { wait: ['[data-ui="period-panel"]'] }, { click: ['[data-ui="period-item"]', '全期間'] }, { wait: ['[data-ui="report-scope"]'] },
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
