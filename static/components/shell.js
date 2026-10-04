import { html, useState } from '../htm-preact-standalone.js';
import { Panel } from './ui.js';
import { RowList } from './parts.js';
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
  var ref = useState(false);
  var copied = ref[0], setCopied = ref[1];
  function handleCopy() {
    navigator.clipboard.writeText(text).then(function () {
      setCopied(true);
      setTimeout(function () { setCopied(false); }, 2000);
    });
  }
  return html`<button type="button" class=${'share-item' + (copied ? ' copied' : '')} data-ui="share-item" onClick=${handleCopy} aria-label="テキストをコピー">
    <span class="share-icon share-copy" dangerouslySetInnerHTML=${{ __html: copied ? SVG_CHECK : SVG_COPY }} />${copied ? 'コピー済み' : 'コピー'}
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

// --- その他画面 ---

export function MoreView({ shareData, onLogout, onRebuildCache }) {
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
    { key: 'refetch', main: '試合データを取得し直す', sub: 'サーバーから全件を再取得します', expand: confirmPanel || null },
    { key: 'vsmobile', main: 'ガンダムモバイルを開く', sub: '外部サイト', href: 'https://web.vsmobile.jp/exvs2ib/' },
  ];
  var accountRows = [{ key: 'logout', main: 'ログアウト', sub: '保存したログイン情報も削除します', tone: 'danger' }];
  return html`<div data-ui="more">
    ${hasShare && html`<${Panel} title="結果を共有">
      <p class="more-lead">最多使用の機体と敵機との相性を文章にして共有します。</p>
      <${ShareArea} shareData=${shareData} />
    </${Panel}>`}
    <${Panel} title="データ">
      <${RowList} rows=${dataRows} onSelect=${function (k) { if (k === 'refetch') setConfirming(!confirming); }} />
    </${Panel}>
    <${Panel} title="アカウント">
      <${RowList} rows=${accountRows} onSelect=${function () { onLogout(); }} />
    </${Panel}>
  </div>`;
}

// 上部バー・本文・下部タブバーの外枠
export function AppShell({ topbarRef, onRefresh, controls, nav, children }) {
  return html`<div class=${'view-root' + (nav.view === 'more' ? ' view-more' : '')}>
    <div class="topbar" data-ui="topbar" ref=${topbarRef}>
      <div class="topbar-head">
        <span class="brand"><img src="logo.svg" alt="catalyzer" /></span>
        ${onRefresh && html`<button class="topbar-refresh" onClick=${onRefresh}>再分析</button>`}
      </div>
      ${controls}
    </div>
    ${children}
    <${TabBar} view=${nav.view} onNavigate=${nav.onNavigate} />
  </div>`;
}
