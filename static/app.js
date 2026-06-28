import { html, render, useState, useMemo, useCallback, useEffect, useRef } from './htm-preact-standalone.js';

// --- Constants ---
var STATUS_MESSAGES = {
  pending: '準備中...',
  refreshing: '最新データを取得中...',
  scraping: '戦績を取得中...（数分かかります）',
  analyzing: '分析中...',
  done: '完了',
  error: 'エラーが発生しました',
};

var PERIOD_KEYS = ['all', '90d', '60d', '30d', '14d', '7d', '3d', '1d'];

// --- IndexedDB Match Cache ---
var MATCH_DB_NAME = 'catalyzer';
var MATCH_DB_VERSION = 1;
var MATCH_STORE = 'matches';

function openMatchDB() {
  return new Promise(function (resolve, reject) {
    var req = indexedDB.open(MATCH_DB_NAME, MATCH_DB_VERSION);
    req.onupgradeneeded = function (e) {
      var db = e.target.result;
      if (!db.objectStoreNames.contains(MATCH_STORE)) {
        var store = db.createObjectStore(MATCH_STORE, { keyPath: 'id' });
        store.createIndex('userKey', 'user_key', { unique: false });
        store.createIndex('date', 'date', { unique: false });
        store.createIndex('ms', 'ms', { unique: false });
        store.createIndex('userKey_date', ['user_key', 'date'], { unique: false });
      }
    };
    req.onsuccess = function (e) { resolve(e.target.result); };
    req.onerror = function (e) { reject(e.target.error); };
  });
}

function saveMatchesToDB(userKey, matches) {
  return openMatchDB().then(function (db) {
    return new Promise(function (resolve, reject) {
      var tx = db.transaction(MATCH_STORE, 'readwrite');
      var store = tx.objectStore(MATCH_STORE);
      for (var i = 0; i < matches.length; i++) {
        var m = Object.assign({}, matches[i], {
          id: userKey + '_' + matches[i].date,
          user_key: userKey
        });
        store.put(m);
      }
      tx.oncomplete = function () { resolve(); };
      tx.onerror = function (e) { reject(e.target.error); };
    });
  });
}

function loadMatchesFromDB(userKey) {
  return openMatchDB().then(function (db) {
    return new Promise(function (resolve, reject) {
      var tx = db.transaction(MATCH_STORE, 'readonly');
      var store = tx.objectStore(MATCH_STORE);
      var index = store.index('userKey');
      var req = index.getAll(userKey);
      req.onsuccess = function (e) { resolve(e.target.result || []); };
      req.onerror = function (e) { reject(e.target.error); };
    });
  });
}

function getLatestMatchDate(userKey) {
  return openMatchDB().then(function (db) {
    return new Promise(function (resolve, reject) {
      var tx = db.transaction(MATCH_STORE, 'readonly');
      var store = tx.objectStore(MATCH_STORE);
      var index = store.index('userKey_date');
      var range = IDBKeyRange.bound([userKey, ''], [userKey, '￿']);
      var req = index.openCursor(range, 'prev');
      req.onsuccess = function (e) {
        var cursor = e.target.result;
        resolve(cursor ? cursor.value.date : null);
      };
      req.onerror = function (e) { reject(e.target.error); };
    });
  });
}

function fetchAndCacheMatches(userKey) {
  getLatestMatchDate(userKey).then(function (latestDate) {
    var url = '/matches?user_key=' + encodeURIComponent(userKey);
    if (latestDate) {
      url += '&after=' + encodeURIComponent(latestDate);
    }
    return fetch(url);
  }).then(function (res) {
    if (!res.ok) throw new Error('fetch failed');
    return res.json();
  }).then(function (data) {
    if (data.matches && data.matches.length > 0) {
      return saveMatchesToDB(userKey, data.matches);
    }
  }).catch(function () {});
}

// --- Utility ---
function esc(s) {
  if (s == null) return '';
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// **太字** をパースして html`<strong>太字</strong>` に変換
function boldText(s) {
  if (s == null) return '';
  var parts = String(s).split(/\*\*(.+?)\*\*/g);
  if (parts.length === 1) return s;
  return parts.map(function (part, i) {
    return i % 2 === 1 ? html`<strong class="tip-bold">${part}</strong>` : part;
  });
}

function pct(n) { return n != null ? n.toFixed(1) + '%' : '-'; }
function num(n, d) { return n != null ? n.toFixed(d != null ? d : 0) : '-'; }

// --- Color helpers (4段階: great > good > bad > terrible) ---
// higherIsBetter: true=値が大きいほど良い, false=値が小さいほど良い
function valClass4(n, great, good, bad, terrible, higherIsBetter) {
  if (n == null) return '';
  if (higherIsBetter) {
    if (n >= great) return 'val-great';
    if (n >= good) return 'val-good';
    if (n <= terrible) return 'val-terrible';
    return 'val-bad';
  } else {
    if (n <= great) return 'val-great';
    if (n <= good) return 'val-good';
    if (n >= terrible) return 'val-terrible';
    return 'val-bad';
  }
}

function colorVal(n, great, good, bad, terrible, higherIsBetter, decimals) {
  if (n == null) return '-';
  var cls = valClass4(n, great, good, bad, terrible, higherIsBetter);
  var text = n.toFixed(decimals != null ? decimals : 0);
  return { sortValue: n, display: html`<span class=${cls}>${text}</span>` };
}

// 勝率: ≥60=great, ≥50=good, <50=bad, ≤40=terrible
function colorPct(n) {
  if (n == null) return '-';
  var cls = valClass4(n, 60, 50, 50, 40, true);
  var text = n.toFixed(1) + '%';
  return { sortValue: n, display: html`<span class=${cls}>${text}</span>` };
}

// 与被ダメ比: ≥1.2=great, ≥1.0=good, <1.0=bad, ≤0.8=terrible
function colorDE(n, d) {
  if (n == null) return '-';
  var cls = valClass4(n, 1.2, 1.0, 1.0, 0.8, true);
  var text = n.toFixed(d != null ? d : 3);
  return { sortValue: n, display: html`<span class=${cls}>${text}</span>` };
}

// 与ダメ: ≥1100=great, ≥900=good, <900=bad, ≤700=terrible
function colorDmgGiven(n) { return colorVal(n, 1100, 900, 900, 700, true, 0); }
// 被ダメ: <700=great, <800=good, ≥800=bad, ≥900=terrible
function colorDmgTaken(n) { return colorVal(n, 700, 800, 800, 900, false, 0); }
// 撃墜: ≥1.8=great, ≥1.5=good, <1.5=bad, ≤1.0=terrible
function colorKills(n) { return colorVal(n, 1.8, 1.5, 1.5, 1.0, true, 2); }
// 被撃墜: <1.0=great, ≤1.5=good, >1.5=bad, ≥2.5=terrible
function colorDeaths(n) { return colorVal(n, 1.0, 1.5, 1.5, 2.5, false, 2); }
// K/D比: ≥1.5=great, ≥1.0=good, <1.0=bad, ≤0.6=terrible
function colorKD(n) { return colorVal(n, 1.5, 1.0, 1.0, 0.6, true, 2); }
// EXダメ: ≥200=great, ≥160=good, <160=bad, ≤100=terrible
function colorExDmg(n) { return colorVal(n, 200, 160, 160, 100, true, 0); }
// 覚醒回数(最大3程度): ≥2.0=great, ≥1.5=good, <1.5=bad, ≤1.0=terrible
function colorBursts(n) { return colorVal(n, 2.0, 1.5, 1.5, 1.0, true, 2); }
// 差分: 色なし
function colorDiff(n, d) {
  if (n == null) return '-';
  var text = (n >= 0 ? '+' : '') + n.toFixed(d != null ? d : 1);
  return text;
}

function cellValue(cell) {
  return cell != null && typeof cell === 'object' && cell.sortValue != null ? cell.sortValue : cell;
}

function cellDisplay(cell) {
  return cell != null && typeof cell === 'object' && cell.display != null ? cell.display : cell;
}

// --- Share helpers ---
var SVG_X = '<svg viewBox="0 0 24 24"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>';
var SVG_BSKY = '<svg viewBox="0 0 568 501"><path d="M123.121 33.664C188.241 82.553 258.281 181.68 284 234.873c25.719-53.192 95.759-152.32 160.879-201.21C491.866-1.611 568-28.906 568 57.947c0 17.346-9.945 145.713-15.778 166.555-20.275 72.453-94.155 90.933-159.875 79.748C507.222 323.8 536.444 388.56 473.333 453.32c-119.86 122.992-172.272-30.859-185.702-70.281-2.462-7.227-3.614-10.608-3.631-7.733-.017-2.875-1.169.506-3.631 7.733-13.43 39.422-65.842 193.273-185.702 70.281-63.111-64.76-33.889-129.52 80.986-149.071-65.72 11.185-139.6-7.295-159.875-79.748C9.945 203.659 0 75.291 0 57.946 0-28.906 76.135-1.612 123.121 33.664z"/></svg>';
var SVG_LINE = '<svg viewBox="0 0 24 24"><path d="M19.365 9.863c.349 0 .63.285.63.631 0 .345-.281.63-.63.63H17.61v1.125h1.755c.349 0 .63.283.63.63 0 .344-.281.629-.63.629h-2.386c-.345 0-.627-.285-.627-.629V8.108c0-.345.282-.63.63-.63h2.386c.346 0 .627.285.627.63 0 .349-.281.63-.63.63H17.61v1.125h1.755zm-3.855 3.016c0 .27-.174.51-.432.596-.064.021-.133.031-.199.031-.211 0-.391-.09-.51-.25l-2.443-3.317v2.94c0 .344-.279.629-.631.629-.346 0-.626-.285-.626-.629V8.108c0-.27.173-.51.43-.595.06-.023.136-.033.194-.033.195 0 .375.104.495.254l2.462 3.33V8.108c0-.345.282-.63.63-.63.345 0 .63.285.63.63v4.771zm-5.741 0c0 .344-.282.629-.631.629-.345 0-.627-.285-.627-.629V8.108c0-.345.282-.63.63-.63.346 0 .628.285.628.63v4.771zm-2.466.629H4.917c-.345 0-.63-.285-.63-.629V8.108c0-.345.285-.63.63-.63.348 0 .63.285.63.63v4.141h1.756c.348 0 .629.283.629.63 0 .344-.282.629-.629.629M24 10.314C24 4.943 18.615.572 12 .572S0 4.943 0 10.314c0 4.811 4.27 8.842 10.035 9.608.391.082.923.258 1.058.59.12.301.079.766.038 1.08l-.164 1.02c-.045.301-.24 1.186 1.049.645 1.291-.539 6.916-4.078 9.436-6.975C23.176 14.393 24 12.458 24 10.314"/></svg>';
var SVG_COPY = '<svg viewBox="0 0 24 24"><path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/></svg>';
var SVG_CHECK = '<svg viewBox="0 0 24 24"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>';

function buildShareText(items) {
  var lines = ['【EXVS2IB 戦績診断】'];
  for (var i = 0; i < items.length; i++) {
    var item = items[i];
    if (item.type === 'top_ms') {
      lines.push('🤖 最多使用: ' + item.ms + '（' + item.count + '戦）');
    } else if (item.type === 'strong_enemy') {
      lines.push('💪 ' + item.enemy + '相手に勝率' + item.wr + '%！');
    } else if (item.type === 'weak_enemy') {
      lines.push('😈 ' + item.enemy + 'に勝率' + item.wr + '%...天敵かも');
    } else if (item.type === 'dmg_efficiency') {
      var desc = item.value >= 1.0 ? '与ダメが上回ってます' : '被ダメが上回ってます';
      lines.push('⚔ ' + item.ms + 'の与被ダメ比: ' + item.value + '（' + desc + '）');
    }
  }
  lines.push('');
  lines.push('▶ 自分も診断してみる');
  lines.push(location.origin);
  return lines.join('\n');
}

// --- Generic components ---

function Tips({ tips }) {
  if (!tips || !tips.length) return null;
  return html`<blockquote><strong>💡アドバイス:</strong><br />${tips.map(function (t, i) {
    var text = typeof t === 'string' ? t : t.text;
    var details = typeof t === 'object' && t.details ? t.details : null;
    return html`${i > 0 && html`<br />`}${boldText(text)}
      ${details && html`<ul class="advice-details">${details.map(function (d) { return html`<li>${boldText(d)}</li>`; })}</ul>`}`;
  })}</blockquote>`;
}

function SortableTable({ headers, rows, sortableColumns, defaultLimit }) {
  if (!rows || !rows.length) return null;
  var sortRef = useState({ col: -1, asc: true });
  var sortState = sortRef[0], setSortState = sortRef[1];
  var limitRef = useState(defaultLimit || 0);
  var limit = limitRef[0], setLimit = limitRef[1];

  var sortedRows = useMemo(function () {
    if (sortState.col < 0) return rows;
    var col = sortState.col;
    var sorted = rows.slice().sort(function (a, b) {
      var va = cellValue(a[col]), vb = cellValue(b[col]);
      // 数値文字列からパース（%や+を除去）
      var na = typeof va === 'number' ? va : parseFloat(String(va).replace(/[%+戦件回]/g, ''));
      var nb = typeof vb === 'number' ? vb : parseFloat(String(vb).replace(/[%+戦件回]/g, ''));
      if (!isNaN(na) && !isNaN(nb)) {
        return sortState.asc ? na - nb : nb - na;
      }
      var sa = String(cellValue(a[col])), sb = String(cellValue(b[col]));
      return sortState.asc ? sa.localeCompare(sb) : sb.localeCompare(sa);
    });
    return sorted;
  }, [rows, sortState]);

  var expanded = limit === 0;
  var displayRows = limit > 0 ? sortedRows.slice(0, limit) : sortedRows;
  var hasMore = limit > 0 && sortedRows.length > limit;

  function handleSort(colIdx) {
    if (sortState.col === colIdx) {
      if (colIdx === 0 && !sortState.asc) {
        // 1列目で降順→リセット（元の順序に戻す）
        setSortState({ col: -1, asc: true });
      } else {
        setSortState({ col: colIdx, asc: !sortState.asc });
      }
    } else {
      setSortState({ col: colIdx, asc: colIdx === 0 ? true : false });
    }
  }

  var sortable = sortableColumns || [];

  return html`<div>
    <div class="table-wrap"><table>
      <thead><tr>${headers.map(function (h, i) {
        var isSortable = h !== '' && (sortable.length === 0 || sortable.indexOf(i) >= 0);
        var indicator = sortState.col === i ? (sortState.asc ? ' ▲' : ' ▼') : (isSortable ? ' ▽' : '');
        return html`<th class=${isSortable ? 'sortable' : ''} onClick=${isSortable ? function () { handleSort(i); } : undefined}>${h}${indicator}</th>`;
      })}</tr></thead>
      <tbody>${displayRows.map(function (row) {
        return html`<tr>${row.map(function (cell) { return html`<td>${cellDisplay(cell)}</td>`; })}</tr>`;
      })}</tbody>
    </table></div>
    ${defaultLimit > 0 && sortedRows.length > defaultLimit && html`<div class="show-more-wrap">
      ${hasMore
        ? html`<button class="show-more-btn" onClick=${function () { setLimit(0); }}>もっと見る (+${sortedRows.length - limit}件)</button>`
        : html`<button class="show-more-btn" onClick=${function () { setLimit(defaultLimit); }}>折りたたむ</button>`}
    </div>`}
  </div>`;
}

function Table({ headers, rows }) {
  if (!rows || !rows.length) return null;
  return html`<${SortableTable} headers=${headers} rows=${rows} />`;
}

function Section({ title, open, children }) {
  return html`<details ...${{ open: open || false }}>
    <summary><strong>${title}</strong></summary>
    ${children}
  </details><hr />`;
}

function SubSection({ title, open, children }) {
  return html`<details ...${{ open: open || false }}>
    <summary>${title}</summary>
    ${children}
  </details>`;
}

// --- Calendar component ---

var DOW_LABELS = ['日', '月', '火', '水', '木', '金', '土'];

function RangeCalendar({ startDate, endDate, onSelectStart, onSelectEnd }) {
  var init = startDate ? new Date(startDate) : new Date();
  var viewRef = useState({ year: init.getFullYear(), month: init.getMonth() });
  var view = viewRef[0], setView = viewRef[1];
  var phaseRef = useState(startDate ? (endDate ? 'done' : 'end') : 'start');
  var phase = phaseRef[0], setPhase = phaseRef[1];

  function prevMonth() {
    setView(function (v) {
      var m = v.month - 1;
      return m < 0 ? { year: v.year - 1, month: 11 } : { year: v.year, month: m };
    });
  }
  function nextMonth() {
    setView(function (v) {
      var m = v.month + 1;
      return m > 11 ? { year: v.year + 1, month: 0 } : { year: v.year, month: m };
    });
  }

  var firstDay = new Date(view.year, view.month, 1).getDay();
  var daysInMonth = new Date(view.year, view.month + 1, 0).getDate();

  var cells = [];
  for (var i = 0; i < firstDay; i++) cells.push(null);
  for (var d = 1; d <= daysInMonth; d++) cells.push(d);
  while (cells.length < 42) cells.push(null);

  function toStr(day) {
    return view.year + '-' + String(view.month + 1).padStart(2, '0') + '-' + String(day).padStart(2, '0');
  }

  function handleClick(day) {
    if (!day) return;
    var s = toStr(day);
    if (phase === 'start' || phase === 'done') {
      onSelectStart(s);
      onSelectEnd('');
      setPhase('end');
    } else {
      if (s < startDate) {
        onSelectStart(s);
        onSelectEnd('');
      } else {
        onSelectEnd(s);
        setPhase('done');
      }
    }
  }

  function dayClass(day) {
    if (!day) return '';
    var s = toStr(day);
    var cls = 'cal-day';
    if (s === startDate || s === endDate) cls += ' selected';
    else if (startDate && endDate && s > startDate && s < endDate) cls += ' in-range';
    return cls;
  }

  var hint = phase === 'start' || phase === 'done' ? '▶ 開始日を選択' : '▶ 終了日を選択';

  return html`<div class="cal">
    <div class="cal-header">
      <button class="cal-nav" onClick=${prevMonth}>◀</button>
      <span class="cal-title">${view.year}年${view.month + 1}月</span>
      <button class="cal-nav" onClick=${nextMonth}>▶</button>
    </div>
    <div style="text-align:center;font-size:0.8em;color:var(--accent);margin-bottom:4px">${hint}</div>
    <div class="cal-grid">
      ${DOW_LABELS.map(function (d) { return html`<span class="cal-dow">${d}</span>`; })}
      ${cells.map(function (day) {
        if (!day) return html`<span class="cal-empty" />`;
        return html`<button class=${dayClass(day)}
          onClick=${function () { handleClick(day); }}>${day}</button>`;
      })}
    </div>
  </div>`;
}

// --- Time selector ---

var MINUTES_START = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55];
var MINUTES_END = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 59];

