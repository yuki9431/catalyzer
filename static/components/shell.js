import { html, useState, useEffect, useLayoutEffect, useRef } from '../htm-preact-standalone.js';
import { Dropdown, Panel } from './ui.js';
import { RowList, Notice, ToggleGroup } from './parts.js';
import { describeStatus, errorMessage } from '../lib/autorefresh.js';
import { PULL_IDLE, pullStep, pullReady, BAR_SHOWN, nextBar } from '../lib/topbar.js';
import { TAB_SEEN_KEY, markSeen, tabBadges } from '../lib/tabseen.js';
import { EXPORT_PERIODS, reportFileName } from '../analysis/report-export.js';
import { buildShareText, SVG_X, SVG_BSKY, SVG_LINE, SVG_COPY, SVG_CHECK } from '../lib/format.js';

// --- 画面切替(下部タブバー) ---

export var VIEW_KEY = 'catalyzer_view';
export var TAB_ITEMS = [
  { key: 'home', label: 'ホーム' },
  { key: 'report', label: 'レポート' },
  { key: 'search', label: '試合検索' },
  { key: 'notes', label: 'メモ' },
  { key: 'more', label: 'その他' },
];

// その他の下の画面(下部タブには出さず、親タブを選択中として扱う)
var SUB_VIEWS = { classrecord: 'more' };

export function tabOf(view) {
  return Object.prototype.hasOwnProperty.call(SUB_VIEWS, view) ? SUB_VIEWS[view] : view;
}

// 下の画面の点は親タブに出す。表示中のタブには付けない
export function tabDot(badges, key, view) {
  if (!badges || key === tabOf(view)) return false;
  return !!badges[key] || Object.keys(SUB_VIEWS).some(function (s) { return SUB_VIEWS[s] === key && !!badges[s]; });
}

// アイコンは描画ごとに新しい vnode を返す(vnode の使い回しを避ける)
export var TAB_ICONS = {
  home: function () { return html`<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 11l8-7 8 7M6 9.5V20h12V9.5M10 20v-6h4v6" /></svg>`; },
  report: function () { return html`<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /></svg>`; },
  search: function () { return html`<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>`; },
  notes: function () { return html`<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 19l1-4L16 5l3 3L9 18l-4 1zM14 7l3 3" /></svg>`; },
  more: function () { return html`<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1.2" /><circle cx="12" cy="12" r="1.2" /><circle cx="19" cy="12" r="1.2" /></svg>`; },
};

// 保存値が TAB_ITEMS か SUB_VIEWS の key ならそれ、他(未保存・未知・例外)は起動時と同じ home
export function readView() {
  try {
    var v = localStorage.getItem(VIEW_KEY);
    return TAB_ITEMS.some(function (t) { return t.key === v; }) || Object.prototype.hasOwnProperty.call(SUB_VIEWS, v) ? v : 'home';
  } catch (e) {
    return 'home';
  }
}

// 再分析は Report を再マウントするため、画面を localStorage で永続化して復元する
export function useView() {
  var ref = useState(readView);
  var view = ref[0], setView = ref[1];
  function onNavigate(v) {
    setView(v);
    try { localStorage.setItem(VIEW_KEY, v); } catch (e) {}
    // 切替時にスクロールロックを確実に解除し先頭へ戻す(ヘッダーが下に固定される不具合の対処)
    document.body.style.overflow = '';
    document.documentElement.style.overflow = '';
    window.scrollTo(0, 0);
  }
  return { view: view, onNavigate: onNavigate };
}

function loadTabSeen(userKey) {
  try {
    var v = JSON.parse(localStorage.getItem(TAB_SEEN_KEY));
    if (!v || v.user_key !== userKey || !v.seen || typeof v.seen !== 'object') return null;
    var seen = {};
    Object.keys(v.seen).forEach(function (k) { if (Number.isFinite(v.seen[k])) seen[k] = v.seen[k]; });
    return seen;
  } catch (e) { return null; }
}

// signals: タブごとの「更新」を表す値(試合数など)。表示中のタブは見たものとして記録する
export function useTabBadges(userKey, signals, view) {
  var ref = useState(function () { return { key: userKey, seen: loadTabSeen(userKey) }; });
  var state = ref[0], setState = ref[1];
  var seen = state.key === userKey ? state.seen : loadTabSeen(userKey);
  var sig = JSON.stringify(signals);
  useEffect(function () {
    if (!userKey) return;
    var next = markSeen(seen, signals, view);
    if (next === seen && state.key === userKey) return;
    try { localStorage.setItem(TAB_SEEN_KEY, JSON.stringify({ user_key: userKey, seen: next })); } catch (e) {}
    setState({ key: userKey, seen: next });
  }, [userKey, sig, view]);
  return tabBadges(seen, signals, view);
}

