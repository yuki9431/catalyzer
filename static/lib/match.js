// 試合データの判定ヘルパー。analysis 層からも使うため import を持たない。

// 試合の制限時間（秒）。この時間まで経過した試合はタイムアップとなり、勝敗はスコアで決まる。
export var TIMEUP_SEC = 240;

// タイムアップ（制限時間切れ）で決着した試合か。game_end_secが制限時間に達していれば真。
export function isTimeUp(match) {
  return !!(match && match.game_end_sec != null && match.game_end_sec >= TIMEUP_SEC);
}