function TimeSelector({ hour, minute, onChangeHour, onChangeMinute, isEnd }) {
  var hours = [];
  for (var h = 0; h < 24; h++) hours.push(h);
  var minutes = isEnd ? MINUTES_END : MINUTES_START;

  return html`<div class="time-sel">
    <select class="time-select" value=${hour} onChange=${function (e) { onChangeHour(parseInt(e.target.value)); }}>
      ${hours.map(function (h) { return html`<option value=${h}>${String(h).padStart(2, '0')}時</option>`; })}
    </select>
    <span class="time-colon">:</span>
    <select class="time-select" value=${minute} onChange=${function (e) { onChangeMinute(parseInt(e.target.value)); }}>
      ${minutes.map(function (m) { return html`<option value=${m}>${String(m).padStart(2, '0')}分</option>`; })}
    </select>
  </div>`;
}

// --- Period selector (GCP/AWS style dropdown) ---

function PeriodSelector({ periods, selected, onSelect, userKey, onCustomReport }) {
  var keys = PERIOD_KEYS.filter(function (k) { return periods[k]; });
  if (keys.length <= 1 && !userKey) return null;

  var openRef = useState(false);
  var isOpen = openRef[0], setIsOpen = openRef[1];
  var customRef = useState(false);
  var showCustom = customRef[0], setShowCustom = customRef[1];
  var loadingRef = useState(false);
  var isLoading = loadingRef[0], setIsLoading = loadingRef[1];
  var errorRef = useState('');
  var customError = errorRef[0], setCustomError = errorRef[1];

  // カスタム日時の状態（日付文字列 + 時/分）
  var startDateRef = useState('');
  var startDate = startDateRef[0], setStartDate = startDateRef[1];
  var startHourRef = useState(0);
  var startHour = startHourRef[0], setStartHour = startHourRef[1];
  var startMinRef = useState(0);
  var startMin = startMinRef[0], setStartMin = startMinRef[1];
  var endDateRef = useState('');
  var endDate = endDateRef[0], setEndDate = endDateRef[1];
  var endHourRef = useState(23);
  var endHour = endHourRef[0], setEndHour = endHourRef[1];
  var endMinRef = useState(59);
  var endMin = endMinRef[0], setEndMin = endMinRef[1];
  var timeRef = useState(false);
  var showTime = timeRef[0], setShowTime = timeRef[1];

  var containerRef = useRef(null);
  var triggerRef = useRef(null);

  useEffect(function () {
    function handleClick(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return function () { document.removeEventListener('mousedown', handleClick); };
  }, []);

  useEffect(function () {
    if (isOpen && window.innerWidth <= 720) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return function () { document.body.style.overflow = ''; };
  }, [isOpen]);

  var dropStyle = {};
  if (isOpen && triggerRef.current && window.innerWidth <= 720) {
    dropStyle.top = triggerRef.current.getBoundingClientRect().bottom + 4 + 'px';
  }

  var currentLabel = selected === 'custom'
    ? (periods.custom ? periods.custom.label : '日付指定')
    : (periods[selected] ? periods[selected].label : '全データ');

  function selectPreset(k) {
    onSelect(k);
    setIsOpen(false);
    setShowCustom(false);
  }

  function formatDt(date, hour, min) {
    return date + ' ' + String(hour).padStart(2, '0') + ':' + String(min).padStart(2, '0');
  }

  function handleCustomApply() {
    if (!startDate || !endDate) {
      setCustomError('開始日と終了日をカレンダーから選択してください');
      return;
    }
    var start = showTime ? formatDt(startDate, startHour, startMin) : startDate + ' 00:00';
    var end = showTime ? formatDt(endDate, endHour, endMin) : endDate + ' 23:59';
    setIsLoading(true);
    setCustomError('');
    fetch('/period?user_key=' + encodeURIComponent(userKey) + '&start=' + encodeURIComponent(start) + '&end=' + encodeURIComponent(end))
      .then(function (res) { return res.json(); })
      .then(function (data) {
        setIsLoading(false);
        if (data.error) {
          setCustomError(data.error);
          return;
        }
        onCustomReport(data.report);
        setIsOpen(false);
      })
      .catch(function (e) {
        setIsLoading(false);
        setCustomError(e.message);
      });
  }

  return html`<div class="period-selector" ref=${containerRef}>
    <button class="period-trigger" ref=${triggerRef} onClick=${function () { setIsOpen(!isOpen); }}>
      ${currentLabel} <span class="period-arrow">${isOpen ? '\u25B2' : '\u25BC'}</span>
    </button>
    ${isOpen && html`<div class="period-backdrop" onClick=${function () { setIsOpen(false); }} />`}
    ${isOpen && html`<div class="period-dropdown" style=${dropStyle}>
      <div class="period-dropdown-list">
        ${keys.map(function (k) {
          return html`<button class=${'period-dropdown-item' + (selected === k ? ' active' : '')}
            onClick=${function () { selectPreset(k); }}>${periods[k].label}</button>`;
        })}
        ${userKey && html`<button class=${'period-dropdown-item period-dropdown-custom' + (showCustom ? ' active' : '')}
          onClick=${function () { setShowCustom(!showCustom); }}>日付指定</button>`}
      </div>
      ${showCustom && html`<div class="period-custom">
        <div class="period-custom-range">
          <div class="period-custom-col">
            <span class="period-custom-title">開始: ${startDate || '未選択'}${showTime ? ' ' + String(startHour).padStart(2, '0') + ':' + String(startMin).padStart(2, '0') : ''}</span>
          </div>
          <div class="period-custom-col">
            <span class="period-custom-title">終了: ${endDate || '未選択'}${showTime ? ' ' + String(endHour).padStart(2, '0') + ':' + String(endMin).padStart(2, '0') : ''}</span>
          </div>
        </div>
        <${RangeCalendar} startDate=${startDate} endDate=${endDate} onSelectStart=${setStartDate} onSelectEnd=${setEndDate} />
        ${showTime && html`<div class="period-custom-range" style="margin-top:8px">
          <div class="period-custom-col">
            <span style="font-size:0.8em;color:var(--muted)">開始時刻</span>
            <${TimeSelector} hour=${startHour} minute=${startMin}
              onChangeHour=${setStartHour} onChangeMinute=${setStartMin} />
          </div>
          <div class="period-custom-col">
            <span style="font-size:0.8em;color:var(--muted)">終了時刻</span>
            <${TimeSelector} hour=${endHour} minute=${endMin}
              onChangeHour=${setEndHour} onChangeMinute=${setEndMin} isEnd />
          </div>
        </div>`}
        <button class="period-time-toggle" onClick=${function () { setShowTime(!showTime); }}>
          ${showTime ? '時刻指定を解除' : '時刻を指定'}</button>
        <button class="period-custom-apply" onClick=${handleCustomApply} disabled=${isLoading}>
          ${isLoading ? '分析中...' : '適用'}</button>
        ${customError && html`<p class="period-custom-error">${customError}</p>`}
      </div>`}
    </div>`}
  </div>`;
}

// --- Report sections ---

function EnemyMatchupSection({ matchup }) {
  if (!matchup) return null;
  var headers = ['機体名', '試合', '勝率', '与被ダメ比', '与ダメ', '被ダメ'];
  function matchupRows(list) {
    return (list || []).map(function (e) {
      return [esc(e.ms), e.matches, colorPct(e.win_rate), colorDE(e.dmg_efficiency, 3), colorDmgGiven(e.avg_dmg_given), colorDmgTaken(e.avg_dmg_taken)];
    });
  }
  return html`<div>
    ${matchup.strong && matchup.strong.length > 0 && html`<p><strong>得意な相手:</strong></p><${SortableTable} headers=${headers} rows=${matchupRows(matchup.strong)} defaultLimit=${5} />`}
    ${matchup.weak && matchup.weak.length > 0 && html`<p><strong>苦手な相手:</strong></p><${SortableTable} headers=${headers} rows=${matchupRows(matchup.weak)} defaultLimit=${5} />`}
    ${matchup.even && matchup.even.length > 0 && html`<p><strong>互角の相手:</strong></p><${SortableTable} headers=${headers} rows=${matchupRows(matchup.even)} defaultLimit=${5} />`}
    <${Tips} tips=${matchup.tips} />
  </div>`;
}

function PartnerSection({ partners }) {
  if (!partners || !partners.length) return null;
  var rows = partners.map(function (p) {
    return [esc(p.ms), p.matches, colorPct(p.win_rate), colorDE(p.dmg_efficiency, 3)];
  });
  return html`<div>
    <${SortableTable} headers=${['機体名', '試合', '勝率', '与被ダメ比']} rows=${rows} defaultLimit=${10} />
  </div>`;
}


function MsPairSubSection({ msPair }) {
  if (!msPair) return null;
  var list = msPair.by_matches || [];
  if (!list.length) return null;
  var rows = list.map(function (p) {
    return [esc(p.pair), p.matches, colorPct(p.win_rate), colorDE(p.dmg_efficiency, 3)];
  });
  return html`<div>
    <${SortableTable} headers=${['編成', '試合数', '勝率', '与被ダメ比']} rows=${rows} defaultLimit=${10} />
  </div>`;
}

function CostPairSubSection({ costPair }) {
  if (!costPair || !costPair.length) return null;
  var rows = costPair.map(function (p) {
    return [esc(p.pair), p.matches, colorPct(p.win_rate), colorDE(p.dmg_efficiency, 3)];
  });
  return html`<div>
    <${SortableTable} headers=${['コスト編成', '試合数', '勝率', '与被ダメ比']} rows=${rows} defaultLimit=${10} />
  </div>`;
}

function DmgContributionSubSection({ dmg }) {
  if (!dmg) return null;
  function diffPct(win, lose) {
    if (win == null || lose == null) return '-';
    var d = win - lose;
    var s = d >= 0 ? '+' : '';
    return s + d.toFixed(1) + '%';
  }
  var rows = [];
  (dmg.by_cost || []).forEach(function (c) {
    rows.push([c.matches, pct(c.avg_contribution), pct(c.avg_win_contribution), pct(c.avg_lose_contribution), diffPct(c.avg_win_contribution, c.avg_lose_contribution)]);
  });
  return html`<div>
    <${Table} headers=${['試合数', '平均貢献率', '勝利時', '敗北時', '差分']} rows=${rows} />
  </div>`;
}

function DeathsImpactSubSection({ deaths }) {
  if (!deaths || !deaths.length) return null;
  return deaths.map(function (d) {
    var rows = (d.buckets || []).map(function (b) {
      return [b.label, b.matches + '戦', colorPct(b.win_rate)];
    });
    return html`<div>
      <${Table} headers=${['被撃墜数', '試合数', '勝率']} rows=${rows} />
      <${Tips} tips=${d.tips} />
    </div>`;
  });
}

// スクロール連動: 要素が画面に入ったらtrueを返すフック
function useInView(ref) {
  var state = useState(false);
  var inView = state[0], setInView = state[1];

  useEffect(function () {
    if (!ref.current) return;
    var observer = new IntersectionObserver(function (entries) {
      if (entries[0].isIntersecting) {
        setInView(true);
        observer.disconnect();
      }
    }, { threshold: 0.1 });
    observer.observe(ref.current);
    return function () { observer.disconnect(); };
  }, []);

  return inView;
}

// 50%基準線プラグイン
var winRate50Plugin = {
  id: 'winRate50Line',
  afterDraw: function (chart) {
    var yScale = chart.scales.y;
    if (!yScale) return;
    var y = yScale.getPixelForValue(50);
    var ctx = chart.ctx;
    ctx.save();
    ctx.beginPath();
    ctx.setLineDash([6, 4]);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
    ctx.lineWidth = 1;
    ctx.moveTo(chart.chartArea.left, y);
    ctx.lineTo(chart.chartArea.right, y);
    ctx.stroke();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
    ctx.font = '11px sans-serif';
    ctx.fillText('50%', chart.chartArea.left + 4, y - 4);
    ctx.restore();
  },
};

function TimeOfDayChart({ hours }) {
  var containerRef = useRef(null);
  var canvasRef = useRef(null);
  var chartRef = useRef(null);
  var inView = useInView(containerRef);

  useEffect(function () {
    if (!inView || !canvasRef.current || !hours || !hours.length) return;
    if (chartRef.current) chartRef.current.destroy();

    var labels = hours.map(function (h) { return h.hour + '時'; });
    var winRates = hours.map(function (h) { return h.win_rate; });
    var matches = hours.map(function (h) { return h.matches; });

    chartRef.current = new Chart(canvasRef.current, {
      type: 'bar',
      data: {
        labels: labels,
        datasets: [
          {
            label: '勝率 (%)',
            data: winRates,
            backgroundColor: winRates.map(function (v) { return v >= 60 ? 'rgba(76, 175, 80, 0.7)' : v < 50 ? 'rgba(239, 83, 80, 0.7)' : 'rgba(129, 212, 250, 0.3)'; }),
            borderWidth: 0,
            yAxisID: 'y',
          },
          {
            label: '試合数',
            data: matches,
            type: 'line',
            borderColor: '#81d4fa',
            backgroundColor: 'rgba(129, 212, 250, 0.1)',
            fill: false,
            tension: 0.3,
            pointRadius: 4,
            pointHoverRadius: 6,
            yAxisID: 'y1',
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { labels: { color: '#aaa', font: { size: 12 }, usePointStyle: true, generateLabels: function (chart) { return chart.data.datasets.map(function (ds, i) { var meta = chart.getDatasetMeta(i); var ps; if (ds.type === 'line') { var c = document.createElement('canvas'); c.width = 24; c.height = 12; var cx = c.getContext('2d'); var color = ds.borderColor; cx.strokeStyle = color; cx.lineWidth = 2; cx.beginPath(); cx.moveTo(4, 6); cx.lineTo(20, 6); cx.stroke(); cx.fillStyle = color; cx.beginPath(); cx.arc(4, 6, 3, 0, Math.PI * 2); cx.fill(); cx.beginPath(); cx.arc(20, 6, 3, 0, Math.PI * 2); cx.fill(); ps = c; } else { ps = 'rectRounded'; } return { text: ds.label, fontColor: '#aaa', fillStyle: ds.type === 'line' ? ds.borderColor : (Array.isArray(ds.backgroundColor) ? ds.backgroundColor[0] : ds.backgroundColor), strokeStyle: ds.type === 'line' ? ds.borderColor : (Array.isArray(ds.borderColor) ? ds.borderColor[0] : ds.borderColor), lineWidth: ds.type === 'line' ? 0 : 1, pointStyle: ps, hidden: meta.hidden, datasetIndex: i }; }); } } },
        },
        scales: {
          x: {
            ticks: { color: '#888', font: { size: 11 } },
            grid: { color: 'rgba(255,255,255,0.05)' },
          },
          y: {
            position: 'left',
            min: 0,
            max: 100,
            ticks: { color: '#aaa', callback: function (v) { return v + '%'; } },
            grid: { color: 'rgba(255,255,255,0.08)' },
          },
          y1: {
            position: 'right',
            min: 0,
            ticks: { color: '#aaa', stepSize: 1 },
            grid: { display: false },
          },
        },
      },
      plugins: [winRate50Plugin],
    });

    return function () { if (chartRef.current) { chartRef.current.destroy(); chartRef.current = null; } };
  }, [hours, inView]);

  return html`<div class="chart-container" ref=${containerRef}><canvas ref=${canvasRef} /></div>`;
}

function DayOfWeekChart({ days }) {
  var containerRef = useRef(null);
  var canvasRef = useRef(null);
  var chartRef = useRef(null);
  var inView = useInView(containerRef);

  useEffect(function () {
    if (!inView || !canvasRef.current || !days || !days.length) return;
    if (chartRef.current) chartRef.current.destroy();

    var labels = days.map(function (d) { return d.name + '曜'; });
    var winRates = days.map(function (d) { return d.win_rate; });
    var matches = days.map(function (d) { return d.matches; });

    chartRef.current = new Chart(canvasRef.current, {
      type: 'bar',
      data: {
        labels: labels,
        datasets: [
          {
            label: '勝率 (%)',
            data: winRates,
            backgroundColor: winRates.map(function (v) { return v >= 60 ? 'rgba(76, 175, 80, 0.7)' : v < 50 ? 'rgba(239, 83, 80, 0.7)' : 'rgba(129, 212, 250, 0.3)'; }),
            borderWidth: 0,
            yAxisID: 'y',
          },
          {
            label: '試合数',
            data: matches,
            type: 'line',
            borderColor: '#81d4fa',
            backgroundColor: 'rgba(129, 212, 250, 0.1)',
            fill: false,
            tension: 0.3,
            pointRadius: 4,
            pointHoverRadius: 6,
            yAxisID: 'y1',
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { labels: { color: '#aaa', font: { size: 12 }, usePointStyle: true, generateLabels: function (chart) { return chart.data.datasets.map(function (ds, i) { var meta = chart.getDatasetMeta(i); var ps; if (ds.type === 'line') { var c = document.createElement('canvas'); c.width = 24; c.height = 12; var cx = c.getContext('2d'); var color = ds.borderColor; cx.strokeStyle = color; cx.lineWidth = 2; cx.beginPath(); cx.moveTo(4, 6); cx.lineTo(20, 6); cx.stroke(); cx.fillStyle = color; cx.beginPath(); cx.arc(4, 6, 3, 0, Math.PI * 2); cx.fill(); cx.beginPath(); cx.arc(20, 6, 3, 0, Math.PI * 2); cx.fill(); ps = c; } else { ps = 'rectRounded'; } return { text: ds.label, fontColor: '#aaa', fillStyle: ds.type === 'line' ? ds.borderColor : (Array.isArray(ds.backgroundColor) ? ds.backgroundColor[0] : ds.backgroundColor), strokeStyle: ds.type === 'line' ? ds.borderColor : (Array.isArray(ds.borderColor) ? ds.borderColor[0] : ds.borderColor), lineWidth: ds.type === 'line' ? 0 : 1, pointStyle: ps, hidden: meta.hidden, datasetIndex: i }; }); } } },
        },
        scales: {
          x: {
            ticks: { color: '#888', font: { size: 11 } },
            grid: { color: 'rgba(255,255,255,0.05)' },
          },
          y: {
            position: 'left',
            min: 0,
            max: 100,
            ticks: { color: '#aaa', callback: function (v) { return v + '%'; } },
            grid: { color: 'rgba(255,255,255,0.08)' },
          },
          y1: {
            position: 'right',
            min: 0,
            ticks: { color: '#aaa', stepSize: 1 },
            grid: { display: false },
          },
        },
      },
      plugins: [winRate50Plugin],
    });

    return function () { if (chartRef.current) { chartRef.current.destroy(); chartRef.current = null; } };
  }, [days, inView]);

  return html`<div class="chart-container" ref=${containerRef}><canvas ref=${canvasRef} /></div>`;
}

function DailyTrendChart({ days }) {
  var containerRef = useRef(null);
  var canvasRef = useRef(null);
  var chartRef = useRef(null);
  var inView = useInView(containerRef);

  useEffect(function () {
    if (!inView || !canvasRef.current || !days || !days.length) return;

    if (chartRef.current) {
      chartRef.current.destroy();
    }

    var labels = days.map(function (d) { return d.date.slice(5); });
    var winRates = days.map(function (d) { return d.win_rate; });
    var matches = days.map(function (d) { return d.matches; });

    chartRef.current = new Chart(canvasRef.current, {
      type: 'bar',
      data: {
        labels: labels,
        datasets: [
          {
            label: '勝率 (%)',
            data: winRates,
            backgroundColor: winRates.map(function (v) { return v >= 60 ? 'rgba(76, 175, 80, 0.7)' : v < 50 ? 'rgba(239, 83, 80, 0.7)' : 'rgba(129, 212, 250, 0.3)'; }),
            borderWidth: 0,
            yAxisID: 'y',
          },
          {
            label: '試合数',
            data: matches,
            type: 'line',
            borderColor: '#81d4fa',
            backgroundColor: 'rgba(129, 212, 250, 0.1)',
            fill: false,
            tension: 0.3,
            pointRadius: days.length > 30 ? 2 : 4,
            pointHoverRadius: 6,
            yAxisID: 'y1',
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { labels: { color: '#aaa', font: { size: 12 }, usePointStyle: true, generateLabels: function (chart) { return chart.data.datasets.map(function (ds, i) { var meta = chart.getDatasetMeta(i); var ps; if (ds.type === 'line') { var c = document.createElement('canvas'); c.width = 24; c.height = 12; var cx = c.getContext('2d'); var color = ds.borderColor; cx.strokeStyle = color; cx.lineWidth = 2; cx.beginPath(); cx.moveTo(4, 6); cx.lineTo(20, 6); cx.stroke(); cx.fillStyle = color; cx.beginPath(); cx.arc(4, 6, 3, 0, Math.PI * 2); cx.fill(); cx.beginPath(); cx.arc(20, 6, 3, 0, Math.PI * 2); cx.fill(); ps = c; } else { ps = 'rectRounded'; } return { text: ds.label, fontColor: '#aaa', fillStyle: ds.type === 'line' ? ds.borderColor : (Array.isArray(ds.backgroundColor) ? ds.backgroundColor[0] : ds.backgroundColor), strokeStyle: ds.type === 'line' ? ds.borderColor : (Array.isArray(ds.borderColor) ? ds.borderColor[0] : ds.borderColor), lineWidth: ds.type === 'line' ? 0 : 1, pointStyle: ps, hidden: meta.hidden, datasetIndex: i }; }); } } },
          tooltip: {
            callbacks: {
              title: function (items) {
                var idx = items[0].dataIndex;
                var d = days[idx];
                return d.date + ' (' + d.dow_name + ')';
              },
            },
          },
        },
        scales: {
          x: {
            ticks: { color: '#888', maxRotation: 45, font: { size: 11 } },
            grid: { color: 'rgba(255,255,255,0.05)' },
          },
          y: {
            position: 'left',
            min: 0,
            max: 100,
            ticks: {
              color: '#aaa',
              callback: function (v) { return v + '%'; },
            },
            grid: { color: 'rgba(255,255,255,0.08)' },
          },
          y1: {
            position: 'right',
            min: 0,
            ticks: { color: '#aaa', stepSize: 1 },
            grid: { display: false },
          },
        },
      },
      plugins: [winRate50Plugin],
    });

    return function () {
      if (chartRef.current) {
        chartRef.current.destroy();
        chartRef.current = null;
      }
    };
  }, [days, inView]);

  return html`<div class="chart-container" ref=${containerRef}>
    <canvas ref=${canvasRef} />
  </div>`;
}

// シーズンごとの勝率(棒)と試合数(折れ線)の推移（時間帯/曜日グラフと同デザイン）
function SeasonChart({ seasons }) {
  var containerRef = useRef(null);
  var canvasRef = useRef(null);
  var chartRef = useRef(null);
  var inView = useInView(containerRef);

  useEffect(function () {
    if (!inView || !canvasRef.current || !seasons || !seasons.length) return;
    if (chartRef.current) chartRef.current.destroy();

    // 年が変わった時だけ年を表示する（例: 2026年4-5月 → 6-7月 → 8-9月）
    // 斜め表示を避けるため、年を含む長いラベルは「年」の位置で2行に分割する
    var prevYear = null;
    var labels = seasons.map(function (s) {
      var m = s.name.match(/^(\d{4})年/);
      var label = (m && m[1] === prevYear) ? s.name.replace(/^\d{4}年/, '') : s.name;
      if (m) prevYear = m[1];
      var yi = label.indexOf('年');
      return yi === -1 ? label : [label.slice(0, yi + 1), label.slice(yi + 1)];
    });
    var winRates = seasons.map(function (s) { return s.win_rate; });
    var matches = seasons.map(function (s) { return s.matches; });

    chartRef.current = new Chart(canvasRef.current, {
      type: 'bar',
      data: {
        labels: labels,
        datasets: [
          {
            label: '勝率 (%)',
            data: winRates,
            backgroundColor: winRates.map(function (v) { return v >= 60 ? 'rgba(76, 175, 80, 0.7)' : v < 50 ? 'rgba(239, 83, 80, 0.7)' : 'rgba(129, 212, 250, 0.3)'; }),
            borderWidth: 0,
            yAxisID: 'y',
          },
          {
            label: '試合数',
            data: matches,
            type: 'line',
            borderColor: '#81d4fa',
            backgroundColor: 'rgba(129, 212, 250, 0.1)',
            fill: false,
            tension: 0.3,
            pointRadius: 4,
            pointHoverRadius: 6,
            yAxisID: 'y1',
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { labels: { color: '#aaa', font: { size: 12 }, usePointStyle: true, generateLabels: function (chart) { return chart.data.datasets.map(function (ds, i) { var meta = chart.getDatasetMeta(i); var ps; if (ds.type === 'line') { var c = document.createElement('canvas'); c.width = 24; c.height = 12; var cx = c.getContext('2d'); var color = ds.borderColor; cx.strokeStyle = color; cx.lineWidth = 2; cx.beginPath(); cx.moveTo(4, 6); cx.lineTo(20, 6); cx.stroke(); cx.fillStyle = color; cx.beginPath(); cx.arc(4, 6, 3, 0, Math.PI * 2); cx.fill(); cx.beginPath(); cx.arc(20, 6, 3, 0, Math.PI * 2); cx.fill(); ps = c; } else { ps = 'rectRounded'; } return { text: ds.label, fontColor: '#aaa', fillStyle: ds.type === 'line' ? ds.borderColor : (Array.isArray(ds.backgroundColor) ? ds.backgroundColor[0] : ds.backgroundColor), strokeStyle: ds.type === 'line' ? ds.borderColor : (Array.isArray(ds.borderColor) ? ds.borderColor[0] : ds.borderColor), lineWidth: ds.type === 'line' ? 0 : 1, pointStyle: ps, hidden: meta.hidden, datasetIndex: i }; }); } } },
          tooltip: {
            callbacks: {
              title: function (items) { return seasons[items[0].dataIndex].name; },
            },
          },
        },
        scales: {
          x: {
            ticks: { color: '#888', maxRotation: 0, minRotation: 0, font: { size: 11 } },
            grid: { color: 'rgba(255,255,255,0.05)' },
          },
          y: {
            position: 'left',
            min: 0,
            max: 100,
            ticks: { color: '#aaa', callback: function (v) { return v + '%'; } },
            grid: { color: 'rgba(255,255,255,0.08)' },
          },
          y1: {
            position: 'right',
            min: 0,
            ticks: { color: '#aaa', stepSize: 1 },
            grid: { display: false },
          },
        },
      },
      plugins: [winRate50Plugin],
    });

    return function () { if (chartRef.current) { chartRef.current.destroy(); chartRef.current = null; } };
  }, [seasons, inView]);

  return html`<div class="chart-container" ref=${containerRef}><canvas ref=${canvasRef} /></div>`;
}

// --- Reusable win-rate bar chart (categories + win rate + match count) ---

function WinRateBarChart({ items }) {
  var containerRef = useRef(null);
  var canvasRef = useRef(null);
  var chartRef = useRef(null);
  var inView = useInView(containerRef);

  useEffect(function () {
    if (!inView || !canvasRef.current || !items || !items.length) return;
    if (chartRef.current) chartRef.current.destroy();
    var labels = items.map(function (i) { return i.label; });
    var rates = items.map(function (i) { return i.win_rate; });
    var counts = items.map(function (i) { return i.matches; });
    chartRef.current = new Chart(canvasRef.current, {
      type: 'bar',
      data: {
        labels: labels,
        datasets: [
          { label: '勝率 (%)', data: rates, backgroundColor: rates.map(function (v) { return v >= 60 ? 'rgba(76, 175, 80, 0.7)' : v < 50 ? 'rgba(239, 83, 80, 0.7)' : 'rgba(129, 212, 250, 0.3)'; }), borderWidth: 0, yAxisID: 'y' },
          { label: '試合数', data: counts, type: 'line', borderColor: '#81d4fa', fill: false, tension: 0.3, pointRadius: 4, pointHoverRadius: 6, yAxisID: 'y1' },
        ],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: { legend: { labels: { color: '#aaa', font: { size: 12 } } } },
        scales: {
          x: { ticks: { color: '#888', font: { size: 11 } }, grid: { color: 'rgba(255,255,255,0.05)' } },
          y: { position: 'left', min: 0, max: 100, ticks: { color: '#aaa', callback: function (v) { return v + '%'; } }, grid: { color: 'rgba(255,255,255,0.08)' } },
          y1: { position: 'right', min: 0, ticks: { color: '#aaa', stepSize: 1 }, grid: { display: false } },
        },
      },
      plugins: [winRate50Plugin],
    });
    return function () { if (chartRef.current) { chartRef.current.destroy(); chartRef.current = null; } };
  }, [items, inView]);

  return html`<div class="chart-container" ref=${containerRef}><canvas ref=${canvasRef} /></div>`;
}

// 勝利時/敗北時のメトリクスを並べたグループ棒グラフ
// ダメージ貢献率チャート（全体/勝利時/敗北時）
function DmgContributionChart({ dmg }) {
  var containerRef = useRef(null);
  var canvasRef = useRef(null);
  var chartRef = useRef(null);
  var inView = useInView(containerRef);

  useEffect(function () {
    if (!inView || !canvasRef.current || !dmg || !dmg.by_cost || !dmg.by_cost.length) return;
    if (chartRef.current) chartRef.current.destroy();
    var c = dmg.by_cost[0];
    var labels = ['全体', '勝利時', '敗北時'];
    var values = [c.avg_contribution || 0, c.avg_win_contribution || 0, c.avg_lose_contribution || 0];
    var colors = ['rgba(129, 212, 250, 0.5)', 'rgba(105, 240, 174, 0.6)', 'rgba(239, 83, 80, 0.6)'];
    chartRef.current = new Chart(canvasRef.current, {
      type: 'bar',
      data: { labels: labels, datasets: [{ label: '貢献率 (%)', data: values, backgroundColor: colors, borderWidth: 0 }] },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: function (ctx) { return '貢献率: ' + ctx.parsed.y.toFixed(1) + '%'; } } } },
        scales: {
          x: { ticks: { color: '#888' }, grid: { color: 'rgba(255,255,255,0.05)' } },
          y: { min: 0, max: 100, ticks: { color: '#aaa', callback: function (v) { return v + '%'; } }, grid: { color: 'rgba(255,255,255,0.08)' } },
        },
      },
    });
    return function () { if (chartRef.current) { chartRef.current.destroy(); chartRef.current = null; } };
  }, [dmg, inView]);

  return html`<div class="chart-container" ref=${containerRef}><canvas ref=${canvasRef} /></div>`;
}

// --- Fall order / Burst before death ---

function FallOrderContent({ fallOrder }) {
  if (!fallOrder) return null;
  var n = fallOrder.no_fall;
  var f = fallOrder.first_fall;
  var s = fallOrder.second_fall;
  var st = fallOrder.same_time;
  var rows = [
    ['0落ち', n.count + '戦 (' + n.rate + '%)', colorPct(n.win_rate), colorDmgGiven(n.avg_dmg_given), colorDmgTaken(n.avg_dmg_taken), colorDE(n.dmg_efficiency, 3)],
    ['先落ち', f.count + '戦 (' + f.rate + '%)', colorPct(f.win_rate), colorDmgGiven(f.avg_dmg_given), colorDmgTaken(f.avg_dmg_taken), colorDE(f.dmg_efficiency, 3)],
    ['後落ち', s.count + '戦 (' + s.rate + '%)', colorPct(s.win_rate), colorDmgGiven(s.avg_dmg_given), colorDmgTaken(s.avg_dmg_taken), colorDE(s.dmg_efficiency, 3)],
  ];
  if (st.count > 0) {
    rows.push(['同時落ち', st.count + '戦 (' + st.rate + '%)', colorPct(st.win_rate), colorDmgGiven(st.avg_dmg_given), colorDmgTaken(st.avg_dmg_taken), colorDE(st.dmg_efficiency, 3)]);
  }
  return html`<div>
    <p>対象: ${fallOrder.total}戦</p>
    <${Table} headers=${['パターン', '試合数', '勝率', '与ダメ', '被ダメ', '与被ダメ比']} rows=${rows} />
    <${Tips} tips=${fallOrder.tips} />
  </div>`;
}

function BurstHoldDeathContent({ holdData }) {
  if (!holdData) return null;
  var nh = holdData.no_hold;
  var rows = (holdData.by_death || []).filter(function (d) { return d.count > 0; }).map(function (d) {
    return [d.label, d.count + '戦 (' + d.rate + '%)', colorPct(d.win_rate)];
  });
  rows.push(['抱え落ちなし', nh.count + '戦 (' + nh.rate + '%)', colorPct(nh.win_rate)]);
  return html`<div>
    <p>覚醒ゲージが溜まった状態で発動せずに撃墜された試合（対象: ${holdData.total}戦）</p>
    <${Table} headers=${['パターン', '試合数', '勝率']} rows=${rows} />
    <${Tips} tips=${holdData.tips} />
  </div>`;
}

function BurstCountContent({ countData }) {
  if (!countData || !countData.by_count || !countData.by_count.length) return null;
  var rows = countData.by_count.map(function (c) {
    return [c.label, c.matches + '戦', colorPct(c.win_rate)];
  });
  return html`<div>
    <${Table} headers=${['覚醒回数', '試合数', '勝率']} rows=${rows} />
    <${Tips} tips=${countData.tips} />
  </div>`;
}

// --- Aggregation helpers (for 全機体 view) ---

function aggregateDeathsImpact(msStats) {
  var bucketMap = {};
  Object.keys(msStats).forEach(function (ms) {
    var di = msStats[ms].deaths_impact;
    if (!di) return;
    di.forEach(function (d) {
      (d.buckets || []).forEach(function (b) {
        if (!bucketMap[b.label]) bucketMap[b.label] = { label: b.label, matches: 0, wins: 0 };
        bucketMap[b.label].matches += b.matches;
        bucketMap[b.label].wins += Math.round(b.win_rate / 100 * b.matches);
      });
    });
  });
  var buckets = Object.values(bucketMap).map(function (b) {
    return { label: b.label, matches: b.matches, win_rate: b.matches > 0 ? b.wins / b.matches * 100 : 0 };
  });
  if (!buckets.length) return null;
  return [{ buckets: buckets }];
}

function aggregateFallOrder(msStats) {
  var total = 0;
  var cats = { no_fall: { count: 0, wins: 0 }, first_fall: { count: 0, wins: 0 }, second_fall: { count: 0, wins: 0 }, same_time: { count: 0, wins: 0 } };
  Object.keys(msStats).forEach(function (ms) {
    var fo = msStats[ms].fall_order;
    if (!fo) return;
    total += fo.total || 0;
    ['no_fall', 'first_fall', 'second_fall', 'same_time'].forEach(function (k) {
      if (fo[k]) {
        cats[k].count += fo[k].count || 0;
        cats[k].wins += Math.round((fo[k].win_rate || 0) / 100 * (fo[k].count || 0));
      }
    });
  });
  if (total === 0) return null;
  function mkCat(c) {
    return { count: c.count, rate: total > 0 ? (c.count / total * 100).toFixed(1) : '0.0', win_rate: c.count > 0 ? c.wins / c.count * 100 : 0, avg_dmg_given: null, avg_dmg_taken: null, dmg_efficiency: null };
  }
  return { total: total, no_fall: mkCat(cats.no_fall), first_fall: mkCat(cats.first_fall), second_fall: mkCat(cats.second_fall), same_time: mkCat(cats.same_time) };
}

function aggregateDmgContribution(msStats) {
  var totalMatches = 0, totalContrib = 0, totalWinContrib = 0, totalWinMatches = 0, totalLoseContrib = 0, totalLoseMatches = 0;
  Object.keys(msStats).forEach(function (ms) {
    var dc = msStats[ms].dmg_contribution;
    if (!dc || !dc.by_cost) return;
    dc.by_cost.forEach(function (c) {
      var bs = msStats[ms].basic_stats;
      var wr = bs ? bs.win_rate / 100 : 0.5;
      var wm = Math.round(c.matches * wr);
      totalMatches += c.matches;
      totalContrib += (c.avg_contribution || 0) * c.matches;
      if (c.avg_win_contribution != null) {
        totalWinContrib += c.avg_win_contribution * wm;
        totalWinMatches += wm;
      }
      if (c.avg_lose_contribution != null) {
        totalLoseContrib += c.avg_lose_contribution * (c.matches - wm);
        totalLoseMatches += c.matches - wm;
      }
    });
  });
  if (totalMatches === 0) return null;
  return { by_cost: [{ matches: totalMatches, avg_contribution: totalContrib / totalMatches, avg_win_contribution: totalWinMatches > 0 ? totalWinContrib / totalWinMatches : null, avg_lose_contribution: totalLoseMatches > 0 ? totalLoseContrib / totalLoseMatches : null }] };
}

function aggregateBurstCount(msStats) {
  var countMap = {};
  Object.keys(msStats).forEach(function (ms) {
    var bc = msStats[ms].burst_count;
    if (!bc || !bc.by_count) return;
    bc.by_count.forEach(function (c) {
      if (!countMap[c.label]) countMap[c.label] = { label: c.label, matches: 0, wins: 0 };
      countMap[c.label].matches += c.matches;
      countMap[c.label].wins += Math.round(c.win_rate / 100 * c.matches);
    });
  });
  var byCount = Object.values(countMap).map(function (c) {
    return { label: c.label, matches: c.matches, win_rate: c.matches > 0 ? c.wins / c.matches * 100 : 0 };
  });
  if (!byCount.length) return null;
  return { by_count: byCount };
}

function aggregateBurstHoldDeath(msStats) {
  var deathMap = {};
  var noHoldWins = 0, noHoldTotal = 0, total = 0;
  Object.keys(msStats).forEach(function (ms) {
    var bh = msStats[ms].burst_hold_death;
    if (!bh) return;
    total += bh.total || 0;
    if (bh.no_hold) {
      noHoldTotal += bh.no_hold.count || 0;
      noHoldWins += Math.round((bh.no_hold.win_rate || 0) / 100 * (bh.no_hold.count || 0));
    }
    (bh.by_death || []).forEach(function (d) {
      if (!deathMap[d.label]) deathMap[d.label] = { label: d.label, count: 0, wins: 0 };
      deathMap[d.label].count += d.count;
      deathMap[d.label].wins += Math.round(d.win_rate / 100 * d.count);
    });
  });
  if (total === 0) return null;
  var byDeath = Object.values(deathMap).map(function (d) {
    return { label: d.label, count: d.count, rate: (d.count / total * 100).toFixed(1), win_rate: d.count > 0 ? d.wins / d.count * 100 : 0 };
  });
  return { total: total, by_death: byDeath, no_hold: { count: noHoldTotal, rate: (noHoldTotal / total * 100).toFixed(1), win_rate: noHoldTotal > 0 ? noHoldWins / noHoldTotal * 100 : 0 } };
}

function aggregateEnemyMatchup(msStats) {
  var enemyMap = {};
  Object.keys(msStats).forEach(function (ms) {
    var em = msStats[ms].enemy_matchup;
    if (!em) return;
    ['strong', 'weak', 'even'].forEach(function (cat) {
      (em[cat] || []).forEach(function (e) {
        if (!enemyMap[e.ms]) enemyMap[e.ms] = { ms: e.ms, matches: 0, wins: 0, dmgGiven: 0, dmgTaken: 0 };
        enemyMap[e.ms].matches += e.matches;
        enemyMap[e.ms].wins += Math.round(e.win_rate / 100 * e.matches);
        enemyMap[e.ms].dmgGiven += (e.avg_dmg_given || 0) * e.matches;
        enemyMap[e.ms].dmgTaken += (e.avg_dmg_taken || 0) * e.matches;
      });
    });
  });
  var all = Object.values(enemyMap).map(function (e) {
    var wr = e.matches > 0 ? e.wins / e.matches * 100 : 0;
    var dg = e.matches > 0 ? e.dmgGiven / e.matches : 0;
    var dt = e.matches > 0 ? e.dmgTaken / e.matches : 0;
    return { ms: e.ms, matches: e.matches, win_rate: wr, avg_dmg_given: dg, avg_dmg_taken: dt, dmg_efficiency: dt > 0 ? dg / dt : 0 };
  });
  return {
    strong: all.filter(function (e) { return e.win_rate >= 60; }).sort(function (a, b) { return b.matches - a.matches; }),
    weak: all.filter(function (e) { return e.win_rate <= 40; }).sort(function (a, b) { return b.matches - a.matches; }),
    even: all.filter(function (e) { return e.win_rate > 40 && e.win_rate < 60; }).sort(function (a, b) { return b.matches - a.matches; }),
  };
}

function aggregatePartner(msStats) {
  var partnerMap = {};
  Object.keys(msStats).forEach(function (ms) {
    var partners = msStats[ms].partner;
    if (!partners) return;
    partners.forEach(function (p) {
      if (!partnerMap[p.ms]) partnerMap[p.ms] = { ms: p.ms, matches: 0, wins: 0, de: 0 };
      partnerMap[p.ms].matches += p.matches;
      partnerMap[p.ms].wins += Math.round(p.win_rate / 100 * p.matches);
      partnerMap[p.ms].de += (p.dmg_efficiency || 0) * p.matches;
    });
  });
  return Object.values(partnerMap).map(function (p) {
    return { ms: p.ms, matches: p.matches, win_rate: p.matches > 0 ? p.wins / p.matches * 100 : 0, dmg_efficiency: p.matches > 0 ? p.de / p.matches : 0 };
  }).sort(function (a, b) { return b.matches - a.matches; });
}

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

function HamburgerMenu({ isOpen, onClose, shareData, onReAnalyze, hasSession, onLogout }) {
  useEffect(function () {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return function () { document.body.style.overflow = ''; };
  }, [isOpen]);

  if (!isOpen) return null;
  return html`<div>
    <div class="menu-backdrop" onClick=${onClose} />
    <div class=${'menu-drawer' + (isOpen ? ' open' : '')}>
      <div class="menu-header"><img src="logo.svg" alt="catalyzer" style="height:24px;width:auto;" /></div>
      <div class="menu-body">
        <button class="menu-item" onClick=${function () { onClose(); onReAnalyze(); }}>再分析</button>
        ${hasSession ? [
          html`<div class="menu-divider" />`,
          html`<button class="menu-item" style="color: var(--bad)" onClick=${function () { onClose(); onLogout(); }}>ログアウト</button>`
        ] : null}
        <div class="menu-divider" />
        <div style="padding: 8px 16px;">
          <${ShareArea} shareData=${shareData} />
        </div>
      </div>
    </div>
  </div>`;
}

function MsSelector({ entries, selected, onSelect }) {
  var ref = useState(false);
  var isOpen = ref[0], setIsOpen = ref[1];
  var containerRef = useRef(null);
  useEffect(function () {
    if (!isOpen) return;
    function handleClick(e) { if (containerRef.current && !containerRef.current.contains(e.target)) setIsOpen(false); }
    document.addEventListener('click', handleClick, true);
    return function () { document.removeEventListener('click', handleClick, true); };
  }, [isOpen]);
  var label = selected ? '1機選択' : '全機体';
  var isSelected = !!selected;
  var triggerRef = useRef(null);
  var dropStyle = {};
  if (isOpen && triggerRef.current && window.innerWidth <= 720) {
    dropStyle.top = triggerRef.current.getBoundingClientRect().bottom + 4 + 'px';
  }
  return html`<div class="ms-topbar-wrap" ref=${containerRef}>
    <button class=${'ms-topbar-trigger' + (isSelected ? ' selected' : '')} ref=${triggerRef} onClick=${function () { setIsOpen(!isOpen); }}>
      ${esc(label)} <span class="period-arrow">${isOpen ? '▲' : '▼'}</span>
    </button>
    ${isOpen && html`<div class="ms-topbar-backdrop" onClick=${function () { setIsOpen(false); }} />`}
    ${isOpen && html`<div class="ms-topbar-dropdown" style=${dropStyle}>
      <button class=${'ms-topbar-item' + (!selected ? ' active' : '')}
        onClick=${function () { onSelect(null); setIsOpen(false); }}>全機体</button>
      ${entries.map(function (e) {
        return html`<button class=${'ms-topbar-item' + (selected === e.name ? ' active' : '')}
          onClick=${function () { onSelect(e.name); setIsOpen(false); }}>${esc(e.name)} <span style="color:var(--muted)">(${e.matches}戦)</span></button>`;
      })}
    </div>`}
  </div>`;
}

function LensToggle({ lens, onSelect }) {
  var opts = [['all', '全体'], ['win', '勝利'], ['loss', '敗北']];
  return html`<div class="lens-toggle">
    ${opts.map(function (o) {
      return html`<button class=${'lens-btn' + (lens === o[0] ? ' active' : '')}
        onClick=${function () { onSelect(o[0]); }}>${o[1]}</button>`;
    })}
  </div>`;
}

// --- Dashboard building blocks ---

// 値を min..max の範囲で 0-100 に正規化（レーダー用）
function clampN(v, min, max) {
  if (v == null) return 0;
  return Math.max(0, Math.min(100, (v - min) / (max - min) * 100));
}

// KPIカードの色クラス。higher=trueは大きいほど良い
function kpiClass(n, great, good, terrible, higher) {
  if (n == null) return '';
  if (higher) return n >= great ? 'great' : n >= good ? 'good' : n <= terrible ? 'terrible' : 'bad';
  return n <= great ? 'great' : n <= good ? 'good' : n >= terrible ? 'terrible' : 'bad';
}

function Panel({ title, children }) {
  return html`<div class="panel">
    ${title && html`<h2><span class="dot" />${title}</h2>`}
    ${children}
  </div>`;
}

function KpiGrid({ stats }) {
  if (!stats) return null;
  var cards = [
    { label: '対戦数', value: stats.matches, cls: '', sub: stats.wins + '勝 ' + stats.losses + '敗' },
    { label: '勝率', value: pct(stats.win_rate), cls: kpiClass(stats.win_rate, 60, 50, 40, true), sub: '' },
    { label: '平均与ダメージ', value: num(stats.avg_dmg_given), cls: kpiClass(stats.avg_dmg_given, 1100, 900, 700, true), sub: '' },
    { label: '平均被ダメージ', value: num(stats.avg_dmg_taken), cls: kpiClass(stats.avg_dmg_taken, 700, 800, 900, false), sub: '' },
    { label: '平均EXダメージ', value: num(stats.avg_ex_dmg), cls: kpiClass(stats.avg_ex_dmg, 200, 160, 100, true), sub: '' },
    { label: '与被ダメ比', value: num(stats.dmg_efficiency, 2), cls: kpiClass(stats.dmg_efficiency, 1.2, 1.0, 0.8, true), sub: '' },
  ];
  return html`<div class="kpi-grid">${cards.map(function (c) {
    return html`<div class="kpi">
      <div class="kpi-label">${c.label}</div>
      <div class=${'kpi-value ' + c.cls}>${c.value}</div>
      ${c.sub && html`<div class="kpi-sub">${c.sub}</div>`}
    </div>`;
  })}</div>`;
}

// 2系列を重ねたレーダー（series: [{label, color, bg, data[]}]）
function CompareRadar({ labels, series, showLegend }) {
  var containerRef = useRef(null);
  var canvasRef = useRef(null);
  var chartRef = useRef(null);
  var inView = useInView(containerRef);

  useEffect(function () {
    if (!inView || !canvasRef.current) return;
    if (chartRef.current) chartRef.current.destroy();
    chartRef.current = new Chart(canvasRef.current, {
      type: 'radar',
      data: {
        labels: labels,
        datasets: series.map(function (s) {
          return {
            label: s.label, data: s.data, hidden: !!s.hidden,
            backgroundColor: s.bg, borderColor: s.color,
            pointBackgroundColor: s.color, borderWidth: 2,
          };
        }),
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: showLegend === false ? { display: false } : { labels: { color: '#8aa0b3' } } },
        scales: {
          r: {
            min: 0, max: 100, ticks: { display: false, stepSize: 25 },
            grid: { color: 'rgba(255,255,255,0.1)' }, angleLines: { color: 'rgba(255,255,255,0.1)' },
            pointLabels: { color: '#aaa', font: { size: 12 } },
          },
        },
      },
    });
    return function () { if (chartRef.current) { chartRef.current.destroy(); chartRef.current = null; } };
  }, [labels, series, inView, showLegend]);

  return html`<div class="chart-container chart-radar" ref=${containerRef}><canvas ref=${canvasRef} /></div>`;
}

