import { html, useState, useMemo, useEffect, useRef } from '../htm-preact-standalone.js';
import { themeReader } from '../lib/theme.js';
import {
  emptyFilters, hasActiveFilters, collectMsOptions,
  filterMatches, sortMatches, SORT_OPTIONS, appliedFilterLabels, sortDirLabel, sortLabel,
} from '../analysis/search.js';
import {
  num, cellDisplay, isTimeUp,
  colorKillsInt, colorDeathsInt, colorDmgGiven, colorDmgTaken, colorExDmg,
} from '../lib/format.js';
import { CompareRadar } from './charts.js';
import { RangeCalendar, Dropdown, MultiSelect, Autocomplete, Panel } from './ui.js';
import { useDismiss, usePopover, Popover } from './popover.js';
import { Chip, ToggleGroup } from './parts.js';
import { PERIOD_DAYS, filterByPlayDays, clampMetric } from '../analysis/stats.js';

var PAGE_SIZE = 20;

// 試合経過ガントのマッピング。lane 0=バースト行、lane 1=オーバーリミット行。
// kind: 'bar'=可能域の帯（範囲）/ 'diamond'=発動タイミングの菱形（点）。
var GANTT_BAR = {
  'ex': { lane: 0, cls: 'ex', kind: 'bar' },            // EXバースト発動可能域（グレー帯）
  'exbst-f': { lane: 0, cls: 'f', kind: 'diamond' },    // ファイティングバースト発動（橙）
  'exbst-s': { lane: 0, cls: 's', kind: 'diamond' },    // シューティングバースト発動（青）
  'exbst-e': { lane: 0, cls: 'e', kind: 'diamond' },    // エクステンドバースト発動（緑）
  'ov': { lane: 1, cls: 'ov', kind: 'bar' },            // EXオーバーリミット発動可能域（白枠帯）
  'exbst-ov': { lane: 1, cls: 'ov-on', kind: 'diamond' }, // EXオーバーリミット発動（白）
};

// ガント凡例の項目。
var GANTT_LEGEND = [
  ['ex', '覚醒可'], ['f', 'F覚醒'], ['s', 'S覚醒'], ['e', 'E覚醒'], ['death', '被撃墜'],
  ['ov', 'OLスタンバイ'], ['ov-on', 'OL発動'],
];

// 機体/タッグ/コスト編成用の複数選択（OR）。集計結果 [{name, matches}] を渡す。
// 選択後のトリガーは名前のみ（chip）、ドロップダウン内は「名前（N戦）」を出す。
function MsMulti({ values, onChange, options }) {
  var opts = options.map(function (o) { return { value: o.name, label: o.name + '（' + o.matches + '戦）', chip: o.name }; });
  return html`<${MultiSelect} values=${values} options=${opts} onChange=${onChange} placeholder="-" />`;
}

// 数値レンジ入力（最小〜最大）。
function RangeInput({ label, minVal, maxVal, onMin, onMax }) {
  return html`<div class="search-field">
    <label class="search-label">${label}</label>
    <div class="search-range">
      <input type="number" class="search-num" inputmode="numeric" aria-label=${label + ' 最小'}
        value=${minVal} onInput=${function (e) { onMin(e.target.value); }} />
      <span class="search-range-sep">〜</span>
      <input type="number" class="search-num" inputmode="numeric" aria-label=${label + ' 最大'}
        value=${maxVal} onInput=${function (e) { onMax(e.target.value); }} />
    </div>
  </div>`;
}

// 全画面の層。一覧はマウントしたまま背面に残し、背面スクロールは body・html の overflow で止める。
function Layer({ ui, label, head, foot, footUi, onClose, children }) {
  var ref = useRef(null);
  useDismiss(true, null, onClose);
  useEffect(function () {
    var y = window.scrollY, back = document.activeElement;
    var b = document.body.style.overflow, h = document.documentElement.style.overflow;
    document.body.style.overflow = 'hidden'; document.documentElement.style.overflow = 'hidden';
    if (ref.current) ref.current.focus({ preventScroll: true });
    return function () {
      document.body.style.overflow = b; document.documentElement.style.overflow = h;
      if (window.scrollY !== y) window.scrollTo(0, y);
      if (back && back.focus) back.focus({ preventScroll: true });
    };
  }, []);
  return html`<div class="search-layer" data-ui=${ui} role="dialog" aria-modal="true" aria-label=${label} tabindex="-1" ref=${ref}>
    <div class="search-layer-head">${head}</div>
    <div class="search-layer-body">${children}</div>
    ${foot && html`<div class="search-layer-foot" data-ui=${footUi}>${foot}</div>`}
  </div>`;
}

