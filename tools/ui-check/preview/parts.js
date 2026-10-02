import { html, render, useState } from '/htm-preact-standalone.js';
import { Chip, ToggleGroup, Summary, RowList, Notice } from '/components/parts.js';
import { Dropdown, Panel } from '/components/ui.js';

var SHEET_OPTIONS = ['A', 'B', 'C', 'D', 'E'].map(function (k) { return { value: k, label: '項目 ' + k }; });

function Gallery() {
  var t = useState('all'), tab = t[0], setTab = t[1];
  var s = useState('A'), sel = s[0], setSel = s[1];
  return html`<div class="container" data-ui="parts-gallery">
    <${Panel} title="Chip">
      <${Chip}>通常</${Chip}> <${Chip} tone="good">勝ち越し</${Chip}> <${Chip} tone="bad" active=${true} onClick=${function () {}}>負け越し</${Chip}>
    </${Panel}>
    <${Panel} title="ToggleGroup">
      <${ToggleGroup} label="範囲" value=${tab} onChange=${setTab} options=${[{ value: 'all', label: '全体' }, { value: 'win', label: '勝利' }, { value: 'lose', label: '敗北' }]} />
    </${Panel}>
    <${Panel} title="Summary">
      <${Summary} items=${[{ label: '勝率', value: '58%', sub: '60戦', tone: 'good' }, { label: '平均被撃墜', value: '2.1', tone: 'bad' }, { label: '試合数', value: '120' }]} />
    </${Panel}>
    <${Panel} title="RowList">
      <${RowList} onSelect=${function () {}} rows=${[{ key: 1, main: 'ガンダム', sub: '3000コスト', aside: '62%' }, { key: 2, main: 'ザク', aside: '48%' }]} />
    </${Panel}>
    <${Panel} title="Notice">
      <${Notice}>情報です</${Notice}> <${Notice} tone="warn">注意です</${Notice}> <${Notice} tone="error">エラーです</${Notice}>
    </${Panel}>
    <div data-ui="sheet-demo"><${Panel} title="Dropdown (sheet-bottom)">
      <${Dropdown} mode="sheet-bottom" value=${sel} options=${SHEET_OPTIONS} onChange=${setSel} noClear=${true} />
    </${Panel}></div>
  </div>`;
}

render(html`<${Gallery} />`, document.getElementById('root'));
