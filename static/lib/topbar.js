// 上部バーの純粋ロジック(引っ張り再分析・絞り込み行の隠す/出す)。import を持たない。

export var PULL = { slop: 8, resist: 0.5, threshold: 64, max: 96 };
export var PULL_IDLE = { phase: 'idle', startX: 0, startY: 0, distance: 0 };

function result(state, fire, prevent) {
  return { state: state, fire: fire, prevent: prevent };
}

// ev: {type:'start',x,y,scrollY,enabled} | {type:'move',x,y,scrollY} | {type:'end'} | {type:'cancel'}
export function pullStep(state, ev) {
  if (ev.type === 'cancel') return result(PULL_IDLE, false, false);
  if (ev.type === 'start') {
    if (!ev.enabled || ev.scrollY > 0) return result(PULL_IDLE, false, false);
    return result({ phase: 'armed', startX: ev.x, startY: ev.y, distance: 0 }, false, false);
  }
  if (ev.type === 'end') {
    return result(PULL_IDLE, state.phase === 'pulling' && state.distance >= PULL.threshold, false);
  }
  if (ev.type !== 'move' || state.phase === 'idle') return result(state, false, false);
  var dx = ev.x - state.startX;
  var dy = ev.y - state.startY;
  var vert = dy > 0 && dy >= Math.abs(dx);
  if (state.phase === 'armed') {
    // slop 内は prevent しない(cancel 済みのタッチ列はネイティブスクロールを始めない)
    if (Math.max(Math.abs(dx), Math.abs(dy)) < PULL.slop) return result(state, false, false);
    if (vert && ev.scrollY <= 0) return result(pulling(state, dy), false, true);
    return result(PULL_IDLE, false, false);
  }
  if (dy > 0 && ev.scrollY <= 0) return result(pulling(state, dy), false, true);
  return result(PULL_IDLE, false, false);
}

function pulling(state, dy) {
  return { phase: 'pulling', startX: state.startX, startY: state.startY, distance: Math.min(PULL.max, dy * PULL.resist) };
}

export function pullReady(state) {
  return state.phase === 'pulling' && state.distance >= PULL.threshold;
}

export var BAR = { hideAfter: 24, showAfter: 16 };
export var BAR_SHOWN = { hidden: false, anchor: 0 };

// limits: {top, max}。y は [0, max] に丸める(iOS の上下バウンスで誤判定しない)
export function nextBar(prev, y, limits) {
  var max = Math.max(limits.max, 0);
  var yy = Math.min(Math.max(y, 0), max);
  if (prev.anchor > max) prev = { hidden: prev.hidden, anchor: max }; // max が縮んだら anchor も丸める
  if (yy <= limits.top) return { hidden: false, anchor: yy };
  if (!prev.hidden) {
    if (yy < prev.anchor) return { hidden: false, anchor: yy };
    if (yy - prev.anchor >= BAR.hideAfter) return { hidden: true, anchor: yy };
    return prev;
  }
  if (yy > prev.anchor) return { hidden: true, anchor: yy };
  if (prev.anchor - yy >= BAR.showAfter) return { hidden: false, anchor: yy };
  return prev;
}