// 詳細な条件（日付指定・タッグ・コスト・数値レンジ）に含めるフィルタ項目。
var ADV_FIELDS = ['dateFrom', 'dateTo', 'enemyTagName',
  'dmgGivenMin', 'dmgGivenMax', 'dmgTakenMin', 'dmgTakenMax', 'killsMin', 'killsMax', 'deathsMin', 'deathsMax',
  'scoreMin', 'scoreMax', 'exDmgMin', 'exDmgMax', 'burstsMin', 'burstsMax'];
// 詳細な条件内の複数選択（配列）フィルタ。
var ADV_LIST_FIELDS = ['myTagList', 'myCostList', 'partnerCostList', 'enemyCostPairList'];

// 自機コストの選択肢（固定4種）。
var COST_OPTIONS = [
  { value: '3000', label: '3000' }, { value: '2500', label: '2500' },
  { value: '2000', label: '2000' }, { value: '1500', label: '1500' },
];

var ENEMY_MODE_OPTIONS = [{ value: 'and', label: 'すべて含む' }, { value: 'or', label: 'どれかを含む' }];
var NAME_SCOPE_OPTIONS = [{ value: 'both', label: '両方' }, { value: 'ally', label: '相方' }, { value: 'enemy', label: '相手' }];
var RESULT_OPTIONS = [{ value: 'all', label: 'すべて' }, { value: 'win', label: '勝利' }, { value: 'loss', label: '敗北' }];

