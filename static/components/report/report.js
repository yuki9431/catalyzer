import { html, useEffect, useMemo, useState } from '../../htm-preact-standalone.js';
import { PERIOD_DAYS, computeBasicStats, computeBurstCount, computeBurstTiming, computeBurstType, computeConsecutiveFall, computeCostPair, computeDailyTrend, computeDayOfWeek, computeDmgContribution, computeEnemyMatchup, computeFallOrder, computeFixedPartners, computeGameDuration, computeMsPair, computeMsSummary, computeOverlimit, computePartner, computeSeason, computeShareData, computeTeamDeathsImpact, computeTimeOfDay, computeWinLossPattern, filterByPlayDays } from '../../analysis/stats.js';
import { computeActionPlan } from '../../analysis/coach.js';
import { emptyFilters } from '../../analysis/search.js';
import { loadMatchesFromDB } from '../../lib/db.js';
import { AppShell, MoreView, useTabBadges, useView } from '../shell.js';
import { SearchView } from '../search.js';
import { ClassRecordView } from '../classrecord.js';
import { Chip } from '../parts.js';
import { BurstPane } from './burst.js';
import { LensToggle, MsSelector, PERIOD_KEYS, PeriodSelector } from './controls.js';
import { MatchupPane } from './matchup.js';
import { OverviewPane } from './overview.js';
import { PlaystylePane } from './playstyle.js';
import { ReportSummary } from './summary.js';
import { TimePane } from './time.js';
import { HomeView } from '../home.js';

var TAB_DEFS = [
  ['overview', '総合'],
  ['playstyle', '立ち回り'],
  ['burst', '覚醒'],
  ['matchup', '機体相性'],
  ['time', '時間帯'],
];

// 要約の上に出す対象範囲。期間・機体・勝敗レンズを「・」で連結する
function scopeText(periodKey, periods, ms, lens) {
  var parts = [periodKey === 'all' ? '全期間' : periodKey === 'custom' ? (periods.custom ? periods.custom.label : '日付指定') : '直近' + periods[periodKey].label];
  if (ms) parts.push(ms);
  if (lens === 'win') parts.push('勝利のみ');
  else if (lens === 'loss') parts.push('敗北のみ');
  return parts.join('・');
}

// 広い画面の再分析ボタン(スマホ幅は CSS で非表示)。分析中は押せない
function reanalyzeButton(actions) {
  return html`<button type="button" class="controls-reanalyze" data-ui="reanalyze-button" disabled=${actions.canReanalyze ? !actions.canReanalyze() : false} onClick=${actions.onReanalyze}>再分析</button>`;
}

function pullAction(actions) { return actions.pullEnabled ? actions.onReanalyze : null; }