// 全体・勝利時・敗北時を下のボタンで単一選択し、レーダーとテーブルを連動して切り替える
// 軸はK/D比(頂点)→被ダメ(右)→EXダメ(下)→与ダメ(左)。勝率は分割で無意味なため含めない
function BasicLensSection({ basic, pattern, lens }) {
  if (!basic) return null;
  if (!lens) lens = 'all';
  var metrics = (pattern && pattern.metrics) || [];
  function wmVal(label) {
    var m = metrics.find(function (m) { return m.label === label; });
    if (!m) return null;
    return lens === 'win' ? m.win_avg : m.loss_avg;
  }
  // 攻めを上半分・守りを下半分に固めつつ3ペアを対極配置: 与ダメ↔被ダメ, 撃墜↔被撃墜, EXダメ↔覚醒回数
  // 軸順(idx): 0=与ダメ(上), 1=撃墜(右上), 2=覚醒回数(右下), 3=被ダメ(下), 4=被撃墜(左下), 5=EXダメ(左上)
  function vec(dgv, kv, bv, dtv, dthv, exv) {
    return [clampN(dgv, 600, 1200), clampN(kv, 0.5, 2.5), clampN(bv, 0, 2.5), clampN(dtv, 1200, 600), clampN(dthv, 2.5, 0.5), clampN(exv, 80, 250)];
  }
  var seriesByLens = {
    all: { label: '全体', color: '#81d4fa', bg: 'rgba(129,212,250,.2)', data: vec(basic.avg_dmg_given, basic.avg_kills, basic.avg_bursts, basic.avg_dmg_taken, basic.avg_deaths, basic.avg_ex_dmg) },
    win: { label: '勝利時', color: '#69f0ae', bg: 'rgba(105,240,174,.2)', data: vec(wmVal('平均与ダメージ'), wmVal('平均撃墜'), wmVal('平均覚醒回数'), wmVal('平均被ダメージ'), wmVal('平均被撃墜'), wmVal('平均EXダメージ')) },
    loss: { label: '敗北時', color: '#ef5350', bg: 'rgba(239,83,80,.18)', data: vec(wmVal('平均与ダメージ'), wmVal('平均撃墜'), wmVal('平均覚醒回数'), wmVal('平均被ダメージ'), wmVal('平均被撃墜'), wmVal('平均EXダメージ')) },
  };

  // [ラベル, 全体値, 色関数]。勝敗時はwin_loss_patternの同名metricから値を引く
  var specs = [
    ['平均与ダメージ', basic.avg_dmg_given, colorDmgGiven],
    ['平均被ダメージ', basic.avg_dmg_taken, colorDmgTaken],
    ['与被ダメ比', basic.dmg_efficiency, function (n) { return colorDE(n, 3); }],
    ['平均撃墜', basic.avg_kills, colorKills],
    ['平均被撃墜', basic.avg_deaths, colorDeaths],
    ['K/D比', basic.kd_ratio, colorKD],
    ['平均EXダメージ', basic.avg_ex_dmg, colorExDmg],
    ['平均覚醒回数', basic.avg_bursts, colorBursts],
  ];
  function valFor(label, allVal) {
    if (lens === 'all') return allVal;
    return wmVal(label);
  }
  var matchesLabel = lens === 'all' ? '試合数' : lens === 'win' ? '勝利数' : '敗北数';
  var matchesVal = lens === 'all' ? (basic.matches + '戦')
    : lens === 'win' ? (basic.wins + '戦') : (basic.losses + '戦');
  // 勝率は勝敗で割ると100%/0%の同語反復になるため、勝敗時は「ー」で行だけ維持
  var rows = [
    [matchesLabel, matchesVal],
    ['勝率', lens === 'all' ? colorPct(basic.win_rate) : '-'],
  ].concat(specs.map(function (s) {
    return [s[0], s[2](valFor(s[0], s[1]))];
  }));

  var lensLabel = seriesByLens[lens].label;
  return html`<div class="two-col">
    <div>
      <${CompareRadar} labels=${['与ダメ', '撃墜', '覚醒回数', '被ダメ', '被撃墜', 'EXダメ']} series=${[seriesByLens[lens]]} showLegend=${false} />
    </div>
    <div class="lens-table">
      <${Table} headers=${['項目', lensLabel]} rows=${rows} />
      <${Tips} tips=${basic.tips} />
    </div>
  </div>`;
}

