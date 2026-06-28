import { html, useState, useMemo } from '../htm-preact-standalone.js';
import { boldText, cellValue, cellDisplay } from '../lib/format.js';

export function Tips({ tips }) {
  if (!tips || !tips.length) return null;
  return html`<blockquote><strong>💡アドバイス:</strong><br />${tips.map(function (t, i) {
    var text = typeof t === 'string' ? t : t.text;
    var details = typeof t === 'object' && t.details ? t.details : null;
    return html`${i > 0 && html`<br />`}${boldText(text)}
      ${details && html`<ul class="advice-details">${details.map(function (d) { return html`<li>${boldText(d)}</li>`; })}</ul>`}`;
  })}</blockquote>`;
}

export function SortableTable({ headers, rows, sortableColumns, defaultLimit }) {
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

export function Table({ headers, rows }) {
  if (!rows || !rows.length) return null;
  return html`<${SortableTable} headers=${headers} rows=${rows} />`;
}

export function Section({ title, open, children }) {
  return html`<details ...${{ open: open || false }}>
    <summary><strong>${title}</strong></summary>
    ${children}
  </details><hr />`;
}

export function SubSection({ title, open, children }) {
  return html`<details ...${{ open: open || false }}>
    <summary>${title}</summary>
    ${children}
  </details>`;
}
