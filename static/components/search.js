import { html, useState, useMemo, useEffect, useRef } from '../htm-preact-standalone.js';
import {
  emptyFilters, hasActiveFilters, collectMsOptions,
  filterMatches, sortMatches, SORT_OPTIONS,
} from '../analysis/search.js';
import { esc, num } from '../lib/format.js';

var PAGE_SIZE = 20;

// タイムラインのアクション種別 → 表示ラベル。
var ACTION_LABELS = {
  death: '被撃墜',
  'exbst-f': 'F覚醒',
  'exbst-s': 'S覚醒',
  'exbst-e': 'E覚醒',
  'exbst-ov': 'OV覚醒',
};

// 秒数を M:SS 形式に整形する。
function fmtSec(sec) {
  if (sec == null || isNaN(sec)) return '';
  var s = Math.max(0, Math.round(sec));
  var m = Math.floor(s / 60);
  return m + ':' + String(s % 60).padStart(2, '0');
}

// ネイティブ <select>。value/onChange と選択肢配列を受け取る。
function Select({ value, onChange, options, placeholder }) {
  return html`<select class="search-select" value=${value}
    onChange=${function (e) { onChange(e.target.value); }}>
    <option value="">${placeholder}</option>
    ${options.map(function (o) {
      return html`<option value=${o.name}>${o.name}（${o.matches}戦）</option>`;
    })}
  </select>`;
}

// 数値レンジ入力（最小〜最大）。
function RangeInput({ label, minVal, maxVal, onMin, onMax }) {
  return html`<div class="search-field">
    <label class="search-label">${label}</label>
    <div class="search-range">
      <input type="number" class="search-num" inputmode="numeric" placeholder="最小"
        value=${minVal} onInput=${function (e) { onMin(e.target.value); }} />
      <span class="search-range-sep">〜</span>
      <input type="number" class="search-num" inputmode="numeric" placeholder="最大"
        value=${maxVal} onInput=${function (e) { onMax(e.target.value); }} />
    </div>
  </div>`;
}

// フィルタフォーム。filters と個々のフィールド更新関数、リセットを受け取る。
function FilterForm({ filters, options, onField, onReset, resultCount }) {
  var openRef = useState(true);
  var open = openRef[0], setOpen = openRef[1];
  var active = hasActiveFilters(filters);

  return html`<div class="panel search-filter-panel">
    <div class="search-filter-head">
      <h2><span class="dot" />絞り込み条件</h2>
      <button class="search-toggle" onClick=${function () { setOpen(!open); }}>
        ${open ? '閉じる ▲' : '開く ▼'}
      </button>
    </div>
    ${open && html`<div class="search-form">
      <div class="search-field">
        <label class="search-label">期間</label>
        <div class="search-range">
          <input type="date" class="search-date" value=${filters.dateFrom}
            onInput=${function (e) { onField('dateFrom', e.target.value); }} />
          <span class="search-range-sep">〜</span>
          <input type="date" class="search-date" value=${filters.dateTo}
            onInput=${function (e) { onField('dateTo', e.target.value); }} />
        </div>
      </div>

      <div class="search-field">
        <label class="search-label">使用機体</label>
        <${Select} value=${filters.myMs} placeholder="すべての自機"
          options=${options.mine} onChange=${function (v) { onField('myMs', v); }} />
      </div>
      <div class="search-field">
        <label class="search-label">相方機体</label>
        <${Select} value=${filters.partnerMs} placeholder="すべての相方"
          options=${options.partners} onChange=${function (v) { onField('partnerMs', v); }} />
      </div>
      <div class="search-field">
        <label class="search-label">敵機体</label>
        <${Select} value=${filters.enemyMs} placeholder="すべての敵機"
          options=${options.enemies} onChange=${function (v) { onField('enemyMs', v); }} />
      </div>

      <div class="search-field">
        <label class="search-label">勝敗</label>
        <div class="lens-toggle">
          ${[['all', '全て'], ['win', '勝利'], ['loss', '敗北']].map(function (o) {
            return html`<button class=${'lens-btn' + (filters.result === o[0] ? ' active' : '')}
              onClick=${function () { onField('result', o[0]); }}>${o[1]}</button>`;
          })}
        </div>
      </div>

      <${RangeInput} label="与ダメージ" minVal=${filters.dmgGivenMin} maxVal=${filters.dmgGivenMax}
        onMin=${function (v) { onField('dmgGivenMin', v); }} onMax=${function (v) { onField('dmgGivenMax', v); }} />
      <${RangeInput} label="被ダメージ" minVal=${filters.dmgTakenMin} maxVal=${filters.dmgTakenMax}
        onMin=${function (v) { onField('dmgTakenMin', v); }} onMax=${function (v) { onField('dmgTakenMax', v); }} />
      <${RangeInput} label="撃墜数" minVal=${filters.killsMin} maxVal=${filters.killsMax}
        onMin=${function (v) { onField('killsMin', v); }} onMax=${function (v) { onField('killsMax', v); }} />
      <${RangeInput} label="被撃墜数" minVal=${filters.deathsMin} maxVal=${filters.deathsMax}
        onMin=${function (v) { onField('deathsMin', v); }} onMax=${function (v) { onField('deathsMax', v); }} />

      <div class="search-form-actions">
        <span class="search-count">${resultCount}件ヒット</span>
        ${active && html`<button class="search-reset" onClick=${onReset}>条件をクリア</button>`}
      </div>
    </div>`}
  </div>`;
}

