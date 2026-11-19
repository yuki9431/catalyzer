import { html, useState, useEffect, useRef } from '../htm-preact-standalone.js';
import { buildDiagnosisInput } from '../analysis/diagnosis.js';
import { sanitizeStatus, resolveLoad, refetchDelay, nextAtLabel, shouldPoll, POLL_INTERVAL_MS, POLL_MAX } from '../lib/ai-diagnosis.js';
import { Panel } from './ui.js';
import { Notice } from './parts.js';

var SLOW = '時間がかかっています。あとで開き直してください';
var START_FAILED = '診断を開始できませんでした';
var LOAD_FAILED = '診断の状態を取得できませんでした';
var SECTIONS = [['tendencies', '傾向'], ['cautions', '気をつけること'], ['strengths', 'いいところ']];

function Result({ status }) {
  var r = status.result;
  var next = status.next_at ? nextAtLabel(status.next_at) : '';
  return html`<div>
    <p class="ai-headline" data-ui="ai-diagnosis-headline">${r.headline}</p>
    ${SECTIONS.map(function (s) {
      return html`<h3 class="ai-section">${s[1]}</h3>
        <ul class="ai-list">${r[s[0]].map(function (t) { return html`<li data-ui="ai-diagnosis-item">${t}</li>`; })}</ul>`;
    })}
    ${next && html`<p class="ai-next" data-ui="ai-diagnosis-next">次は ${next} 以降</p>`}
  </div>`;
}

// ホームの AI 診断。使えないとき(未ログイン・許可外・未設定)は何も描かない。状態はメモリだけに持つ。actions は app.js の AI_DIAGNOSIS_ACTIONS
export function AiDiagnosisPanel({ actions, matches, msImages }) {
  var stRef = useState(null);
  var status = stRef[0], setStatus = stRef[1];
  var failRef = useState('');
  var failure = failRef[0], setFailure = failRef[1];
  var slowRef = useState(false);
  var slow = slowRef[0], setSlow = slowRef[1];
  var busyRef = useState(false);
  var sending = busyRef[0], setSending = busyRef[1];
  var loadFailRef = useState(false);
  var loadFailed = loadFailRef[0], setLoadFailed = loadFailRef[1];
  var statusRef = useRef(null);
  statusRef.current = status;
  var alive = useRef(true);
  var inflight = useRef(false);
  var polls = useRef(0);
  useEffect(function () {
    alive.current = true;
    return function () { alive.current = false; };
  }, []);

  var usable = !!(actions && actions.available());
  function reload() {
    return actions.load().then(function (res) {
      if (!alive.current) return;
      var r = resolveLoad(statusRef.current, res);
      setLoadFailed(r.transient);
      if (!r.transient) setStatus(r.status);
    });
  }
  useEffect(function () {
    if (!usable) return;
    reload();
  }, [usable]);

  // 画面を開いたまま next_at を過ぎたら状態を取り直す(日次の切り替わり)
  useEffect(function () {
    var delay = refetchDelay(status, Date.now());
    if (delay === null) return;
    var timer = setTimeout(reload, delay);
    return function () { clearTimeout(timer); };
  }, [status]);

  var running = !!status && status.available && shouldPoll(status.status);
  useEffect(function () {
    if (!running) return;
    var timer = setTimeout(function tick() {
      if (!alive.current) return;
      if (polls.current >= POLL_MAX) { setSlow(true); return; }
      polls.current++;
      actions.load().then(function (res) {
        if (!alive.current) return;
        var r = resolveLoad(statusRef.current, res);
        if (!r.transient) setStatus(r.status);
        if (!r.transient && !r.status.available) return;
        timer = setTimeout(tick, POLL_INTERVAL_MS);
      });
    }, POLL_INTERVAL_MS);
    return function () { clearTimeout(timer); };
  }, [running]);

  function request() {
    var known = msImages ? new Set(Object.keys(msImages)) : null;
    var input = buildDiagnosisInput(matches, new Date(), known, status && status.min_matches);
    if (!input || inflight.current) return;
    inflight.current = true;
    setSending(true);
    setFailure('');
    setSlow(false);
    polls.current = 0;
    actions.request(input).then(function (res) {
      inflight.current = false;
      if (!alive.current) return;
      setSending(false);
      var next = res ? sanitizeStatus(res.body) : { available: false };
      if (res && (res.status === 202 || res.status === 409) && next.available) { setStatus(next); setLoadFailed(false); return; }
      if (res && res.status === 401) { setStatus({ available: false }); return; }
      setFailure(res && res.body && typeof res.body.error === 'string' && res.body.error ? res.body.error : START_FAILED);
      reload();
    });
  }

  if (!usable || (status && !status.available)) return null;
  if (!status) {
    if (!loadFailed) return null;
    return html`<div data-ui="ai-diagnosis"><${Panel} title="AI診断">
      <${Notice} tone="error" action=${{ label: '再取得', onClick: reload }}>${LOAD_FAILED}<//>
    <//></div>`;
  }
  var count = (matches || []).length;
  var st = status.status;
  var body;
  if (shouldPoll(st)) {
    body = slow
      ? html`<${Notice}>${SLOW}<//>`
      : html`<p class="ai-busy" data-ui="ai-diagnosis-busy" role="status" aria-busy="true">診断中…</p>`;
  } else if (st === 'done') {
    body = html`<${Result} status=${status} />`;
  } else if (st === 'error') {
    body = html`<${Notice} tone="error" action=${status.retry ? { label: 'もう一度診断する', onClick: request } : null}>${status.error}<//>
      ${!status.retry && status.next_at && html`<p class="ai-next" data-ui="ai-diagnosis-next">次は ${nextAtLabel(status.next_at)} 以降</p>`}`;
  } else if (count < status.min_matches) {
    body = html`<p class="ai-note" data-ui="ai-diagnosis-short">${status.min_matches}試合から診断できます</p>`;
  } else {
    body = html`<p class="ai-note">全試合(${count}戦)から診断します。送るのは勝率などの数値と機体名だけです。</p>
      <button type="button" class="ui-action" data-ui="ai-diagnosis-run" disabled=${sending} onClick=${request}>診断する</button>`;
  }
  return html`<div data-ui="ai-diagnosis">
    <${Panel} title="AI診断">
      ${body}
      ${failure && html`<${Notice} tone="error">${failure}<//>`}
      ${loadFailed && html`<${Notice} tone="error" action=${{ label: '再取得', onClick: reload }}>${LOAD_FAILED}<//>`}
    <//>
  </div>`;
}
