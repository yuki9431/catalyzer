// レポートの期間・対戦形式と試合検索の同じ条件を相互に変換する(全画面で1つの値を共有する)。import を持たない
export var SCOPE_KEYS = ['playDays', 'dateFrom', 'dateTo', 'mode'];

// レポートの状態 → 試合検索の条件。シートは日単位(dateFrom/dateTo)、絞り込みは時刻まで(rangeStart/rangeEnd)
export function searchScope(period, customRange, mode) {
  var custom = period === 'custom' && customRange;
  return {
    playDays: period === 'all' || period === 'custom' ? '' : period,
    dateFrom: custom && customRange.start ? customRange.start.slice(0, 10) : '',
    dateTo: custom && customRange.end ? customRange.end.slice(0, 10) : '',
    rangeStart: custom ? customRange.start || '' : '',
    rangeEnd: custom ? customRange.end || '' : '',
    mode: mode || 'all',
  };
}

// 試合検索で条件を1つ変えたときのレポートの状態。key が null なら全て既定に戻す。期間と日付は排他
export function applyScope(key, value, cur) {
  var next = { period: cur.period, customRange: cur.customRange, mode: cur.mode };
  if (key === null) return { period: 'all', customRange: null, mode: 'all' };
  if (key === 'mode') next.mode = value || 'all';
  else if (key === 'playDays') {
    if (value) next.period = value;
    else if (cur.period !== 'custom') next.period = 'all';
  } else if (key === 'dateFrom' || key === 'dateTo') {
    var r = cur.period === 'custom' && cur.customRange ? cur.customRange : { start: '', end: '' };
    var start = key === 'dateFrom' ? (value ? value + ' 00:00' : '') : r.start;
    var end = key === 'dateTo' ? (value ? value + ' 23:59' : '') : r.end;
    if (!start && !end) { next.period = 'all'; next.customRange = null; } else { next.period = 'custom'; next.customRange = { start: start, end: end }; }
  }
  return next;
}

// 日付指定の範囲に試合が入るか。片側だけの範囲(試合検索で開始日だけ選んだ等)も扱う
export function inCustomRange(date, r) {
  return (!r.start || date >= r.start) && (!r.end || date <= r.end);
}

// チップに収まるよう月日を M/D で短く出す
function md(d) { return d ? Number(d.substring(5, 7)) + '/' + Number(d.substring(8, 10)) : ''; }
export function customRangeLabel(r) {
  return md(r.start) + '~' + md(r.end);
}
