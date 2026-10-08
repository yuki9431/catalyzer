// テーマ(端末に合わせる/ダーク/ライト)の初期適用と切替。FOUC 防止のため <head> で同期実行する
(function (w) {
  var KEY = 'catalyzer_theme';
  var CHOICES = ['system', 'dark', 'light'];
  var META = { dark: '#0e141b', light: '#f4f6f8' };
  var mq = null;
  try { mq = w.matchMedia ? w.matchMedia('(prefers-color-scheme: light)') : null; } catch (e) { mq = null; }

  function resolve(choice, osLight) {
    if (choice === 'system') return osLight ? 'light' : 'dark';
    return choice;
  }
  function load() {
    var v = null;
    try { v = w.localStorage.getItem(KEY); } catch (e) { v = null; }
    return CHOICES.indexOf(v) >= 0 ? v : 'system';
  }
  var current = load();
  function choice() { return current; }
  function apply(c) {
    var t = resolve(c, !!(mq && mq.matches));
    w.document.documentElement.setAttribute('data-theme', t);
    var meta = w.document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', META[t]);
  }
  function set(v) {
    var c = CHOICES.indexOf(v) >= 0 ? v : 'system';
    current = c;
    try { w.localStorage.setItem(KEY, c); } catch (e) { /* 保存できなくても適用する */ }
    apply(c);
  }

  w.catalyzerTheme = { KEY: KEY, CHOICES: CHOICES, META: META, resolve: resolve, choice: choice, set: set };
  apply(choice());
  var onChange = function () { if (choice() === 'system') apply('system'); };
  if (mq) {
    if (mq.addEventListener) mq.addEventListener('change', onChange);
    else if (mq.addListener) mq.addListener(onChange);
  }
})(window);
