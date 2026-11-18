import { html, useState, useRef, useEffect, useMemo } from '../htm-preact-standalone.js';
import { currentPlayDay, playDay } from '../analysis/today.js';
import {
  sanitizeNotes, notesForMatch, matchEnemies, pinnedNotes, canPinMore, notesForEnemy, groupByMs, MS_TABS, notesByTab, tabCounts, noteTargetLabel, defaultDraft, draftFromNote, draftToRequest, textLength,
  validateDraft, canAddEnemy, enemyOptions, withValue, pinnedCount, upsertNote, removeNoteById, loadDecision, responseOutcome,
  swipeAxis, swipeOffset, swipeOpens,
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

  // fromRow は一覧の行の操作。後から開いた編集シートを閉じない
  function save(d, fromRow) {
    var req = draftToRequest(d);
    var call = d.id ? api.update(d.id, req) : api.create(req);
    return call.then(function (res) {
      var note = res.body && res.body.note ? sanitizeNotes([res.body.note])[0] : null;
      if ((res.status === 200 || res.status === 201) && note) {
        if (alive.current) { apply(function (list) { return upsertNote(list, note); }); if (!fromRow) setDraft(null); }
        return '';
      }
      return failText(res, 'メモを保存できませんでした');
    });
  }

  // 404 はもう消えているので成功として扱う
  function remove(id, fromRow) {
    return api.remove(id).then(function (res) {
      if (res.status === 200 || res.status === 404) {
        if (alive.current) { apply(function (list) { return removeNoteById(list, id); }); if (!fromRow) setDraft(null); }
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

// 鉛筆アイコンの「書く」ボタン
function WriteButton({ ui, onClick }) {
  return html`<button type="button" class="search-link note-write-icon" data-ui=${ui} aria-label="書く" onClick=${onClick}><svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16z M13 7l4 4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round" /></svg></button>`;
}

// ピン留めの印。NoteMark と同じ線画
function PinMark() {
  return html`<span class="note-mark" data-ui="note-pinned" role="img" aria-label="ピン留め"><svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M9 3h6 M10 3v6l-3 5h10l-3-5V3 M12 14v7" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round" /></svg></span>`;
}

// 1件の行。タップで編集シートを開く。showPin でピン留めの印を出す
export function NoteItem({ note, showTarget, showPin, onOpen }) {
  var pin = showPin && note.pinned;
  return html`<button type="button" class="note-item" data-ui="note-item" onClick=${function () { onOpen(note); }}>
    ${(pin || showTarget || note.my_ms || note.partner_ms) && html`<span class="note-item-meta">
      ${pin && html`<${PinMark} />`}
      ${showTarget && html`<b>${noteTargetLabel(note)}</b>`}
      ${note.my_ms && html`<span>自機: ${note.my_ms}</span>`}
      ${note.partner_ms && html`<span>僚機: ${note.partner_ms}</span>`}
    </span>`}
    <span class="note-item-text">${note.text}</span>
  </button>`;
}

var SWIPE_WIDTH = 168;

// 左スワイプでピン留めと削除を出す行。削除は2回タップで確定。rowKey が openId と同じ行だけ開く
export function SwipeNote({ notes, note, rowKey, showTarget, showPin, openId, setOpenId, onError }) {
  var open = openId === rowKey;
  var dragRef = useState(null);
  var drag = dragRef[0], setDrag = dragRef[1];
  var confirmRef = useState(false);
  var confirming = confirmRef[0], setConfirming = confirmRef[1];
  var busyRef = useState(false);
  var busy = busyRef[0], setBusy = busyRef[1];
  var start = useRef(null);
  var dragX = useRef(null);
  var moved = useRef(false);
  useEffect(function () { if (!open) setConfirming(false); }, [open]);

  function drop() { start.current = null; dragX.current = null; setDrag(null); }
  function down(e) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    start.current = { x: e.clientX, y: e.clientY, id: e.pointerId, axis: '' };
    moved.current = false;
  }
  function move(e) {
    var st = start.current;
    if (!st || st.id !== e.pointerId) return;
    if (e.pointerType === 'mouse' && !e.buttons) { drop(); return; }
    if (!st.axis) {
      st.axis = swipeAxis(e.clientX - st.x, e.clientY - st.y);
      if (st.axis === 'x' && e.currentTarget.setPointerCapture) e.currentTarget.setPointerCapture(e.pointerId);
    }
    if (st.axis !== 'x') return;
    moved.current = true;
    dragX.current = swipeOffset(e.clientX - st.x, open, SWIPE_WIDTH);
    setDrag(dragX.current);
  }
  function up() {
    var last = dragX.current;
    drop();
    if (last === null) return;
    var opens = swipeOpens(last, SWIPE_WIDTH);
    setOpenId(function (cur) { return opens ? rowKey : (cur === rowKey ? null : cur); });
    // タッチではドラッグ後に click が来ないことがあるので、次の操作を止めないよう戻す
    setTimeout(function () { moved.current = false; }, 0);
  }
  function tap(x) {
    if (moved.current) { moved.current = false; return; }
    if (openId !== null) { setOpenId(null); return; }
    notes.open(draftFromNote(x));
  }
  function run(call) {
    setBusy(true);
    onError('');
    call().then(function (msg) {
      setBusy(false);
      if (msg) onError(msg);
      else setOpenId(function (cur) { return cur === rowKey ? null : cur; });
    });
  }
  function togglePin() {
    if (!note.pinned && !canPinMore(notes.list, notes.limits)) {
      var max = (notes.limits || {}).pinned_max;
      onError(max ? 'ピン留めは' + max + '件までです' : 'これ以上ピン留めできません');
      return;
    }
    run(function () { return notes.save(Object.assign(draftFromNote(note), { pinned: !note.pinned }), true); });
  }
  function remove() {
    if (!confirming) { setConfirming(true); return; }
    run(function () { return notes.remove(note.id, true); });
  }
  var x = drag !== null ? drag : (open ? -SWIPE_WIDTH : 0);
  return html`<div class="note-swipe" data-ui="note-swipe">
    ${x !== 0 && html`<div class="note-swipe-actions">
      <button type="button" class="note-swipe-pin" data-ui="note-swipe-pin" disabled=${busy} tabindex=${open ? 0 : -1} onClick=${togglePin}>${note.pinned ? 'ピンを外す' : 'ピン留め'}</button>
      <button type="button" class="note-swipe-delete" data-ui="note-swipe-delete" disabled=${busy} tabindex=${open ? 0 : -1} onClick=${remove}>${confirming ? '削除する' : '削除'}</button>
    </div>`}
    <div class=${'note-swipe-front' + (drag !== null ? ' note-swipe-drag' : '')} style=${'transform:translateX(' + x + 'px)'}
      onPointerDown=${down} onPointerMove=${move} onPointerUp=${up} onPointerCancel=${drop}>
      <${NoteItem} note=${note} showTarget=${showTarget} showPin=${showPin} onOpen=${tap} />
    </div>
  </div>`;
}

// スワイプで開いている行とエラー。行の開閉でエラーを消す
function useSwipeRows() {
  var openRef = useState(null);
  var errRef = useState('');
  return {
    openId: openRef[0], error: errRef[0], setError: errRef[1],
    setOpenId: function (v) { openRef[1](v); errRef[1](''); },
  };
}

// 試合詳細から書くときの既定: その試合のプレイ日・相手の2機・自機
export function matchDraft(match) {
  return defaultDraft({ enemies: matchEnemies(match), my_ms: match.ms || '', date: playDay(match.date) });
}

// 相性タブ・メモ一覧から書くときの既定: 今日のプレイ日と myMs。enemy が '' なら敵機は0欄
export function todayDraft(enemy, myMs, now) {
  return defaultDraft({ enemies: enemy ? [enemy] : [], my_ms: myMs, date: currentPlayDay(now) });
}

// ホームの「書く」の既定: 今日のプレイ日と myMs。ピンに空きがあればピン留め
export function homeDraft(notes, limits, myMs, now) {
  return defaultDraft({ my_ms: myMs, date: currentPlayDay(now), pinned: canPinMore(notes, limits) });
}

// 相性タブの行の中身。その敵機のメモを並べる。writeMs は書くときの自機の既定
export function EnemyNotes({ notes, enemy, myMs, writeMs }) {
  var list = notesForEnemy(notes.list, enemy, myMs);
  return html`<div class="note-match" data-ui="enemy-notes">
    ${list.length
      ? list.map(function (n) { return html`<${NoteItem} key=${n.id} note=${n} onOpen=${function (x) { notes.open(draftFromNote(x)); }} />`; })
      : html`<p class="note-empty">まだメモはありません</p>`}
    <button type="button" class="ui-action note-write" data-ui="note-write"
      onClick=${function () { notes.open(todayDraft(enemy, writeMs || '', new Date())); }}>＋ メモを書く</button>
  </div>`;
}

// 試合詳細のパネルの中身。相手の機体の組ごと、続けて敵機の指定が無い自機・僚機のメモを並べる
export function MatchNotes({ notes, match }) {
  var groups = useMemo(function () { return notesForMatch(notes.list, match); }, [notes.list, match]);
  return html`<div class="note-match" data-ui="match-notes">
    ${groups.map(function (g) {
      return html`<section class="note-group" key=${g.head}>
        <h3 class="note-group-head">${g.head || '自機・僚機'}</h3>
        ${g.notes.length
          ? g.notes.map(function (n) { return html`<${NoteItem} key=${n.id} note=${n} onOpen=${function (x) { notes.open(draftFromNote(x)); }} />`; })
          : html`<p class="note-empty">まだメモはありません</p>`}
      </section>`;
    })}
    <button type="button" class="ui-action note-write" data-ui="note-write"
      onClick=${function () { notes.open(matchDraft(match)); }}>＋ メモを書く</button>
  </div>`;
}

// 試合詳細のメモ欄。試合を見る画面なので既定は閉じ、見出しに件数を出す
export function MatchNotesPanel({ notes, match }) {
  var openRef = useState(false);
  var open = openRef[0], setOpen = openRef[1];
  var count = useMemo(function () {
    return notesForMatch(notes.list, match).reduce(function (n, g) { return n + g.notes.length; }, 0);
  }, [notes.list, match]);
  return html`<div class="panel" data-ui="panel">
    <h2 class=${open ? '' : 'note-panel-closed'}><button type="button" class=${'note-panel-toggle' + (open ? ' open' : '')} data-ui="match-notes-toggle" aria-expanded=${open}
      onClick=${function () { setOpen(function (o) { return !o; }); }}>
      <span>メモ<small>${count}件</small></span><span class="search-chevron" aria-hidden="true"></span>
    </button></h2>
    ${open && html`<${MatchNotes} notes=${notes} match=${match} />`}
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
  var partners = withValue(choices.partners, draft.partner_ms);
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
      <div class="search-field">
        <label class="search-label">僚機</label>
        <div data-ui="note-partner"><${Dropdown} value=${draft.partner_ms} options=${partners} placeholder="指定しない"
          onChange=${function (v) { patch({ partner_ms: v }); }} /></div>
      </div>
      <label class="note-pin" data-ui="note-pin">
        <input type="checkbox" checked=${draft.pinned} disabled=${pinFull && !draft.pinned}
          onChange=${function (e) { patch({ pinned: e.target.checked }); }} />
        <span>ホームにピン留めする（最大${limits.pinned_max || ''}件）${pinFull && !draft.pinned && html`<small>ピン留めは${limits.pinned_max}件までです</small>`}</span>
      </label>
      ${error && html`<${Notice} tone="error">${error}</${Notice}>`}
    </div>
  </${Layer}>`;
}

// 書くシート。どの入口から開いても同じ部品。draft が無いときは何も描かない
export function NoteSheet({ notes, choices }) {
  if (!notes || !notes.draft) return null;
  return html`<${NoteSheetBody} notes=${notes} choices=${choices || { enemies: [], mine: [], partners: [] }} />`;
}

var LIST_TABS = [['all', 'すべて'], ['enemy', '敵機'], ['mine', '自機'], ['partner', '僚機'], ['date', '日付']];

// メモ一覧の本体。タップで編集シートを開く
function NoteList({ notes }) {
  var tabRef = useState('all');
  var tab = tabRef[0], setTab = tabRef[1];
  var counts = useMemo(function () { return tabCounts(notes.list); }, [notes.list]);
  var items = useMemo(function () { return notesByTab(notes.list, tab); }, [notes.list, tab]);
  var field = MS_TABS[tab];
  var groups = useMemo(function () { return field ? groupByMs(notes.list, field) : []; }, [notes.list, field]);
  var sw = useSwipeRows();
  function row(n, group) {
    var key = group + '\n' + n.id;
    return html`<${SwipeNote} key=${key} rowKey=${key} notes=${notes} note=${n} showTarget=${!group} showPin openId=${sw.openId} setOpenId=${sw.setOpenId} onError=${sw.setError} />`;
  }
  function pickTab(t) { setTab(t); sw.setOpenId(null); }
  var options = LIST_TABS.map(function (t) { return { value: t[0], label: t[1] + ' ' + counts[t[0]] }; });
  return html`<div class="note-list" data-ui="note-list">
    <div class="note-tabs-scroll"><${ToggleGroup} ui="note-tabs" label="表示するメモ" options=${options} value=${tab} onChange=${pickTab} /></div>
    ${sw.error && html`<${Notice} tone="error">${sw.error}</${Notice}>`}
    ${!items.length && html`<p class="note-empty">メモはまだありません</p>`}
    ${field
      ? groups.map(function (g) {
        return html`<section class="note-group" key=${g.ms}>
          <h3 class="note-group-head" data-ui="note-group">${g.ms}<span>${g.count}件</span></h3>
          ${g.notes.map(function (n) { return row(n, g.ms); })}
        </section>`;
      })
      : items.map(function (n) { return row(n, ''); })}
  </div>`;
}

// メモタブ。使えるとき(on)だけ書く・一覧を出す
export function NotesView({ notes, myMs }) {
  var on = notes.status === 'on';
  var body;
  if (on) body = html`<${NoteList} notes=${notes} />`;
  else if (notes.status === 'loading') body = html`<p class="note-empty">読み込み中…</p>`;
  else if (notes.status === 'error') body = html`<${Notice} tone="error" action=${{ label: 'もう一度読み込む', onClick: notes.reload }}>読み込めませんでした</${Notice}>`;
  else body = html`<${Notice}>ログイン状態を保持すると使えます</${Notice}>`;
  return html`<div data-ui="notes-view">
    <div class="notes-head"><h2>メモ</h2>${on && html`<${WriteButton} ui="note-write"
      onClick=${function () { notes.open(todayDraft('', myMs || '', new Date())); }} />`}</div>
    ${body}
  </div>`;
}

// ホームのピン留めの行。スワイプの開閉とエラーを持つ
function PinnedRows({ notes, list }) {
  var sw = useSwipeRows();
  return html`${sw.error && html`<${Notice} tone="error">${sw.error}</${Notice}>`}
    ${list.map(function (n) { return html`<${SwipeNote} key=${n.id} rowKey=${n.id} notes=${notes} note=${n} showTarget openId=${sw.openId} setOpenId=${sw.setOpenId} onError=${sw.setError} />`; })}`;
}

// ホーム最上部のピン留めしたメモ。メモが使えないときは何も描かない
export function PinnedNotes({ notes, myMs }) {
  if (!notes || notes.status !== 'on') return null;
  var write = html`<${WriteButton} ui="home-note-write"
    onClick=${function () { notes.open(homeDraft(notes.list, notes.limits, myMs || '', new Date())); }} />`;
  var list = pinnedNotes(notes.list, (notes.limits || {}).pinned_max);
  if (!list.length) {
    return html`<section class="note-pins-empty" data-ui="home-notes"><p>メモをピン留めすると、ここに出ます</p>${write}</section>`;
  }
  return html`<section class="note-pins" data-ui="home-notes">
    <div class="note-pins-head"><h2>ピン留めしたメモ</h2>${write}</div>
    <${PinnedRows} notes=${notes} list=${list} />
  </section>`;
}