// 絞り込みの入力欄。条件はその場で filters に反映する。
function FilterFields({ filters, options, onField }) {
  // 詳細な条件に条件が入っていれば初期表示は開く。
  var advActive = ADV_FIELDS.some(function (k) { return filters[k] !== '' && filters[k] != null; })
    || ADV_LIST_FIELDS.some(function (k) { return filters[k] && filters[k].length; });
  var advOpenRef = useState(advActive);
  var advOpen = advOpenRef[0], setAdvOpen = advOpenRef[1];
  // 期間カレンダーはクリックで開くプルダウン形式にする。
  var dateOpenRef = useState(false);
  var dateOpen = dateOpenRef[0], setDateOpen = dateOpenRef[1];

  return html`<div class="search-form">
      <div class="search-field search-field-wide">
        <label class="search-label">期間</label>
        <${Dropdown} value=${filters.playDays} placeholder="全データ"
          options=${Object.keys(PERIOD_DAYS).map(function (k) { return { value: k, label: '直近' + PERIOD_DAYS[k] + '日' }; })}
          onChange=${function (v) { onField('playDays', v); }} />
      </div>

      <div class="search-field">
        <label class="search-label">自機（複数選択可）</label>
        <${MsMulti} values=${filters.myMsList} options=${options.mine}
          onChange=${function (vs) { onField('myMsList', vs); }} />
      </div>
      <div class="search-field">
        <label class="search-label">僚機（複数選択可）</label>
        <${MsMulti} values=${filters.partnerMsList} options=${options.partners}
          onChange=${function (vs) { onField('partnerMsList', vs); }} />
      </div>
      <div class="search-field search-field-wide">
        <div class="search-label search-label-row">
          <span>敵機（複数選択可）</span>
          <${ToggleGroup} ui="search-enemy-mode" label="敵機の絞り方" options=${ENEMY_MODE_OPTIONS} value=${filters.enemyMsMode}
            onChange=${function (v) { onField('enemyMsMode', v); }} />
        </div>
        <${MsMulti} values=${filters.enemyMsList} options=${options.enemies}
          onChange=${function (vs) { onField('enemyMsList', vs); }} />
      </div>

      <div class="search-field search-field-wide">
        <div class="search-label search-label-row">
          <span>プレイヤー名（部分一致）</span>
          <${ToggleGroup} ui="search-name-scope" label="プレイヤー名の範囲" options=${NAME_SCOPE_OPTIONS} value=${filters.playerNameScope}
            onChange=${function (v) { onField('playerNameScope', v); }} />
        </div>
        <${Autocomplete} value=${filters.playerName} placeholder="名前の一部を入力"
          options=${options.playerNames.map(function (o) { return o.name; })}
          onChange=${function (v) { onField('playerName', v); }} />
      </div>

      <div class="search-field search-field-wide">
        <label class="search-label">勝敗</label>
        <${ToggleGroup} ui="search-winloss" label="勝敗" options=${RESULT_OPTIONS} value=${filters.result}
          onChange=${function (v) { onField('result', v); }} />
      </div>

      <div class="search-adv">
        <button type="button" class=${'search-adv-toggle' + (advOpen ? ' open' : '')}
          onClick=${function () { setAdvOpen(!advOpen); }} aria-expanded=${advOpen}>
          <span>詳細な条件${!advOpen && advActive && html` <${Chip} active ui="search-adv-applied">適用中</${Chip}>`}</span>
          <span class="search-chevron" aria-hidden="true"></span>
        </button>
        ${advOpen && html`<div class="search-adv-grid">
          <div class="search-field search-field-wide">
            <label class="search-label">期間（日付を指定）</label>
            <button type="button" data-ui="date-trigger" class=${'panel-select-trigger search-date-trigger' + (dateOpen ? ' open' : '')}
              onClick=${function () { setDateOpen(!dateOpen); }} aria-expanded=${dateOpen}>
              <span class="panel-select-label">${filters.dateFrom
                ? filters.dateFrom + ' 〜 ' + (filters.dateTo || '…')
                : '-'}</span>
              <span class="period-arrow">${dateOpen ? '▲' : '▼'}</span>
            </button>
            ${dateOpen && html`<${RangeCalendar} startDate=${filters.dateFrom} endDate=${filters.dateTo}
              onSelectStart=${function (v) { onField('dateFrom', v); }}
              onSelectEnd=${function (v) { onField('dateTo', v); if (v) setDateOpen(false); }} />`}
          </div>
          <div class="search-field search-field-wide">
            <label class="search-label">味方タッグ名（複数選択可）</label>
            <${MsMulti} values=${filters.myTagList} options=${options.myTags}
              onChange=${function (vs) { onField('myTagList', vs); }} />
          </div>
          <div class="search-field search-field-wide">
            <label class="search-label">相手タッグ名（部分一致）</label>
            <${Autocomplete} value=${filters.enemyTagName} placeholder="タッグ名の一部を入力"
              options=${options.enemyTags.map(function (o) { return o.name; })}
              onChange=${function (v) { onField('enemyTagName', v); }} />
          </div>
          <div class="search-field">
            <label class="search-label">自機コスト（複数選択可）</label>
            <${MultiSelect} values=${filters.myCostList} placeholder="-" options=${COST_OPTIONS}
              onChange=${function (vs) { onField('myCostList', vs); }} />
          </div>
          <div class="search-field">
            <label class="search-label">僚機コスト（複数選択可）</label>
            <${MultiSelect} values=${filters.partnerCostList} placeholder="-" options=${COST_OPTIONS}
              onChange=${function (vs) { onField('partnerCostList', vs); }} />
          </div>
          <div class="search-field search-field-wide">
            <label class="search-label">相手コスト編成（複数選択可）</label>
            <${MsMulti} values=${filters.enemyCostPairList} options=${options.enemyCostPairs}
              onChange=${function (vs) { onField('enemyCostPairList', vs); }} />
          </div>
          <${RangeInput} label="与ダメージ" minVal=${filters.dmgGivenMin} maxVal=${filters.dmgGivenMax}
            onMin=${function (v) { onField('dmgGivenMin', v); }} onMax=${function (v) { onField('dmgGivenMax', v); }} />
          <${RangeInput} label="被ダメージ" minVal=${filters.dmgTakenMin} maxVal=${filters.dmgTakenMax}
            onMin=${function (v) { onField('dmgTakenMin', v); }} onMax=${function (v) { onField('dmgTakenMax', v); }} />
          <${RangeInput} label="撃墜数" minVal=${filters.killsMin} maxVal=${filters.killsMax}
            onMin=${function (v) { onField('killsMin', v); }} onMax=${function (v) { onField('killsMax', v); }} />
          <${RangeInput} label="被撃墜数" minVal=${filters.deathsMin} maxVal=${filters.deathsMax}
            onMin=${function (v) { onField('deathsMin', v); }} onMax=${function (v) { onField('deathsMax', v); }} />
          <${RangeInput} label="スコア" minVal=${filters.scoreMin} maxVal=${filters.scoreMax}
            onMin=${function (v) { onField('scoreMin', v); }} onMax=${function (v) { onField('scoreMax', v); }} />
          <${RangeInput} label="EXダメージ" minVal=${filters.exDmgMin} maxVal=${filters.exDmgMax}
            onMin=${function (v) { onField('exDmgMin', v); }} onMax=${function (v) { onField('exDmgMax', v); }} />
          <${RangeInput} label="覚醒回数" minVal=${filters.burstsMin} maxVal=${filters.burstsMax}
            onMin=${function (v) { onField('burstsMin', v); }} onMax=${function (v) { onField('burstsMax', v); }} />
        </div>`}
      </div>
    </div>`;
}