// 1試合分のサマリー行。クリックで詳細を開く。
function ResultItem({ match, onOpen }) {
  var enemies = [match.opponent1_ms, match.opponent2_ms].filter(Boolean).join(' / ');
  return html`<button class="search-item" onClick=${function () { onOpen(match); }}>
    <div class="search-item-top">
      <span class=${'badge ' + (match.win ? 'win' : 'lose')}>${match.win ? 'WIN' : 'LOSE'}</span>
      <span class="search-item-date">${esc(match.date)}</span>
      <span class="search-item-score">${num(match.score)}pt</span>
    </div>
    <div class="search-item-ms">
      <span class="search-item-self">${esc(match.ms || '?')}</span>
      <span class="search-item-partner">+ ${esc(match.partner_ms || '?')}</span>
      <span class="search-item-vs">vs</span>
      <span class="search-item-enemy">${esc(enemies || '?')}</span>
    </div>
    <div class="search-item-stats">
      <span>撃墜 <b>${num(match.kills)}</b></span>
      <span>被撃墜 <b>${num(match.deaths)}</b></span>
      <span>与 <b>${num(match.dmg_given)}</b></span>
      <span>被 <b>${num(match.dmg_taken)}</b></span>
    </div>
  </button>`;
}

// 詳細モーダル内の統合タイムライン（自分・相方の被撃墜/覚醒を時系列で表示）。
function Timeline({ match }) {
  var events = [];
  function collect(actions, who) {
    (actions || []).forEach(function (a) {
      if (!ACTION_LABELS[a.action]) return;
      events.push({ who: who, label: ACTION_LABELS[a.action], sec: a.action_start_sec, isDeath: a.action === 'death' });
    });
  }
  collect(match.actions, '自分');
  collect(match.partner_actions, '相方');
  events.sort(function (a, b) { return (a.sec || 0) - (b.sec || 0); });

  if (!events.length) {
    return html`<p class="search-detail-empty">タイムラインデータがありません。</p>`;
  }
  return html`<ul class="search-timeline">
    ${events.map(function (ev) {
      return html`<li class=${'search-tl-item' + (ev.isDeath ? ' death' : ' burst')}>
        <span class="search-tl-time">${fmtSec(ev.sec)}</span>
        <span class="search-tl-who">${ev.who}</span>
        <span class="search-tl-label">${ev.label}</span>
      </li>`;
    })}
  </ul>`;
}

