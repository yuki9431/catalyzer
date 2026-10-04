import { html, useEffect, useMemo, useRef, useState } from '../../htm-preact-standalone.js';
import { PERIOD_DAYS, computeBasicStats, computeBurstCount, computeBurstTiming, computeBurstType, computeConsecutiveFall, computeCostPair, computeDailyTrend, computeDayOfWeek, computeDmgContribution, computeEnemyMatchup, computeFallOrder, computeFixedPartners, computeMsPair, computeMsSummary, computePartner, computeSeason, computeShareData, computeTeamDeathsImpact, computeTimeOfDay, computeWinLossPattern, filterByPlayDays } from '../../analysis/stats.js';
import { computeActionPlan } from '../../analysis/coach.js';
import { loadMatchesFromDB } from '../../lib/db.js';
import { AppShell, MoreView, useView } from '../shell.js';
import { SearchView } from '../search.js';
import { ClassRecordView } from '../classrecord.js';
import { BurstPane } from './burst.js';
import { LensToggle, MsSelector, PERIOD_KEYS, PeriodSelector } from './controls.js';
import { KpiGrid } from './kpi.js';
import { MatchupPane } from './matchup.js';
import { OverviewPane } from './overview.js';
import { PlaystylePane } from './playstyle.js';
import { TimePane } from './time.js';

var TAB_DEFS = [
  ['overview', '総合'],
  ['playstyle', '立ち回り'],
  ['burst', '覚醒'],
  ['matchup', '機体相性'],
  ['time', '時間帯'],
];

export function Report({ data, userKey, actions }) {
  if (!data) return null;
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
  var nav = useView();
  var view = nav.view;
  var matchesRef = useState(data.matches || null);
  var allMatches = matchesRef[0], setAllMatches = matchesRef[1];
  var tagPartnersRef = useState(null);
  var tagPartners = tagPartnersRef[0], setTagPartners = tagPartnersRef[1];
  var msImagesRef = useState(null);
  var msImages = msImagesRef[0], setMsImages = msImagesRef[1];
  // Report は再描画で使い回されるため、どの userKey の値かを持ち、別ユーザーの値を表示しない
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
  var msNationalRef = useState(null);
  var msNational = msNationalRef[0], setMsNational = msNationalRef[1];
  var topbarRef = useRef(null);

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
    fetch('/tag-partners?user_key=' + encodeURIComponent(userKey))
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) { if (d && d.tag_partners) setTagPartners(d.tag_partners); })
      .catch(function () {});
  }, [userKey]);

  useEffect(function () {
    var row = topbarRef.current && topbarRef.current.querySelector('.controls-row');
    if (!row) return;
    function onScroll() {
      if (window.scrollY > 50) {
        row.style.maxHeight = '0';
        row.style.opacity = '0';
        row.style.paddingTop = '0';
        row.style.overflow = 'hidden';
        row.style.pointerEvents = 'none';
      } else {
        row.style.maxHeight = '';
        row.style.opacity = '';
        row.style.paddingTop = '';
        row.style.overflow = '';
        row.style.pointerEvents = '';
      }
    }
    window.addEventListener('scroll', onScroll, { passive: true });
    return function () { window.removeEventListener('scroll', onScroll); };
  }, []);

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
    if (!periodFiltered.length) return null;
    var msSummary = computeMsSummary(periodFiltered);
    var shareItems = computeShareData(periodFiltered);
    var filtered = periodFiltered;
    if (selectedMs) filtered = filtered.filter(function (m) { return m.ms === selectedMs; });
    // アクションプランは勝ち負け両方の比較が必要なので勝敗レンズ適用前の試合で計算する
    var actionPlan = computeActionPlan(filtered);
    // 勝敗レンズ: 選択時はレポート全体を勝ち/負け試合のみに絞る（MS一覧・共有データは母集団のまま）
    if (lens === 'win') filtered = filtered.filter(function (m) { return m.win; });
    else if (lens === 'loss') filtered = filtered.filter(function (m) { return !m.win; });
    if (!filtered.length) return { ms_summary: msSummary, share_data: shareItems, action_plan: actionPlan };
    return {
      ms_summary: msSummary,
      share_data: shareItems,
      action_plan: actionPlan,
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
      fixed_partners: computeFixedPartners(filtered, tagPartners),
    };
  }, [allMatches, selectedPeriod, selectedMs, lens, tagPartners, customRange]);

  var msStats = (frontendData && frontendData.ms_summary) || {};
  var msEntries = useMemo(function () {
    return Object.keys(msStats).sort(function (a, b) { return msStats[b].matches - msStats[a].matches; }).map(function (name) {
      return { name: name, matches: msStats[name].matches };
    });
  }, [msStats]);

  useEffect(function () {
    if (selectedMs && !msStats[selectedMs]) setSelectedMs(null);
  }, [msStats]);

  var shareData = (frontendData && frontendData.share_data) || [];

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
  if (view === 'search') {
    return html`<${AppShell} onRefresh=${actions.onReanalyze} nav=${nav}>
      <${SearchView} matches=${allMatches || []} msImages=${msImages || {}} />
    </${AppShell}>`;
  }

  if (view === 'classrecord') {
    return html`<${AppShell} onRefresh=${actions.onReanalyze} nav=${nav}>
      <${ClassRecordView} record=${classRecord} analyzedCount=${(allMatches || []).length} />
    </${AppShell}>`;
  }

  if (view === 'more') {
    return html`<${AppShell} nav=${nav}>
      <${MoreView} shareData=${shareData} onLogout=${actions.onLogout} onRebuildCache=${actions.onRebuildCache} />
    </${AppShell}>`;
  }

  if (!frontendData) {
    return html`<${Skeleton} actions=${actions} nav=${nav} />`;
  }

  var pane;
  if (activeTab === 'playstyle') {
    pane = html`<${PlaystylePane} frontendData=${frontendData} />`;
  } else if (activeTab === 'burst') {
    pane = html`<${BurstPane} frontendData=${frontendData} />`;
  } else if (activeTab === 'matchup') {
    pane = html`<${MatchupPane} frontendData=${frontendData} />`;
  } else if (activeTab === 'time') {
    var timePd = { time_of_day: frontendData.time_of_day, day_of_week: frontendData.day_of_week, daily_trend: frontendData.daily_trend };
    pane = html`<${TimePane} pd=${timePd} />`;
  } else {
    pane = html`<${OverviewPane} pd=${fePd} selectedMs=${selectedMs} lens=${lens} frontendData=${frontendData} msNational=${msNational || {}} allMatches=${allMatches} userKey=${userKey} />`;
  }

  var controls = html`<div class="controls-row">
        <${PeriodSelector} periods=${periods} selected=${selectedPeriod} onSelect=${setSelectedPeriod}
          userKey=${userKey} onCustomReport=${handleCustomReport} />
        <${MsSelector} entries=${msEntries} selected=${selectedMs} onSelect=${setSelectedMs} />
        <${LensToggle} lens=${lens} onSelect=${setLens} />
      </div>
      <div class="tabs" role="tablist">${TAB_DEFS.map(function (t) {
        return html`<button data-ui="tab" role="tab" aria-selected=${activeTab === t[0]} class=${'tab' + (activeTab === t[0] ? ' active' : '')}
          onClick=${function () { setActiveTab(t[0]); }}>${t[1]}</button>`;
      })}</div>`;

  return html`<${AppShell} topbarRef=${topbarRef} onRefresh=${actions.onReanalyze} controls=${controls} nav=${nav}>
    <${KpiGrid} activeTab=${activeTab} frontendData=${frontendData} />

    ${pane}
  </${AppShell}>`;
}