// 横棒の内側に名前（左）と勝率（右）を描くプラグイン
var inBarLabel = {
  id: 'inBarLabel',
  afterDatasetsDraw: function (chart) {
    var ctx = chart.ctx;
    var meta = chart.getDatasetMeta(0);
    var x0 = chart.scales.x.getPixelForValue(0);
    var areaRight = chart.chartArea.right;
    ctx.save();
    ctx.font = '700 12px system-ui, -apple-system, sans-serif';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#e6edf3';
    var ellipsize = function (text, maxWidth) {
      if (maxWidth <= 0 || ctx.measureText(text).width <= maxWidth) return text;
      var t = text;
      while (t.length > 1 && ctx.measureText(t + '…').width > maxWidth) t = t.slice(0, -1);
      return t + '…';
    };
    meta.data.forEach(function (bar, i) {
      var pct = chart.data.datasets[0].data[i].toFixed(1) + '%';
      var pctWidth = ctx.measureText(pct).width;
      // 描画領域から勝率ぶんの幅を確保した上で、収まらない機体名は省略（…）する
      var name = ellipsize(chart.data.labels[i], areaRight - (x0 + 8) - pctWidth - 12);
      ctx.textAlign = 'left';
      ctx.fillText(name, x0 + 8, bar.y);
      var nameRight = x0 + 8 + ctx.measureText(name).width;
      // 棒内の名前の右側に勝率が収まるなら右端内側に、収まらなければ棒の外（名前の右隣）に出す
      if (bar.x - 8 - pctWidth > nameRight + 6) {
        ctx.textAlign = 'right';
        ctx.fillText(pct, bar.x - 8, bar.y);
      } else {
        ctx.textAlign = 'left';
        ctx.fillText(pct, Math.max(bar.x + 6, nameRight + 6), bar.y);
      }
    });
    ctx.restore();
  },
};