function TabBar({ view, onNavigate, badges }) {
  return html`<nav class="tabbar" aria-label="画面切替" data-ui="tabbar">
    ${TAB_ITEMS.map(function (t) {
      var dot = tabDot(badges, t.key, view);
      return html`<button type="button" class="tabbar-item" data-ui="tabbar-item" aria-current=${tabOf(view) === t.key ? 'page' : undefined}
        onClick=${function () { onNavigate(t.key); }}><span class="tabbar-icon">${TAB_ICONS[t.key]()}${dot && html`<span class="tabbar-dot" data-ui="tabbar-dot"></span>`}</span>${t.label}${dot && html`<span class="visually-hidden">(更新あり)</span>`}</button>`;
    })}
  </nav>`;
}

// --- 共有 ---

// 非セキュアな接続では navigator.clipboard 自体が無い
function copyText(text) {
  return navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject(new Error('clipboard unavailable'));
}

function CopyButton({ text }) {
  var ref = useState('');
  var result = ref[0], setResult = ref[1];
  function show(r) {
    setResult(r);
    setTimeout(function () { setResult(''); }, 2000);
  }
  function handleCopy() {
    copyText(text).then(function () { show('copied'); }, function () { show('failed'); });
  }
  var copied = result === 'copied';
  var label = copied ? 'コピー済み' : result === 'failed' ? '失敗' : 'コピー';
  return html`<button type="button" class=${'share-item' + (copied ? ' copied' : '')} data-ui="share-item" onClick=${handleCopy} aria-label="テキストをコピー">
    <span class="share-icon share-copy" dangerouslySetInnerHTML=${{ __html: copied ? SVG_CHECK : SVG_COPY }} />${label}
  </button>`;
}

function ShareArea({ shareData }) {
  if (!shareData || !shareData.length) return null;
  var text = buildShareText(shareData);
  var encoded = encodeURIComponent(text);
  function link(href, cls, label, svg) {
    return html`<a href=${href} target="_blank" rel="noopener noreferrer" class="share-item" data-ui="share-item" aria-label=${label + 'で共有'}>
      <span class=${'share-icon ' + cls} dangerouslySetInnerHTML=${{ __html: svg }} />${label}
    </a>`;
  }
  return html`<div class="share-grid">
    ${link('https://x.com/intent/tweet?text=' + encoded, 'share-x', 'X', SVG_X)}
    ${link('https://bsky.app/intent/compose?text=' + encoded, 'share-bsky', 'Bluesky', SVG_BSKY)}
    ${link('https://line.me/R/share?text=' + encoded, 'share-line', 'LINE', SVG_LINE)}
    <${CopyButton} text=${text} />
  </div>`;
}

// --- 設定: テーマ ---
export var THEME_OPTIONS = [{ value: 'system', label: '端末に合わせる' }, { value: 'dark', label: 'ダーク' }, { value: 'light', label: 'ライト' }];

// 保存と適用は theme-init.js(window.catalyzerTheme)が持つ。読み込めていなければ出さない
function ThemeSettings() {
  var api = window.catalyzerTheme;
  var choiceRef = useState(api ? api.choice() : 'system'), choice = choiceRef[0], setChoice = choiceRef[1];
  if (!api) return null;
  return html`<div class="more-theme" data-ui="theme-setting">
    <span class="more-theme-label">テーマ</span>
    <${ToggleGroup} options=${THEME_OPTIONS} value=${choice} label="テーマ" ui="theme-toggle" onChange=${function (v) { api.set(v); setChoice(api.choice()); }} />
  </div>`;
}