// 試合詳細モーダル。
function DetailModal({ match, onClose }) {
  useEffect(function () {
    function onKey(e) { if (e.key === 'Escape') onClose(); }
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return function () {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, []);

  var enemies = [match.opponent1_ms, match.opponent2_ms].filter(Boolean).join(' / ');
  function row(label, mine, partner) {
    return html`<tr><th>${label}</th><td class="num">${mine}</td><td class="num">${partner}</td></tr>`;
  }

  return html`<div class="modal-backdrop" onClick=${function (e) { if (e.target === e.currentTarget) onClose(); }}>
    <div class="search-detail">
      <div class="search-detail-head">
        <div>
          <span class=${'badge ' + (match.win ? 'win' : 'lose')}>${match.win ? 'WIN' : 'LOSE'}</span>
          <span class="search-detail-date">${esc(match.date)}</span>
        </div>
        <button class="search-detail-close" onClick=${onClose} aria-label="閉じる">✕</button>
      </div>

      <div class="search-detail-matchup">
        <div><span class="search-detail-tag">自軍</span> ${esc(match.ms || '?')} ＋ ${esc(match.partner_ms || '?')}</div>
        <div><span class="search-detail-tag enemy">敵軍</span> ${esc(enemies || '?')}</div>
      </div>

      <div class="table-wrap"><table class="search-detail-table">
        <thead><tr><th></th><th class="num">自分</th><th class="num">相方 (${esc(match.partner_name || '-')})</th></tr></thead>
        <tbody>
          ${row('スコア', num(match.score), num(match.partner_score))}
          ${row('撃墜', num(match.kills), num(match.partner_kills))}
          ${row('被撃墜', num(match.deaths), num(match.partner_deaths))}
          ${row('与ダメージ', num(match.dmg_given), num(match.partner_dmg_given))}
          ${row('被ダメージ', num(match.dmg_taken), num(match.partner_dmg_taken))}
          ${row('EXダメージ', num(match.ex_dmg), num(match.partner_ex_dmg))}
          ${row('覚醒回数', num(match.bursts), num(match.partner_bursts))}
        </tbody>
      </table></div>

      <h3 class="search-detail-tl-title">タイムライン</h3>
      <${Timeline} match=${match} />
    </div>
  </div>`;
}

// 試合検索ビュー本体。matches はIndexedDBから読み込んだ全試合。
export function SearchView({ matches }) {
  var filtersRef = useState(emptyFilters);
  var filters = filtersRef[0], setFilters = filtersRef[1];
  var sortRef = useState('date');
  var sortKey = sortRef[0], setSortKey = sortRef[1];
  var descRef = useState(true);
  var desc = descRef[0], setDesc = descRef[1];
  var pageRef = useState(1);
  var page = pageRef[0], setPage = pageRef[1];
  var detailRef = useState(null);
  var detail = detailRef[0], setDetail = detailRef[1];

  var options = useMemo(function () { return collectMsOptions(matches); }, [matches]);

  var filtered = useMemo(function () {
    return sortMatches(filterMatches(matches, filters), sortKey, desc);
  }, [matches, filters, sortKey, desc]);

  // 条件・並び順の変更時は1ページ目に戻す（各操作ハンドラで明示的にリセット）。
  function onField(key, value) {
    setFilters(function (prev) {
      var next = Object.assign({}, prev);
      next[key] = value;
      return next;
    });
    setPage(1);
  }
  function onReset() { setFilters(emptyFilters()); setPage(1); }
  function onSortKey(key) { setSortKey(key); setPage(1); }
  function onToggleDir() { setDesc(!desc); setPage(1); }

  var total = filtered.length;
  var totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  var curPage = Math.min(page, totalPages);
  var start = (curPage - 1) * PAGE_SIZE;
  var pageItems = filtered.slice(start, start + PAGE_SIZE);

  return html`<div class="search-view">
    <${FilterForm} filters=${filters} options=${options}
      onField=${onField} onReset=${onReset} resultCount=${total} />

    <div class="panel">
      <div class="search-result-head">
        <h2><span class="dot" />検索結果 <span class="search-result-count">${total}件</span></h2>
        <div class="search-sort">
          <select class="search-select" value=${sortKey}
            onChange=${function (e) { onSortKey(e.target.value); }}>
            ${SORT_OPTIONS.map(function (o) { return html`<option value=${o.key}>${o.label}</option>`; })}
          </select>
          <button class="search-dir" onClick=${onToggleDir}
            aria-label="並び順">${desc ? '降順 ↓' : '昇順 ↑'}</button>
        </div>
      </div>

      ${total === 0
        ? html`<p class="search-empty">条件に一致する試合がありません。</p>`
        : html`<div class="search-list">
            ${pageItems.map(function (m) {
              return html`<${ResultItem} match=${m} onOpen=${setDetail} />`;
            })}
          </div>`}

      ${totalPages > 1 && html`<div class="search-pager">
        <button class="search-page-btn" disabled=${curPage <= 1}
          onClick=${function () { setPage(curPage - 1); }}>← 前へ</button>
        <span class="search-page-info">${start + 1}〜${Math.min(start + PAGE_SIZE, total)} / ${total}件（${curPage}/${totalPages}）</span>
        <button class="search-page-btn" disabled=${curPage >= totalPages}
          onClick=${function () { setPage(curPage + 1); }}>次へ →</button>
      </div>`}
    </div>

    ${detail && html`<${DetailModal} match=${detail} onClose=${function () { setDetail(null); }} />`}
  </div>`;
}
