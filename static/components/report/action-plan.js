import { html, useEffect, useState } from '../../htm-preact-standalone.js';
import { evaluateGoal, isValidGoal } from '../../analysis/coach.js';
import { pct } from '../../lib/format.js';
import { Panel } from '../ui.js';

// 「勝率アップミッション」: 勝率への影響が大きい順にミッションを示し、影響度「小」は「もっと見る」に畳む
var IMPACT_LABEL = { high: '大', mid: '中', low: '小' };
export var FOCUS_KEY = 'catalyzer_focus';
var FOCUS_SLOTS = 10;

function WinRateGain({ from, to }) {
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) return null;
  return html`<div class="action-gain">見込み勝率 ${pct(from)} → <strong>${pct(to)}</strong>（+${(to - from).toFixed(1)}%）</div>`;
}

// 挑戦中のミッションは利用者・機体ごとに1件。選択時点の最新試合より後の試合で達成を判定する
function isValidFocus(f) {
  return !!f && isValidGoal(f.goal) && typeof f.title === 'string' && typeof f.since === 'string';
}
function loadFocus(userKey, ms) {
  if (!userKey) return null;
  try {
    var v = JSON.parse(localStorage.getItem(FOCUS_KEY));
    var f = v && v.user_key === userKey && v.by_ms ? v.by_ms[ms || ''] : null;
    return isValidFocus(f) ? f : null;
  } catch (e) { return null; }
}
function saveFocus(userKey, ms, focus) {
  if (!userKey) return;
  try {
    var v = JSON.parse(localStorage.getItem(FOCUS_KEY));
    if (!v || v.user_key !== userKey || !v.by_ms) v = { user_key: userKey, by_ms: {} };
    if (focus) v.by_ms[ms || ''] = focus;
    else delete v.by_ms[ms || ''];
    localStorage.setItem(FOCUS_KEY, JSON.stringify(v));
  } catch (e) {}
}

// 影響度「小」以外を最初から表示する。全て「小」なら1位だけ
function primaryActions(actions) {
  var main = actions.filter(function (a) { return a.level !== 'low'; });
  return main.length ? main : actions.slice(0, 1);
}

function FocusCard({ focus, matches, selectedMs, onClear, onContinue }) {
  var targets = (matches || []).filter(function (m) { return m.date > focus.since && (!selectedMs || m.ms === selectedMs); });
  var ev = evaluateGoal(focus.goal, targets, FOCUS_SLOTS);
  var marks = ev.marks, achieved = ev.achieved, streak = ev.streak;
  var complete = marks.length >= FOCUS_SLOTS;
  var last = marks[marks.length - 1];
  var slots = [];
  for (var j = 0; j < FOCUS_SLOTS; j++) slots.push(marks[j] || null);
  return html`<div class=${'focus-card' + (complete || (last && last.ok) ? ' done' : '')}>
    <div class=${'focus-label' + (complete ? ' complete' : '')}>${complete ? '🎉 ミッション完了' : '挑戦中のミッション'}</div>
    <div class="focus-title">${focus.title}</div>
    <${WinRateGain} from=${focus.win_rate_from} to=${focus.win_rate_to} />
    ${focus.condition && html`<div class="focus-condition">達成条件: ${focus.condition}</div>`}
    <div class="focus-progress">
      ${complete
        ? html`<span><strong>${FOCUS_SLOTS}戦中${achieved}戦</strong> 達成</span>`
        : html`<span><strong>${achieved}戦達成</strong>（${FOCUS_SLOTS}戦中${marks.length}戦終了）</span>`}
      ${!complete && streak > 0 && html`<span class="focus-streak">${streak}戦連続達成中</span>`}
    </div>
    <div class="focus-marks">${slots.map(function (x, k) {
      if (!x) return html`<span class="focus-mark empty">${k + 1}</span>`;
      return html`<span class=${'focus-mark' + (x.ok ? ' ok' : '')} title=${x.date}>${x.ok ? '✓' : '✗'}</span>`;
    })}</div>
    <div class="focus-caption">${marks.length ? '✓ 達成 / ✗ 未達成。試合ごとに左から埋まります' : '次の試合から、試合ごとに左から埋まります'}</div>
    <div class="focus-actions">
      ${complete && html`<button class="focus-btn" onClick=${function () { onContinue(last.date); }}>もう${FOCUS_SLOTS}戦続ける</button>`}
      <button class="focus-btn ghost" onClick=${onClear}>ミッションを選び直す</button>
    </div>
  </div>`;
}