// --- 設定: 自動更新 ---
// autoRefresh = { load(), set(enabled, passphrase), lastImportedAt() }(app.js から props で注入)。load/set は { status, body } を返し、通信失敗は status 0
function AutoRefreshSettings({ autoRefresh }) {
  var stRef = useState(null), st = stRef[0], setSt = stRef[1];
  var errRef = useState(''), error = errRef[0], setError = errRef[1];
  var passRef = useState(''), passphrase = passRef[0], setPassphrase = passRef[1];
  var statusRef = useState(0), errStatus = statusRef[0], setErrStatus = statusRef[1];
  var busyRef = useState(false), busy = busyRef[0], setBusy = busyRef[1];

  function apply(res) {
    if (res.status === 200 && res.body) { setSt(res.body); setError(''); return true; }
    setErrStatus(res.status);
    setError(errorMessage(res.status));
    return false;
  }
  var alive = useRef(true);
  useEffect(function () {
    autoRefresh.load().then(function (res) { if (alive.current) apply(res); });
    return function () { alive.current = false; };
  }, []);

  function submit(enabled) {
    // 合言葉は送信前に state から消す(失敗しても入力欄に残さない)
    var p = passphrase;
    setPassphrase('');
    setBusy(true);
    autoRefresh.set(enabled, p).then(function (res) { if (alive.current) { apply(res); setBusy(false); } });
  }

  // 保持していない・必要というのは異常でなく状態なので赤い警告にしない
  var errTone = errStatus === 401 || errStatus === 409 ? 'info' : 'error';
  if (!st) {
    return html`<div class="auto-refresh" data-ui="auto-refresh">
      ${error ? html`<${Notice} tone=${errTone}>${error}</${Notice}>` : html`<p class="more-lead">自動更新の状態を確認しています。</p>`}
    </div>`;
  }
  // 開いたまま取り込みが走っても最新を出すため、描画のたびに読む
  var d = describeStatus(st, autoRefresh.lastImportedAt());
  var row = [{ key: 'auto-refresh-status', main: '自動更新', sub: d.sub, aside: d.aside }];
  var on = st.available && st.enabled;
  // 合言葉欄は type=password だと IME が無効で日本語を打てない。spellcheck・autocorrect は文字列だと真になるので真偽値で渡す
  var off = st.available && !st.enabled;
  return html`<div class="auto-refresh" data-ui="auto-refresh">
    <${RowList} rows=${row} />
    ${off && html`<form class="auto-form" onSubmit=${function (e) { e.preventDefault(); submit(true); }}>
      ${st.passphrase_required && html`<label for="autoRefreshPassphrase">合言葉</label>
      <input id="autoRefreshPassphrase" type="text" autocomplete="off" autocapitalize="off" autocorrect=${false} spellcheck=${false} required value=${passphrase} onInput=${function (e) { setPassphrase(e.target.value); }} />`}
      <button type="submit" class="more-btn" disabled=${busy || (st.passphrase_required && !passphrase)}>有効にする</button>
    </form>`}
    ${on && html`<button type="button" class="more-btn-sub" disabled=${busy} onClick=${function () { submit(false); }}>無効にする</button>`}
    ${error && html`<${Notice} tone=${errTone}>${error}</${Notice}>`}
  </div>`;
}

// --- AI に渡すレポート ---

function saveText(filename, text) {
  var url = URL.createObjectURL(new Blob([text], { type: 'text/markdown;charset=utf-8' }));
  var a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Safari は click 直後に revoke すると保存に失敗することがある
  setTimeout(function () { URL.revokeObjectURL(url); }, 10000);
}

var EXPORT_SUB = { '': 'Markdown をクリップボードにコピーします', copied: 'コピーしました。AI のチャットに貼り付けてください', failed: 'コピーできませんでした。ダウンロードをお試しください', empty: 'この期間・機体の試合がありません' };

function ReportExport({ report }) {
  var ref = useState('');
  var status = ref[0], setStatus = ref[1];
  var pRef = useState('all'), period = pRef[0], setPeriod = pRef[1];
  var mRef = useState(''), setMs = mRef[1];
  var msOptions = report.msOptions(period);
  // 選んだ機体がその期間に無ければ全機体に戻す(表示と出力を食い違わせない)
  var ms = msOptions.some(function (o) { return o.value === mRef[0]; }) ? mRef[0] : '';
  function show(r) {
    setStatus(r);
    setTimeout(function () { setStatus(''); }, 3000);
  }
  // 生成は押したときだけ行う(描画のたびに全集計を回さない)。clipboard の操作起点を保つため同期で作る
  function run(key) {
    var text = report.build({ period: period, ms: ms });
    if (!text) { show('empty'); return; }
    if (key === 'download') { saveText(reportFileName(new Date()), text); return; }
    copyText(text).then(function () { show('copied'); }, function () { show('failed'); });
  }
  var rows = [
    { key: 'copy', main: 'レポートをコピー', sub: EXPORT_SUB[status] },
    { key: 'download', main: 'レポートをダウンロード', sub: status === 'empty' ? EXPORT_SUB.empty : 'Markdown ファイル(.md)で保存します' },
  ];
  return html`<div data-ui="report-export">
    <p class="more-lead">選んだ期間・機体の集計を AI エージェントが読める形にまとめます。プレイヤー名は含めません。</p>
    <div class="more-field" data-ui="report-export-period"><span>期間</span><${Dropdown} value=${period} options=${EXPORT_PERIODS} noClear onChange=${setPeriod} /></div>
    <div class="more-field" data-ui="report-export-ms"><span>機体</span><${Dropdown} value=${ms} options=${msOptions} placeholder="全機体" onChange=${setMs} /></div>
    <${RowList} rows=${rows} onSelect=${run} />
  </div>`;
}