// 絞り込みの全画面シート。条件はその場で一覧に反映し、「結果を見る」で閉じる。
function FilterSheet({ filters, options, total, onField, onReset, onClose }) {
  var head = html`<button type="button" class="search-link" data-ui="search-filter-clear" onClick=${onReset}>クリア</button>
    <h2>絞り込み</h2>
    <button type="button" class="ui-sheet-close" data-ui="sheet-close" onClick=${onClose}>閉じる</button>`;
  var foot = html`<span class="search-foot-count">${total}試合が該当</span>
    <button type="button" class="search-apply" data-ui="search-filter-apply" onClick=${onClose}>結果を見る</button>`;
  return html`<${Layer} ui="search-filter-sheet" footUi="search-filter-foot" label="絞り込み" head=${head} foot=${foot} onClose=${onClose}>
    <${FilterFields} filters=${filters} options=${options} onField=${onField} />
  </${Layer}>`;
}

// 並べ替え中の指標を一覧カードにも小さく出すためのラベル。SORT_OPTIONSと二重管理しないよう流用する。
var METRIC_LABELS = SORT_OPTIONS.reduce(function (m, o) { m[o.key] = o.label; return m; }, {});

// プレイヤー名を整形（空は「—」）。
function playerName(n) {
  return (n || '').trim() || '—';
}

// 1試合1行。右端は日付順なら与ダメージ、他は並べ替え指標。クリックで詳細を開く。
function ResultRow({ match, sortKey, onOpen }) {
  var key = sortKey && sortKey !== 'date' ? sortKey : 'dmg_given';
  var enemies = (match.opponent1_ms || '?') + ' / ' + (match.opponent2_ms || '?');
  return html`<button type="button" class="search-row" data-ui="search-result" onClick=${function () { onOpen(match); }}>
    <span class=${'search-row-res ' + (match.win ? 'win' : 'lose')}>${match.win ? '勝' : '敗'}</span>
    <span class="search-row-name">${match.ms}${isTimeUp(match) && html`<span class="badge-timeup" title="制限時間切れ（勝敗はスコアで決定）">タイムアップ</span>`}</span>
    <span class="search-row-meta"><b>${num(match[key])}</b>${METRIC_LABELS[key]}<br />${(match.date || '').slice(11, 16)}</span>
    <span class="search-row-line">vs ${enemies}</span>
    <span class="search-row-line">相方 ${playerName(match.partner_name)}・相手 ${playerName(match.opponent1_name)} / ${playerName(match.opponent2_name)}</span>
  </button>`;
}

// 結果一覧。日付が変わる行の前に日付区切りを入れる。
function ResultList({ items, sortKey, onOpen }) {
  var prev = '';
  return html`<div class="search-list">
    ${items.map(function (m) {
      var day = (m.date || '').slice(0, 10);
      var sep = day !== prev ? html`<p class="search-day" data-ui="search-day">${day}</p>` : null;
      prev = day;
      return html`${sep}<${ResultRow} match=${m} sortKey=${sortKey} onOpen=${onOpen} />`;
    })}
  </div>`;
}

