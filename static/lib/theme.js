// tokens.css の値を読む(canvas/Chart.js 用)。描画ごとに作り直しキャッシュしない。Node では空文字。
export function themeReader() {
  if (typeof document === 'undefined') return function cssVar() { return ''; };
  var style = getComputedStyle(document.documentElement);
  return function cssVar(name) {
    var v = style.getPropertyValue(name).trim();
    if (!v) console.error('tokens.css に未定義のトークン: ' + name);
    return v;
  };
}
