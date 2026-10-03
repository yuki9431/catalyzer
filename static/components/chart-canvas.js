import { html, useState, useRef, useEffect } from '../htm-preact-standalone.js';
import { themeReader } from '../lib/theme.js';

// スクロール連動: 要素が画面に入ったらtrueを返すフック
function useInView(ref) {
  var state = useState(false);
  var inView = state[0], setInView = state[1];

  useEffect(function () {
    if (!ref.current) return;
    var observer = new IntersectionObserver(function (entries) {
      if (entries[0].isIntersecting) {
        setInView(true);
        observer.disconnect();
      }
    }, { threshold: 0.1 });
    observer.observe(ref.current);
    return function () { observer.disconnect(); };
  }, []);

  return inView;
}

// 50%基準線プラグイン
var winRate50Plugin = {
  id: 'winRate50Line',
  afterDraw: function (chart) {
    var yScale = chart.scales.y;
    if (!yScale) return;
    var cssVar = themeReader();
    var y = yScale.getPixelForValue(50);
    var ctx = chart.ctx;
    ctx.save();
    ctx.beginPath();
    ctx.setLineDash([6, 4]);
    ctx.strokeStyle = cssVar('--chart-ref-line');
    ctx.lineWidth = 1;
    ctx.moveTo(chart.chartArea.left, y);
    ctx.lineTo(chart.chartArea.right, y);
    ctx.stroke();
    ctx.fillStyle = cssVar('--chart-ref-text');
    ctx.font = '11px sans-serif';
    ctx.fillText('50%', chart.chartArea.left + 4, y - 4);
    ctx.restore();
  },
};

// Chart.js の生成・破棄・画面内に入るまでの遅延を担う。build(cssVar) は設定を返し、null なら描かない
export function ChartCanvas({ build, deps, className, style }) {
  var containerRef = useRef(null);
  var canvasRef = useRef(null);
  var chartRef = useRef(null);
  var inView = useInView(containerRef);

  useEffect(function () {
    if (!inView || !canvasRef.current) return;
    var config = build(themeReader());
    if (!config) return;
    chartRef.current = new Chart(canvasRef.current, config);
    return function () { if (chartRef.current) { chartRef.current.destroy(); chartRef.current = null; } };
  }, deps.concat([inView]));

  return html`<div class=${className || 'chart-container'} style=${style} ref=${containerRef}><canvas ref=${canvasRef} /></div>`;
}

// 勝率の警告色(>=60 緑 / <50 赤)。中間色は呼び出し側が解決した色で渡す
export function winRateColors(cssVar, values, midColor) {
  return values.map(function (v) { return v >= 60 ? cssVar('--win-a70') : v < 50 ? cssVar('--terrible-a70') : midColor; });
}

export function xAxis(cssVar, ticks, extra) {
  return Object.assign({
    ticks: Object.assign({ color: cssVar('--chart-text-sub') }, ticks),
    grid: { color: cssVar('--chart-grid') },
  }, extra);
}

export function pctAxis(cssVar, extra) {
  return Object.assign({
    min: 0, max: 100,
    ticks: { color: cssVar('--chart-text'), callback: function (v) { return v + '%'; } },
    grid: { color: cssVar('--chart-grid-strong') },
  }, extra);
}

export function countAxis(cssVar) {
  return {
    position: 'right', min: 0,
    ticks: { color: cssVar('--chart-text'), stepSize: 1 },
    grid: { display: false },
  };
}

// 線系列は凡例に線+両端の点を描く
export function comboLegend(cssVar) {
  var textColor = cssVar('--chart-text');
  return { labels: { color: textColor, font: { size: 12 }, usePointStyle: true, generateLabels: function (chart) {
    return chart.data.datasets.map(function (ds, i) {
      var meta = chart.getDatasetMeta(i);
      var ps;
      if (ds.type === 'line') {
        var c = document.createElement('canvas');
        c.width = 24; c.height = 12;
        var cx = c.getContext('2d');
        var color = ds.borderColor;
        cx.strokeStyle = color; cx.lineWidth = 2;
        cx.beginPath(); cx.moveTo(4, 6); cx.lineTo(20, 6); cx.stroke();
        cx.fillStyle = color;
        cx.beginPath(); cx.arc(4, 6, 3, 0, Math.PI * 2); cx.fill();
        cx.beginPath(); cx.arc(20, 6, 3, 0, Math.PI * 2); cx.fill();
        ps = c;
      } else {
        ps = 'rectRounded';
      }
      return {
        text: ds.label, fontColor: textColor,
        fillStyle: ds.type === 'line' ? ds.borderColor : (Array.isArray(ds.backgroundColor) ? ds.backgroundColor[0] : ds.backgroundColor),
        strokeStyle: ds.type === 'line' ? ds.borderColor : (Array.isArray(ds.borderColor) ? ds.borderColor[0] : ds.borderColor),
        lineWidth: ds.type === 'line' ? 0 : 1, pointStyle: ps, hidden: meta.hidden, datasetIndex: i,
      };
    });
  } } };
}

// 勝率の棒 + 試合数の線の2軸グラフ。plain は WinRateBar 用(線に背景色なし・簡素な凡例)
export function winRateComboConfig(cssVar, o) {
  var plain = !!o.plain;
  var line = {
    label: '試合数', data: o.matches, type: 'line',
    borderColor: cssVar('--accent-2'),
    fill: false, tension: 0.3,
    pointRadius: o.pointRadius == null ? 4 : o.pointRadius, pointHoverRadius: 6,
    yAxisID: 'y1',
  };
  if (!plain) line.backgroundColor = cssVar('--accent-2-a10');
  var plugins = { legend: plain ? { labels: { color: cssVar('--chart-text'), font: { size: 12 } } } : comboLegend(cssVar) };
  if (o.tooltipTitle) plugins.tooltip = { callbacks: { title: o.tooltipTitle } };
  return {
    type: 'bar',
    data: {
      labels: o.labels,
      datasets: [
        { label: '勝率 (%)', data: o.winRates, backgroundColor: winRateColors(cssVar, o.winRates, cssVar('--accent-2-a30')), borderWidth: 0, yAxisID: 'y' },
        line,
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: plugins,
      scales: {
        x: xAxis(cssVar, Object.assign({ font: { size: 11 } }, o.xTicks)),
        y: pctAxis(cssVar, { position: 'left' }),
        y1: countAxis(cssVar),
      },
    },
    plugins: [winRate50Plugin],
  };
}