export function ActionPlanPanel({ plan, selectedMs, matches, userKey }) {
  var scope = userKey + '|' + (selectedMs || '');
  var focusRef = useState(function () { return { scope: scope, value: loadFocus(userKey, selectedMs) }; });
  var focusState = focusRef[0], setFocusState = focusRef[1];
  var moreRef = useState(false);
  var showMore = moreRef[0], setShowMore = moreRef[1];
  // 利用者・機体が変わったら挑戦中ミッションを読み直し、展開状態を戻す（同期前の1描画は別 scope の値を出さない）
  useEffect(function () {
    if (focusState.scope !== scope) setFocusState({ scope: scope, value: loadFocus(userKey, selectedMs) });
    setShowMore(false);
  }, [scope]);
  var focus = focusState.scope === scope ? focusState.value : loadFocus(userKey, selectedMs);
  if (!plan) return null;
  function setFocus(f) {
    saveFocus(userKey, selectedMs, f);
    setFocusState({ scope: scope, value: f });
  }
  function choose(a) {
    var since = '';
    (matches || []).forEach(function (m) { if (m.date > since) since = m.date; });
    setFocus({ goal: a.goal, title: a.title, condition: a.condition, since: since, win_rate_from: a.win_rate_from, win_rate_to: a.win_rate_to });
  }
  var title = '勝率アップミッション';
  if (focus) {
    return html`<${Panel} title=${title}>
      <${FocusCard} focus=${focus} matches=${matches} selectedMs=${selectedMs} onClear=${function () { setFocus(null); }}
        onContinue=${function (since) { setFocus(Object.assign({}, focus, { since: since })); }} />
    <//>`;
  }
  if (plan.insufficient) {
    return html`<${Panel} title=${title}>
      <p class="action-empty">診断には${plan.min_matches}試合以上が必要です（現在${plan.matches}試合）。期間を広げてください。</p>
    <//>`;
  }
  var recent = plan.recent;
  var down = recent && recent.win_rate < recent.before_win_rate;
  return html`<${Panel} title=${title}>
    <div class="action-summary">
      <span>${plan.matches}戦 勝率 <strong>${pct(plan.win_rate)}</strong></span>
      ${recent && html`<span class=${down ? 'action-down' : 'action-up'}>直近${recent.matches}戦 ${pct(recent.win_rate)}（それ以前 ${pct(recent.before_win_rate)}）</span>`}
    </div>
    ${plan.weak_enemy && html`<div class="action-enemy">苦手機体: <strong>${plan.weak_enemy.enemy}</strong>（${plan.weak_enemy.matches}戦 勝率${plan.weak_enemy.win_rate}%、それ以外 ${plan.weak_enemy.other_win_rate}%）${plan.weak_enemy.fact && '。' + plan.weak_enemy.fact}</div>`}
    ${plan.after_streak && html`<div class="action-enemy">${plan.after_streak.streak}連敗直後の試合: ${plan.after_streak.total}戦中${plan.after_streak.matches}戦（勝率${plan.after_streak.win_rate}%、それ以外 ${plan.after_streak.other_win_rate}%）</div>`}
    ${recent && recent.worsened.length > 0 && html`<div class="action-worsened">直近で悪化:
      ${recent.worsened.map(function (w) {
        return html`<span class="action-chip">${w.label} ${w.before}→${w.recent}</span>`;
      })}
    </div>`}
    ${plan.actions.length ? html`<ol class="action-list">${(showMore ? plan.actions : primaryActions(plan.actions)).map(function (a) {
      return html`<li>
        <div class="action-title">${a.title}<span class=${'action-impact ' + a.level}>影響度 ${IMPACT_LABEL[a.level]}</span></div>
        <div class="action-detail">${a.detail}</div>
        <${WinRateGain} from=${a.win_rate_from} to=${a.win_rate_to} />
        ${userKey && html`<button class="focus-btn" onClick=${function () { choose(a); }}>このミッションに挑戦</button>`}
      </li>`;
    })}</ol>` : html`<p class="action-empty">目立った負け筋は見つかりませんでした。</p>`}
    ${plan.actions.length > primaryActions(plan.actions).length && html`<button class="action-more" onClick=${function () { setShowMore(!showMore); }}>
      ${showMore ? '閉じる' : 'もっと見る（影響度 小 あと' + (plan.actions.length - primaryActions(plan.actions).length) + '件）'}
    </button>`}
    ${userKey && plan.actions.length > 0 && html`<p class="action-hint">ミッションを1つ選ぶと、次の試合から${FOCUS_SLOTS}戦分の達成状況を記録します。</p>`}
    ${!selectedMs && html`<p class="action-hint">上部で機体を選ぶと、その機体に絞って診断します。</p>`}
  <//>`;
}