// 公式「試合経過」風のガント式タイムライン（4人分・横棒）。
// 各行に機体画像＋2レーン（バースト行/オーバーリミット行）＋被撃墜×、下に時間軸。
function Timeline({ match, msImages }) {
  var rows = [
    { ms: match.ms, actions: match.actions },
    { ms: match.partner_ms, actions: match.partner_actions },
    { ms: match.opponent1_ms, actions: match.opponent1_actions },
    { ms: match.opponent2_ms, actions: match.opponent2_actions },
  ];
  // 実時間 = GameEndSec（無ければ全アクションの最大終了秒）。
  var raw = match.game_end_sec || 0;
  rows.forEach(function (r) {
    (r.actions || []).forEach(function (a) {
      raw = Math.max(raw, a.action_end_sec || 0, a.action_start_sec || 0);
    });
  });
  if (raw <= 0) {
    return html`<p class="search-detail-empty">試合経過データがありません。</p>`;
  }
  // 終盤が詰まって見えるため末尾に余白（7%）を足して描画スケールを広げる。目盛りは実終了まで。
  var total = raw * 1.07;
  function pct(sec) { return Math.max(0, Math.min(100, (sec || 0) / total * 100)); }
  function bar(a) {
    var m = GANTT_BAR[a.action];
    var left = pct(a.action_start_sec);
    var w = Math.max(0.6, pct(a.action_end_sec) - left); // 極小でも視認できる最小幅
    var barEl = html`<span data-ui="gantt-bar" class=${'gantt-bar gantt-' + m.cls} style=${'left:' + left + '%;width:' + w + '%'}></span>`;
    // 発動系は「発動の瞬間＝菱形」＋「その後の発動中＝色付きバー」の両方を描く。
    if (m.kind === 'diamond') {
      return html`${barEl}<span class=${'gantt-diamond gantt-' + m.cls} style=${'left:' + left + '%'}></span>`;
    }
    return barEl;
  }
  // 補助線＋目盛り。30秒ごとに点線の補助線、1分ごと(major)に秒数ラベル(60/120/180)を付ける。
  // 以前は10秒刻みでラベルを出しており、隣同士が重なって判読できなかった。
  var grid = [];
  for (var t = 30; t < raw; t += 30) grid.push({ sec: t, major: t % 60 === 0 });
  var labels = grid.filter(function (g) { return g.major; });

  return html`<div class="gantt" data-ui="gantt">
    <div class="gantt-rows">
      <div class="gantt-grid">
        ${grid.map(function (g) {
          return html`<span class=${'gantt-gridline' + (g.major ? ' gantt-gridline-major' : '')} style=${'left:' + pct(g.sec) + '%'}></span>`;
        })}
      </div>
      ${rows.map(function (r) {
        var acts = r.actions || [];
        var lane0 = acts.filter(function (a) { return GANTT_BAR[a.action] && GANTT_BAR[a.action].lane === 0; });
        var lane1 = acts.filter(function (a) { return GANTT_BAR[a.action] && GANTT_BAR[a.action].lane === 1; });
        var deaths = acts.filter(function (a) { return a.action === 'death'; });
        return html`<div class="gantt-row">
          <${DetailThumb} name=${r.ms} msImages=${msImages} />
          <div class="gantt-track">
            <div class="gantt-lane">
              ${lane0.map(bar)}
              ${deaths.map(function (a) {
                return html`<span class="gantt-death" style=${'left:' + pct(a.action_start_sec) + '%'}>✕</span>`;
              })}
            </div>
            <div class="gantt-lane">${lane1.map(bar)}</div>
          </div>
        </div>`;
      })}
    </div>
    <div class="gantt-axis">
      ${labels.map(function (g) {
        return html`<span class="gantt-tick" style=${'left:' + pct(g.sec) + '%'}>${g.sec}</span>`;
      })}
    </div>
    <div class="gantt-legend">
      ${GANTT_LEGEND.map(function (l) {
        // OL系の手前で改行し、2行目に「OLスタンバイ / OL発動 / 被撃墜」を並べる。
        var brk = l[0] === 'ov' ? html`<span class="gantt-legend-break"></span>` : '';
        return html`${brk}<span class="gantt-legend-item"><span class=${'gantt-legend-swatch gantt-' + l[0]}></span>${l[1]}</span>`;
      })}
    </div>
  </div>`;
}

// 基本データ比較レーダーの軸（基本データ画面と同じ6指標）。スコアは基準が無いため除外。
// 正規化の重み付け(基準レンジ)は基本データ分析と同じものを stats.js の METRIC_RANGE で共有する。
var RADAR_AXES = [
  { label: '与ダメ', key: 'dmgGiven' },
  { label: '撃墜', key: 'kills' },
  { label: '覚醒', key: 'bursts' },
  { label: '被ダメ', key: 'dmgTaken' },
  { label: '被撃墜', key: 'deaths' },
  { label: 'EXダメ', key: 'exDmg' },
];
var RADAR_LABELS = RADAR_AXES.map(function (a) { return a.label; });

