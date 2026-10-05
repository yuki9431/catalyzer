// 起動経路の判定(再読み込み・ホーム画面アプリ)。DOM・storage を持たない。

// entries: performance.getEntriesByType('navigation')、legacyType: performance.navigation.type
export function navigationType(entries, legacyType) {
  var t = entries && entries[0] && entries[0].type;
  if (typeof t === 'string') return t;
  if (legacyType === 1) return 'reload';
  if (legacyType === 2) return 'back_forward';
  return 'navigate';
}

// env: { standalone, matchMedia(q) }
export function isStandalone(env) {
  if (env.standalone === true) return true;
  return !!(env.matchMedia && env.matchMedia('(display-mode: standalone)').matches);
}

export var RELOAD_GUARD = { runningMs: 10 * 60 * 1000, cooldownMs: 60 * 1000 };

function stamp(v, now) {
  var n = Number(v);
  return isFinite(n) && n > 0 && n <= now ? n : 0;
}

// s: { navType, hasSession, now, startedAt, finishedAt }(startedAt/finishedAt は localStorage の生の値)
export function shouldReanalyzeOnReload(s) {
  if (s.navType !== 'reload' || !s.hasSession) return false;
  var started = stamp(s.startedAt, s.now), finished = stamp(s.finishedAt, s.now);
  if (started > finished && s.now - started < RELOAD_GUARD.runningMs) return false;
  if (finished > 0 && s.now - finished < RELOAD_GUARD.cooldownMs) return false;
  return true;
}
