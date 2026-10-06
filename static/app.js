import { html, render } from './htm-preact-standalone.js';
import { loadMatchesFromDB, saveMatchesToDB, replaceMatchesForUser, needsRebuild } from './lib/db.js';
import { FOCUS_KEY } from './components/report/action-plan.js';
import { CLASS_RECORD_KEY, Report, Skeleton } from './components/report/report.js';
import { VIEW_KEY } from './components/shell.js';
import { diffAfterParam, shouldPull } from './lib/autorefresh.js';
import { createRunLock } from './lib/runlock.js';
import { navigationType, isStandalone, shouldReanalyzeOnReload } from './lib/launch.js';

// ホーム画面アプリのときだけ自前の引っ張り再分析を使う(ブラウザのタブは標準の再読み込みが再分析の経路)
var STANDALONE = isStandalone({ standalone: navigator.standalone, matchMedia: window.matchMedia ? function (q) { return window.matchMedia(q); } : null });
if (STANDALONE) document.documentElement.setAttribute('data-standalone', '');

// --- Constants ---
var STATUS_MESSAGES = {
  pending: '準備中...',
  refreshing: '最新データを取得中...',
  scraping: '戦績を取得中...（数分かかります）',
  analyzing: '分析中...',
  rebuilding: 'データを再取得中...',
  done: '完了',
  error: 'エラーが発生しました',
};

// 全件再構築に失敗したときの再試行抑止期間。サーバー異常や0件応答のたびに
// 毎起動で/matches(=Firestore全件読み取り)を叩き続けるのを防ぐ。
var REBUILD_BACKOFF_MS = 6 * 60 * 60 * 1000;
var REBUILD_BACKOFF_KEY = 'catalyzer_rebuild_backoff_until';

// 再読み込みでの再分析の連続起動を抑える。この端末で直近に分析を始めた/終えた時刻
var ANALYSIS_STARTED_KEY = 'catalyzer_analysis_started_at';
var ANALYSIS_FINISHED_KEY = 'catalyzer_analysis_finished_at';
function markAnalysis(key) {
  try { localStorage.setItem(key, String(Date.now())); } catch (e) {}
}
function readMark(key) {
  try { return localStorage.getItem(key); } catch (e) { return null; }
}

// 実行中の分析ジョブID。ログアウト時にこのジョブのスクレイピングを中断し、ポーリングを停止するために使う
var activeJobId = null;

// 分析の多重起動ロック。activeJobId は POST の応答後にしか入らないため、それより前の二重起動をここで防ぐ
var analysis = createRunLock();
function analysisBusy() { return analysis.busy() || activeJobId !== null; }

// 自動更新(サーバーが定期取得した試合)の取り込み。起動時と画面が前面に戻ったときに差分だけ取り、直近の取り込みから20秒は飛ばす
var lastPullAt = 0; // 取り込みを試みた時刻(間隔制御用)
var lastImportedAt = 0; // 差分を保存できた時刻(画面表示用)
var pulling = false;

