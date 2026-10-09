import { html } from '../../htm-preact-standalone.js';
import { Panel } from '../ui.js';
import { BurstCountContent, BurstTimingContent, BurstTypeContent, OverlimitContent, WinRateBarChart } from '../charts.js';

export function BurstPane({ frontendData }) {
  var burstCount = frontendData.burst_count;
  var burstTiming = frontendData.burst_timing;
  var burstType = frontendData.burst_type;
  var overlimit = frontendData.overlimit;

  var countItems = burstCount && burstCount.by_count ? burstCount.by_count : [];
  var typeItems = burstType && burstType.by_type
    ? burstType.by_type.map(function (t) { return { label: t.label, matches: t.matches, win_rate: t.win_rate }; })
    : [];
  var timingItems = burstTiming && burstTiming.by_timing
    ? burstTiming.by_timing.map(function (t) { return { label: t.label, matches: t.count, win_rate: t.win_rate }; })
    : [];

  return html`<div class="tabpane">
    ${countItems.length > 0 && html`<${Panel} title="覚醒回数と勝率">
      <${WinRateBarChart} items=${countItems} />
      <${BurstCountContent} countData=${burstCount} />
    <//>`}

    ${typeItems.length > 0 && html`<${Panel} title="覚醒タイプ別傾向">
      <${WinRateBarChart} items=${typeItems} />
      <${BurstTypeContent} typeData=${burstType} />
    <//>`}

    ${timingItems.length > 0 && html`<${Panel} title="覚醒タイミング">
      <${WinRateBarChart} items=${timingItems} />
      <${BurstTimingContent} timingData=${burstTiming} />
    <//>`}

    ${overlimit && html`<${Panel} title="OL発動の順番と勝率">
      <${WinRateBarChart} items=${overlimit.by_order} />
      <${OverlimitContent} overlimit=${overlimit} />
    <//>`}

    ${!countItems.length && !typeItems.length && !timingItems.length && !overlimit && html`<${Panel}><p>覚醒データがありません（タイムラインデータが必要です）。</p><//>`}
  </div>`;
}
