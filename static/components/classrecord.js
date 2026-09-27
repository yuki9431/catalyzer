import { html } from '../htm-preact-standalone.js';
import { classRecordCoverage, classRecordKD } from '../analysis/classrecord.js';
import { pct, colorPct, colorKD, cellDisplay } from '../lib/format.js';
import { Table } from './ui.js';

function fmtInt(n) { return n != null ? n.toLocaleString('ja-JP') : '-'; }

// SortableTable はカンマ入り文字列を数値ソートできないため sortValue を持たせる
function intCell(n, unit) { return { sortValue: n, display: fmtInt(n) + unit }; }

// モバイル総合戦歴ビュー。record は /result の class_record（未取得なら null）
export function ClassRecordView({ record, analyzedCount }) {
  if (!record) {
    return html`<div class="panel">
      <h2><span class="dot" />モバイル総合戦歴</h2>
      <p class="kpi-sub">分析の完了後に、ガンダムモバイルの通算戦績を表示します。</p>
    </div>`;
  }
  var total = record.total;
  var coverage = classRecordCoverage(total.matches, analyzedCount);
  var kd = classRecordKD(record.counts);
  var cards = [
    ['通算対戦数', fmtInt(total.matches), fmtInt(total.wins) + '勝 ' + fmtInt(total.matches - total.wins) + '敗'],
    ['通算勝率', total.matches > 0 ? pct(total.win_rate) : '-', ''],
    ['通算K/D比', cellDisplay(colorKD(kd)), ''],
    ['分析カバー率', pct(coverage), fmtInt(analyzedCount) + '戦を分析済み'],
  ];
  return html`<div class="tabpane">
    <div class="kpi-grid">${cards.map(function (c) {
      return html`<div class="kpi">
        <div class="kpi-label">${c[0]}</div>
        <div class="kpi-value">${c[1]}</div>
        ${c[2] && html`<div class="kpi-sub">${c[2]}</div>`}
      </div>`;
    })}</div>
    ${record.breakdown && record.breakdown.length > 0 && html`<div class="panel">
      <h2><span class="dot" />クラスマッチG戦績</h2>
      <${Table} headers=${['区分', '対戦数', '勝利数', '勝率']} rows=${record.breakdown.map(function (b) {
        return [b.label, intCell(b.matches, '戦'), intCell(b.wins, '勝'), b.matches > 0 ? colorPct(b.win_rate) : '-'];
      })} />
    </div>`}
    ${record.counts && record.counts.length > 0 && html`<div class="panel">
      <h2><span class="dot" />通算記録</h2>
      <${Table} headers=${['項目', '記録']} rows=${record.counts.map(function (c) {
        return [c.label, intCell(c.value, c.unit)];
      })} />
    </div>`}
  </div>`;
}
