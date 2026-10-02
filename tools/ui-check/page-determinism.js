// ページ読込前に注入する決定性処理(IO スタブ・Chart アニメ無効・CSS アニメ無効)
function install() {
  window.IntersectionObserver = class {
    constructor(cb) { this.cb = cb; }
    observe(el) { var self = this; Promise.resolve().then(function () { self.cb([{ isIntersecting: true, intersectionRatio: 1, target: el }], self); }); }
    unobserve() {}
    disconnect() {}
    takeRecords() { return []; }
  };
  var chart;
  Object.defineProperty(window, 'Chart', {
    configurable: true,
    get: function () { return chart; },
    set: function (v) { chart = v; try { v.defaults.animation = false; } catch (e) {} },
  });
  var style = document.createElement('style');
  style.textContent = '*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}';
  var add = function () { document.documentElement.appendChild(style); };
  if (document.documentElement) add();
  else new MutationObserver(function (_, o) { if (document.documentElement) { o.disconnect(); add(); } }).observe(document, { childList: true });
}

export var determinismSource = '(' + install.toString() + ')();';