function reAnalyze() {
  if (analysisBusy()) return;
  // セッション保持中はパスワード不要で再分析
  if (localStorage.getItem('catalyzer_has_session')) {
    window.scrollTo({ top: 0, behavior: 'smooth' });
    analysis.run(reanalyzeWithSession);
    return;
  }
  var u = document.getElementById('username');
  var p = document.getElementById('password');
  if (u && p && u.value && p.value) {
    window.scrollTo({ top: 0, behavior: 'smooth' });
    analysis.run(analyze);
    return;
  }
  var rep = document.getElementById('report');
  if (rep) rep.style.display = 'none';
  var lf = document.getElementById('loginForm');
  if (lf) lf.style.display = 'block';
  var t = document.getElementById('pageTitle');
  if (t) t.style.display = '';
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function reanalyzeWithSession(auto) {
  var status = document.getElementById('status');
  var statusText = document.getElementById('statusText');
  var error = document.getElementById('error');

  var cachedKey = localStorage.getItem('catalyzer_user_key');
  var usedCache = false;
  if (cachedKey) {
    try {
      var cachedMatches = await loadMatchesFromDB(cachedKey);
      if (cachedMatches && cachedMatches.length > 0) {
        renderReport({ matches: cachedMatches }, cachedKey);
        usedCache = true;
      }
    } catch (e) {}
  }
  if (!usedCache) showSkeleton();

  status.style.display = 'block';
  statusText.textContent = usedCache ? STATUS_MESSAGES.refreshing : STATUS_MESSAGES.pending;
  error.style.display = 'none';

  var lastPreliminaryVersion = 0;
  var posted = false; // POST を投げたら失敗しても終了を記録する(再読み込みごとの再分析を防ぐ)
  var busyNotice = false;

  try {
    posted = true;
    var res = await fetch('/reanalyze', { method: 'POST' });
    var data = await res.json();

    if (data.error) {
      // 再読み込みでの自動起動が lease 中の409になったときは、エラーにせず事実だけ短く出す
      if (auto && res.status === 409) {
        busyNotice = true;
        statusText.textContent = '自動更新で取得中のため、再分析は後で行えます';
        setTimeout(function () { status.style.display = 'none'; }, 4000);
        return;
      }
      if (res.status === 401) {
        returnToLogin();
        error.style.display = 'block';
        error.textContent = data.error;
        status.style.display = 'none';
        return;
      }
      throw new Error(data.error);
    }

    var jobId = data.id;
    activeJobId = jobId;
    markAnalysis(ANALYSIS_STARTED_KEY);

    while (true) {
      await new Promise(function (r) { setTimeout(r, 3000); });
      // ログアウト等でジョブが中断/切り替わった場合はポーリングを停止する
      if (activeJobId !== jobId) return;

      var statusRes = await fetch('/status/' + jobId);
      var statusData = await statusRes.json();

      if (statusData.error && statusData.status !== 'error') {
        throw new Error(statusData.error);
      }

      statusText.textContent = statusData.message || STATUS_MESSAGES[statusData.status] || statusData.status;

      var progressWrap = document.getElementById('progressWrap');
      var progressFill = document.getElementById('progressFill');
      if (statusData.progress_total > 0) {
        var p = Math.round(100 * statusData.progress / statusData.progress_total);
        progressFill.classList.remove('indeterminate');
        progressFill.style.width = p + '%';
        document.getElementById('progressPct').textContent = p + '%';
        document.getElementById('progressCount').textContent = statusData.progress + '/' + statusData.progress_total + '件';
        progressWrap.style.display = 'block';
      } else if (statusData.status === 'scraping') {
        progressFill.classList.add('indeterminate');
        document.getElementById('progressPct').textContent = '戦歴を検索中…';
        document.getElementById('progressCount').textContent = statusData.progress ? statusData.progress + '件' : '';
        progressWrap.style.display = 'block';
      } else {
        progressFill.classList.remove('indeterminate');
        progressWrap.style.display = 'none';
      }

      if (statusData.logged_in && statusData.has_preliminary_report && statusData.preliminary_version > lastPreliminaryVersion) {
        var prelimRes = await fetch('/result/' + jobId);
        var prelimData = await prelimRes.json();
        // fetch中にログアウトした場合、古いレポート描画やIndexedDB再作成を防ぐ
        if (activeJobId !== jobId) return;
        if (prelimData.matches && prelimData.preliminary) {
          if (prelimData.user_key) {
            saveMatchesToDB(prelimData.user_key, prelimData.matches, prelimData.schema_version);
          }
          renderReport({ matches: prelimData.matches }, prelimData.user_key);
          statusText.textContent = STATUS_MESSAGES.refreshing;
          lastPreliminaryVersion = statusData.preliminary_version;
        }
      }

      if (statusData.status === 'cancelled') return;

      if (statusData.status === 'error') {
        if (statusData.error && statusData.error.indexOf('セッション') >= 0) returnToLogin();
        throw new Error(statusData.error || '分析に失敗しました');
      }

      if (statusData.status === 'done') {
        var resultRes = await fetch('/result/' + jobId);
        var resultData = await resultRes.json();
        // fetch中にログアウトした場合、古いレポート描画やIndexedDB再作成を防ぐ
        if (activeJobId !== jobId) return;
        if (resultData.error) throw new Error(resultData.error);
        if (resultData.user_key && resultData.matches) {
          await saveMatchesToDB(resultData.user_key, resultData.matches, resultData.schema_version);
        }
        clearRebuildError();
        renderReport({ matches: resultData.matches, class_record: resultData.class_record, tag_partners: resultData.tag_partners }, resultData.user_key);
        break;
      }
    }
  } catch (e) {
    error.style.display = 'block';
    error.textContent = e.message;
  } finally {
    if (posted && (jobId === undefined || activeJobId === jobId)) {
      activeJobId = null;
      markAnalysis(ANALYSIS_FINISHED_KEY);
    }
    if (!busyNotice) status.style.display = 'none';
  }
}

async function logout() {
  // 実行中の分析ジョブがあればスクレイピングを中断し、ポーリングを停止する
  var jid = activeJobId;
  activeJobId = null;
  analysis.release();
  // キャンセルは撃ちっぱなし（await しない）。/cancel が詰まってもセッション削除・UIリセットを止めない
  if (jid) {
    try { fetch('/cancel/' + jid, { method: 'POST' }).catch(function () {}); } catch (e) {}
  }
  try {
    await fetch('/session', { method: 'DELETE' });
  } catch (e) {}
  localStorage.removeItem('catalyzer_user_key');
  localStorage.removeItem('catalyzer_has_session');
  localStorage.removeItem(ANALYSIS_STARTED_KEY);
  localStorage.removeItem(ANALYSIS_FINISHED_KEY);
  localStorage.removeItem(CLASS_RECORD_KEY);
  localStorage.removeItem(FOCUS_KEY);
  localStorage.removeItem(VIEW_KEY);
  try { sessionStorage.removeItem('catalyzer_cred'); } catch (e) {}

  var rep = document.getElementById('report');
  if (rep) { render(null, rep); rep.style.display = 'none'; }
  var lf = document.getElementById('loginForm');
  if (lf) lf.style.display = 'block';
  var t = document.getElementById('pageTitle');
  if (t) t.style.display = '';
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// 自動更新の設定 API。通信失敗は status 0。合言葉は本文だけで送り、URL・ログ・storage に載せない
async function autoRefreshCall(method, body) {
  try {
    var res = await fetch('/auto-refresh', {
      method: method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    var data = null;
    try { data = await res.json(); } catch (e) {}
    return { status: res.status, body: data };
  } catch (e) {
    return { status: 0, body: null };
  }
}

var AUTO_REFRESH_ACTIONS = {
  lastImportedAt: function () { return lastImportedAt; },
  load: function () { return autoRefreshCall('GET'); },
  set: function (enabled, passphrase) { return autoRefreshCall('POST', enabled ? { enabled: true, passphrase: passphrase } : { enabled: false }); },
};

// report/ は app.js を import できない(循環)ため、操作は props で渡す
var REPORT_ACTIONS = { onReanalyze: reAnalyze, canReanalyze: function () { return !analysisBusy(); }, pullEnabled: STANDALONE, onLogout: logout, onRebuildCache: rebuildCache, autoRefresh: AUTO_REFRESH_ACTIONS };

function showSkeleton() {
  var reportEl = document.getElementById('report');
  reportEl.style.display = 'block';
  var pageTitle = document.getElementById('pageTitle');
  if (pageTitle) pageTitle.style.display = 'none';
  render(html`<${Skeleton} actions=${REPORT_ACTIONS} />`, reportEl);
}

function renderReport(data, userKey) {
  var reportEl = document.getElementById('report');
  reportEl.style.display = 'block';
  var pageTitle = document.getElementById('pageTitle');
  if (pageTitle) pageTitle.style.display = 'none';
  // userKey が変わったら再マウントし、前ユーザーの allMatches 等の state を持ち越さない(#402)
  render(html`<${Report} key=${userKey} data=${data} userKey=${userKey} actions=${REPORT_ACTIONS} />`, reportEl);

  try {
    if (userKey) localStorage.setItem('catalyzer_user_key', userKey);
  } catch (e) {}
}

// 再構築のバックオフ期限を読み書きする。localStorageが使えない環境では
// 抑止を諦めて通常どおり再構築を試みる（機能自体は動く方に倒す）。
function rebuildBackoffActive() {
  try {
    var until = parseInt(localStorage.getItem(REBUILD_BACKOFF_KEY), 10);
    return until > Date.now();
  } catch (e) {
    return false;
  }
}

function setRebuildBackoff(active) {
  try {
    if (active) localStorage.setItem(REBUILD_BACKOFF_KEY, String(Date.now() + REBUILD_BACKOFF_MS));
    else localStorage.removeItem(REBUILD_BACKOFF_KEY);
  } catch (e) {}
}

// セッション失効時にログイン画面へ戻す。pageTitle(ロゴ)を復帰させ、その safe-area で上端の被りを防ぐ
function returnToLogin() {
  localStorage.removeItem('catalyzer_user_key');
  localStorage.removeItem('catalyzer_has_session');
  var rep = document.getElementById('report');
  if (rep) { render(null, rep); rep.style.display = 'none'; }
  var lf = document.getElementById('loginForm');
  if (lf) lf.style.display = 'block';
  var t = document.getElementById('pageTitle');
  if (t) t.style.display = '';
}

// 分析中・ユーザーが替わったら IndexedDB への反映を見送る(全件の再構築と自動更新の取り込みで共通)
function rebuildStale(userKey) {
  var current = null;
  try { current = localStorage.getItem('catalyzer_user_key'); } catch (e) {}
  return activeJobId !== null || current !== userKey;
}

// IndexedDB を /matches の全件で置き換える。成功で true、失敗・0件は false、セッション無しは 'unauthorized'(いずれもバックオフ)、反映を見送ったら null
async function rebuildCacheFromServer(userKey) {
  if (rebuildStale(userKey)) return null;
  var statusText = document.getElementById('statusText');
  var status = document.getElementById('status');
  // 分析ポーリング等が既にステータスを出している場合は横取りしない（終了時にも消さない）。
  var ownsStatus = !!(status && statusText && status.style.display === 'none');
  if (ownsStatus) {
    status.style.display = 'block';
    statusText.textContent = STATUS_MESSAGES.rebuilding;
  }
  try {
    var res = await fetch('/matches');
    // ログイン状態を保持していない(セッションが無い)と本人の全件は取れない
    if (res.status === 401) {
      setRebuildBackoff(true);
      return 'unauthorized';
    }
    var data = await res.json();
    // 空配列(0件)はサーバー側の異常応答の可能性があるため再構築せず既存キャッシュを温存する
    if (!res.ok || !data.matches || !data.matches.length) {
      setRebuildBackoff(true);
      return false;
    }
    if (rebuildStale(userKey)) return null;
    // Cookie の本人がローカルのユーザーと違う(ログアウトを経ない再ログインの残り)=本人のセッションが無い
    if (data.user_key !== userKey) {
      setRebuildBackoff(true);
      return 'unauthorized';
    }
    await replaceMatchesForUser(userKey, data.matches, data.schema_version);
    setRebuildBackoff(false);
    renderReport({ matches: data.matches }, userKey);
    return true;
  } catch (e) {
    setRebuildBackoff(true);
    throw e;
  } finally {
    if (ownsStatus) status.style.display = 'none';
  }
}

// その他画面の「試合データを取得し直す」から呼ばれる明示操作版。確認は画面内で済んでいる。
// 明示操作なのでバックオフ中でも実行し、失敗はエラー表示でユーザーに伝える。
var rebuildingCache = false;
async function rebuildCache() {
  // 画面内確認は再タップできるため、実行中の二重起動を防ぐ
  if (rebuildingCache) return;
  var userKey = null;
  try { userKey = localStorage.getItem('catalyzer_user_key'); } catch (e) {}
  var error = document.getElementById('error');
  // ユーザーキーが無い(初回分析中・セッション失効)。既に出ている失効メッセージは上書きしない
  if (!userKey) {
    if (!error || error.style.display !== 'block') showRebuildError(error, '分析が終わってから実行してください。');
    return;
  }

  if (error) error.style.display = 'none';
  var rebuilt = false;
  rebuildingCache = true;
  try {
    rebuilt = await rebuildCacheFromServer(userKey);
  } catch (e) {
  } finally {
    rebuildingCache = false;
  }
  // 見送りの理由がログアウト(キー消失)なら案内しない
  if (rebuilt === null) { if (localStorage.getItem('catalyzer_user_key')) showRebuildError(error, '分析が終わってから実行してください。'); }
  else if (rebuilt === 'unauthorized') showRebuildError(error, 'ログイン状態を保持していないため取得し直せません。再分析してください。');
  else if (!rebuilt) showRebuildError(error, '試合データの再取得に失敗しました。時間をおいて再度お試しください。');
}

function showRebuildError(error, message) {
  if (!error) return;
  error.dataset.source = 'rebuild';
  // #error は partial 警告(黄色)と共有のため、赤系エラー表示前にインラインスタイルを戻す。
  error.style.backgroundColor = '';
  error.style.borderColor = '';
  error.style.color = '';
  error.textContent = message;
  error.style.display = 'block';
}

// 分析完了時、再取得由来の表示だけを消す(partial 警告などは各経路が上書きする)
function clearRebuildError() {
  var error = document.getElementById('error');
  if (error && error.dataset.source === 'rebuild') { error.style.display = 'none'; delete error.dataset.source; }
}

async function analyze() {
  var username = document.getElementById('username').value;
  var password = document.getElementById('password').value;
  var btn = document.getElementById('analyzeBtn');
  var status = document.getElementById('status');
  var statusText = document.getElementById('statusText');
  var error = document.getElementById('error');
  var reportEl = document.getElementById('report');

  if (!username || !password) {
    error.style.display = 'block';
    error.textContent = 'メールアドレスとパスワードを入力してください。';
    return;
  }

  try { sessionStorage.setItem('catalyzer_cred', JSON.stringify({ u: username, p: password })); } catch (e) {}

  btn.disabled = true;
  status.style.display = 'block';
  statusText.textContent = STATUS_MESSAGES.pending;
  error.style.display = 'none';
  error.style.backgroundColor = '';
  error.style.borderColor = '';
  error.style.color = '';
  reportEl.style.display = 'none';
  render(null, reportEl);

  var pageTitle = document.getElementById('pageTitle');
  if (pageTitle) pageTitle.style.display = '';

  document.getElementById('loginForm').style.display = 'none';
  var lastPreliminaryVersion = 0;
  var renderedReal = false;

  var cachedKey = localStorage.getItem('catalyzer_user_key');
  var usedCache = false;
  if (cachedKey) {
    try {
      var cachedMatches = await loadMatchesFromDB(cachedKey);
      if (cachedMatches && cachedMatches.length > 0) {
        renderReport({ matches: cachedMatches }, cachedKey);
        statusText.textContent = STATUS_MESSAGES.refreshing;
        usedCache = true;
      }
    } catch (e) {}
  }
  if (!usedCache) showSkeleton();

  try {
    var rememberEl = document.getElementById('remember');
    var remember = rememberEl ? rememberEl.checked : false;

    var res = await fetch('/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: username, password: password, remember: remember }),
    });

    var data = await res.json();
    if (data.error) {
      throw new Error(data.error);
    }

    var jobId = data.id;
    activeJobId = jobId;
    markAnalysis(ANALYSIS_STARTED_KEY);

    while (true) {
      await new Promise(function (r) { setTimeout(r, 3000); });
      // ログアウト等でジョブが中断/切り替わった場合はポーリングを停止する
      if (activeJobId !== jobId) return;

      var statusRes = await fetch('/status/' + jobId);
      var statusData = await statusRes.json();

      if (statusData.error && statusData.status !== 'error') {
        throw new Error(statusData.error);
      }

      statusText.textContent = statusData.message || STATUS_MESSAGES[statusData.status] || statusData.status;

      var progressWrap = document.getElementById('progressWrap');
      var progressFill = document.getElementById('progressFill');
      var isScraping = statusData.status === 'scraping';
      if (statusData.progress_total > 0) {
        var p = Math.round(100 * statusData.progress / statusData.progress_total);
        progressFill.classList.remove('indeterminate');
        progressFill.style.width = p + '%';
        document.getElementById('progressPct').textContent = p + '%';
        document.getElementById('progressCount').textContent = statusData.progress + '/' + statusData.progress_total + '件';
        progressWrap.style.display = 'block';
      } else if (isScraping) {
        progressFill.classList.add('indeterminate');
        document.getElementById('progressPct').textContent = '戦歴を検索中…';
        document.getElementById('progressCount').textContent = statusData.progress ? statusData.progress + '件' : '';
        progressWrap.style.display = 'block';
      } else {
        progressFill.classList.remove('indeterminate');
        progressWrap.style.display = 'none';
      }

      if (statusData.logged_in && statusData.has_preliminary_report && statusData.preliminary_version > lastPreliminaryVersion) {
        var prelimRes = await fetch('/result/' + jobId);
        var prelimData = await prelimRes.json();
        // fetch中にログアウトした場合、古いレポート描画やIndexedDB再作成を防ぐ
        if (activeJobId !== jobId) return;
        if (prelimData.matches && prelimData.preliminary) {
          if (prelimData.user_key) {
            saveMatchesToDB(prelimData.user_key, prelimData.matches, prelimData.schema_version);
          }
          renderReport({ matches: prelimData.matches }, prelimData.user_key);
          renderedReal = true;
          statusText.textContent = STATUS_MESSAGES.refreshing;
          lastPreliminaryVersion = statusData.preliminary_version;
        }
      }

      if (statusData.status === 'cancelled') return;

      if (statusData.status === 'error') {
        throw new Error(statusData.error || '分析に失敗しました');
      }

      if (statusData.status === 'done') {
        var resultRes = await fetch('/result/' + jobId);
        var resultData = await resultRes.json();
        // fetch中にログアウトした場合、古いレポート描画やIndexedDB再作成を防ぐ
        if (activeJobId !== jobId) return;

        if (resultData.error) {
          throw new Error(resultData.error);
        }

        if (resultData.user_key && resultData.matches) {
          await saveMatchesToDB(resultData.user_key, resultData.matches, resultData.schema_version);
        }
        clearRebuildError();
        renderReport({ matches: resultData.matches, class_record: resultData.class_record, tag_partners: resultData.tag_partners }, resultData.user_key);
        renderedReal = true;
        if (resultData.session_saved) {
          try { localStorage.setItem('catalyzer_has_session', '1'); } catch (e) {}
        }
        if (resultData.partial) {
          var warning = document.getElementById('error');
          warning.style.display = 'block';
          warning.style.backgroundColor = 'var(--warn-bg)';
          warning.style.borderColor = 'var(--warn-border)';
          warning.style.color = 'var(--warn-text)';
          warning.textContent = 'ガンダムモバイルからアクセスが制限されたため、一部のデータのみで分析しています。時間をおいて再度実行すると続きから取得します。';
        }
        break;
      }
    }
  } catch (e) {
    error.style.display = 'block';
    error.textContent = e.message;
    if (!renderedReal) {
      render(null, reportEl);
      reportEl.style.display = 'none';
      if (pageTitle) pageTitle.style.display = '';
    }
    document.getElementById('loginForm').style.display = 'block';
  } finally {
    if (activeJobId === jobId) {
      activeJobId = null;
      markAnalysis(ANALYSIS_FINISHED_KEY);
    }
    btn.disabled = false;
    status.style.display = 'none';
  }
}

var loginForm = document.getElementById('loginForm');
if (loginForm) {
  loginForm.addEventListener('submit', function (e) {
    e.preventDefault();
    analysis.run(analyze);
  });
  try {
    var cred = JSON.parse(sessionStorage.getItem('catalyzer_cred'));
    if (cred) {
      document.getElementById('username').value = cred.u;
      document.getElementById('password').value = cred.p;
    }
  } catch (e) {}
}

// セッション保持の説明モーダル
var rememberInfoBtn = document.getElementById('rememberInfoBtn');
var rememberModal = document.getElementById('rememberModal');
var rememberModalClose = document.getElementById('rememberModalClose');
if (rememberInfoBtn && rememberModal) {
  rememberInfoBtn.addEventListener('click', function (e) {
    e.preventDefault();
    rememberModal.style.display = 'flex';
  });
  rememberModal.addEventListener('click', function (e) {
    if (e.target === rememberModal) rememberModal.style.display = 'none';
  });
  if (rememberModalClose) {
    rememberModalClose.addEventListener('click', function () {
      rememberModal.style.display = 'none';
    });
  }
}

// ページロード時: IndexedDBにmatchesがあれば即時表示
(async function initSession() {
  var cachedUserKey = null;
  var hasSession = false;
  try {
    cachedUserKey = localStorage.getItem('catalyzer_user_key');
    hasSession = !!localStorage.getItem('catalyzer_has_session');
  } catch (e) {}

  var reloadRun = hasSession && shouldReanalyzeOnReload({
    navType: navigationType(performance.getEntriesByType ? performance.getEntriesByType('navigation') : [], performance.navigation ? performance.navigation.type : undefined),
    hasSession: true, now: Date.now(), startedAt: readMark(ANALYSIS_STARTED_KEY), finishedAt: readMark(ANALYSIS_FINISHED_KEY),
  });

  var renderedFromCache = false;
  if (cachedUserKey) {
    try {
      var cachedMatches = await loadMatchesFromDB(cachedUserKey);
      if (cachedMatches && cachedMatches.length > 0) {
        renderReport({ matches: cachedMatches }, cachedUserKey);
        renderedFromCache = true;
      }
    } catch (e) {}
  }

  // キャッシュのスキーマバージョンをサーバーの現行版と非ブロッキングで照合し、
  // 不一致なら（Firestore再構築のみの）全件再取得でキャッシュを作り直す。
  // 一致時は/matchesを叩かない。取得不能(サーバー未応答等)なら判定不能として何もしない。
  // 直近の再構築が失敗している間は/schema-version(Firestore非アクセス)の照合だけ行い、
  // /matchesの再試行はバックオフ期限まで見送る。
  if (renderedFromCache) {
    fetch('/schema-version').then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        if (!d) return;
        if (!needsRebuild(cachedMatches, d.schema_version)) return;
        if (rebuildBackoffActive()) return;
        // 自動実行なので失敗は黙って見送る（明示の再取得はその他画面から）
        rebuildCacheFromServer(cachedUserKey).catch(function () {});
      })
      .catch(function () {});
  }

  // キャッシュからレポートを表示したらログイン画面を隠す。
  // セッション有無に関わらず、レポートの上にログイン画面が残るのを防ぐ
  // （ログインが必要な場合は引っ張り・その他の再分析経由で reAnalyze が再表示する）。
  if (renderedFromCache && loginForm) loginForm.style.display = 'none';

  if (hasSession && !reloadRun) pullAutoRefresh();

  if (hasSession) {
    if (loginForm) loginForm.style.display = 'none';
    var hasLocalData = renderedFromCache;

    fetch('/session').then(function (r) { return r.json(); }).then(function (data) {
      if (!data.valid) {
        // セッション失効時は、キャッシュから描画済みのレポートを隠さないと
        // ログイン画面の下に古いレポートが残る（reanalyzeWithSession の401経路と同じ後始末）。
        localStorage.removeItem('catalyzer_has_session');
        var rep = document.getElementById('report');
        if (rep) { render(null, rep); rep.style.display = 'none'; }
        if (loginForm) loginForm.style.display = 'block';
        var t = document.getElementById('pageTitle');
        if (t) t.style.display = '';
      } else if (!hasLocalData || reloadRun) {
        analysis.run(function () { return reanalyzeWithSession(true); });
      }
    }).catch(function () {
      if (loginForm) loginForm.style.display = 'block';
    });
  }
})();

function currentUserKey() {
  try { return localStorage.getItem('catalyzer_user_key'); } catch (e) { return null; }
}

async function pullAutoRefresh() {
  var userKey = currentUserKey();
  var hasSession = false;
  try { hasSession = !!localStorage.getItem('catalyzer_has_session'); } catch (e) {}
  if (!userKey || !hasSession) return;
  if (!shouldPull({ now: Date.now(), lastPullAt: lastPullAt, activeJobId: activeJobId, pulling: pulling })) return;
  pulling = true;
  lastPullAt = Date.now();
  try {
    // touch でサーバー側の自動更新の継続時間を延ばす。401 はセッションが無いので差分取得もしない
    var touch = await fetch('/auto-refresh/touch', { method: 'POST' });
    if (touch.status === 401) return;
    var after = diffAfterParam(await loadMatchesFromDB(userKey));
    if (!after) return;
    var res = await fetch('/matches?after=' + encodeURIComponent(after));
    if (!res.ok) return;
    var data = await res.json();
    if (data.user_key !== userKey || !data.matches || !data.matches.length) return;
    if (rebuildStale(userKey)) return;
    await saveMatchesToDB(userKey, data.matches, data.schema_version);
    lastImportedAt = Date.now();
    if (rebuildStale(userKey)) return;
    renderReport({ matches: await loadMatchesFromDB(userKey) }, userKey);
  } catch (e) {
    // 自動実行なので失敗は見送る(次の起動・前面復帰で再試行)
  } finally {
    pulling = false;
  }
}

document.addEventListener('visibilitychange', function () {
  if (document.visibilityState === 'visible') pullAutoRefresh();
});

// preview.html用: windowにrenderReportを公開
window.renderReport = renderReport;
