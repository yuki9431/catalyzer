import { html, useEffect, useRef, useState } from '../../htm-preact-standalone.js';
import { esc } from '../../lib/format.js';
import { Chip, ToggleGroup } from '../parts.js';
import { RangeCalendar } from '../ui.js';
import { Popover, usePopover } from '../popover.js';

export var PERIOD_KEYS = ['all', '90d', '60d', '30d', '14d', '7d', '3d', '1d'];

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

export function PeriodSelector({ periods, selected, onSelect, userKey, onCustomReport, openSignal }) {
  var keys = PERIOD_KEYS.filter(function (k) { return periods[k]; });
  var pop = usePopover({ mode: 'sheet-bottom', lockScroll: true });
  var isOpen = pop.isOpen;
  var customRef = useState(false);
  var showCustom = customRef[0], setShowCustom = customRef[1];
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

  var customElRef = useRef(null);

  // 日付指定を開いたらカレンダーが見えるようドロップダウン内でスクロールする
  useEffect(function () {
    if (showCustom && customElRef.current) {
      customElRef.current.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }, [showCustom]);

  // 親が openSignal を増やすたびにシートを開く(空の状態の「期間を変更」)
  useEffect(function () {
    if (openSignal) pop.open();
  }, [openSignal]);

  // hooks の後ろで判定する（#446）
  if (keys.length <= 1 && !userKey) return null;

  var currentLabel = selected === 'custom'
    ? (periods.custom ? periods.custom.label : '日付指定')
    : (periods[selected] ? periods[selected].label : '全データ');

  function selectPreset(k) {
    onSelect(k);
    pop.close();
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
    setCustomError('');
    onCustomReport({ start: start, end: end });
    pop.close();
  }

  return html`<div class="period-selector" ref=${pop.rootRef}>
    <${Chip} ui="period-trigger" expanded=${isOpen} active=${selected !== 'all'} onClick=${pop.toggle}><span class="ui-chip-text">${currentLabel}</span></${Chip}>
    <${Popover} pop=${pop} panelClass="period-dropdown" backdropClass="period-backdrop" ui="period-panel" title="期間">
      <div class="period-dropdown-list">
        ${keys.map(function (k) {
          return html`<button data-ui="period-item" class=${'period-dropdown-item' + (selected === k ? ' active' : '')}
            onClick=${function () { selectPreset(k); }}>${periods[k].label}</button>`;
        })}
        ${userKey && html`<button data-ui="period-item" class=${'period-dropdown-item period-dropdown-custom' + (showCustom ? ' active' : '')}
          onClick=${function () { setShowCustom(!showCustom); }}>日付指定</button>`}
      </div>
      ${showCustom && html`<div class="period-custom" ref=${customElRef}>
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
            <span style="font-size:0.875rem;color:var(--muted)">開始時刻</span>
            <${TimeSelector} hour=${startHour} minute=${startMin}
              onChangeHour=${setStartHour} onChangeMinute=${setStartMin} />
          </div>
          <div class="period-custom-col">
            <span style="font-size:0.875rem;color:var(--muted)">終了時刻</span>
            <${TimeSelector} hour=${endHour} minute=${endMin}
              onChangeHour=${setEndHour} onChangeMinute=${setEndMin} isEnd />
          </div>
        </div>`}
        <button class="period-time-toggle" onClick=${function () { setShowTime(!showTime); }}>
          ${showTime ? '時刻指定を解除' : '時刻を指定'}</button>
        <button class="period-custom-apply" data-ui="period-apply" onClick=${handleCustomApply}>適用</button>
        ${customError && html`<p class="period-custom-error">${customError}</p>`}
      </div>`}
    </${Popover}>
  </div>`;
}

export function MsSelector({ entries, selected, onSelect }) {
  var pop = usePopover({ mode: 'sheet-bottom', lockScroll: true });
  var isOpen = pop.isOpen;
  var label = selected ? '1機選択' : '全機体';
  var isSelected = !!selected;
  return html`<div class="ms-topbar-wrap" ref=${pop.rootRef}>
    <${Chip} ui="ms-trigger" expanded=${isOpen} active=${isSelected} onClick=${pop.toggle}><span class="ui-chip-text">${esc(label)}</span></${Chip}>
    <${Popover} pop=${pop} panelClass="ms-topbar-dropdown" backdropClass="ms-topbar-backdrop" ui="ms-panel" title="機体">
      <button data-ui="ms-item" class=${'ms-topbar-item' + (!selected ? ' active' : '')}
        onClick=${function () { onSelect(null); pop.close(); }}>全機体</button>
      ${entries.map(function (e) {
        return html`<button data-ui="ms-item" class=${'ms-topbar-item' + (selected === e.name ? ' active' : '')}
          onClick=${function () { onSelect(e.name); pop.close(); }}>${esc(e.name)} <span style="color:var(--muted)">(${e.matches}戦)</span></button>`;
      })}
    </${Popover}>
  </div>`;
}

var LENS_OPTIONS = [{ value: 'all', label: '全体' }, { value: 'win', label: '勝利' }, { value: 'loss', label: '敗北' }];

export function LensToggle({ lens, onSelect }) {
  return html`<${ToggleGroup} ui="lens-toggle" label="勝敗" options=${LENS_OPTIONS} value=${lens} onChange=${onSelect} />`;
}
