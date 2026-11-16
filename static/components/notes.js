import { html, useState, useRef, useEffect, useMemo } from '../htm-preact-standalone.js';
import { currentPlayDay, playDay } from '../analysis/today.js';
import {
  sanitizeNotes, notesForMatch, notesForEnemy, groupByEnemy, notesByTab, tabCounts, noteTargetLabel, defaultDraft, draftFromNote, draftToRequest, textLength,
  validateDraft, canAddEnemy, enemyOptions, withValue, pinnedCount, upsertNote, removeNoteById, loadDecision, responseOutcome,
} from '../lib/notes.js';
import { Layer } from './popover.js';
import { ToggleGroup, Notice } from './parts.js';
import { Dropdown } from './ui.js';

var NETWORK_ERROR = '通信に失敗しました。電波の良い場所でもう一度お試しください';

// 失敗の文言。応答の error を優先し、通信失敗は専用の文言、それ以外は fallback
function failText(res, fallback) {
  if (res && res.body && typeof res.body.error === 'string' && res.body.error) return res.body.error;
  return res && res.status === 0 ? NETWORK_ERROR : fallback;
}

// メモの取得と保存。メモリだけに置く(端末には保存しない)。api は app.js の NOTES_ACTIONS
export function useNotes(userKey, api, data) {
  var stateRef = useState({ status: 'off', list: [], limits: null });
  var state = stateRef[0], setState = stateRef[1];
  var draftRef = useState(null);
  var draft = draftRef[0], setDraft = draftRef[1];
  var settled = useRef(null);
  var loading = useRef(null);
  var current = useRef(userKey);
  current.current = userKey;
  var alive = useRef(true);
  useEffect(function () {
    alive.current = true;
    return function () { alive.current = false; };
  }, []);

  function load(key) {
    loading.current = key;
    setState(function (prev) { return { status: 'loading', list: prev.list, limits: prev.limits }; });
    api.list().then(function (res) {
      if (loading.current === key) loading.current = null;
      if (!alive.current) return;
      var outcome = responseOutcome(key, current.current, res);
      if (outcome === 'stale') return;
      if (outcome === 'off') { setState({ status: 'off', list: [], limits: null }); return; }
      settled.current = key;
      setState(outcome === 'on'
        ? { status: 'on', list: sanitizeNotes(res.body.notes), limits: res.body.limits || null }
        : { status: 'error', list: [], limits: null });
    });
  }

  // 初回ログインでは分析の完了時に使えるようになるため、data の更新でも判定し直す
  useEffect(function () {
    var d = loadDecision(userKey, !!(api && api.available()), settled.current, loading.current);
    if (d === 'off') {
      settled.current = null;
      setState(function (prev) { return prev.status === 'off' ? prev : { status: 'off', list: [], limits: null }; });
    } else if (d === 'load') load(userKey);
  }, [userKey, data]);

  function apply(fn) { setState(function (prev) { return Object.assign({}, prev, { list: fn(prev.list) }); }); }

  function save(d) {
    var req = draftToRequest(d);
    var call = d.id ? api.update(d.id, req) : api.create(req);
    return call.then(function (res) {
      var note = res.body && res.body.note ? sanitizeNotes([res.body.note])[0] : null;
      if ((res.status === 200 || res.status === 201) && note) {
        if (alive.current) { apply(function (list) { return upsertNote(list, note); }); setDraft(null); }
        return '';
      }
      return failText(res, 'メモを保存できませんでした');
    });
  }

  // 404 はもう消えているので成功として扱う
  function remove(id) {
    return api.remove(id).then(function (res) {
      if (res.status === 200 || res.status === 404) {
        if (alive.current) { apply(function (list) { return removeNoteById(list, id); }); setDraft(null); }
        return '';
      }
      return failText(res, 'メモを削除できませんでした');
    });
  }

  function reload() { if (api && api.available() && current.current && loading.current !== current.current) load(current.current); }

  return {
    status: state.status, list: state.list, limits: state.limits, draft: draft,
    open: setDraft, close: function () { setDraft(null); }, save: save, remove: remove, reload: reload,
  };
}

// メモがあることを示す印。絵文字は撮影環境のフォントに無いので SVG で描く
export function NoteMark() {
  return html`<span class="note-mark" data-ui="note-mark" role="img" aria-label="メモあり"><svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M5 3h10l4 4v14H5z M14 3v5h5 M8 12h8 M8 16h8" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round" /></svg></span>`;
}

// 1件の行。タップで編集シートを開く
export function NoteItem({ note, showTarget, onOpen }) {
  return html`<button type="button" class="note-item" data-ui="note-item" onClick=${function () { onOpen(note); }}>
    ${(showTarget || note.my_ms) && html`<span class="note-item-meta">
      ${showTarget && html`<b>${noteTargetLabel(note)}</b>`}
      ${note.my_ms && html`<span>自機: ${note.my_ms}</span>`}
    </span>`}
    <span class="note-item-text">${note.text}</span>
  </button>`;
}

