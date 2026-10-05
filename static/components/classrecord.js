import { html } from '../htm-preact-standalone.js';
import { classRecordCoverage, classRecordKD } from '../analysis/classrecord.js';
import { num, pct, colorPct, colorKD, cellDisplay } from '../lib/format.js';
import { Notice, Summary } from './parts.js';
import { Table } from './ui.js';

function fmtInt(n) { return n != null ? n.toLocaleString('ja-JP') : '-'; }

function intCell(n, unit) { return { sortValue: n, display: fmtInt(n) + unit }; }

// モバイル総合戦歴ビュー。record は /result の class_record（未取得なら null）
export function ClassRecordView({ record, analyzedCount }) {
  if (!record) {
    return html`<div class="panel">
      <h2>モバイル総合戦歴</h2>
      <${Notice}>分析の完了後に、ガンダムモバイルの通算戦績を表示します。</${Notice}>
    </div>`;
  }
  var total = record.total;
  var coverage = classRecordCoverage(total.matches, analyzedCount);
  var kd = classRecordKD(record.counts);
  var hero = { label: '通算勝率', value: total.matches > 0 ? num(total.win_rate, 1) : '-', unit: total.matches > 0 ? '%' : null, aside: fmtInt(total.wins) + '勝 ' + fmtInt(total.matches - total.wins) + '敗' };
  var items = [
    { label: '通算対戦数', value: fmtInt(total.matches) },
    { label: '通算K/D比', value: cellDisplay(colorKD(kd)) },
    { label: '分析カバー率', value: pct(coverage), sub: fmtInt(analyzedCount) + '戦を分析済み' },
  ];
  return html`<div class="tabpane">
    <div class="report-summary"><${Summary} hero=${hero} items=${items} /></div>
    ${record.breakdown && record.breakdown.length > 0 && html`<div class="panel">
      <h2>クラスマッチG戦績</h2>
      <${Table} headers=${['区分', '対戦数', '勝利数', '勝率']} rows=${record.breakdown.map(function (b) {
        return [b.label, intCell(b.matches, '戦'), intCell(b.wins, '勝'), b.matches > 0 ? colorPct(b.win_rate) : '-'];
      })} />
    </div>`}
    ${record.counts && record.counts.length > 0 && html`<div class="panel">
      <h2>通算記録</h2>
      <${Table} headers=${['項目', '記録']} rows=${record.counts.map(function (c) {
        return [c.label, intCell(c.value, c.unit)];
      })} />
    </div>`}
  </div>`;
}