// 4人分のレーダー系列を作る。各軸を基本データと同じ基準(clampMetric)で0-100に正規化（絶対評価）。
function radarPlayers(match) {
  var cssVar = themeReader();
  var players = [
    { label: '自分', color: cssVar('--accent'), bg: cssVar('--accent-a25'), raw: [match.dmg_given, match.kills, match.bursts, match.dmg_taken, match.deaths, match.ex_dmg] },
    { label: '相方', color: cssVar('--great'), bg: cssVar('--great-a25'), raw: [match.partner_dmg_given, match.partner_kills, match.partner_bursts, match.partner_dmg_taken, match.partner_deaths, match.partner_ex_dmg] },
    { label: '相手1', color: cssVar('--terrible'), bg: cssVar('--terrible-a22'), raw: [match.opponent1_dmg_given, match.opponent1_kills, match.opponent1_bursts, match.opponent1_dmg_taken, match.opponent1_deaths, match.opponent1_ex_dmg] },
    { label: '相手2', color: cssVar('--radar-opp2'), bg: cssVar('--radar-opp2-a22'), raw: [match.opponent2_dmg_given, match.opponent2_kills, match.opponent2_bursts, match.opponent2_dmg_taken, match.opponent2_deaths, match.opponent2_ex_dmg] },
  ];
  players.forEach(function (p) {
    p.data = p.raw.map(function (v, a) { return clampMetric(v, RADAR_AXES[a].key); });
  });
  return players;
}

// 機体サムネイル（固定サイズ）。画像が無ければ機体名テキスト。
function DetailThumb({ name, msImages }) {
  var nm = (name || '').trim();
  var url = nm && msImages ? msImages[nm] : '';
  if (url) {
    return html`<img class="search-detail-thumb" src=${url} alt=${nm} title=${nm} />`;
  }
  return html`<span class="search-detail-thumb search-detail-thumb-text" title=${nm}>${nm || '?'}</span>`;
}

