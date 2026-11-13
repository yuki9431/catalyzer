// 試合データの判定ヘルパー。analysis 層からも使うため import を持たない。

// 試合の制限時間（秒）。この時間まで経過した試合はタイムアップとなり、勝敗はスコアで決まる。
export var TIMEUP_SEC = 240;

// 対戦形式（試合の mode）の表示名。取得前の試合は mode が無く、形式不明として扱う。
export var MODE_LABELS = { shuffle: 'シャッフル', fixed: '固定' };

// 対戦形式の表示名。'all'・形式不明・想定外の値は ''
export function modeLabel(mode) {
  return Object.prototype.hasOwnProperty.call(MODE_LABELS, mode) ? MODE_LABELS[mode] : '';
}

// タイムアップ（制限時間切れ）で決着した試合か。game_end_secが制限時間に達していれば真。
export function isTimeUp(match) {
  return !!(match && match.game_end_sec != null && match.game_end_sec >= TIMEUP_SEC);
}

// 連勝の上限。10連勝で打ち止めになり、次の試合は1から数え直す。
export var STREAK_MAX = 10;
// 取得前の試合の推定で、同じ連勝の続きとみなす試合間隔の上限（途中で降りて並び直した試合を切る）。
var STREAK_GAP_MS = 10 * 60 * 1000;

function timeOf(date) {
  var t = Date.parse((date || '').replace(' ', 'T'));
  return isNaN(t) ? null : t;
}

// 直前の勝ちから連勝が続いているか。相方・対戦形式が変わるか間が空けば途中で降りたとみなす。
function continuesStreak(prev, prevStreak, m) {
  if (!prev || prevStreak < 1 || prevStreak >= STREAK_MAX) return false;
  if ((prev.partner_name || '') !== (m.partner_name || '')) return false;
  if (prev.mode && m.mode && prev.mode !== m.mode) return false;
  var a = timeOf(prev.date), b = timeOf(m.date);
  return a != null && b != null && b >= a && b - a <= STREAK_GAP_MS;
}

// 試合キー（match_id か日時）ごとの連勝数の Map（負けは0）。公式の値 win_streak が無い試合は直前の試合から推定する。
export function winStreaks(matches) {
  var sorted = (matches || []).slice().sort(function (a, b) {
    return a.date < b.date ? -1 : a.date > b.date ? 1 : 0;
  });
  var out = new Map();
  var prev = null, prevStreak = 0;
  sorted.forEach(function (m) {
    var s = 0;
    if (m.win) s = m.win_streak > 0 ? m.win_streak : continuesStreak(prev, prevStreak, m) ? prevStreak + 1 : 1;
    out.set(streakKey(m), s);
    prev = m;
    prevStreak = s;
  });
  return out;
}

// winStreaks の Map を引くキー。自動更新で試合オブジェクトが作り直されても引ける。
export function streakKey(m) {
  return (m && (m.match_id || m.date)) || '';
}

// 連勝数の表示。公式と同じく2連勝以上だけ出す。
export function streakLabel(n) {
  return n >= 2 ? n + '連勝' : '';
}