// 機体別の勝率を横棒で比較（棒の内側に機体名と勝率）
function MsCompareChart({ entries }) {
  var containerRef = useRef(null);
  var canvasRef = useRef(null);
  var chartRef = useRef(null);
  var inView = useInView(containerRef);

  useEffect(function () {
    if (!inView || !canvasRef.current || !entries.length) return;
    if (chartRef.current) chartRef.current.destroy();
    var values = entries.map(function (e) { return e.winRate; });
    chartRef.current = new Chart(canvasRef.current, {
      type: 'bar',
      data: {
        labels: entries.map(function (e) { return e.name; }),
        datasets: [{
          data: values,
          backgroundColor: values.map(function (v) { return v >= 60 ? 'rgba(76, 175, 80, 0.7)' : v < 50 ? 'rgba(239, 83, 80, 0.7)' : 'rgba(129, 212, 250, 0.35)'; }),
          borderWidth: 0,
          borderRadius: 4,
        }],
      },
      options: {
        indexAxis: 'y', responsive: true, maintainAspectRatio: false,
        layout: { padding: { right: 4 } },
        plugins: { legend: { display: false } },
        scales: {
          x: { min: 0, max: 100, ticks: { color: '#888', font: { size: 11 }, callback: function (v) { return v + '%'; } }, grid: { color: 'rgba(255,255,255,0.05)' } },
          y: { ticks: { display: false }, grid: { display: false } },
        },
      },
      plugins: [inBarLabel],
    });
    return function () { if (chartRef.current) { chartRef.current.destroy(); chartRef.current = null; } };
  }, [entries, inView]);

  var h = Math.max(160, entries.length * 46);
  return html`<div class="chart-container" style=${'height:' + h + 'px'} ref=${containerRef}><canvas ref=${canvasRef} /></div>`;
}