// 試合詳細から書くときの既定: その試合のプレイ日と相手の1機目
export function matchDraft(match) {
  return defaultDraft({ enemy: match.opponent1_ms, date: playDay(match.date) });
}

// 相性タブ・メモ一覧から書くときの既定: 今日のプレイ日。enemy が '' なら敵機は0欄
export function todayDraft(enemy, now) {
  return defaultDraft({ enemy: enemy, date: currentPlayDay(now) });
}

// 相性タブの行の中身。その敵機のメモを並べる
export function EnemyNotes({ notes, enemy, myMs }) {
  var list = notesForEnemy(notes.list, enemy, myMs);
  return html`<div class="note-match" data-ui="enemy-notes">
    ${list.length
      ? list.map(function (n) { return html`<${NoteItem} key=${n.id} note=${n} onOpen=${function (x) { notes.open(draftFromNote(x)); }} />`; })
      : html`<p class="note-empty">まだメモはありません</p>`}
    <button type="button" class="ui-action note-write" data-ui="note-write"
      onClick=${function () { notes.open(todayDraft(enemy, new Date())); }}>＋ メモを書く</button>
  </div>`;
}

// 試合詳細のパネルの中身。その試合の敵機ごとにメモを並べる
export function MatchNotes({ notes, match }) {
  var groups = useMemo(function () { return notesForMatch(notes.list, match); }, [notes.list, match]);
  return html`<div class="note-match" data-ui="match-notes">
    ${groups.map(function (g) {
      return html`<section class="note-group">
        <h3 class="note-group-head">${g.enemy}</h3>
        ${g.notes.length
          ? g.notes.map(function (n) { return html`<${NoteItem} key=${n.id} note=${n} onOpen=${function (x) { notes.open(draftFromNote(x)); }} />`; })
          : html`<p class="note-empty">まだメモはありません</p>`}
      </section>`;
    })}
    <button type="button" class="ui-action note-write" data-ui="note-write"
      onClick=${function () { notes.open(matchDraft(match)); }}>＋ メモを書く</button>
  </div>`;
}

function NoteSheetBody({ notes, choices }) {
  var init = notes.draft;
  var dRef = useState(init);
  var draft = dRef[0], setDraft = dRef[1];
  var busyRef = useState(false);
  var busy = busyRef[0], setBusy = busyRef[1];
  var errRef = useState('');
  var error = errRef[0], setError = errRef[1];
  var confirmRef = useState(false);
  var confirming = confirmRef[0], setConfirming = confirmRef[1];
  var alive = useRef(true);
  useEffect(function () { return function () { alive.current = false; }; }, []);

  var limits = notes.limits || {};
  var others = pinnedCount(notes.list, draft.id);
  var pinFull = !!limits.pinned_max && others >= limits.pinned_max;
  var problem = validateDraft(draft, limits, others);
  var len = textLength(draft.text);
  var over = !!limits.text_max && len > limits.text_max;
  var editing = !!draft.id;

  function patch(p) { setDraft(function (prev) { return Object.assign({}, prev, p); }); }
  function setEnemy(i, v) { patch({ enemies: draft.enemies.map(function (e, k) { return k === i ? v : e; }) }); }
  function removeEnemy(i) { patch({ enemies: draft.enemies.filter(function (e, k) { return k !== i; }) }); }
  function done(p) {
    setBusy(true); setError('');
    p.then(function (msg) {
      if (!alive.current) return;
      setBusy(false);
      if (msg) setError(msg);
    });
  }

  var head = html`<span></span>
    <h2>${editing ? 'メモを編集' : 'メモを書く'}</h2>
    <button type="button" class="ui-sheet-close" data-ui="sheet-close" onClick=${notes.close}>閉じる</button>`;
  var foot = html`${editing && (confirming
      ? html`<span class="note-foot-left">
          <button type="button" class="ui-action note-danger" data-ui="note-delete-confirm" disabled=${busy} onClick=${function () { done(notes.remove(draft.id)); }}>削除する</button>
          <button type="button" class="ui-action" data-ui="note-delete-cancel" onClick=${function () { setConfirming(false); }}>やめる</button>
        </span>`
      : html`<span class="note-foot-left"><button type="button" class="ui-action" data-ui="note-delete" disabled=${busy} onClick=${function () { setConfirming(true); }}>削除</button></span>`)}
    <button type="button" class="search-apply note-save" data-ui="note-save" disabled=${!!problem || busy}
      onClick=${function () { done(notes.save(draft)); }}>${busy ? '保存中…' : '保存'}</button>`;

  var mine = withValue(choices.mine, draft.my_ms);
  return html`<${Layer} ui="note-sheet" label=${editing ? 'メモを編集' : 'メモを書く'} head=${head} foot=${foot} footUi="note-foot" onClose=${notes.close}>
    <div class="note-form">
      <div class="search-field">
        <label class="search-label" for="noteText">メモ</label>
        <textarea id="noteText" class="note-text" rows="6" placeholder="対策を書く（例: 着地を見てから射撃を合わせる）"
          value=${draft.text} onInput=${function (e) { patch({ text: e.target.value }); }}></textarea>
        <p class=${'note-count' + (over ? ' note-count-over' : '')} data-ui="note-count">${len}${limits.text_max ? ' / ' + limits.text_max : ''}</p>
      </div>
      <div class="search-field">
        <label class="search-label" for="noteDate">日付</label>
        <div class="note-row">
          <input id="noteDate" type="date" class="note-date" data-ui="note-date" value=${draft.date}
            onInput=${function (e) { patch({ date: e.target.value }); }} />
          ${draft.date && html`<button type="button" class="note-x" data-ui="note-date-clear" aria-label="日付を消す"
            onClick=${function () { patch({ date: '' }); }}>×</button>`}
        </div>
      </div>
      <div class="search-field">
        <label class="search-label">敵機</label>
        ${draft.enemies.map(function (e, i) {
          return html`<div class="note-row" data-ui="note-enemy" key=${i}>
            <${Dropdown} value=${e} options=${enemyOptions(choices.enemies, draft.enemies, i)} noClear placeholder="選んでください"
              onChange=${function (v) { setEnemy(i, v); }} />
            <button type="button" class="note-x" data-ui="note-enemy-remove" aria-label="敵機を外す"
              onClick=${function () { removeEnemy(i); }}>×</button>
          </div>`;
        })}
        ${canAddEnemy(draft, limits) && html`<button type="button" class="ui-action note-write" data-ui="note-enemy-add"
          onClick=${function () { patch({ enemies: draft.enemies.concat(['']) }); }}>＋ 敵機を追加する</button>`}
      </div>
      <div class="search-field">
        <label class="search-label">自機</label>
        <div data-ui="note-my"><${Dropdown} value=${draft.my_ms} options=${mine} placeholder="指定しない"
          onChange=${function (v) { patch({ my_ms: v }); }} /></div>
      </div>
      <label class="note-pin" data-ui="note-pin">
        <input type="checkbox" checked=${draft.pinned} disabled=${pinFull && !draft.pinned}
          onChange=${function (e) { patch({ pinned: e.target.checked }); }} />
        <span>ピン留めする（最大${limits.pinned_max || ''}件）${pinFull && !draft.pinned && html`<small>ピン留めは${limits.pinned_max}件までです</small>`}</span>
      </label>
      ${error && html`<${Notice} tone="error">${error}</${Notice}>`}
    </div>
  </${Layer}>`;
}