export function Report({ data, userKey, actions }) {
  var periodRef = useState('all');
  var selectedPeriod = periodRef[0], setSelectedPeriod = periodRef[1];
  var customRangeRef = useState(null);
  var customRange = customRangeRef[0], setCustomRange = customRangeRef[1];
  var tabRef = useState('overview');
  var activeTab = tabRef[0], setActiveTab = tabRef[1];
  var msRef = useState(null);
  var selectedMs = msRef[0], setSelectedMs = msRef[1];
  var lensRef = useState('all');
  var lens = lensRef[0], setLens = lensRef[1];
  var periodOpenRef = useState(0);
  var periodOpen = periodOpenRef[0], setPeriodOpen = periodOpenRef[1];
  var nav = useView();
  var view = nav.view;
  // ホームのミッションから開いた試合検索の初期条件。search 以外の画面では持ち越さない
  var presetRef = useState(null);
  var searchPreset = presetRef[0], setSearchPreset = presetRef[1];
  useEffect(function () { if (view !== 'search') setSearchPreset(null); }, [view]);
  var matchesRef = useState(data.matches || null);
  var allMatches = matchesRef[0], setAllMatches = matchesRef[1];
  var tagPartnersRef = useState(null);
  var tagPartners = tagPartnersRef[0], setTagPartners = tagPartnersRef[1];
  var msImagesRef = useState(null);
  var msImages = msImagesRef[0], setMsImages = msImagesRef[1];
  // key=userKey で再マウントされるが、念のため userKey ごとに値を持ち別ユーザーの値を表示しない
  var classRecordRef = useState(function () { return { key: userKey, record: loadClassRecord(userKey) }; });
  var classRecordState = classRecordRef[0], setClassRecordState = classRecordRef[1];
  var classRecord = classRecordState.key === userKey ? classRecordState.record : null;
  // class_record を含まない再描画（速報・キャッシュ再構築）では消さない
  useEffect(function () {
    if (data.class_record) {
      setClassRecordState({ key: userKey, record: data.class_record });
      saveClassRecord(userKey, data.class_record);
    } else if (classRecordState.key !== userKey) {
      setClassRecordState({ key: userKey, record: loadClassRecord(userKey) });
    }
  }, [data, userKey]);
  // 分析直後は結果に相方が入っている(ログイン状態を保持していなくても出せる)
  useEffect(function () {
    if (data.tag_partners) setTagPartners(data.tag_partners);
  }, [data]);
  var msNationalRef = useState(null);
  var msNational = msNationalRef[0], setMsNational = msNationalRef[1];

  // 機体名→画像URLのマップを一度だけ取得（試合検索一覧のサムネイル表示用）。
  useEffect(function () {
    fetch('/ms-list')
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (list) {
        if (!list) return;
        var map = {};
        list.forEach(function (m) { if (m && m.Name) map[m.Name] = m.ImageURL; });
        setMsImages(map);
      })
      .catch(function () {});
  }, []);

  // 機体名→全国統計（勝率・使用率）のマップを取得（自分の勝率との比較表示用）。
  // サーバーが起動時に読み込む静的データなので一度だけでよい。
  useEffect(function () {
    fetch('/national-ms-stats')
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (list) {
        if (!list || !list.length) return;
        var map = {};
        list.forEach(function (m) { if (m && m.name) map[m.name] = m; });
        setMsNational(map);
      })
      .catch(function () {});
  }, []);

  // renderReport は同じインスタンスを再利用するため useState の初期値は初回しか効かない。
  // 速報の段階更新を受け取るには data の差し替えを明示的に取り込む必要がある。
  useEffect(function () {
    var m = data.matches;
    if (!m || !m.length) return;
    setAllMatches(function (prev) {
      return prev && prev.length >= m.length ? prev : m;
    });
  }, [data]);

  useEffect(function () {
    if (!userKey) return;
    loadMatchesFromDB(userKey).then(function (matches) {
      if (matches && matches.length > 0) setAllMatches(function (prev) {
        return prev && prev.length >= matches.length ? prev : matches;
      });
    }).catch(function () {});
    fetch('/tag-partners')
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) { if (d && d.tag_partners && d.user_key === userKey) setTagPartners(d.tag_partners); })
      .catch(function () {});
  }, [userKey]);

  // view 切替時にスクロールロック解除と先頭復帰。再マウント時にも効かせるため onNavigate と二重に持つ
  useEffect(function () {
    document.body.style.overflow = '';
    document.documentElement.style.overflow = '';
    window.scrollTo(0, 0);
  }, [view]);

  var PERIOD_LABELS = { all: '全データ', '90d': '90日', '60d': '60日', '30d': '30日', '14d': '14日', '7d': '7日', '3d': '3日', '1d': '1日' };
  var periods = {};
  PERIOD_KEYS.forEach(function (k) { periods[k] = { label: PERIOD_LABELS[k] }; });
  if (customRange) periods.custom = { label: customRange.start.substring(5, 10) + ' ~ ' + customRange.end.substring(5, 10) };

  var frontendData = useMemo(function () {
    if (!allMatches || !allMatches.length) return null;
    var periodFiltered = allMatches;
    var days = PERIOD_DAYS[selectedPeriod];
    if (days) periodFiltered = filterByPlayDays(allMatches, days);
    if (selectedPeriod === 'custom' && customRange) {
      periodFiltered = allMatches.filter(function (m) {
        return m.date >= customRange.start && m.date <= customRange.end;
      });
    }
    if (!periodFiltered.length) return { empty: true };
    var msSummary = computeMsSummary(periodFiltered);
    var shareItems = computeShareData(periodFiltered);
    var filtered = periodFiltered;
    if (selectedMs) filtered = filtered.filter(function (m) { return m.ms === selectedMs; });
    // 勝敗レンズ: 選択時はレポート全体を勝ち/負け試合のみに絞る（MS一覧・共有データは母集団のまま）
    if (lens === 'win') filtered = filtered.filter(function (m) { return m.win; });
    else if (lens === 'loss') filtered = filtered.filter(function (m) { return !m.win; });
    if (!filtered.length) return { ms_summary: msSummary, share_data: shareItems };
    return {
      ms_summary: msSummary,
      share_data: shareItems,
      time_of_day: computeTimeOfDay(filtered),
      day_of_week: computeDayOfWeek(filtered),
      daily_trend: computeDailyTrend(filtered),
      season: computeSeason(filtered),
      basic_stats: computeBasicStats(filtered),
      win_loss_pattern: computeWinLossPattern(filtered),
      enemy_matchup: computeEnemyMatchup(filtered),
      partner: computePartner(filtered),
      cost_pair: computeCostPair(filtered),
      ms_pair: computeMsPair(filtered),
      dmg_contribution: computeDmgContribution(filtered),
      team_deaths: computeTeamDeathsImpact(filtered),
      burst_count: computeBurstCount(filtered),
      fall_order: computeFallOrder(filtered),
      consecutive_fall: computeConsecutiveFall(filtered),
      burst_timing: computeBurstTiming(filtered),
      burst_type: computeBurstType(filtered),
      overlimit: computeOverlimit(filtered),
      game_duration: computeGameDuration(filtered),
      fixed_partners: computeFixedPartners(filtered, tagPartners),
    };
  }, [allMatches, selectedPeriod, selectedMs, lens, tagPartners, customRange]);

  var msStats = (frontendData && frontendData.ms_summary) || {};
  var msEntries = useMemo(function () {
    return Object.keys(msStats).sort(function (a, b) { return msStats[b].matches - msStats[a].matches; }).map(function (name) {
      return { name: name, matches: msStats[name].matches };
    });
  }, [msStats]);

  // ホームは期間で絞らないため、期間内に無い機体の解除はレポート表示中だけ行う
  useEffect(function () {
    if (view === 'report' && selectedMs && !msStats[selectedMs]) setSelectedMs(null);
  }, [msStats, view]);

  var shareData = (frontendData && frontendData.share_data) || [];
  // ホームは期間で絞らないので、機体の候補も全期間から作る
  var homeMsEntries = useMemo(function () {
    var counts = {};
    (allMatches || []).forEach(function (m) { if (m.ms) counts[m.ms] = (counts[m.ms] || 0) + 1; });
    return Object.keys(counts).sort(function (a, b) { return counts[b] - counts[a]; }).map(function (name) { return { name: name, matches: counts[name] }; });
  }, [allMatches]);
  // ホーム画面のミッションは期間に依らず全期間で診断する
  var homePlan = useMemo(function () {
    var ms = allMatches || [];
    return computeActionPlan(selectedMs ? ms.filter(function (m) { return m.ms === selectedMs; }) : ms);
  }, [allMatches, selectedMs]);

  function showMatches(link) {
    var f = emptyFilters();
    f.myMsList = selectedMs ? [selectedMs] : [];
    f.goal = link.goal;
    if (link.focusRange) f.focusRange = link.focusRange;
    setSearchPreset(f);
    nav.onNavigate('search');
  }

  function handleCustomReport(range) {
    setCustomRange(range);
    setSelectedPeriod('custom');
  }

  var fePd = useMemo(function () {
    if (frontendData && frontendData.basic_stats) {
      return { basic_stats: frontendData.basic_stats, win_loss_pattern: frontendData.win_loss_pattern };
    }
    return { basic_stats: null, win_loss_pattern: null };
  }, [frontendData]);

  // 試合検索ビュー: ダッシュボードのフィルタ群とは独立した専用画面。
  // allMatches（IndexedDBキャッシュ）を共有し、フロントエンドで絞り込む。
  var count = allMatches ? allMatches.length : null;
  nav.badges = useTabBadges(userKey, { home: count, report: count, search: count, classrecord: classRecord && classRecord.total ? classRecord.total.matches : null }, view);
  if (view === 'home') {
    var msOnly = html`<div class="controls-row" data-ui="filter-bar">
        <${MsSelector} entries=${homeMsEntries} selected=${selectedMs} onSelect=${setSelectedMs} />
        ${reanalyzeButton(actions)}
      </div>`;
    return html`<${AppShell} nav=${nav} filters=${msOnly} onPull=${pullAction(actions)} canPull=${actions.canReanalyze}>
      <${HomeView} matches=${allMatches || []} selectedMs=${selectedMs} userKey=${userKey} plan=${homePlan} onShowMatches=${showMatches} />
    </${AppShell}>`;
  }
  if (view === 'search') {
    return html`<${AppShell} nav=${nav} trailing=${reanalyzeButton(actions)} onPull=${pullAction(actions)} canPull=${actions.canReanalyze}>
      <${SearchView} matches=${allMatches || []} msImages=${msImages || {}} initialFilters=${searchPreset} />
    </${AppShell}>`;
  }

  if (view === 'classrecord') {
    return html`<${AppShell} nav=${nav} trailing=${reanalyzeButton(actions)} onPull=${pullAction(actions)} canPull=${actions.canReanalyze}>
      <${ClassRecordView} record=${classRecord} analyzedCount=${(allMatches || []).length} />
    </${AppShell}>`;
  }

  if (view === 'more') {
    return html`<${AppShell} nav=${nav}>
      <${MoreView} shareData=${shareData} onLogout=${actions.onLogout} onRebuildCache=${actions.onRebuildCache} onReanalyze=${function () { nav.onNavigate('report'); actions.onReanalyze(); }} autoRefresh=${actions.autoRefresh} />
    </${AppShell}>`;
  }

  if (!frontendData) {
    return html`<${Skeleton} actions=${actions} nav=${nav} />`;
  }

  var pane;
  if (frontendData.empty) {
    pane = html`<${EmptyPeriod} scope=${scopeText(selectedPeriod, periods, null, 'all')} onChangePeriod=${function () { setPeriodOpen(periodOpen + 1); }} />`;
  } else if (activeTab === 'playstyle') {
    pane = html`<${PlaystylePane} frontendData=${frontendData} />`;
  } else if (activeTab === 'burst') {
    pane = html`<${BurstPane} frontendData=${frontendData} />`;
  } else if (activeTab === 'matchup') {
    pane = html`<${MatchupPane} frontendData=${frontendData} />`;
  } else if (activeTab === 'time') {
    var timePd = { time_of_day: frontendData.time_of_day, day_of_week: frontendData.day_of_week, daily_trend: frontendData.daily_trend };
    pane = html`<${TimePane} pd=${timePd} />`;
  } else {
    pane = html`<${OverviewPane} pd=${fePd} selectedMs=${selectedMs} lens=${lens} frontendData=${frontendData} msNational=${msNational || {}} />`;
  }

  var filters = html`<div class="controls-row" data-ui="filter-bar">
        <${PeriodSelector} periods=${periods} selected=${selectedPeriod} onSelect=${setSelectedPeriod}
          userKey=${userKey} onCustomReport=${handleCustomReport} openSignal=${periodOpen} />
        <${MsSelector} entries=${msEntries} selected=${selectedMs} onSelect=${setSelectedMs} />
        <${LensToggle} lens=${lens} onSelect=${setLens} />
        ${reanalyzeButton(actions)}
      </div>`;
  var tabs = html`<div class="tabs" role="tablist">${TAB_DEFS.map(function (t) {
        return html`<button data-ui="tab" role="tab" aria-selected=${activeTab === t[0]} class=${'tab' + (activeTab === t[0] ? ' active' : '')}
          onClick=${function () { setActiveTab(t[0]); }}>${t[1]}</button>`;
      })}</div>`;

  return html`<${AppShell} filters=${filters} tabs=${tabs} onPull=${pullAction(actions)} canPull=${actions.canReanalyze} nav=${nav}>
    ${!frontendData.empty && html`<${ReportSummary} activeTab=${activeTab} frontendData=${frontendData} scope=${scopeText(selectedPeriod, periods, selectedMs, lens)} />`}

    ${pane}
  </${AppShell}>`;
}