// ログイン成功後、データ到着までのダッシュボード骨組み表示
export function Skeleton({ actions, nav }) {
  var own = useView();
  var n = nav || own;
  function bar(w, h, mb) {
    return html`<div class="skel" data-ui="skeleton" style=${{ width: w, height: h + 'px', marginBottom: (mb || 0) + 'px' }}></div>`;
  }
  var controls = html`<div class="controls-row" style=${{ opacity: 0.5, pointerEvents: 'none' }}>
        <button class="period-trigger" disabled>全データ <span class="period-arrow">▼</span></button>
        <button class="ms-topbar-trigger" disabled>全機体 <span class="period-arrow">▼</span></button>
        <${LensToggle} lens=${'all'} onSelect=${function () {}} />
      </div>
      <div class="tabs" role="tablist" style=${{ opacity: 0.5, pointerEvents: 'none' }}>
        ${TAB_DEFS.map(function (t) {
          return html`<button data-ui="tab" role="tab" aria-selected=${t[0] === 'overview'} class=${'tab' + (t[0] === 'overview' ? ' active' : '')} disabled>${t[1]}</button>`;
        })}
      </div>`;
  if (n.view === 'more') {
    return html`<${AppShell} nav=${n}>
      <${MoreView} shareData=${null} onLogout=${actions.onLogout} onRebuildCache=${actions.onRebuildCache} />
    </${AppShell}>`;
  }
  return html`<${AppShell} controls=${controls} nav=${n}>
    <div class="kpi-grid">
      ${[0, 1, 2, 3, 4, 5].map(function () {
        return html`<div class="kpi">${bar('50%', 12, 12)}${bar('70%', 28)}</div>`;
      })}
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