function PartnerDropdown({ items, idx, onSelect }) {
  var ref = useState(false);
  var isOpen = ref[0], setIsOpen = ref[1];
  var containerRef = useRef(null);
  useEffect(function () {
    if (!isOpen) return;
    function handleClick(e) { if (containerRef.current && !containerRef.current.contains(e.target)) setIsOpen(false); }
    document.addEventListener('click', handleClick, true);
    return function () { document.removeEventListener('click', handleClick, true); };
  }, [isOpen]);
  var current = items[idx];
  var label = current.partner_name + (current.team_name ? ' 【' + current.team_name + '】' : '');
  return html`<div class="panel-select-wrap" ref=${containerRef}>
    <button class="panel-select-trigger" onClick=${function () { setIsOpen(!isOpen); }}>
      ${esc(label)} <span class="period-arrow">${isOpen ? '▲' : '▼'}</span>
    </button>
    ${isOpen && html`<div class="panel-select-dropdown">
      ${items.map(function (item, i) {
        var itemLabel = item.partner_name + (item.team_name ? ' 【' + item.team_name + '】' : '');
        return html`<button class=${'panel-select-item' + (i === idx ? ' active' : '')}
          onClick=${function () { onSelect(i); setIsOpen(false); }}>${esc(itemLabel)}</button>`;
      })}
    </div>`}
  </div>`;
}

function FixedPartnerPanel({ fp, fpItems, lens }) {
  var idxRef = useState(0);
  var idx = idxRef[0], setIdx = idxRef[1];
  var p = fpItems[idx];
  if (!p) return null;
  if (!lens) lens = 'all';

  var myWl = (p.my_win_loss_pattern && p.my_win_loss_pattern.metrics) || [];
  var partnerWl = (p.partner_win_loss_pattern && p.partner_win_loss_pattern.metrics) || [];
  function valFor(metrics, label, allVal) {
    if (lens === 'all') return allVal;
    var m = metrics.find(function (m) { return m.label === label; });
    if (!m) return null;
    return lens === 'win' ? m.win_avg : m.loss_avg;
  }

  var specs = [
    ['平均与ダメージ', p.my_stats.avg_dmg_given, p.partner_stats.avg_dmg_given, colorDmgGiven],
    ['平均被ダメージ', p.my_stats.avg_dmg_taken, p.partner_stats.avg_dmg_taken, colorDmgTaken],
    ['与被ダメ比', p.my_stats.dmg_efficiency, p.partner_stats.dmg_efficiency, function (n) { return colorDE(n, 3); }],
    ['平均撃墜', p.my_stats.avg_kills, p.partner_stats.avg_kills, colorKills],
    ['平均被撃墜', p.my_stats.avg_deaths, p.partner_stats.avg_deaths, colorDeaths],
    ['K/D比', p.my_stats.kd_ratio, p.partner_stats.kd_ratio, colorKD],
    ['平均EXダメージ', p.my_stats.avg_ex_dmg, p.partner_stats.avg_ex_dmg, colorExDmg],
    ['平均覚醒回数', p.my_stats.avg_bursts, p.partner_stats.avg_bursts, colorBursts],
  ];
  var statsRows = specs.map(function (s) {
    return [s[0], s[3](valFor(myWl, s[0], s[1])), s[3](valFor(partnerWl, s[0], s[2]))];
  });

  function pVec(stats, wlMetrics) {
    function v(label, allVal) { return valFor(wlMetrics, label, allVal); }
    return [
      clampN(v('平均与ダメージ', stats.avg_dmg_given), 600, 1200),
      clampN(v('平均撃墜', stats.avg_kills), 0.5, 2.5),
      clampN(v('平均覚醒回数', stats.avg_bursts), 0, 2.5),
      clampN(v('平均被ダメージ', stats.avg_dmg_taken), 1200, 600),
      clampN(v('平均被撃墜', stats.avg_deaths), 2.5, 0.5),
      clampN(v('平均EXダメージ', stats.avg_ex_dmg), 80, 250),
    ];
  }

  var matchesLabel = lens === 'all' ? '試合数' : lens === 'win' ? '勝利数' : '敗北数';
  var matchesVal = lens === 'all' ? (p.matches + '戦')
    : lens === 'win' ? (p.wins + '戦') : (p.losses + '戦');
  var lensLabel = lens === 'all' ? '全体' : lens === 'win' ? '勝利時' : '敗北時';

  var headerRows = [
    [matchesLabel, matchesVal, '-'],
    ['勝率', lens === 'all' ? colorPct(p.win_rate) : '-', '-'],
  ];

  var msRows = (p.partner_ms_breakdown || []).map(function (m) { return [esc(m.ms), m.matches, colorPct(m.win_rate)]; });

  return html`<${Panel} title="固定相方">
    ${fp.notice && html`<p style="margin-bottom: 12px; color: var(--muted); font-size: 0.9em;">${esc(fp.notice)}</p>`}
    ${fpItems.length > 1 ? html`<${PartnerDropdown} items=${fpItems} idx=${idx} onSelect=${setIdx} />` : html`<div class="ms-head">
      <span class="name">${esc(p.partner_name)}${p.team_name ? html` <span class="meta">【${esc(p.team_name)}】</span>` : ''}</span>
      <span>${p.matches}戦 ${cellDisplay(colorPct(p.win_rate))}</span>
    </div>`}
    <${CompareRadar} labels=${['与ダメ', '撃墜', '覚醒回数', '被ダメ', '被撃墜', 'EXダメ']} series=${[
      { label: '自分 (' + lensLabel + ')', color: '#4fc3f7', bg: 'rgba(79,195,247,.2)', data: pVec(p.my_stats, myWl) },
      { label: '相方 (' + lensLabel + ')', color: '#ff8a65', bg: 'rgba(255,138,101,.18)', data: pVec(p.partner_stats, partnerWl) },
    ]} />
    <${Table} headers=${['項目 (' + lensLabel + ')', '自分', '相方']} rows=${headerRows.concat(statsRows)} />
    ${msRows.length > 0 && html`<p><strong>相方の使用機体:</strong></p><${Table} headers=${['機体', '試合', '勝率']} rows=${msRows} />`}
    <${Tips} tips=${p.tips} />
  <//>`;
}

// --- Tab panes ---