// --- その他画面 ---

export function MoreView({ shareData, report, onLogout, onRebuildCache, onReanalyze, autoRefresh, onClassRecord, classRecordDot }) {
  var ref = useState(false);
  var confirming = ref[0], setConfirming = ref[1];
  var hasShare = !!(shareData && shareData.length);
  var confirmPanel = confirming && html`<div class="more-confirm" data-ui="refetch-confirm">
    <p>試合データをサーバーから全件取得し直します。</p>
    <div class="more-confirm-actions">
      <button type="button" class="more-confirm-ok" onClick=${function () { setConfirming(false); window.scrollTo(0, 0); onRebuildCache(); }}>取得し直す</button>
      <button type="button" class="more-confirm-cancel" onClick=${function () { setConfirming(false); }}>やめる</button>
    </div>
  </div>`;
  var dataRows = [
    { key: 'reanalyze', main: '再分析', sub: '公式サイトから新しい戦績を取得して分析し直します' },
    { key: 'refetch', main: '試合データを取得し直す', sub: 'サーバーから全件を再取得します', expand: confirmPanel || null },
    { key: 'vsmobile', main: 'ガンダムモバイルを開く', sub: '外部サイト', href: 'https://web.vsmobile.jp/exvs2ib/' },
  ];
  var classRows = [{ key: 'classrecord', main: '総合戦歴', sub: 'ガンダムモバイルの通算戦績と通算記録', dot: !!classRecordDot }];
  var accountRows = [{ key: 'logout', main: 'ログアウト', sub: '保存したログイン情報と端末内の試合データを削除します', tone: 'danger' }];
  return html`<div data-ui="more">
    <div class="more-brand" data-ui="more-brand"><img src="logo.svg" alt="catalyzer" /></div>
    <${Panel} title="戦績">
      <div data-ui="more-classrecord"><${RowList} rows=${classRows} onSelect=${function () { onClassRecord(); }} /></div>
    </${Panel}>
    ${hasShare && html`<${Panel} title="結果を共有">
      <p class="more-lead">最多使用の機体と敵機との相性を文章にして共有します。</p>
      <${ShareArea} shareData=${shareData} />
    </${Panel}>`}
    ${report && html`<${Panel} title="レポート出力">
      <${ReportExport} report=${report} />
    </${Panel}>`}
    <${Panel} title="設定">
      <${ThemeSettings} />
      <${AutoRefreshSettings} autoRefresh=${autoRefresh} />
    </${Panel}>
    <${Panel} title="データ">
      <${RowList} rows=${dataRows} onSelect=${function (k) { if (k === 'reanalyze') onReanalyze(); else if (k === 'refetch') setConfirming(!confirming); }} />
    </${Panel}>
    <${Panel} title="アカウント">
      <${RowList} rows=${accountRows} onSelect=${function () { onLogout(); }} />
    </${Panel}>
  </div>`;
}