// 試合詳細の全画面。試合経過は常に出す。
function MatchDetail({ match, msImages, onClose }) {
  // レーダー: 4人分の系列とトグルによる表示切替（既定は自分＋相方＝自陣）。
  var players = useMemo(function () { return radarPlayers(match); }, [match]);
  var checkedRef = useState([true, true, false, false]);
  var checked = checkedRef[0], setChecked = checkedRef[1];
  var series = useMemo(function () {
    return players.map(function (p, i) {
      return { label: p.label, data: p.data, color: p.color, bg: p.bg, hidden: !checked[i] };
    });
  }, [players, checked]);
  function toggle(i) {
    setChecked(function (prev) { var next = prev.slice(); next[i] = !next[i]; return next; });
  }

  // 4人分の機体とプレイヤー名（自分・相方・敵1・敵2）。自陣/敵陣は列位置(index 2)の区切り線で示す。
  var cols = [match.ms, match.partner_ms, match.opponent1_ms, match.opponent2_ms];
  var names = [match.name, match.partner_name, match.opponent1_name, match.opponent2_name].map(playerName);
  // 公式「スコア」画面と同じ項目（覚醒回数は試合経過側で表示するため含めない）。
  // color は分析画面と同じ色分け関数。スコアは基準が無いため色分けしない。
  var rows = [
    { label: 'スコア', vals: [match.score, match.partner_score, match.opponent1_score, match.opponent2_score], color: null },
    { label: '撃墜', vals: [match.kills, match.partner_kills, match.opponent1_kills, match.opponent2_kills], color: colorKillsInt },
    { label: '被撃墜', vals: [match.deaths, match.partner_deaths, match.opponent1_deaths, match.opponent2_deaths], color: colorDeathsInt },
    { label: '与ダメージ', vals: [match.dmg_given, match.partner_dmg_given, match.opponent1_dmg_given, match.opponent2_dmg_given], color: colorDmgGiven },
    { label: '被ダメージ', vals: [match.dmg_taken, match.partner_dmg_taken, match.opponent1_dmg_taken, match.opponent2_dmg_taken], color: colorDmgTaken },
    { label: 'EXダメージ', vals: [match.ex_dmg, match.partner_ex_dmg, match.opponent1_ex_dmg, match.opponent2_ex_dmg], color: colorExDmg },
  ];

  var head = html`<button type="button" class="search-back" data-ui="match-detail-back" onClick=${onClose}>
      <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" stroke-width="2" /></svg>試合検索</button>
    <span class="search-layer-date">${match.date}</span>`;
  return html`<${Layer} ui="match-detail" label="試合詳細" head=${head} onClose=${onClose}>
    <p class="search-detail-result" data-ui="match-result"><strong class=${match.win ? 'win' : 'lose'}>${match.win ? '勝利' : '敗北'}</strong>${isTimeUp(match) && html`<span class="badge-timeup" title="制限時間切れ（勝敗はスコアで決定）">タイムアップ</span>`}</p>

    <${Panel} title="4人の比較">
      <div class="search-radar-toggles">
        ${players.map(function (p, i) {
          return html`<button type="button" class=${'search-radar-toggle' + (checked[i] ? '' : ' off')} data-ui="radar-toggle"
            onClick=${function () { toggle(i); }} aria-pressed=${checked[i]}>
            <span class="search-radar-swatch" style=${'background:' + p.color}></span>
            <${DetailThumb} name=${cols[i]} msImages=${msImages} />
            <span class="search-radar-name">${names[i]}</span>
          </button>`;
        })}
      </div>
      <${CompareRadar} labels=${RADAR_LABELS} series=${series} showLegend=${false} />
    </${Panel}>

    <${Panel} title="スコア">
      <div class="table-wrap"><table class="search-detail-table" data-ui="match-score-table">
        <thead><tr>
          <th></th>
          ${names.map(function (n, i) {
            return html`<th class=${'num search-detail-col' + (i === 2 ? ' team-sep' : '')}><span class="search-detail-name" title=${n}>${n}</span></th>`;
          })}
        </tr></thead>
        <tbody>
          ${rows.map(function (r) {
            return html`<tr><th>${r.label}</th>${r.vals.map(function (v, i) {
              // 分析画面と同じ色分け関数を通す（cellDisplayが色付きspanを返す）。基準の無いスコアはそのまま。
              var content = r.color ? cellDisplay(r.color(v)) : num(v);
              return html`<td class=${'num' + (i === 2 ? ' team-sep' : '')}>${content}</td>`;
            })}</tr>`;
          })}
        </tbody>
      </table></div>
    </${Panel}>

    <${Panel} title="試合経過">
      <${Timeline} match=${match} msImages=${msImages} />
    </${Panel}>
  </${Layer}>`;
}

var PAGE_SIZES = [10, 20, 50, 100, 200];

// 並べ替えシート。項目・並び順・1ページの件数を1枚にまとめ、項目を選んでも閉じない。
function SortSheet({ sortKey, desc, pageSize, onSortKey, onDir, onPageSize }) {
  // lockScroll 部品はマウント時に body.overflow を書くので、件数に関係なく常時マウントする
  var pop = usePopover({ mode: 'sheet-bottom', lockScroll: true });
  var dirOptions = [{ value: 'desc', label: sortDirLabel(sortKey, true) }, { value: 'asc', label: sortDirLabel(sortKey, false) }];
  return html`<div class="search-sort" ref=${pop.rootRef}>
    <${Chip} ui="search-sort-trigger" expanded=${pop.isOpen} onClick=${pop.toggle}><span class="search-sort-k">並べ替え</span>${sortLabel(sortKey, desc)}</${Chip}>
    <${Popover} pop=${pop} panelClass="search-sort-panel" ui="search-sort-panel" title="並べ替え">
      ${SORT_OPTIONS.map(function (o) {
        return html`<button type="button" class="search-sort-opt" data-ui="search-sort-item" aria-pressed=${o.key === sortKey}
          onClick=${function () { onSortKey(o.key); }}>${o.label}</button>`;
      })}
      <div class="search-sort-group">
        <${ToggleGroup} ui="search-sort-dir" label="並び順" options=${dirOptions} value=${desc ? 'desc' : 'asc'}
          onChange=${function (v) { onDir(v === 'desc'); }} />
        <h3 class="search-sort-label">1ページの件数</h3>
        <${ToggleGroup} ui="search-pagesize" label="1ページの件数" value=${pageSize} onChange=${onPageSize}
          options=${PAGE_SIZES.map(function (n) { return { value: n, label: String(n) }; })} />
      </div>
    </${Popover}>
  </div>`;
}

