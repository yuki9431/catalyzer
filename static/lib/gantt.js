// 試合経過ガントの目盛りの純粋ロジック。import を持たない。

// 終了ラベルと重ならない、終了までの残り割合の下限(narrow は 360px 幅、wide は 720px 超を想定)
export var TICK_GAP = { narrow: 0.34, wide: 0.16 };

// 30秒ごとの目盛りと表示用の終了秒。label: 'all'=常に表示 / 'wide'=広い画面だけ / null=出さない
export function ganttTicks(raw) {
  var end = Math.floor(raw);
  var ticks = [];
  for (var t = 30; t < end; t += 30) {
    var major = t % 60 === 0;
    var gap = (raw - t) / raw;
    var label = !major ? null : gap >= TICK_GAP.narrow ? 'all' : gap >= TICK_GAP.wide ? 'wide' : null;
    ticks.push({ sec: t, major: major, label: label });
  }
  return { end: end, ticks: ticks };
}
