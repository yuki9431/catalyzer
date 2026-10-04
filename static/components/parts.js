import { html } from '../htm-preact-standalone.js';

// 段階B の画面が共通で使う小部品。クラスは ui- 接頭辞(styles/parts.css)、目印は data-ui。
export function Chip({ tone, active, onClick, children }) {
  var cls = 'ui-chip' + (tone ? ' ui-chip-' + tone : '') + (active ? ' ui-chip-active' : '');
  if (onClick) return html`<button type="button" class=${cls} data-ui="chip" aria-pressed=${!!active} onClick=${onClick}>${children}</button>`;
  return html`<span class=${cls} data-ui="chip">${children}</span>`;
}

export function ToggleGroup({ options, value, onChange, label }) {
  return html`<div class="ui-toggle" role="group" aria-label=${label} data-ui="toggle">
    ${options.map(function (o) {
      return html`<button type="button" class="ui-toggle-btn" aria-pressed=${o.value === value} onClick=${function () { onChange(o.value); }}>${o.label}</button>`;
    })}
  </div>`;
}

export function Summary({ items }) {
  return html`<dl class="ui-summary" data-ui="summary">
    ${items.map(function (it) {
      return html`<div class=${'ui-summary-item' + (it.tone ? ' ui-summary-' + it.tone : '')}>
        <dt>${it.label}</dt>
        <dd>${it.value}${it.sub && html`<small>${it.sub}</small>`}</dd>
      </div>`;
    })}
  </dl>`;
}

// rows[i]: {key,main,sub?,aside?,href?(外部リンク),tone?:'danger',expand?(行内に展開する要素。null で閉)}
export function RowList({ rows, onSelect }) {
  return html`<ul class="ui-rows" data-ui="row-list">
    ${rows.map(function (r) {
      var body = html`<span class="ui-row-main">${r.main}${r.sub && html`<small>${r.sub}</small>`}</span>${r.aside && html`<span class="ui-row-aside">${r.aside}</span>`}`;
      var cls = 'ui-row-btn' + (r.tone === 'danger' ? ' ui-row-danger' : '');
      var op = r.href
        ? html`<a class=${cls} href=${r.href} target="_blank" rel="noopener noreferrer">${body}</a>`
        : onSelect
          ? html`<button type="button" class=${cls} aria-expanded=${r.expand !== undefined ? !!r.expand : undefined} onClick=${function () { onSelect(r.key); }}>${body}</button>`
          : html`<div class="ui-row-body">${body}</div>`;
      return html`<li key=${r.key} class="ui-row">${op}${r.expand}</li>`;
    })}
  </ul>`;
}

export function Notice({ tone = 'info', children }) {
  return html`<div class=${'ui-notice ui-notice-' + tone} role=${tone === 'error' ? 'alert' : 'status'} data-ui="notice">${children}</div>`;
}