// 試合検索ビュー本体。matches はIndexedDBから読み込んだ全試合。
export function SearchView({ matches, msImages }) {
  var filtersRef = useState(emptyFilters);
  var filters = filtersRef[0], setFilters = filtersRef[1];
  var sortRef = useState('date');
  var sortKey = sortRef[0], setSortKey = sortRef[1];
  var descRef = useState(true);
  var desc = descRef[0], setDir = descRef[1];
  var pageRef = useState(1);
  var page = pageRef[0], setPage = pageRef[1];
  var pageSizeRef = useState(PAGE_SIZE);
  var pageSize = pageSizeRef[0], setPageSize = pageSizeRef[1];
  var detailRef = useState(null);
  var detail = detailRef[0], setDetail = detailRef[1];
  var sheetRef = useState(false);
  var sheetOpen = sheetRef[0], setSheetOpen = sheetRef[1];

  var options = useMemo(function () { return collectMsOptions(matches); }, [matches]);

  var filtered = useMemo(function () {
    // 期間プリセット（直近Nプレイ日）はレポートと同じ filterByPlayDays で先に絞る。
    var base = filters.playDays && PERIOD_DAYS[filters.playDays]
      ? filterByPlayDays(matches, PERIOD_DAYS[filters.playDays])
      : matches;
    return sortMatches(filterMatches(base, filters), sortKey, desc);
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
  function onDir(d) { if (d !== desc) { setDir(d); setPage(1); } }

  var total = filtered.length;
  var wins = filtered.reduce(function (n, m) { return n + (m.win ? 1 : 0); }, 0);
  var winRate = total ? Math.round(wins / total * 1000) / 10 : 0;
  var totalPages = Math.max(1, Math.ceil(total / pageSize));
  var curPage = Math.min(page, totalPages);
  var start = (curPage - 1) * pageSize;
  var pageItems = filtered.slice(start, start + pageSize);
  function onPageSize(n) { setPageSize(n); setPage(1); }

  var labels = appliedFilterLabels(filters);

  return html`<div class="search-view">
    <div class="search-toolbar" data-ui="search-filter">
      <div class="search-toolbar-row">
        <${Chip} ui="search-filter-toggle" expanded=${sheetOpen} active=${labels.length > 0} onClick=${function () { setSheetOpen(true); }}>${labels.length ? '絞り込み（' + labels.length + '件適用中）' : '絞り込み'}</${Chip}>
        ${hasActiveFilters(filters) && html`<button type="button" class="search-link" data-ui="search-clear" onClick=${onReset}>条件をクリア</button>`}
      </div>
      ${labels.length > 0 && html`<div class="search-applied-list">
        ${labels.map(function (l) { return html`<${Chip} ui="search-applied">${l}</${Chip}>`; })}
      </div>`}
    </div>
    ${sheetOpen && html`<${FilterSheet} filters=${filters} options=${options} total=${total}
      onField=${onField} onReset=${onReset} onClose=${function () { setSheetOpen(false); }} />`}

    <section class="search-results">
      <div class="search-results-head">
        <h2 class="search-total" data-ui="search-total">${total}試合${total > 0 && html`<small>勝率 ${winRate.toFixed(1)}%</small>`}</h2>
        <${SortSheet} sortKey=${sortKey} desc=${desc} pageSize=${pageSize}
          onSortKey=${onSortKey} onDir=${onDir} onPageSize=${onPageSize} />
      </div>

      ${total === 0
        ? html`<p class="search-empty">条件に一致する試合がありません。</p>`
        : html`<${ResultList} items=${pageItems} sortKey=${sortKey} onOpen=${setDetail} />`}

      ${totalPages > 1 && html`<div class="search-pager" data-ui="search-pager">
        <button class="search-page-btn" disabled=${curPage <= 1}
          onClick=${function () { setPage(curPage - 1); }}>← 前へ</button>
        <span class="search-page-info">${start + 1}〜${Math.min(start + pageSize, total)} / ${total}件（${curPage}/${totalPages}）</span>
        <button class="search-page-btn" disabled=${curPage >= totalPages}
          onClick=${function () { setPage(curPage + 1); }}>次へ →</button>
      </div>`}
    </section>

    ${detail && html`<${MatchDetail} match=${detail} msImages=${msImages || {}} onClose=${function () { setDetail(null); }} />`}
  </div>`;
}
