// 自動更新の純粋ロジック(取り込みの要否・差分の起点・状態表示の文言)。通信と描画は持たない

// 前回の取り込みからこの間隔(ms)は次の取り込みを飛ばす
export var PULL_MIN_INTERVAL_MS = 20000;

function pad2(n) { return String(n).padStart(2, '0'); }

// キャッシュ済み試合の最新日時(YYYY-MM-DD HH:MM)の1分前を /matches?after= の値にする。
// サーバーの after は厳密な「より後」なので、同じ分の未取得試合を落とさないよう1分戻す(重複は match_id で上書きされる)。空なら ''
export function diffAfterParam(matches) {
  var latest = '';
  (matches || []).forEach(function (m) {
    if (m && typeof m.date === 'string' && m.date > latest) latest = m.date;
  });
  var p = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/.exec(latest);
  if (!p) return '';
  var t = new Date(Date.UTC(+p[1], +p[2] - 1, +p[3], +p[4], +p[5]) - 60000);
  return t.getUTCFullYear() + '-' + pad2(t.getUTCMonth() + 1) + '-' + pad2(t.getUTCDate()) + ' ' + pad2(t.getUTCHours()) + ':' + pad2(t.getUTCMinutes());
}

// 手動分析中・取り込み実行中・直前の取り込みから20秒以内は取り込まない
export function shouldPull(s) {
  if (s.activeJobId || s.pulling) return false;
  return s.now - s.lastPullAt >= PULL_MIN_INTERVAL_MS;
}

var STOP_REASONS = {
  session_expired: 'ログイン状態の期限が切れたため停止しています。再度ログインしてください',
  access_denied: '公式サイトにアクセスを拒否されたため停止しています',
  no_session: '保存されたログイン状態が無いため停止しています',
  error: '取得の失敗が続いたため停止しています',
};

function hhmm(t) { return pad2(t.getHours()) + ':' + pad2(t.getMinutes()); }

// GET /auto-refresh の応答を、状態行の { aside, sub } にする。lastImportedAt はこの端末で最後に差分を保存できた時刻(ms、0 は未取得)
export function describeStatus(st, lastImportedAt) {
  if (!st || !st.available) return { aside: '利用不可', sub: '現在この機能は使えません' };
  var last = lastImportedAt ? '最終取り込み ' + hhmm(new Date(lastImportedAt)) : '';
  if (!st.enabled || st.status === 'off') return { aside: '無効', sub: '公式サイトの新しい試合を自動で取り込みます' };
  if (st.status === 'stopped') return { aside: '停止中', sub: STOP_REASONS[st.reason] || '問題が起きたため停止しています' };
  if (st.status === 'idle') return { aside: '有効', sub: ['休止中。アプリを開くと再開します', last].filter(Boolean).join(' / ') };
  return { aside: '有効', sub: last || '約5分ごとに新しい試合を取り込みます' };
}

var ERROR_MESSAGES = {
  400: '合言葉が長すぎます。',
  401: 'ログイン状態を保持していません。「ログイン状態を保持する」を選んでログインし直してください。',
  403: '合言葉が違います。',
  409: '自動更新にはログイン状態の保持が必要です。「ログイン状態を保持する」を選んでログインし直してください。',
  429: '合言葉の試行回数の上限に達しました。しばらく時間をおいてから再度お試しください。',
  503: '自動更新は現在利用できません。',
};

// HTTP ステータス(0=通信失敗)を、画面に出す事実の文にする
export function errorMessage(status) {
  return ERROR_MESSAGES[status] || '自動更新の操作に失敗しました。時間をおいて再度お試しください。';
}
