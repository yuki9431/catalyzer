import { html, useState, useEffect, useLayoutEffect, useRef } from '../htm-preact-standalone.js';
import { Panel } from './ui.js';
import { RowList, Notice } from './parts.js';
import { describeStatus, errorMessage } from '../lib/autorefresh.js';
import { PULL_IDLE, pullStep, pullReady, BAR_SHOWN, nextBar } from '../lib/topbar.js';
import { buildShareText, SVG_X, SVG_BSKY, SVG_LINE, SVG_COPY, SVG_CHECK } from '../lib/format.js';

// --- 画面切替(下部タブバー) ---

export var VIEW_KEY = 'catalyzer_view';
export var TAB_ITEMS = [
  { key: 'report', label: 'レポート' },
  { key: 'search', label: '試合検索' },
  { key: 'classrecord', label: '総合戦歴' },
  { key: 'more', label: 'その他' },
];

// アイコンは描画ごとに新しい vnode を返す(vnode の使い回しを避ける)
var TAB_ICONS = {
  report: function () { return html`<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /></svg>`; },
  search: function () { return html`<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>`; },
  classrecord: function () { return html`<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4h14v16H5zM9 9h6M9 13h6M9 17h3" /></svg>`; },
  more: function () { return html`<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1.2" /><circle cx="12" cy="12" r="1.2" /><circle cx="19" cy="12" r="1.2" /></svg>`; },
};

// 保存値が TAB_ITEMS の key ならそれ、他(未保存・未知・例外)は report
export function readView() {
  try {
    var v = localStorage.getItem(VIEW_KEY);
    return TAB_ITEMS.some(function (t) { return t.key === v; }) ? v : 'report';
  } catch (e) {
    return 'report';
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

function TabBar({ view, onNavigate }) {
  return html`<nav class="tabbar" aria-label="画面切替" data-ui="tabbar">
    ${TAB_ITEMS.map(function (t) {
      return html`<button type="button" class="tabbar-item" data-ui="tabbar-item" aria-current=${view === t.key ? 'page' : undefined}
        onClick=${function () { onNavigate(t.key); }}>${TAB_ICONS[t.key]()}${t.label}</button>`;
    })}
  </nav>`;
}

// --- 共有 ---

function CopyButton({ text }) {
  var ref = useState('');
  var result = ref[0], setResult = ref[1];
  function show(r) {
    setResult(r);
    setTimeout(function () { setResult(''); }, 2000);
  }
  function handleCopy() {
    // 非セキュアな接続では navigator.clipboard 自体が無い
    var p = navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject(new Error('clipboard unavailable'));
    p.then(function () { show('copied'); }, function () { show('failed'); });
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

// --- その他画面 ---

export function MoreView({ shareData, onLogout, onRebuildCache, onReanalyze, autoRefresh }) {
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
  var accountRows = [{ key: 'logout', main: 'ログアウト', sub: '保存したログイン情報も削除します', tone: 'danger' }];
  return html`<div data-ui="more">
    <div class="more-brand" data-ui="more-brand"><img src="logo.svg" alt="catalyzer" /></div>
    ${hasShare && html`<${Panel} title="結果を共有">
      <p class="more-lead">最多使用の機体と敵機との相性を文章にして共有します。</p>
      <${ShareArea} shareData=${shareData} />
    </${Panel}>`}
    <${Panel} title="設定">
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
    <${TabBar} view=${nav.view} onNavigate=${nav.onNavigate} />
  </div>`;
}
