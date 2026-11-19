// AI診断の応答の整形と状態の純粋ロジック。import を持たない
export var POLL_INTERVAL_MS = 5000;
export var POLL_MAX = 72;

var STATUSES = ['none', 'pending', 'running', 'done', 'error'];
var DEFAULT_MIN = 10;
var SECTIONS = ['tendencies', 'cautions', 'strengths'];

function isText(v) { return typeof v === 'string' && v.length > 0 && v.length <= 200; }

function sanitizeResult(r) {
  if (!r || typeof r !== 'object' || !isText(r.headline)) return null;
  var out = { headline: r.headline };
  for (var i = 0; i < SECTIONS.length; i++) {
    var list = r[SECTIONS[i]];
    if (!Array.isArray(list) || list.length > 5 || !list.every(isText)) return null;
    out[SECTIONS[i]] = list.slice();
  }
  return out;
}

// GET/POST の応答本文を表示用に整える。使えない・形が不正なら { available: false }
export function sanitizeStatus(body) {
  var off = { available: false };
  if (!body || typeof body !== 'object' || body.available !== true || STATUSES.indexOf(body.status) < 0) return off;
  var out = { available: true, status: body.status, min_matches: Number.isInteger(body.min_matches) && body.min_matches > 0 ? body.min_matches : DEFAULT_MIN };
  if (body.status === 'done') {
    out.result = sanitizeResult(body.result);
    if (!out.result) return off;
  }
  if (typeof body.next_at === 'string' && nextAtLabel(body.next_at)) out.next_at = body.next_at;
  if (body.status === 'error') {
    out.retry = body.retry === true;
    out.attempts_left = Number.isInteger(body.attempts_left) && body.attempts_left >= 0 ? body.attempts_left : 0;
    out.error = isText(body.error) ? body.error : '診断できませんでした';
  }
  return out;
}

// 次に診断できる日時の表示('10/9 5:00')。文字列内の日時をそのまま読み、端末のタイムゾーンに依らない。読めなければ ''
export function nextAtLabel(iso) {
  var m = /^\d{4}-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(typeof iso === 'string' ? iso : '');
  return m ? Number(m[1]) + '/' + Number(m[2]) + ' ' + Number(m[3]) + ':' + m[4] : '';
}

export function shouldPoll(status) { return status === 'pending' || status === 'running'; }

// 取得応答の解釈。200 は整形、401/403 は使えない、それ以外(通信失敗 status 0・5xx 等)は前の状態を保って transient
export function resolveLoad(prev, res) {
  if (res && res.status === 200) return { status: sanitizeStatus(res.body), transient: false };
  if (res && (res.status === 401 || res.status === 403)) return { status: { available: false }, transient: false };
  return { status: prev, transient: true };
}

var MAX_TIMER_MS = 2147483647;
var REFETCH_SKEW_MS = 1000;

// done・再試行できない error は next_at に達したら状態を取り直す。待ち時間(ms)を返し、不要・過去・読めなければ null(取り直しの無限ループを避ける)
export function refetchDelay(status, nowMs) {
  if (!status || !status.available || !status.next_at) return null;
  if (!(status.status === 'done' || (status.status === 'error' && !status.retry))) return null;
  var at = Date.parse(status.next_at);
  if (!Number.isFinite(at) || at <= nowMs) return null;
  return Math.min(at - nowMs + REFETCH_SKEW_MS, MAX_TIMER_MS);
}
