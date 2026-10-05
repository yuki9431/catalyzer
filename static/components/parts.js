import { html } from '../htm-preact-standalone.js';

// 段階B の画面が共通で使う小部品。クラスは ui- 接頭辞(styles/parts.css)、目印は data-ui。
// 0 は表示する(`v &&` だと 0 が消える)
function has(v) { return v != null && v !== ''; }

// expanded を渡すと開閉ボタン(シートを開くチップ)。渡さなければ従来のチップ
export function Chip({ tone, active, onClick, expanded, ui, children }) {
  var cls = 'ui-chip' + (tone ? ' ui-chip-' + tone : '') + (active ? ' ui-chip-active' : '') + (expanded !== undefined ? ' ui-chip-opener' : '');
  var d = ui || 'chip';
  if (expanded !== undefined) return html`<button type="button" class=${cls} data-ui=${d} aria-expanded=${!!expanded} aria-haspopup="dialog" onClick=${onClick}>${children}</button>`;
  if (onClick) return html`<button type="button" class=${cls} data-ui=${d} aria-pressed=${!!active} onClick=${onClick}>${children}</button>`;
  return html`<span class=${cls} data-ui=${d}>${children}</span>`;
}

export function ToggleGroup({ options, value, onChange, label, ui }) {
  return html`<div class="ui-toggle" role="group" aria-label=${label} data-ui=${ui || 'toggle'}>
    ${options.map(function (o) {
      return html`<button type="button" class="ui-toggle-btn" aria-pressed=${o.value === value} onClick=${function () { onChange(o.value); }}>${o.label}</button>`;
    })}
  </div>`;
}

// hero={label,value,unit?,aside?,note?}。hero なしは指標の dl だけ
export function Summary({ hero, items }) {
  return html`<div class="ui-summary" data-ui="summary">
    ${hero && html`<div class="ui-summary-hero" data-ui="summary-hero">
      <p class="ui-summary-label">${hero.label}</p>
      <p class="ui-summary-big"><strong>${hero.value}${has(hero.unit) && html`<small>${hero.unit}</small>`}</strong>${has(hero.aside) && html`<span>${hero.aside}</span>`}</p>
      ${has(hero.note) && html`<p class="ui-summary-note">${hero.note}</p>`}
    </div>`}
    <dl class="ui-summary-metrics">
      ${items.map(function (it) {
        return html`<div class=${'ui-summary-item' + (it.tone ? ' ui-summary-' + it.tone : '')}>
          <dt>${it.label}</dt>
          <dd>${it.value}${has(it.sub) && html`<small>${it.sub}</small>`}</dd>
        </div>`;
      })}
    </dl>
  </div>`;
}

// rows[i]: {key,main,sub?,aside?,asideTone?:'good'|'bad',bar?:{value:0-100,tone:'good'|'mid'|'bad',marker?:number},href?(外部リンク),tone?:'danger',expand?(行内に展開する要素。null で閉)}
export function RowList({ rows, onSelect }) {
  return html`<ul class="ui-rows" data-ui="row-list">
    ${rows.map(function (r) {
      var bar = r.bar ? html`<span class="ui-row-bar" aria-hidden="true"><i class=${'ui-row-bar-fill ui-row-bar-' + r.bar.tone} style=${'width:' + r.bar.value + '%'}></i>${r.bar.marker != null && html`<b class="ui-row-bar-marker" style=${'left:' + r.bar.marker + '%'}></b>`}</span>` : null;
      var body = html`<span class="ui-row-main">${r.main}${has(r.sub) && html`<small>${r.sub}</small>`}${bar}</span>${has(r.aside) && html`<span class=${'ui-row-aside' + (r.asideTone ? ' ui-row-aside-' + r.asideTone : '')}>${r.aside}</span>`}`;
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
