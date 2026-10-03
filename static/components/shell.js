import { html, useState, useEffect } from '../htm-preact-standalone.js';
import { useDismiss } from './popover.js';
import { buildShareText, SVG_X, SVG_BSKY, SVG_LINE, SVG_COPY, SVG_CHECK } from '../lib/format.js';

// --- Share area ---

function ShareArea({ shareData }) {
  if (!shareData || !shareData.length) return null;
  var text = buildShareText(shareData);
  var encoded = encodeURIComponent(text);
  var xUrl = 'https://x.com/intent/tweet?text=' + encoded;
  var bskyUrl = 'https://bsky.app/intent/compose?text=' + encoded;
  var lineUrl = 'https://line.me/R/share?text=' + encoded;

  function CopyButton() {
    var ref = useState(false);
    var copied = ref[0], setCopied = ref[1];
    function handleCopy() {
      navigator.clipboard.writeText(text).then(function () {
        setCopied(true);
        setTimeout(function () { setCopied(false); }, 2000);
      });
    }
    return html`<button class=${'share-btn share-copy' + (copied ? ' copied' : '')} onClick=${handleCopy} aria-label="テキストをコピー"
      dangerouslySetInnerHTML=${{ __html: copied ? SVG_CHECK : SVG_COPY }} />`;
  }

  return html`<div class="share-area">
    <span class="share-label">共有</span>
    <a href=${xUrl} target="_blank" rel="noopener noreferrer" class="share-btn share-x" aria-label="Xで共有" dangerouslySetInnerHTML=${{ __html: SVG_X }} />
    <a href=${bskyUrl} target="_blank" rel="noopener noreferrer" class="share-btn share-bsky" aria-label="Blueskyで共有" dangerouslySetInnerHTML=${{ __html: SVG_BSKY }} />
    <a href=${lineUrl} target="_blank" rel="noopener noreferrer" class="share-btn share-line" aria-label="LINEで共有" dangerouslySetInnerHTML=${{ __html: SVG_LINE }} />
    <${CopyButton} />
  </div>`;
}

// --- Hamburger menu & topbar controls ---

function HamburgerMenu({ isOpen, onClose, shareData, onLogout, currentView, onNavigate, onRebuildCache }) {
  useEffect(function () {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return function () { document.body.style.overflow = ''; };
  }, [isOpen]);

  useDismiss(isOpen, null, onClose);
  if (!isOpen) return null;
  var view = currentView || 'report';
  function go(target) {
    if (onNavigate) onNavigate(target);
    onClose();
  }
  return html`<div>
    <div class="menu-backdrop" onClick=${onClose} />
    <div class=${'menu-drawer' + (isOpen ? ' open' : '')}>
      <div class="menu-header"><img src="logo.svg" alt="catalyzer" style="height:24px;width:auto;" /></div>
      <div class="menu-body">
        <div class="menu-section">メニュー</div>
        <button data-ui="menu-item" class=${'menu-item' + (view === 'report' ? ' active' : '')} onClick=${function () { go('report'); }}><span class="menu-icon">📊</span>分析レポート</button>
        <button data-ui="menu-item" class=${'menu-item' + (view === 'search' ? ' active' : '')} onClick=${function () { go('search'); }}><span class="menu-icon">🔍</span>試合検索</button>
        <button data-ui="menu-item" class=${'menu-item' + (view === 'classrecord' ? ' active' : '')} onClick=${function () { go('classrecord'); }}><span class="menu-icon">📈</span>モバイル総合戦歴</button>
        <button data-ui="menu-item" class="menu-item disabled"><span class="menu-icon">🏆</span>EXランキング<span class="coming-soon">coming soon</span></button>
        <button data-ui="menu-item" class="menu-item disabled"><span class="menu-icon">🤖</span>機体使用率ランキング<span class="coming-soon">coming soon</span></button>
        <div class="menu-divider" />
        <a data-ui="menu-item" class="menu-item" href="https://web.vsmobile.jp/exvs2ib/" target="_blank" rel="noopener noreferrer"><span class="menu-icon">🌐</span>ガンダムモバイル<span class="external-icon">↗</span></a>
        <div class="menu-divider" />
        <div style="padding: 8px 16px;">
          <${ShareArea} shareData=${shareData} />
        </div>
        <div class="menu-divider" />
        ${onRebuildCache && html`<button data-ui="menu-item" class="menu-item" onClick=${function () { onClose(); onRebuildCache(); }}><span class="menu-icon">🔄</span>データを再取得</button>`}
        <button data-ui="menu-item" class="menu-item" style="color: var(--bad)" onClick=${function () { onClose(); onLogout(); }}>ログアウト</button>
      </div>
    </div>
  </div>`;
}


// 上部バー・メニュー・本文の外枠。メニュー開閉はここが持つ
export function AppShell({ topbarRef, onRefresh, controls, menu, children }) {
  var menuRef = useState(false);
  var menuOpen = menuRef[0], setMenuOpen = menuRef[1];
  return html`<div class="view-root">
    <div class="topbar" data-ui="topbar" ref=${topbarRef}>
      <button class="hamburger" data-ui="menu-open" onClick=${function () { setMenuOpen(true); }}>☰</button>
      <span class="brand"><img src="logo.svg" alt="catalyzer" /></span>
      ${onRefresh && html`<button class="topbar-refresh" onClick=${onRefresh}>再分析</button>`}
      ${controls}
    </div>
    <${HamburgerMenu} isOpen=${menuOpen} onClose=${function () { setMenuOpen(false); }}
      shareData=${menu.shareData} onLogout=${menu.onLogout} currentView=${menu.currentView} onNavigate=${menu.onNavigate} onRebuildCache=${menu.onRebuildCache} />
    ${children}
  </div>`;
}