// 下スクロールで絞り込み行を隠し、上に少し戻すと出す(隠す見た目はスマホ幅の CSS だけ)
function useCollapsingBar(enabled) {
  var barRef = useRef(null), tabsRef = useRef(null);
  var cState = useState(false), collapsed = cState[0], setCollapsed = cState[1];
  var sState = useState(0), shift = sState[0], setShift = sState[1];
  useLayoutEffect(function () {
    if (!enabled) return undefined;
    var st = BAR_SHOWN, raf = 0;
    function apply() {
      raf = 0;
      var bar = barRef.current, tabs = tabsRef.current;
      // シート表示中に隠れ状態へ遷移すると visibility:hidden が fixed のシートに継承されて消える
      if (!bar || !tabs || scrollLocked()) return;
      var sh = Math.round(tabs.getBoundingClientRect().top - bar.getBoundingClientRect().top);
      var top = bar.parentElement.getBoundingClientRect().top + window.scrollY + sh;
      var max = document.documentElement.scrollHeight - window.innerHeight;
      st = nextBar(st, window.scrollY, { top: top, max: max });
      setShift(sh);
      setCollapsed(st.hidden);
    }
    function schedule() { if (!raf) raf = requestAnimationFrame(apply); }
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule, { passive: true });
    apply();
    return function () {
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [enabled]);
  return { barRef: barRef, tabsRef: tabsRef, collapsed: collapsed, shift: shift };
}

// シート・モーダル表示中は body か html の overflow が hidden になる
function scrollLocked() {
  return document.body.style.overflow === 'hidden' || document.documentElement.style.overflow === 'hidden';
}

// レポート最上部で下に引っ張ると再分析する。表示は引っ張り中だけ上部バーの上に差し込む
function PullToRefresh({ onPull, canPull }) {
  var latest = useRef();
  latest.current = { onPull: onPull, canPull: canPull };
  var pState = useState(PULL_IDLE), pull = pState[0], setPull = pState[1];
  useLayoutEffect(function () {
    var st = PULL_IDLE;
    function step(ev, e) {
      var r = pullStep(st, ev);
      st = r.state;
      if (r.prevent && e && e.cancelable) e.preventDefault();
      if (r.fire) latest.current.onPull();
      setPull(function (prev) { return prev.phase === st.phase && prev.distance === st.distance ? prev : st; });
    }
    function point(e) { return e.touches[0]; }
    function onStart(e) {
      if (e.touches.length !== 1) return step({ type: 'cancel' }, e);
      var c = latest.current.canPull;
      var p = point(e);
      step({ type: 'start', x: p.clientX, y: p.clientY, scrollY: window.scrollY, enabled: !scrollLocked() && !!(c && c()) }, e);
    }
    function onMove(e) {
      if (st.phase === 'idle' || !e.touches.length) return;
      var p = point(e);
      step({ type: 'move', x: p.clientX, y: p.clientY, scrollY: window.scrollY }, e);
    }
    function onEnd(e) { step({ type: 'end' }, e); }
    function onCancel(e) { step({ type: 'cancel' }, e); }
    document.addEventListener('touchstart', onStart, { passive: true });
    document.addEventListener('touchmove', onMove, { passive: false });
    document.addEventListener('touchend', onEnd, { passive: true });
    document.addEventListener('touchcancel', onCancel, { passive: true });
    return function () {
      document.removeEventListener('touchstart', onStart);
      document.removeEventListener('touchmove', onMove);
      document.removeEventListener('touchend', onEnd);
      document.removeEventListener('touchcancel', onCancel);
    };
  }, []);
  if (pull.phase !== 'pulling') return null;
  return html`<div class="pull-zone" data-ui="pull-indicator" aria-hidden="true" style=${{ height: pull.distance + 'px' }}>
    <span class="pull-icon"><svg viewBox="0 0 24 24"><path d="M20 12a8 8 0 1 1-2.34-5.66M20 4v5h-5" /></svg></span>
    <span>${pullReady(pull) ? '離すと再分析' : '引っ張って再分析'}</span>
  </div>`;
}

// 上部バー(絞り込み行+タブ行)・本文・下部タブバーの外枠。絞り込みもタブも無い画面の上部バーは safe-area だけ
export function AppShell({ filters, tabs, trailing, onPull, canPull, nav, children }) {
  var bare = !filters && !tabs;
  var collapsible = !!(filters && tabs);
  var bar = useCollapsingBar(collapsible);
  return html`<div class=${'view-root' + (nav.view === 'more' ? ' view-more' : '')}>
    ${onPull && html`<${PullToRefresh} onPull=${onPull} canPull=${canPull} />`}
    <div class=${'topbar' + (bare ? ' topbar-bare' : '')} data-ui="topbar" data-collapsed=${collapsible && bar.collapsed ? 'true' : 'false'} ref=${bar.barRef}
      style=${collapsible ? { '--topbar-shift': bar.shift + 'px' } : undefined}>
      ${filters}
      ${bare && trailing && html`<div class="topbar-trailing">${trailing}</div>`}
      ${tabs && html`<div class="topbar-tabs" ref=${bar.tabsRef}>${tabs}</div>`}
    </div>
    ${children}
    <${TabBar} view=${nav.view} onNavigate=${nav.onNavigate} badges=${nav.badges} />
  </div>`;
}