// 書くシート。どの入口から開いても同じ部品。draft が無いときは何も描かない
export function NoteSheet({ notes, choices }) {
  if (!notes || !notes.draft) return null;
  return html`<${NoteSheetBody} notes=${notes} choices=${choices || { enemies: [], mine: [] }} />`;
}

var LIST_TABS = [['all', 'すべて'], ['enemy', '敵機'], ['date', '日付'], ['pin', 'ピン']];

// その他画面から開くメモ一覧。タップで編集シートを開く
export function NoteList({ notes, onClose }) {
  var tabRef = useState('all');
  var tab = tabRef[0], setTab = tabRef[1];
  var counts = useMemo(function () { return tabCounts(notes.list); }, [notes.list]);
  var items = useMemo(function () { return notesByTab(notes.list, tab); }, [notes.list, tab]);
  var groups = useMemo(function () { return groupByEnemy(notes.list); }, [notes.list]);
  function open(n) { notes.open(draftFromNote(n)); }
  var head = html`<button type="button" class="search-back" data-ui="note-list-back" aria-label="その他に戻る" onClick=${onClose}>
      <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" stroke-width="2" /></svg>その他</button>
    <h2>メモ</h2>
    <button type="button" class="search-link note-list-write" data-ui="note-write" onClick=${function () { notes.open(todayDraft('', new Date())); }}>書く</button>`;
  var options = LIST_TABS.map(function (t) { return { value: t[0], label: t[1] + ' ' + counts[t[0]] }; });
  return html`<${Layer} ui="note-list" label="メモ" head=${head} onClose=${onClose}>
    <div class="note-list">
      <${ToggleGroup} ui="note-tabs" label="表示するメモ" options=${options} value=${tab} onChange=${setTab} />
      ${!items.length && html`<p class="note-empty">メモはまだありません</p>`}
      ${tab === 'enemy'
        ? groups.map(function (g) {
          return html`<section class="note-group" key=${g.enemy}>
            <h3 class="note-group-head" data-ui="note-group">${g.enemy}<span>${g.count}件</span></h3>
            ${g.notes.map(function (n) { return html`<${NoteItem} key=${n.id} note=${n} onOpen=${open} />`; })}
          </section>`;
        })
        : items.map(function (n) { return html`<${NoteItem} key=${n.id} note=${n} showTarget onOpen=${open} />`; })}
    </div>
  </${Layer}>`;
}
