// 分析の進み具合を3段階(読み込み/取得/集計)の表示用に整える純粋関数。import を持たない
var LABELS = { load: '保存済みのデータを読み込み', fetch: '新しい試合を取得', build: '集計してレポートを作成' };
var FLOW = { pending: ['now', 'wait', 'wait'], done: ['done', 'done', 'done'] };

function n(v) { return Number(v) > 0 ? Number(v) : 0; }
function fmt(v) { return v.toLocaleString('ja-JP'); }

export function progressView(s) {
  if (!s) return null;
  var p = n(s.progress), t = n(s.progress_total), states, searching = false, count = '';
  if (s.status === 'scraping') {
    if (t === 0) { searching = true; states = ['done', 'now', 'wait']; if (p > 0) count = fmt(p) + ' 件'; }
    else { states = p >= t ? ['done', 'done', 'now'] : ['done', 'now', 'wait']; count = fmt(p) + ' / ' + fmt(t) + ' 件'; }
  } else if (FLOW[s.status]) {
    states = FLOW[s.status];
    if (s.status === 'done' && t > 0) count = fmt(p) + ' / ' + fmt(t) + ' 件';
  } else return null;
  var keys = ['load', 'fetch', 'build'];
  return {
    pct: t > 0 ? Math.min(100, Math.round(100 * p / t)) : null,
    searching: searching,
    count: count,
    steps: keys.map(function (k, i) {
      return { key: k, label: LABELS[k] + (k === 'fetch' && count ? '（' + count + '）' : ''), state: states[i] };
    }),
  };
}
