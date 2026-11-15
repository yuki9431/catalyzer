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

// IME の変換中の Esc は変換の取り消しなので閉じる操作として扱わない。
export function isEscape(e) { return e.key === 'Escape' && !e.isComposing && e.keyCode !== 229; }

// 層の中でドロップダウン等が開いている間の Esc は、それを閉じるためのもの。層は閉じない。
export function hasOpenPopup(root) { return !!root && !!root.querySelector('[aria-expanded="true"]'); }

// 外側クリックと Esc で閉じる処理の唯一の登録箇所。rootRef が null なら Esc のみ。
export function useDismiss(active, rootRef, onDismiss) {
  var cbRef = useRef(onDismiss);
  cbRef.current = onDismiss;
  var hasRoot = !!rootRef;
  useEffect(function () {
    if (!active) return;
    function onClick(e) { if (rootRef.current && !rootRef.current.contains(e.target)) cbRef.current(); }
    function onKey(e) { if (isEscape(e)) cbRef.current(); }
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

// 開いている全画面の層の順序。Esc で閉じるのは最上位の1枚だけにする。
export function createLayerStack() {
  var tokens = [];
  return {
    push: function (t) { tokens.push(t); },
    remove: function (t) { var i = tokens.indexOf(t); if (i >= 0) tokens.splice(i, 1); },
    isTop: function (t) { return tokens.length > 0 && tokens[tokens.length - 1] === t; },
  };
}

var layerStack = createLayerStack();

// 全画面の層。一覧はマウントしたまま背面に残し、背面スクロールは body・html の overflow で止める。
export function Layer({ ui, label, head, foot, footUi, onClose, children }) {
  var ref = useRef(null);
  var tokenRef = useRef(null);
  if (!tokenRef.current) { tokenRef.current = {}; layerStack.push(tokenRef.current); }
  // document の keydown は全ての層が聞くので、最上位でなければ何もしない
  useDismiss(true, null, function () { if (layerStack.isTop(tokenRef.current) && !hasOpenPopup(ref.current)) onClose(); });
  useEffect(function () {
    var y = window.scrollY, back = document.activeElement;
    var b = document.body.style.overflow, h = document.documentElement.style.overflow;
    document.body.style.overflow = 'hidden'; document.documentElement.style.overflow = 'hidden';
    // 背面（祖先ごとの兄弟）を inert にして Tab・クリックを層の外に出さない。
    var dimmed = [];
    for (var n = ref.current; n && n.parentNode && n !== document.documentElement; n = n.parentNode) {
      Array.prototype.forEach.call(n.parentNode.children, function (sib) {
        if (sib !== n && !sib.inert && sib.tagName !== 'SCRIPT') { sib.inert = true; dimmed.push(sib); }
      });
    }
    if (ref.current) ref.current.focus({ preventScroll: true });
    return function () {
      layerStack.remove(tokenRef.current);
      dimmed.forEach(function (d) { d.inert = false; });
      document.body.style.overflow = b; document.documentElement.style.overflow = h;
      if (window.scrollY !== y) window.scrollTo(0, y);
      if (back && back.focus) back.focus({ preventScroll: true });
    };
  }, []);
  return html`<div class="search-layer" data-ui=${ui} role="dialog" aria-modal="true" aria-label=${label} tabindex="-1" ref=${ref}>
    <div class="search-layer-head">${head}</div>
    <div class="search-layer-body">${children}</div>
    ${foot && html`<div class="search-layer-foot" data-ui=${footUi}>${foot}</div>`}
  </div>`;
}
