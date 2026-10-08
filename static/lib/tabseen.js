// --- 下部タブの更新の点: タブごとに最後に見たときの値を覚え、変わっていれば点を付ける ---

export var TAB_SEEN_KEY = 'catalyzer_tab_seen';

// 見ていないタブで値が変わったものに点。記録の無いタブ(初回)には付けない
export function tabBadges(seen, signals, view) {
  var out = {};
  Object.keys(signals).forEach(function (k) {
    out[k] = k !== view && seen != null && seen[k] != null && signals[k] != null && seen[k] !== signals[k];
  });
  return out;
}

// 表示中のタブと、記録の無いタブを今の値で記録する。変化が無ければ同じオブジェクトを返す
export function markSeen(seen, signals, view) {
  var next = Object.assign({}, seen || {});
  var changed = false;
  Object.keys(signals).forEach(function (k) {
    if (signals[k] == null) return;
    if (k === view || next[k] == null) {
      if (next[k] !== signals[k]) { next[k] = signals[k]; changed = true; }
    }
  });
  return changed ? next : seen;
}
