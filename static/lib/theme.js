// tokens.css の値を読む。var() を使えない canvas/Chart.js 用。document が無い環境(Node)では ''。
export function cssVar(name) {
  if (typeof document === 'undefined') return '';
  var v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  if (!v) console.error('tokens.css に未定義のトークン: ' + name);
  return v;
}