// 日付指定で期間内の試合が0件のとき、本文の代わりに出す(絞り込み行は本物のまま残し、期間を変えて戻れる)
function EmptyPeriod({ scope, onChangePeriod }) {
  return html`<div class="report-empty" data-ui="empty-state" role="status">
    <b>この期間の試合はありません</b>
    <p>${scope} に試合がありません。期間を広げると表示されます。</p>
    <button type="button" class="ui-action" data-ui="empty-action" onClick=${onChangePeriod}>期間を変更</button>
  </div>`;
}

// ログイン成功後、データ到着までのダッシュボード骨組み表示
export function Skeleton({ actions, nav }) {
  var own = useView();
  var n = nav || own;
  function bar(w, h, mb) {
    return html`<div class="skel" data-ui="skeleton" style=${{ width: w, height: h + 'px', marginBottom: (mb || 0) + 'px' }}></div>`;
  }
  var filters = html`<div class="controls-row" style=${{ opacity: 0.5, pointerEvents: 'none' }}>
        <${Chip} expanded=${false}><span class="ui-chip-text">全データ</span></${Chip}>
        <${Chip} expanded=${false}><span class="ui-chip-text">全機体</span></${Chip}>
        <${LensToggle} lens=${'all'} onSelect=${function () {}} />
      </div>`;
  var tabs = html`<div class="tabs" role="tablist" style=${{ opacity: 0.5, pointerEvents: 'none' }}>
        ${TAB_DEFS.map(function (t) {
          return html`<button data-ui="tab" role="tab" aria-selected=${t[0] === 'overview'} class=${'tab' + (t[0] === 'overview' ? ' active' : '')} disabled>${t[1]}</button>`;
        })}
      </div>`;
  if (n.view === 'home') {
    var msOnly = html`<div class="controls-row" style=${{ opacity: 0.5, pointerEvents: 'none' }}>
        <${Chip} expanded=${false}><span class="ui-chip-text">全機体</span></${Chip}>
      </div>`;
    return html`<${AppShell} filters=${msOnly} nav=${n}>
      <div class="panel">${bar('40%', 16, 14)}${[0, 1, 2].map(function () { return bar('100%', 14, 10); })}</div>
      <div class="panel">${bar('30%', 16, 14)}${bar('100%', 160)}</div>
    </${AppShell}>`;
  }
  if (n.view === 'more') {
    return html`<${AppShell} nav=${n}>
      <${MoreView} shareData=${null} onLogout=${actions.onLogout} onRebuildCache=${actions.onRebuildCache} onReanalyze=${function () { n.onNavigate('report'); actions.onReanalyze(); }} autoRefresh=${actions.autoRefresh} />
    </${AppShell}>`;
  }
  return html`<${AppShell} filters=${filters} tabs=${tabs} nav=${n}>
    <div class="report-summary">
      <div class="ui-summary">${bar('30%', 14, 10)}${bar('40%', 44, 20)}${bar('100%', 56)}</div>
    </div>
    <div class="panel">
      ${bar('30%', 16, 14)}${bar('100%', 220)}
    </div>
    <div class="panel">
      ${bar('24%', 16, 14)}
      ${[0, 1, 2, 3].map(function () { return bar('100%', 14, 10); })}
    </div>
  </${AppShell}>`;
}

// 通算戦績は /result でしか届かないため、リロード後も表示できるよう最終取得値を user_key 付きで保持する
export var CLASS_RECORD_KEY = 'catalyzer_class_record';

function loadClassRecord(userKey) {
  try {
    var v = JSON.parse(localStorage.getItem(CLASS_RECORD_KEY));
    return userKey && v && v.user_key === userKey && v.record && v.record.total ? v.record : null;
  } catch (e) {
    return null;
  }
}

function saveClassRecord(userKey, record) {
  if (!userKey) return;
  try { localStorage.setItem(CLASS_RECORD_KEY, JSON.stringify({ user_key: userKey, record: record })); } catch (e) {}
}
