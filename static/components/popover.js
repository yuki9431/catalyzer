import { html, useState, useRef, useEffect } from '../htm-preact-standalone.js';

// responsive.css のモバイル切替幅と揃える。
export var SHEET_MAX_WIDTH = 720;

var BOTTOM_SHEET = {
  position: 'fixed', top: 'auto', bottom: '0', left: '0', right: '0', width: '100%', minWidth: '0',
  maxHeight: '70vh', margin: '0', borderRadius: '8px 8px 0 0',
};

// パネルの追加 style。anchor はトリガー直下(CSS 任せ)、sheet-top/bottom はモバイル幅のみ。
export function popoverStyle(mode, triggerRect, viewportWidth) {
  if (viewportWidth > SHEET_MAX_WIDTH) return {};
  if (mode === 'sheet-top') return triggerRect ? { top: triggerRect.bottom + 4 + 'px' } : {};
  if (mode === 'sheet-bottom') return Object.assign({}, BOTTOM_SHEET);
  return {};
}

// 外側クリックと Esc で閉じる処理の唯一の登録箇所。rootRef が null なら Esc のみ。
export function useDismiss(active, rootRef, onDismiss) {
  var cbRef = useRef(onDismiss);
  cbRef.current = onDismiss;
  var hasRoot = !!rootRef;
  useEffect(function () {
    if (!active) return;
    function onClick(e) { if (rootRef.current && !rootRef.current.contains(e.target)) cbRef.current(); }
    function onKey(e) { if (e.key === 'Escape') cbRef.current(); }
    if (hasRoot) document.addEventListener('click', onClick, true);
    document.addEventListener('keydown', onKey);
    return function () {
      if (hasRoot) document.removeEventListener('click', onClick, true);
      document.removeEventListener('keydown', onKey);
    };
  }, [active, hasRoot]);
}

export function usePopover(opts) {
  var o = opts || {};
  var mode = o.mode || 'anchor';
  var openRef = useState(false);
  var isOpen = openRef[0], setOpen = openRef[1];
  var rootRef = useRef(null);
  var triggerRef = useRef(null);

  function close() { setOpen(false); if (o.onClose) o.onClose(); }
  useDismiss(isOpen, rootRef, close);

  useEffect(function () {
    if (!o.lockScroll) return;
    document.body.style.overflow = isOpen && window.innerWidth <= SHEET_MAX_WIDTH ? 'hidden' : '';
    return function () { document.body.style.overflow = ''; };
  }, [isOpen]);

  var rect = isOpen && mode !== 'anchor' && triggerRef.current ? triggerRef.current.getBoundingClientRect() : null;
  return {
    isOpen: isOpen, mode: mode, rootRef: rootRef, triggerRef: triggerRef,
    open: function () { setOpen(true); },
    close: close,
    toggle: function () { if (isOpen) close(); else setOpen(true); },
    panelStyle: popoverStyle(mode, rect, window.innerWidth),
  };
}

// 閉なら何も描かない。クラス名は呼び出し側が渡す(既存 CSS を変えないため)。
export function Popover({ pop, panelClass, backdropClass, ui, title, children }) {
  if (!pop.isOpen) return null;
  var bc = backdropClass || (pop.mode === 'sheet-bottom' ? 'popover-backdrop' : null);
  return html`${bc && html`<div class=${bc} onClick=${pop.close} />`}<div class=${panelClass} style=${pop.panelStyle} data-ui=${ui} role=${title ? 'dialog' : undefined} aria-label=${title}>${title && html`<div class="ui-sheet-head"><h3>${title}</h3><button type="button" class="ui-sheet-close" data-ui="sheet-close" onClick=${pop.close}>閉じる</button></div>`}${children}</div>`;
}