function OverviewPane({ pd, selectedMs, lens, allPd }) {
  var seasons = allPd.season || [];
  var msStats = allPd.ms_stats || {};
  var msEntries = Object.keys(msStats).sort(function (a, b) { return msStats[b].matches - msStats[a].matches; });
  var compareEntries = msEntries.map(function (name) {
    return { name: name, winRate: (msStats[name].basic_stats && msStats[name].basic_stats.win_rate) || 0 };
  });

  var fp = allPd.fixed_partners;
  var fpList = fp ? (fp.partners || fp) : [];
  var fpItems = Array.isArray(fpList) ? fpList : [];

  return html`<div class="tabpane">
    ${pd.basic_stats && html`<${Panel} title="基本データ">
      <${BasicLensSection} basic=${pd.basic_stats} pattern=${pd.win_loss_pattern} lens=${lens} />
    <//>`}

    ${!selectedMs && seasons.length > 0 && html`<${Panel} title="シーズン別分析">
      ${seasons.length > 1 && html`<${SeasonChart} seasons=${seasons} />`}
      ${seasons.map(function (s) {
        var rows = [['全体', s.matches, colorPct(s.win_rate), colorDE(s.dmg_efficiency, 3)]];
        if (s.first_half) rows.push(['前半', s.first_half.matches, colorPct(s.first_half.win_rate), colorDE(s.first_half.dmg_efficiency, 3)]);
        if (s.second_half) rows.push(['後半', s.second_half.matches, colorPct(s.second_half.win_rate), colorDE(s.second_half.dmg_efficiency, 3)]);
        return html`<${SubSection} title=${esc(s.name)}>
          <${Table} headers=${['期間', '試合', '勝率', '与被ダメ比']} rows=${rows} />
          <${Tips} tips=${s.tips} />
        <//>`;
      })}
    <//>`}

    ${!selectedMs && compareEntries.length > 1 && html`<${Panel} title="機体別の勝率比較">
      <${MsCompareChart} entries=${compareEntries} />
    <//>`}

    ${fpItems.length > 0 && html`<${FixedPartnerPanel} fp=${fp} fpItems=${fpItems} lens=${lens} />`}

    ${!fpItems.length && fp && fp.notice && html`<${Panel} title="固定相方">
      <p>${esc(fp.notice)}</p>
    <//>`}
  </div>`;
}

function TimePane({ pd, selectedMs }) {
  var time = pd.time_of_day, dow = pd.day_of_week, daily = pd.daily_trend;
  var timeRows = time && time.hours ? time.hours.map(function (h) {
    return [{ sortValue: h.hour, display: h.hour + '時' }, h.matches, colorPct(h.win_rate), colorDE(h.dmg_efficiency, 3)];
  }) : [];
  var dowSummary = [];
  if (dow && dow.weekday) dowSummary.push(['平日', dow.weekday.matches, colorPct(dow.weekday.win_rate), colorDE(dow.weekday.dmg_efficiency, 3)]);
  if (dow && dow.weekend) dowSummary.push(['土日', dow.weekend.matches, colorPct(dow.weekend.win_rate), colorDE(dow.weekend.dmg_efficiency, 3)]);
  var dowDays = (dow && dow.days || []).map(function (d) {
    return [d.name + '曜', d.matches, colorPct(d.win_rate), colorDE(d.dmg_efficiency, 3)];
  });
  var dailyRows = (daily && daily.days || []).map(function (d) {
    return [{ sortValue: d.date, display: d.date + ' (' + d.dow_name + ')' }, d.matches, colorPct(d.win_rate), colorDE(d.dmg_efficiency, 3)];
  });

  return html`<div class="tabpane">
    ${selectedMs && html`<div class="info-note">※ 時間帯データは全機体の集計です（機体別の時間帯分析は今後対応予定）</div>`}
    ${time && time.hours && time.hours.length > 0 && html`<${Panel} title="時間帯別の勝率">
      <${TimeOfDayChart} hours=${time.hours} />
      <${Tips} tips=${time.tips} />
      <${SubSection} title="テーブルで詳細を見る">
        <${SortableTable} headers=${['時間帯', '試合', '勝率', '与被ダメ比']} rows=${timeRows} />
      <//>
    <//>`}
    ${dow && dow.days && dow.days.length > 0 && html`<${Panel} title="曜日別の勝率">
      <${DayOfWeekChart} days=${dow.days} />
      <${Tips} tips=${dow.tips} />
      <${SubSection} title="テーブルで詳細を見る">
        ${dowSummary.length > 0 && html`<h3>平日 vs 土日</h3><${Table} headers=${['区分', '試合', '勝率', '与被ダメ比']} rows=${dowSummary} />`}
        ${dowDays.length > 0 && html`<h3>曜日別</h3><${Table} headers=${['曜日', '試合', '勝率', '与被ダメ比']} rows=${dowDays} />`}
      <//>
    <//>`}
    ${daily && daily.days && daily.days.length > 0 && html`<${Panel} title="日別勝率">
      <${DailyTrendChart} days=${daily.days} />
      <${Tips} tips=${daily.tips} />
      <${SubSection} title="テーブルで詳細を見る">
        <${SortableTable} headers=${['日付', '試合', '勝率', '与被ダメ比']} rows=${dailyRows} />
      <//>
    <//>`}
  </div>`;
}

// --- New tab panes ---

function PlaystylePane({ msStats, selectedMs }) {
  var deaths, fallOrder, dmg;
  if (selectedMs && msStats[selectedMs]) {
    var ms = msStats[selectedMs];
    deaths = ms.deaths_impact;
    fallOrder = ms.fall_order;
    dmg = ms.dmg_contribution;
  } else {
    deaths = aggregateDeathsImpact(msStats);
    fallOrder = aggregateFallOrder(msStats);
    dmg = aggregateDmgContribution(msStats);
  }

  var deathItems = [];
  if (deaths) {
    deaths.forEach(function (d) {
      (d.buckets || []).forEach(function (b) { deathItems.push(b); });
    });
  }

  var fallItems = [];
  if (fallOrder) {
    ['no_fall', 'first_fall', 'second_fall', 'same_time'].forEach(function (k) {
      if (fallOrder[k] && fallOrder[k].count > 0) {
        var labels = { no_fall: '0落ち', first_fall: '先落ち', second_fall: '後落ち', same_time: '同時落ち' };
        fallItems.push({ name: labels[k], winRate: fallOrder[k].win_rate });
      }
    });
  }

  return html`<div class="tabpane">
    ${deaths && deathItems.length > 0 && html`<${Panel} title="被撃墜数と勝率">
      <${WinRateBarChart} items=${deathItems} />
      <${DeathsImpactSubSection} deaths=${deaths} />
    <//>`}

    ${fallOrder && html`<${Panel} title="先落ち/後落ち分析">
      ${fallItems.length > 0 && html`<${MsCompareChart} entries=${fallItems} />`}
      <${FallOrderContent} fallOrder=${fallOrder} />
    <//>`}

    ${dmg && html`<${Panel} title="ダメージ貢献率">
      <${DmgContributionChart} dmg=${dmg} />
      <${DmgContributionSubSection} dmg=${dmg} />
    <//>`}

    ${!deaths && !fallOrder && !dmg && html`<${Panel}><p>立ち回りデータがありません。</p><//>`}
  </div>`;
}

function BurstPane({ msStats, selectedMs }) {
  var burstCount, burstHold;
  if (selectedMs && msStats[selectedMs]) {
    var ms = msStats[selectedMs];
    burstCount = ms.burst_count;
    burstHold = ms.burst_hold_death;
  } else {
    burstCount = aggregateBurstCount(msStats);
    burstHold = aggregateBurstHoldDeath(msStats);
  }

  var countItems = burstCount && burstCount.by_count ? burstCount.by_count : [];
  var holdItems = [];
  if (burstHold) {
    (burstHold.by_death || []).filter(function (d) { return d.count > 0; }).forEach(function (d) {
      holdItems.push({ label: d.label, matches: d.count, win_rate: d.win_rate });
    });
    if (burstHold.no_hold && burstHold.no_hold.count > 0) {
      holdItems.push({ label: '抱え落ちなし', matches: burstHold.no_hold.count, win_rate: burstHold.no_hold.win_rate });
    }
  }

  return html`<div class="tabpane">
    ${countItems.length > 0 && html`<${Panel} title="覚醒回数と勝率">
      <${WinRateBarChart} items=${countItems} />
      <${BurstCountContent} countData=${burstCount} />
    <//>`}

    ${holdItems.length > 0 && html`<${Panel} title="覚醒抱え落ち">
      <${WinRateBarChart} items=${holdItems} />
      <${BurstHoldDeathContent} holdData=${burstHold} />
    <//>`}

    ${!countItems.length && !holdItems.length && html`<${Panel}><p>覚醒データがありません（タイムラインデータが必要です）。</p><//>`}
  </div>`;
}

function MatchupPane({ msStats, selectedMs }) {
  if (selectedMs && msStats[selectedMs]) {
    var ms = msStats[selectedMs];
    var enemyStrong = (ms.enemy_matchup && ms.enemy_matchup.strong || []).slice(0, 10).map(function (e) { return { name: e.ms, winRate: e.win_rate }; });
    var enemyWeak = (ms.enemy_matchup && ms.enemy_matchup.weak || []).slice(0, 10).map(function (e) { return { name: e.ms, winRate: e.win_rate }; });
    var partnerEntries = (ms.partner || []).slice(0, 10).map(function (p) { return { name: p.ms, winRate: p.win_rate }; });
    var msPairEntries = (ms.ms_pair && ms.ms_pair.by_matches || []).slice(0, 10).map(function (p) { return { name: p.pair, winRate: p.win_rate }; });
    var costPairEntries = (ms.cost_pair || []).map(function (p) { return { name: p.pair, winRate: p.win_rate }; });

    return html`<div class="tabpane">
      ${ms.enemy_matchup && html`<${Panel} title="敵機体との相性">
        ${enemyStrong.length > 0 && html`<h3>得意な相手</h3><${MsCompareChart} entries=${enemyStrong} />`}
        ${enemyWeak.length > 0 && html`<h3>苦手な相手</h3><${MsCompareChart} entries=${enemyWeak} />`}
        <${EnemyMatchupSection} matchup=${ms.enemy_matchup} />
      <//>`}

      ${ms.partner && ms.partner.length > 0 && html`<${Panel} title="相方機体との相性">
        <${MsCompareChart} entries=${partnerEntries} />
        <${PartnerSection} partners=${ms.partner} />
      <//>`}

      ${ms.ms_pair && html`<${Panel} title="編成別勝率">
        ${msPairEntries.length > 0 && html`<${MsCompareChart} entries=${msPairEntries} />`}
        <${MsPairSubSection} msPair=${ms.ms_pair} />
      <//>`}

      ${ms.cost_pair && ms.cost_pair.length > 0 && html`<${Panel} title="コスト編成別勝率">
        <${MsCompareChart} entries=${costPairEntries} />
        <${CostPairSubSection} costPair=${ms.cost_pair} />
      <//>`}
    </div>`;
  }

  var agg = aggregateEnemyMatchup(msStats);
  var aggPartner = aggregatePartner(msStats);
  var aggStrong = (agg.strong || []).slice(0, 10).map(function (e) { return { name: e.ms, winRate: e.win_rate }; });
  var aggWeak = (agg.weak || []).slice(0, 10).map(function (e) { return { name: e.ms, winRate: e.win_rate }; });
  var aggPartnerEntries = aggPartner.slice(0, 10).map(function (p) { return { name: p.ms, winRate: p.win_rate }; });

  return html`<div class="tabpane">
    <${Panel} title="敵機体との相性（全機体集計）">
      ${aggStrong.length > 0 && html`<h3>得意な相手</h3><${MsCompareChart} entries=${aggStrong} />`}
      ${aggWeak.length > 0 && html`<h3>苦手な相手</h3><${MsCompareChart} entries=${aggWeak} />`}
      <${EnemyMatchupSection} matchup=${agg} />
    <//>

    ${aggPartnerEntries.length > 0 && html`<${Panel} title="相方機体との相性（全機体集計）">
      <${MsCompareChart} entries=${aggPartnerEntries} />
      <${PartnerSection} partners=${aggPartner} />
    <//>`}
  </div>`;
}

// --- Main report ---

var TAB_DEFS = [
  ['overview', '総合'],
  ['playstyle', '立ち回り'],
  ['burst', '覚醒'],
  ['matchup', '機体相性'],
  ['time', '時間帯'],
];

function reAnalyze() {
  // セッション保持中はパスワード不要で再分析
  if (localStorage.getItem('catalyzer_has_session')) {
    window.scrollTo({ top: 0, behavior: 'smooth' });
    reanalyzeWithSession();
    return;
  }
  var u = document.getElementById('username');
  var p = document.getElementById('password');
  if (u && p && u.value && p.value) {
    window.scrollTo({ top: 0, behavior: 'smooth' });
    analyze();
    return;
  }
  var rep = document.getElementById('report');
  if (rep) rep.style.display = 'none';
  var lf = document.getElementById('loginForm');
  if (lf) lf.style.display = 'block';
  var t = document.getElementById('pageTitle');
  if (t) t.style.display = '';
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function reanalyzeWithSession() {
  var status = document.getElementById('status');
  var statusText = document.getElementById('statusText');
  var error = document.getElementById('error');

  // localStorageにキャッシュがあれば即時表示
  try {
    var cachedStr = localStorage.getItem('catalyzer_report');
    var cachedKey = localStorage.getItem('catalyzer_user_key');
    if (cachedStr && cachedKey) renderReport(JSON.parse(cachedStr), cachedKey);
  } catch (e) {}

  status.style.display = 'block';
  statusText.textContent = STATUS_MESSAGES.refreshing;
  error.style.display = 'none';

  var lastPreliminaryVersion = 0;

  try {
    var res = await fetch('/reanalyze', { method: 'POST' });
    var data = await res.json();

    if (data.error) {
      // セッション失効
      if (res.status === 401) {
        localStorage.removeItem('catalyzer_user_key');
        localStorage.removeItem('catalyzer_has_session');
        var lf = document.getElementById('loginForm');
        if (lf) lf.style.display = 'block';
        error.style.display = 'block';
        error.textContent = data.error;
        status.style.display = 'none';
        return;
      }
      throw new Error(data.error);
    }

    var jobId = data.id;

    while (true) {
      await new Promise(function (r) { setTimeout(r, 3000); });

      var statusRes = await fetch('/status/' + jobId);
      var statusData = await statusRes.json();

      if (statusData.error && statusData.status !== 'error') {
        throw new Error(statusData.error);
      }

      statusText.textContent = statusData.message || STATUS_MESSAGES[statusData.status] || statusData.status;

      var progressWrap = document.getElementById('progressWrap');
      var progressFill = document.getElementById('progressFill');
      if (statusData.progress_total > 0) {
        var p = Math.round(100 * statusData.progress / statusData.progress_total);
        progressFill.classList.remove('indeterminate');
        progressFill.style.width = p + '%';
        document.getElementById('progressPct').textContent = p + '%';
        document.getElementById('progressCount').textContent = statusData.progress + '/' + statusData.progress_total + '件';
        progressWrap.style.display = 'block';
      } else if (statusData.status === 'scraping') {
        progressFill.classList.add('indeterminate');
        document.getElementById('progressPct').textContent = '戦歴を検索中…';
        document.getElementById('progressCount').textContent = statusData.progress ? statusData.progress + '件' : '';
        progressWrap.style.display = 'block';
      } else {
        progressFill.classList.remove('indeterminate');
        progressWrap.style.display = 'none';
      }

      if (statusData.logged_in && statusData.has_preliminary_report && statusData.preliminary_version > lastPreliminaryVersion) {
        var prelimRes = await fetch('/result/' + jobId);
        var prelimData = await prelimRes.json();
        if (prelimData.report && prelimData.preliminary) {
          renderReport(prelimData.report, prelimData.user_key);
          statusText.textContent = STATUS_MESSAGES.refreshing;
          lastPreliminaryVersion = statusData.preliminary_version;
        }
      }

      if (statusData.status === 'error') {
        // セッション失効エラーの場合はログイン画面を表示
        if (statusData.error && statusData.error.indexOf('セッション') >= 0) {
          localStorage.removeItem('catalyzer_user_key');
          localStorage.removeItem('catalyzer_has_session');
          var lf = document.getElementById('loginForm');
          if (lf) lf.style.display = 'block';
        }
        throw new Error(statusData.error || '分析に失敗しました');
      }

      if (statusData.status === 'done') {
        var resultRes = await fetch('/result/' + jobId);
        var resultData = await resultRes.json();
        if (resultData.error) throw new Error(resultData.error);
        renderReport(resultData.report, resultData.user_key);
        if (resultData.user_key) {
          fetchAndCacheMatches(resultData.user_key);
        }
        break;
      }
    }
  } catch (e) {
    error.style.display = 'block';
    error.textContent = e.message;
  } finally {
    status.style.display = 'none';
  }
}

async function logout() {
  try {
    await fetch('/session', { method: 'DELETE' });
  } catch (e) {}
  localStorage.removeItem('catalyzer_report');
  localStorage.removeItem('catalyzer_user_key');
  localStorage.removeItem('catalyzer_has_session');
  try { sessionStorage.removeItem('catalyzer_cred'); } catch (e) {}

  var rep = document.getElementById('report');
  if (rep) { render(null, rep); rep.style.display = 'none'; }
  var lf = document.getElementById('loginForm');
  if (lf) lf.style.display = 'block';
  var t = document.getElementById('pageTitle');
  if (t) t.style.display = '';
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function Report({ data, userKey }) {
  if (!data) return null;
  var periodRef = useState('all');
  var selectedPeriod = periodRef[0], setSelectedPeriod = periodRef[1];
  var customDataRef = useState(null);
  var customData = customDataRef[0], setCustomData = customDataRef[1];
  var tabRef = useState('overview');
  var activeTab = tabRef[0], setActiveTab = tabRef[1];
  var msRef = useState(null);
  var selectedMs = msRef[0], setSelectedMs = msRef[1];
  var lensRef = useState('all');
  var lens = lensRef[0], setLens = lensRef[1];
  var menuRef = useState(false);
  var menuOpen = menuRef[0], setMenuOpen = menuRef[1];
  var topbarRef = useRef(null);

  useEffect(function () {
    var row = topbarRef.current && topbarRef.current.querySelector('.controls-row');
    if (!row) return;
    function onScroll() {
      if (window.scrollY > 50) {
        row.style.maxHeight = '0';
        row.style.opacity = '0';
        row.style.paddingTop = '0';
        row.style.overflow = 'hidden';
        row.style.pointerEvents = 'none';
      } else {
        row.style.maxHeight = '';
        row.style.opacity = '';
        row.style.paddingTop = '';
        row.style.overflow = '';
        row.style.pointerEvents = '';
      }
    }
    window.addEventListener('scroll', onScroll, { passive: true });
    return function () { window.removeEventListener('scroll', onScroll); };
  }, []);

  var periods = data.periods || {};
  var allPeriods = customData ? Object.assign({}, periods, { custom: customData.periods.custom }) : periods;
  var pd = allPeriods[selectedPeriod] || allPeriods['all'];
  if (!pd) return null;

  var msStats = pd.ms_stats || {};
  var msEntries = useMemo(function () {
    return Object.keys(msStats).sort(function (a, b) { return msStats[b].matches - msStats[a].matches; }).map(function (name) {
      return { name: name, matches: msStats[name].matches };
    });
  }, [msStats]);

  useEffect(function () {
    if (selectedMs && !msStats[selectedMs]) setSelectedMs(null);
  }, [pd]);

  var effectivePd = useMemo(function () {
    if (!selectedMs || !msStats[selectedMs]) return pd;
    var ms = msStats[selectedMs];
    return { basic_stats: ms.basic_stats, win_loss_pattern: ms.win_loss_pattern };
  }, [pd, selectedMs]);

  var shareData = selectedPeriod === 'custom' && customData ? customData.share_data : data.share_data;

  function handleCustomReport(report) {
    setCustomData(report);
    setSelectedPeriod('custom');
  }

  var pane;
  if (activeTab === 'playstyle') {
    pane = html`<${PlaystylePane} msStats=${msStats} selectedMs=${selectedMs} />`;
  } else if (activeTab === 'burst') {
    pane = html`<${BurstPane} msStats=${msStats} selectedMs=${selectedMs} />`;
  } else if (activeTab === 'matchup') {
    pane = html`<${MatchupPane} msStats=${msStats} selectedMs=${selectedMs} />`;
  } else if (activeTab === 'time') {
    pane = html`<${TimePane} pd=${pd} selectedMs=${selectedMs} />`;
  } else {
    pane = html`<${OverviewPane} pd=${effectivePd} selectedMs=${selectedMs} lens=${lens} allPd=${pd} />`;
  }

  return html`
    <div class="topbar" ref=${topbarRef}>
      <button class="hamburger" onClick=${function () { setMenuOpen(true); }}>☰</button>
      <span class="brand"><img src="logo.svg" alt="catalyzer" /></span>
      <div class="controls-row">
        <${PeriodSelector} periods=${allPeriods} selected=${selectedPeriod} onSelect=${setSelectedPeriod}
          userKey=${userKey} onCustomReport=${handleCustomReport} />
        <${MsSelector} entries=${msEntries} selected=${selectedMs} onSelect=${setSelectedMs} />
        <${LensToggle} lens=${lens} onSelect=${setLens} />
      </div>
      <div class="tabs">${TAB_DEFS.map(function (t) {
        return html`<button class=${'tab' + (activeTab === t[0] ? ' active' : '')}
          onClick=${function () { setActiveTab(t[0]); }}>${t[1]}</button>`;
      })}</div>
    </div>

    <${HamburgerMenu} isOpen=${menuOpen} onClose=${function () { setMenuOpen(false); }}
      shareData=${shareData} onReAnalyze=${reAnalyze}
      hasSession=${!!localStorage.getItem('catalyzer_has_session')}
      onLogout=${logout} />

    <${KpiGrid} stats=${effectivePd.basic_stats} />

    ${pane}

  `;
}

// --- Main app logic ---

// ログイン成功後、データ到着までのダッシュボード骨組み表示
function Skeleton() {
  var menuRef = useState(false);
  var menuOpen = menuRef[0], setMenuOpen = menuRef[1];
  function bar(w, h, mb) {
    return html`<div class="skel" style=${{ width: w, height: h + 'px', marginBottom: (mb || 0) + 'px' }}></div>`;
  }
  return html`
    <div class="topbar">
      <button class="hamburger" onClick=${function () { setMenuOpen(true); }}>☰</button>
      <span class="brand"><img src="logo.svg" alt="catalyzer" /></span>
      <div class="controls-row" style=${{ opacity: 0.5, pointerEvents: 'none' }}>
        <button class="period-trigger" disabled>全データ <span class="period-arrow">▼</span></button>
        <button class="ms-topbar-trigger" disabled>全機体 <span class="period-arrow">▼</span></button>
        <${LensToggle} lens=${'all'} onSelect=${function () {}} />
      </div>
      <div class="tabs" style=${{ opacity: 0.5, pointerEvents: 'none' }}>
        ${TAB_DEFS.map(function (t) {
          return html`<button class=${'tab' + (t[0] === 'overview' ? ' active' : '')} disabled>${t[1]}</button>`;
        })}
      </div>
    </div>
    <${HamburgerMenu} isOpen=${menuOpen} onClose=${function () { setMenuOpen(false); }}
      shareData=${null} onReAnalyze=${function () {}} />
    <div class="kpi-grid">
      ${[0, 1, 2, 3, 4, 5].map(function () {
        return html`<div class="kpi">${bar('50%', 12, 12)}${bar('70%', 28)}</div>`;
      })}
    </div>
    <div class="panel">
      ${bar('30%', 16, 14)}${bar('100%', 220)}
    </div>
    <div class="panel">
      ${bar('24%', 16, 14)}
      ${[0, 1, 2, 3].map(function () { return bar('100%', 14, 10); })}
    </div>
  `;
}

function showSkeleton() {
  var reportEl = document.getElementById('report');
  reportEl.style.display = 'block';
  var pageTitle = document.getElementById('pageTitle');
  if (pageTitle) pageTitle.style.display = 'none';
  render(html`<${Skeleton} />`, reportEl);
}

function renderReport(data, userKey) {
  var reportEl = document.getElementById('report');
  reportEl.style.display = 'block';
  var pageTitle = document.getElementById('pageTitle');
  if (pageTitle) pageTitle.style.display = 'none';
  render(html`<${Report} data=${data} userKey=${userKey} />`, reportEl);

  // レポートをlocalStorageにキャッシュ（次回アクセス時の即時表示用）
  try {
    localStorage.setItem('catalyzer_report', JSON.stringify(data));
    if (userKey) localStorage.setItem('catalyzer_user_key', userKey);
  } catch (e) {}
}

async function analyze() {
  var username = document.getElementById('username').value;
  var password = document.getElementById('password').value;
  var btn = document.getElementById('analyzeBtn');
  var status = document.getElementById('status');
  var statusText = document.getElementById('statusText');
  var error = document.getElementById('error');
  var reportEl = document.getElementById('report');

  if (!username || !password) {
    error.style.display = 'block';
    error.textContent = 'メールアドレスとパスワードを入力してください。';
    return;
  }

  try { sessionStorage.setItem('catalyzer_cred', JSON.stringify({ u: username, p: password })); } catch (e) {}

  btn.disabled = true;
  status.style.display = 'block';
  statusText.textContent = STATUS_MESSAGES.pending;
  error.style.display = 'none';
  error.style.backgroundColor = '';
  error.style.borderColor = '';
  error.style.color = '';
  reportEl.style.display = 'none';
  render(null, reportEl);

  var pageTitle = document.getElementById('pageTitle');
  if (pageTitle) pageTitle.style.display = '';

  document.getElementById('loginForm').style.display = 'none';
  var lastPreliminaryVersion = 0;
  var renderedReal = false;

  // localStorageにキャッシュがあれば即時表示、なければスケルトン
  var usedCache = false;
  try {
    var cachedStr = localStorage.getItem('catalyzer_report');
    var cachedKey = localStorage.getItem('catalyzer_user_key');
    if (cachedStr && cachedKey) {
      renderReport(JSON.parse(cachedStr), cachedKey);
      statusText.textContent = STATUS_MESSAGES.refreshing;
      usedCache = true;
    }
  } catch (e) {}
  if (!usedCache) showSkeleton();

  try {
    var rememberEl = document.getElementById('remember');
    var remember = rememberEl ? rememberEl.checked : false;

    var res = await fetch('/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: username, password: password, remember: remember }),
    });

    var data = await res.json();
    if (data.error) {
      throw new Error(data.error);
    }

    var jobId = data.id;

    while (true) {
      await new Promise(function (r) { setTimeout(r, 3000); });

      var statusRes = await fetch('/status/' + jobId);
      var statusData = await statusRes.json();

      if (statusData.error && statusData.status !== 'error') {
        throw new Error(statusData.error);
      }

      statusText.textContent = statusData.message || STATUS_MESSAGES[statusData.status] || statusData.status;

      var progressWrap = document.getElementById('progressWrap');
      var progressFill = document.getElementById('progressFill');
      var isScraping = statusData.status === 'scraping';
      if (statusData.progress_total > 0) {
        // 総数確定: 処理済み/総数の正確なバー
        var p = Math.round(100 * statusData.progress / statusData.progress_total);
        progressFill.classList.remove('indeterminate');
        progressFill.style.width = p + '%';
        document.getElementById('progressPct').textContent = p + '%';
        document.getElementById('progressCount').textContent = statusData.progress + '/' + statusData.progress_total + '件';
        progressWrap.style.display = 'block';
      } else if (isScraping) {
        // 総数未確定(Phase2)中: 不定アニメーション + 取得済み件数
        progressFill.classList.add('indeterminate');
        document.getElementById('progressPct').textContent = '戦歴を検索中…';
        document.getElementById('progressCount').textContent = statusData.progress ? statusData.progress + '件' : '';
        progressWrap.style.display = 'block';
      } else {
        progressFill.classList.remove('indeterminate');
        progressWrap.style.display = 'none';
      }

      // 速報レポート（キャッシュ含む実データ）はログイン成功確認後にのみ反映する
      if (statusData.logged_in && statusData.has_preliminary_report && statusData.preliminary_version > lastPreliminaryVersion) {
        var prelimRes = await fetch('/result/' + jobId);
        var prelimData = await prelimRes.json();
        if (prelimData.report && prelimData.preliminary) {
          renderReport(prelimData.report, prelimData.user_key);
          renderedReal = true;
          statusText.textContent = STATUS_MESSAGES.refreshing;
          lastPreliminaryVersion = statusData.preliminary_version;
        }
      }

      if (statusData.status === 'error') {
        throw new Error(statusData.error || '分析に失敗しました');
      }

      if (statusData.status === 'done') {
        var resultRes = await fetch('/result/' + jobId);
        var resultData = await resultRes.json();

        if (resultData.error) {
          throw new Error(resultData.error);
        }

        renderReport(resultData.report, resultData.user_key);
        renderedReal = true;
        // remember=trueで分析成功 → セッションフラグをセット
        if (remember) {
          try { localStorage.setItem('catalyzer_has_session', '1'); } catch (e) {}
        }
        if (resultData.user_key) {
          fetchAndCacheMatches(resultData.user_key);
        }
        if (resultData.partial) {
          var warning = document.getElementById('error');
          warning.style.display = 'block';
          warning.style.backgroundColor = '#4a3800';
          warning.style.borderColor = '#d4a017';
          warning.style.color = '#ffd54f';
          warning.textContent = 'ガンダムモバイルからアクセスが制限されたため、一部のデータのみで分析しています。時間をおいて再度実行すると続きから取得します。';
        }
        break;
      }
    }
  } catch (e) {
    error.style.display = 'block';
    error.textContent = e.message;
    // まだ実データを描画していない（ログイン中 or スケルトン表示中）なら結果画面を畳んでログイン画面へ戻す
    if (!renderedReal) {
      render(null, reportEl);
      reportEl.style.display = 'none';
      if (pageTitle) pageTitle.style.display = '';
    }
    document.getElementById('loginForm').style.display = 'block';
  } finally {
    btn.disabled = false;
    status.style.display = 'none';
  }
}

var loginForm = document.getElementById('loginForm');
if (loginForm) {
  loginForm.addEventListener('submit', function (e) {
    e.preventDefault();
    analyze();
  });
  try {
    var cred = JSON.parse(sessionStorage.getItem('catalyzer_cred'));
    if (cred) {
      document.getElementById('username').value = cred.u;
      document.getElementById('password').value = cred.p;
    }
  } catch (e) {}
}

// セッション保持の説明モーダル
var rememberInfoBtn = document.getElementById('rememberInfoBtn');
var rememberModal = document.getElementById('rememberModal');
var rememberModalClose = document.getElementById('rememberModalClose');
if (rememberInfoBtn && rememberModal) {
  rememberInfoBtn.addEventListener('click', function (e) {
    e.preventDefault();
    rememberModal.style.display = 'flex';
  });
  rememberModal.addEventListener('click', function (e) {
    if (e.target === rememberModal) rememberModal.style.display = 'none';
  });
  if (rememberModalClose) {
    rememberModalClose.addEventListener('click', function () {
      rememberModal.style.display = 'none';
    });
  }
}

// ページロード時: localStorageにキャッシュレポートがあれば即時表示
(function initSession() {
  var cachedReport = null;
  var cachedUserKey = null;
  var hasSession = false;
  try {
    var reportStr = localStorage.getItem('catalyzer_report');
    cachedUserKey = localStorage.getItem('catalyzer_user_key');
    hasSession = !!localStorage.getItem('catalyzer_has_session');
    if (reportStr) cachedReport = JSON.parse(reportStr);
  } catch (e) {}

  // キャッシュレポートがあれば即時表示
  if (cachedReport && cachedUserKey) {
    renderReport(cachedReport, cachedUserKey);
  }

  if (hasSession) {
    // セッション保持ユーザー: ログインフォームを隠し、バックグラウンドでセッション確認
    if (loginForm) loginForm.style.display = 'none';

    fetch('/session').then(function (r) { return r.json(); }).then(function (data) {
      if (!data.valid) {
        // セッション失効
        localStorage.removeItem('catalyzer_has_session');
        if (loginForm) loginForm.style.display = 'block';
        // レポートキャッシュがない場合はサーバーのレポートキャッシュなしで通常ログインへ
      } else if (!cachedReport && data.report) {
        // localStorageにレポートがないがサーバーにはある場合
        renderReport(data.report, data.user_key);
        if (loginForm) loginForm.style.display = 'none';
        try { localStorage.setItem('catalyzer_report', JSON.stringify(data.report)); } catch (e) {}
      }
    }).catch(function () {
      // ネットワークエラー: ログインフォームを表示
      if (loginForm) loginForm.style.display = 'block';
    });
  }
  // セッションなし + キャッシュありの場合: レポートは表示済み、ログインフォームも表示（デフォルト）
})();

// preview.html用: windowにrenderReportを公開
window.renderReport = renderReport;
