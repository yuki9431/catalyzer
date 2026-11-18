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
