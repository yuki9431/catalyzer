# 設計: 上部バーを減らす 再分析の起動をハイブリッド化・スクロール中は絞り込み行を隠す

- ステータス: implemented(改訂 r2: 再分析の起動をハイブリッドに変更。差分は §11)
- 日付: 2026-10-05
- 関連 issue: #363(#413 の「スクロールで隠さない」をオーナー判断で変更)。基線: afc9aa5
- 参考モック: 2b・3b・4b(ロゴ位置は下記の決定が優先)

## 0. 決定事項(オーナー確定)と残りの既定値
確定(r1 から不変)
- ロゴは「その他」画面の先頭だけ。レポート・試合検索・総合戦歴には出さない。ログイン画面のロゴ(`h1#pageTitle`)は現状維持。`.topbar-head` は廃止。空になる試合検索・総合戦歴・その他の上部バーは出さない(高さ0)
- 下スクロール中は絞り込み行を隠し、上に少し戻すと出す。タブ行は隠さない。固定高さ 120px 以下(タブバー込み)。隠れた状態で `.topbar::before` の帯を残さない
- 「その他」に再分析の入口を残す

確定(r2 で変更: 再分析の起動はハイブリッド)
1. **再読み込みで開いたときだけ**(Navigation Timing の type が `reload`)、ログイン状態を保持していれば既存の再分析(`reanalyzeWithSession`)を起動する。通常の遷移・ホーム画面アイコン・リンクでは起動しない。スマホのブラウザ標準の引っ張り再読み込みがこの経路になる
2. **ホーム画面に追加したアプリのときだけ**自前の「引っ張って再分析」を動かす(表示・しきい値・案内・分析中は受け付けない、は r1 のまま)。ブラウザのタブでは動かさない(標準の再読み込みと二重になる)。`overscroll-behavior` と `preventDefault` もホーム画面アプリのときだけ
3. **広い画面では絞り込み行の右端に「再分析」ボタン**。スマホ幅では置かない

既定値(停止不要。事後確認を推奨)
| 論点 | 採用 | 理由・影響 |
|---|---|---|
| 再読み込みの連続起動の抑止 | この端末で直近に始めた分析が終わっていなければ開始から10分、終わっていれば終了から60秒は、再読み込みで起動しない(§3「再読み込みの抑止」) | サーバーはユーザーごとの lease(`acquireManualLease`)で同時の取得を 409 にするので、重複取得はサーバー側でも防がれる。ただし 409 の文言は「自動更新で取得中」で、実行中の分析を再読み込みで切り離した場合は誤った案内になる。60秒: 1試合は数分かかり、1分以内に新しい試合はまず無い。10分: 初回の全件取得が5〜10分(ログイン画面の案内)。#288 の `lastImportedAt` はメモリ上の値で再読み込みで消え、Firestore からの差分の取り込みであって公式サイトの取得ではないので使わない |
| 抑止したとき | 起動時の差分取り込み(`pullAutoRefresh`)を従来どおり行う | 切り離された分析の結果は Firestore に入るので、差分取り込みで画面に出る |
| 再読み込みで起動するとき | 起動時の差分取り込みは行わない | 再分析が最新を取るので、Firestore の読み取りを1回減らせる |
| ホーム画面アプリの判定 | `navigator.standalone === true` または `matchMedia('(display-mode: standalone)').matches`(manifest の `display` は `standalone`)。JS で1回だけ判定し、`html[data-standalone]` 属性で CSS に渡す | iOS と Android の両方を1か所で判定できる。CSS の `@media (display-mode)` を別に持つと判定元が2つになり、ui-check で同じ状態を作れない |
| 再分析ボタンを出す条件 | 幅が `max-width: 720px` でないとき(CSS は `not all and (max-width: 720px)`。隠す CSS の境界 720px・`SHEET_MAX_WIDTH` と同じで、小数幅でも隙間が出ない) | 「ポインタが細かい/ホバー可能」も検討した。ui-check は `mobile:false` でタッチを模擬しないため、390px 幅の画面でも `pointer:fine` に一致してボタンが出てしまう。また広い画面のタッチ端末(タブレット・スマホ横向き)では隠す動作がないので、ボタンがあっても邪魔にならない。幅 720px 以下のマウス利用者には出ないが、再読み込みとその他画面で再分析できる |
| 試合検索・総合戦歴 | 引っ張り・ボタンとも無し(r1 と同じ) | 再読み込みとその他画面で再分析できる |
| 隠している間の範囲表示 | 既存の本文先頭 `.report-scope` で足りる(r1 と同じ) | バーに常時出すと 120px を超える |

## 1. 方針
- 上部バーは「絞り込み行+タブ行」を持つ1つの sticky 要素のまま、`.topbar-head` を撤去する
- 隠す仕組み: **sticky の `top` を負にするだけで、高さ・margin を変えない**。旧実装(67018e9〜1c6218f)は行の高さを縮めたため文書高が変わり scrollY が振動した。今回は文書高が不変なので、判定の入力(scrollY)が表示状態に依存せず、構造上振動しない
  - `transform` は不可(topbar.css:9-10 の注記のとおり、子孫の fixed シートの包含ブロックが変わる)。`max-height`・`margin` も不可(文書高が変わる)
  - 隠れた状態: `top: calc(env(safe-area-inset-top) - タブ行のバー内位置)` → タブ行の上端が画面上端(safe-area の直下)に付く。絞り込み行は `visibility:hidden`(レイアウトは保つ)
- **帯を出さない構造**: 3b の帯は、タブ行の上に上部バー自身の背景と `::before` のぼかしが残ることで出る。今回は (1) 上部バーの背景色 `--bg-a82` を要素本体から `::before` へ移し(見た目は同じ)、(2) 隠れた状態では `::before` の上端を「タブ行の位置 − safe-area」まで下げる。これで画面上の背景は「safe-area(ステータスバー)+タブ行〜バー下端」だけになり、safe-area 0 ではタブ行より上に何も塗らない。ui-check で帯の高さ 0px を数値検査する
- 判定はすべて純粋関数(`static/lib/topbar.js`)。DOM の読み取り・イベント登録は shell.js のフック/部品に閉じる
  - 旧実装の失敗(report.js 内の `useEffect([])` が `.controls-row` の style を直書きし、Skeleton⇔Report 切替で参照が切れる)を繰り返さない: 状態は Preact の state、描画は属性 `data-collapsed`。登録は AppShell の `useLayoutEffect([collapsible])` で、AppShell の再マウント(Skeleton→Report)と同一インスタンス内の画面切替(レポート→試合検索)の両方で登録・解除される
- 再分析の起動は3経路+その他画面。判定はすべて純粋関数(`static/lib/launch.js`)
  - ブラウザのタブ: 再読み込みで開いた起動時に `shouldReanalyzeOnReload` が真なら `analysis.run(reanalyzeWithSession)`。標準の引っ張り再読み込みはそのまま使う
  - ホーム画面アプリ: 自前の引っ張り(`PullToRefresh`)。`REPORT_ACTIONS.pullEnabled`(起動時に判定した定数)が真のときだけ Report が `onPull` を渡す
  - 広い画面: 絞り込み行の右端の「再分析」ボタン(全幅で描き、CSS で 721px 以上だけ表示)
- 引っ張り(ホーム画面アプリのみ): `document` に touchstart(passive)/touchmove(**passive:false**)/touchend/touchcancel。純粋関数が `prevent` を返したときだけ `preventDefault`(ページ最上部で下向きが優勢な移動のみ)。離したとき `distance >= しきい値` なら `onPull()`。ブラウザのタブでは `PullToRefresh` 自体を描かないのでリスナも登録されない
  - 表示はモック 4b のとおり上部バーの上に差し込む(本文が下がる)。引っ張り中だけ描き、高さ = distance
- 上端の伸び・標準の引っ張り更新の抑止: `html[data-standalone]:has(.view-root){overscroll-behavior-y:contain}`(ホーム画面アプリのアプリ画面だけ)。ブラウザのタブでは何も止めない(標準の再読み込みが再分析の経路なので)
- 分析中は受け付けない(引っ張り・ボタン・その他・再読み込みの全経路): app.js に多重起動ロック(`static/lib/runlock.js`)を置き、`reAnalyze` 冒頭のガードと `REPORT_ACTIONS.canReanalyze` が同じ判定 `analysisBusy()` を使う。`activeJobId` は POST の応答後にしか入らないため、それより前の二重起動はロックで防ぐ
- その他画面の「データ」先頭の「再分析」行は r1 のまま(押すとレポート画面へ移ってから `onReanalyze()`)
- 既存設計との整合
  - surface.test.js の「report.js に scroll リスナと `.style.maxHeight` が無い」は維持。新たに「scroll リスナは static 全体で shell.js の1か所だけ」「`.style.maxHeight` はどこにも無い」を足す
  - report-summary 設計書 C8(`topbarRef` が report.js・shell.js に0件)は維持。ref 名は `barRef`/`tabsRef`
  - #413 の「スクロールで隠さない」・#412 の「再分析ボタンは上部バーのまま、その他には出さない」は本設計で置き換える(両設計書に後続の1行を追記)

## 2. 変更予定ファイル
新規
- `static/lib/topbar.js` — `PULL`/`PULL_IDLE`/`pullStep`/`pullReady`/`BAR`/`BAR_SHOWN`/`nextBar`(純粋関数のみ。import なし)
- `static/lib/runlock.js` — `createRunLock`
- `static/lib/launch.js`(r2)— `navigationType`/`isStandalone`/`RELOAD_GUARD`/`shouldReanalyzeOnReload`(純粋関数のみ。import なし)
- `static/__tests__/topbar.test.js`、`static/__tests__/runlock.test.js`、`static/__tests__/launch.test.js`(r2)
- `tools/ui-check/baseline/{mobile-report-scroll-up,mobile-pull,mobile-pull-release,more-reanalyze,mobile-pull-browser,report-reanalyze}-{dark,light}.png`

変更
- `static/components/shell.js`: AppShell の props を `{filters, tabs, onPull, canPull, nav, children}` に(`onRefresh`・`controls` 廃止)。brand・`.topbar-head` 撤去。絞り込みもタブも無い画面は `topbar topbar-bare`。タブを `div.topbar-tabs`(ref)で包む。`useCollapsingBar`・`PullToRefresh` 追加。MoreView に `onReanalyze`、先頭ロゴ `div.more-brand[data-ui=more-brand]`、データの先頭行「再分析」
- `static/components/report/report.js`: `controls` を `filters`(controls-row)と `tabs`(tablist)の2変数に分割(Report・Skeleton)。AppShell 6か所・MoreView 2か所の呼び出しを §3 のとおり変更
- `static/app.js`: `createRunLock` の import、`analysis`・`analysisBusy()`、`reAnalyze` 冒頭ガード、分析開始4か所を `analysis.run(...)` 経由に、`logout()` で `analysis.release()`、`REPORT_ACTIONS.canReanalyze`。:614 のコメント「再分析ボタン経由」→「引っ張り・その他の再分析経由」
- `static/styles/topbar.css`: `.topbar` の `background` を `::before` へ移す。`.topbar .brand`・`.topbar .brand img`・`.topbar-head`・`.topbar-refresh`(:hover 含む)削除。`.topbar-tabs`・`.topbar.topbar-bare`・隠れた状態の media 規則を追加(§3)
- `static/styles/responsive.css`: `.topbar .brand` の行(:11)削除
- `static/styles/shell.css`: `html:has(.view-root)` の overscroll、`.pull-zone`/`.pull-icon`、`.more-brand`
- `static/__tests__/skeleton-actions.test.js`(+2)、`static/__tests__/surface.test.js`(+1、既存1件は名前だけ更新)
- `tools/ui-check/check.js`: 操作 `scrollBy`・`pull`、画面の `outview`・`fixedMax`(固定高さと帯の検査)、`pull` を含む画面のタッチエミュレーション、OK 行への付記
- `tools/ui-check/screens.js`: 先頭コメント、mobile-report-overview の書き換え、more/mobile-more の必須要素追加、新4画面
- `tools/ui-check/screens.test.js`: selectors() に outview、規約テストの書き換え・追加
- `tools/ui-check/baseline/*.png`: AppShell を使う既存20画面×2(§7 の想定リスト)
- `CLAUDE.md`・`README.md`(§5 C18・C19)
- `docs/design/2026-10-05-report-summary.md`・`docs/design/2026-10-04-bottom-tabbar.md`: ステータス行の下に `- 後続: #363 で上部バーを変更(スクロールで絞り込み行を隠す・再分析は引っ張りとその他画面へ)(2026-10-05-pull-to-refresh.md)` の1行のみ

触らない: Go 全般、`index.html`、`tools/ui-check/server.js`(既存モックで足りる)、`popover.js`

## 3. インターフェース
```js
// static/lib/topbar.js — 上部バーの純粋ロジック(引っ張り再分析・絞り込み行の隠す/出す)
export var PULL = { slop: 8, resist: 0.5, threshold: 64, max: 96 }; // 指の移動 128px でしきい値
export var PULL_IDLE = { phase: 'idle', startX: 0, startY: 0, distance: 0 };
// ev: {type:'start',x,y,scrollY,enabled} | {type:'move',x,y,scrollY} | {type:'end'} | {type:'cancel'}
export function pullStep(state, ev) // → { state, fire: boolean, prevent: boolean }
export function pullReady(state)    // state.phase === 'pulling' && state.distance >= PULL.threshold
export var BAR = { hideAfter: 24, showAfter: 16 };
export var BAR_SHOWN = { hidden: false, anchor: 0 };
export function nextBar(prev, y, limits) // limits: {top, max} → { hidden, anchor }

// static/lib/runlock.js
export function createRunLock() // → { busy(): boolean, run(fn): Promise<boolean>, release(): void }
//  run: busy なら fn を呼ばず false。token を置いて await fn()、finally で自分の token のときだけ解放。fn の reject はそのまま伝播
//  release: 実行中でも即解放(ログアウト用)。古い run の finally は新しい run を解放しない

// static/components/shell.js
export function AppShell({ filters, tabs, onPull, canPull, nav, children })
export function MoreView({ shareData, onLogout, onRebuildCache, onReanalyze, autoRefresh })
function useCollapsingBar(enabled) // → { barRef, tabsRef, collapsed, shift }(非 export)
function PullToRefresh({ onPull, canPull }) // 非 export。引っ張り中だけ差し込み領域を描く

// static/app.js
var analysis = createRunLock();
function analysisBusy() { return analysis.busy() || activeJobId !== null; }
var REPORT_ACTIONS = { onReanalyze: reAnalyze, canReanalyze: function () { return !analysisBusy(); }, pullEnabled: STANDALONE, onLogout: logout, onRebuildCache: rebuildCache, autoRefresh: AUTO_REFRESH_ACTIONS };

// static/lib/launch.js(r2)— 起動経路の判定(再読み込み・ホーム画面アプリ)。DOM・storage を持たない
export function navigationType(entries, legacyType)
//  entries[0].type が文字列ならそれ('navigate'|'reload'|'back_forward'|'prerender')。無ければ legacyType 1→'reload'、2→'back_forward'、他→'navigate'
export function isStandalone(env) // env: { standalone, matchMedia }。standalone === true か matchMedia('(display-mode: standalone)').matches
export var RELOAD_GUARD = { runningMs: 10 * 60 * 1000, cooldownMs: 60 * 1000 };
export function shouldReanalyzeOnReload(s) // s: { navType, hasSession, now, startedAt, finishedAt } → boolean
//  startedAt/finishedAt は localStorage の生の文字列(null 可)。Number で数値化し、有限・正・now 以下のものだけ採用、他は 0
//  navType !== 'reload' か !hasSession → false / started > finished かつ now - started < runningMs → false / finished > 0 かつ now - finished < cooldownMs → false / 他 → true
```

### 状態遷移
pullStep(dx = x - startX, dy = y - startY。`vert` = dy > 0 && dy >= |dx|)
| 現在 | 入力 | 次 | fire / prevent |
|---|---|---|---|
| 任意 | start: `!enabled` または `scrollY > 0` | idle | - / - |
| 任意 | start: 上記以外 | armed(startX/Y) | - / - |
| armed | move: max(\|dx\|,\|dy\|) < slop | armed | - / vert |
| armed | move: slop 以上かつ vert かつ scrollY<=0 | pulling(distance = min(max, dy*resist)) | - / true |
| armed | move: それ以外 | idle | - / false |
| pulling | move: dy > 0 かつ scrollY<=0 | pulling(distance 更新) | - / true |
| pulling | move: dy <= 0 または scrollY > 0 | idle | - / false |
| pulling | end | idle | distance >= threshold / - |
| armed/idle | end | idle | false / - |
| 任意 | cancel | idle | false / - |

nextBar(y は `[0, max(limits.max, 0)]` に丸める。iOS の上下バウンスで誤判定しない)
| 現在 | 条件 | 次 |
|---|---|---|
| 任意 | y <= limits.top | shown(anchor=y) |
| shown | y < anchor | shown(anchor=y) |
| shown | y - anchor >= hideAfter | hidden(anchor=y) |
| hidden | y > anchor | hidden(anchor=y) |
| hidden | anchor - y >= showAfter | shown(anchor=y) |
| 上記以外 | - | 変化なし |

### useCollapsingBar(enabled = !!(filters && tabs))
- `useLayoutEffect([enabled])`: enabled でなければ登録しない。`scroll`・`resize`(passive)を rAF で1フレーム1回に間引いて apply。登録直後に1回 apply。cleanup で解除と cancelAnimationFrame
- apply: `shift = round(tabs.rect.top - bar.rect.top)`、`top = bar.parentElement.rect.top + scrollY + shift`、`max = documentElement.scrollHeight - innerHeight`、`st = nextBar(st, scrollY, {top, max})`(st は effect のクロージャ変数)。`setShift(shift)`・`setCollapsed(st.hidden)`(同値なら Preact は描き直さない)
- 描画: `<div class=${'topbar' + (bare ? ' topbar-bare' : '')} data-ui="topbar" data-collapsed=${enabled && collapsed ? 'true' : 'false'} ref=${barRef} style=${enabled ? {'--topbar-shift': shift + 'px'} : undefined}>${filters}${tabs && html`<div class="topbar-tabs" ref=${tabsRef}>${tabs}</div>`}</div>`

### PullToRefresh(AppShell 内で上部バーの直前に置く)
- `latest = useRef()` に毎描画 `{onPull, canPull}` を入れる(関数 props の差し替えで再登録しない)。`useLayoutEffect([])` で document に4リスナ(この部品の生存期間=機能の生存期間。layout effect なので描画確定と同時に登録され、ui-check の操作と競合しない)
- start: `touches.length !== 1` は cancel。`enabled = !locked() && !!(canPull && canPull())`。`locked()` = body か html の `style.overflow === 'hidden'`(シート・試合詳細モーダル表示中)
- move: idle なら何もしない。`r.prevent && e.cancelable` で `preventDefault()`。end で `r.fire` なら `latest.current.onPull()`
- 描画: phase が pulling のときだけ
  `<div class="pull-zone" data-ui="pull-indicator" aria-hidden="true" style=${{ height: distance + 'px' }}><span class="pull-icon"><svg viewBox="0 0 24 24"><path d="M20 12a8 8 0 1 1-2.34-5.66M20 4v5h-5" /></svg></span><span>${ready ? '離すと再分析' : '引っ張って再分析'}</span></div>`
  (↻ は文字でなく SVG。フォント差で ui-check の画素が揺れないため)
- 本文の押し下げは引っ張り中の数フレームだけで、最上部かつ preventDefault 中なのでスクロール位置は動かない

### 呼び出し(report.js)
- レポート本体: `<${AppShell} filters=${filters} tabs=${tabs} onPull=${actions.pullEnabled ? actions.onReanalyze : null} canPull=${actions.canReanalyze} nav=${nav}>`
- レポート本体の filters(controls-row)の LensToggle の後ろに `<button type="button" class="controls-reanalyze" data-ui="reanalyze-button" onClick=${actions.onReanalyze}>再分析</button>`(r2。Skeleton の filters には置かない)
- search / classrecord: `<${AppShell} nav=${nav}>`(引っ張りなし。上部バーは bare)
- more: `<${AppShell} nav=${nav}>` の MoreView に `onReanalyze=${function () { nav.onNavigate('report'); actions.onReanalyze(); }}`
- Skeleton: 本体 `<${AppShell} filters=${filters} tabs=${tabs} nav=${n}>`(引っ張りなし)、more の MoreView に `onReanalyze=${function () { n.onNavigate('report'); actions.onReanalyze(); }}`
- MoreView: 先頭に `<div class="more-brand" data-ui="more-brand"><img src="logo.svg" alt="catalyzer" /></div>`。dataRows 先頭に `{ key: 'reanalyze', main: '再分析', sub: '公式サイトから新しい戦績を取得して分析し直します' }`。onSelect は `k === 'reanalyze'` で `onReanalyze()`、refetch は従来どおり

### app.js(r2 の追加)
- import に `navigationType, isStandalone, shouldReanalyzeOnReload` を足す
- モジュール先頭で `var STANDALONE = isStandalone({ standalone: navigator.standalone, matchMedia: window.matchMedia ? function (q) { return window.matchMedia(q); } : null });` と `if (STANDALONE) document.documentElement.setAttribute('data-standalone', '');`。REPORT_ACTIONS に `pullEnabled: STANDALONE`
- 分析の開始・終了の記録: `ANALYSIS_STARTED_KEY = 'catalyzer_analysis_started_at'`、`ANALYSIS_FINISHED_KEY = 'catalyzer_analysis_finished_at'`。`reanalyzeWithSession` と `analyze` で `activeJobId = jobId;` の直後に started を `String(Date.now())`、各 finally で `jobId` が入っているときだけ finished を書く(どちらも try/catch。storage が使えなければ抑止を諦める=起動する側に倒す)。`logout()` で両キーを削除
- initSession: `hasSession` を読んだ直後に `var reloadRun = hasSession && shouldReanalyzeOnReload({ navType: navigationType(performance.getEntriesByType ? performance.getEntriesByType('navigation') : [], performance.navigation ? performance.navigation.type : undefined), hasSession: true, now: Date.now(), startedAt: 読み出し, finishedAt: 読み出し });`
  - `if (hasSession) pullAutoRefresh();` → `if (hasSession && !reloadRun) pullAutoRefresh();`
  - `/session` が valid の分岐 `else if (!hasLocalData)` → `else if (!hasLocalData || reloadRun)`(中身は U2 の `analysis.run(reanalyzeWithSession)` のまま)
- 再読み込みで起動したときの 409(自動更新が取得中)は従来どおり #error に出す(文言の修正は起票候補)

### app.js(r1)
- `reAnalyze` の1文目 `if (analysisBusy()) return;`。中の `reanalyzeWithSession()`/`analyze()` を `analysis.run(reanalyzeWithSession)`/`analysis.run(analyze)` に
- loginForm submit の `analyze()` → `analysis.run(analyze)`、initSession の `reanalyzeWithSession()` → `analysis.run(reanalyzeWithSession)`(計4か所。素の呼び出しを残さない)
- `logout()` の `activeJobId = null;` の直後に `analysis.release();`(古いポーリングが最大3秒残っても再ログインを塞がない)

### CSS(トークンのみ。色リテラル禁止・文字 0.875rem 以上・コメントは各1行)
```css
/* topbar.css: .topbar の background 宣言を削除し、::before に移す */
.topbar::before { content: ''; position: absolute; inset: 0; z-index: -1; background: var(--bg-a82); -webkit-backdrop-filter: blur(10px); backdrop-filter: blur(10px); }
.topbar-tabs { flex-basis: 100%; min-width: 0; } /* min-width:0 が無いとタブ行の内容幅で横にはみ出す */
.topbar.topbar-bare { padding: env(safe-area-inset-top) 0 0; margin-bottom: var(--gutter); border-bottom: none; }
@media (max-width: 720px) {
  .topbar[data-collapsed="true"] { top: calc(env(safe-area-inset-top) - var(--topbar-shift, 0px)); }
  .topbar[data-collapsed="true"]::before { top: calc(var(--topbar-shift, 0px) - env(safe-area-inset-top)); }
  .topbar[data-collapsed="true"] .controls-row { visibility: hidden; }
}
@media (max-width: 720px) and (prefers-reduced-motion: no-preference) { .topbar, .topbar::before { transition: top 0.2s ease; } }
.controls-reanalyze { display: none; align-items: center; min-height: 44px; width: auto; padding: 0 16px; border: 1px solid var(--line); border-radius: 8px; background: none; color: var(--accent); font-size: 0.875rem; white-space: nowrap; cursor: pointer; }
.controls-reanalyze:hover { border-color: var(--accent); background: var(--accent-a10); }
@media not all and (max-width: 720px) { .controls-reanalyze { display: inline-flex; } }
/* shell.css(r2: ホーム画面アプリのときだけ) */
html[data-standalone]:has(.view-root) { overscroll-behavior-y: contain; }
.pull-zone { display: flex; flex-direction: column; align-items: center; justify-content: flex-end; gap: 4px; overflow: hidden; margin: calc(var(--gutter) * -1) 0 var(--gutter); color: var(--muted); font-size: 0.875rem; }
.pull-icon { display: flex; align-items: center; justify-content: center; flex: none; width: 32px; height: 32px; border: 2px solid var(--accent); border-radius: 50%; color: var(--accent); }
.pull-icon svg { width: 18px; height: 18px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
.more-brand { display: flex; justify-content: center; margin: 8px 0 24px; }
.more-brand img { display: block; height: 28px; width: auto; }
```
- `.topbar.topbar-bare` は2クラス(responsive.css の `.topbar` の padding が後読みで勝つため)
- `.controls-reanalyze` は topbar.css に置く。LensToggle の `margin-left:auto` で、トグルとボタンが右端に並ぶ。720px 以下は `display:none` なので固定高さ(スマホ幅の検査)には影響しない
- `.pull-zone` の margin は、直後の上部バーの `margin-top:-gutter` と相殺して、引っ張り開始時にバーが跳ねないため
- 隠れた状態の `::before` は `top` だけ動かす(`inset:0` の他辺はそのまま)。これでタブ行より上を塗らない

### 固定高さの定義と見込み(390×844、safe-area 0)
- **定義**: 「スクロール中に固定される高さ」= 下スクロールで絞り込み行が隠れた状態での (A) 画面上端〜上部バー下端の高さ(上部バーの画面内に見えている部分)+ (B) 下部タブバーの高さ。**完了条件は A+B ≦ 120px(タブバー込み)**。あわせて「帯」= タブ行の上端 − 上部バーの見えている上端 = 0px を検査する
- 見込み: A = タブ行 49 + 下余白 6 + 下線 1 = 56px、B = 57px、**計 113px**(モック 3b は帯 約12px を含み 125px)。展開時の上部バーは 12+48+8+49+6+1 = 124px(現 169px)。上スクロールで再表示中は 124+57px になる(一時的)
- 実測が 120 を超えたら architect に戻す(タブ行・タブバーの寸法を独断で変えない)
- r2 の再分析ボタンは 721px 以上だけ表示し、しかも絞り込み行(高さ 44px のチップと同じ行)の中なので、スマホ幅の固定高さにも広い画面の上部バーの高さにも影響しない

### ui-check の追加仕様(check.js)
- `{ scrollBy: [dy] }`: `scrollBy(0,dy)` の後に2フレーム待つ(`awaitPromise`)。`{ pull: [dy, 'release'?] }`: CDP `Input.dispatchTouchEvent` で (幅/2, 300) から touchStart → touchMove 10段で y+dy → `'release'` のときだけ touchEnd。どちらも a[0] は数値(違えば InfraError)。操作前の要素待ち(:155)は click/type/scroll/wait だけにする
- ops に pull を含む画面はナビゲーション前に `Emulation.setTouchEmulationEnabled({enabled:true,maxTouchPoints:1})`。CDP のタッチが届かない場合の代替は、ページ内で `new TouchEvent(..., {touches:[new Touch({...})], cancelable:true})` を document に dispatch
- `outview: [[sel,text?]]`: inview の直後。まず countExpr で1件以上あること(無ければ `outview の対象なし <sel>`)、次に inviewExpr が true なら `画面内に見える <sel>` で fail
- `fixedMax: N`: outview の後・`scrollTo(0,0)` の前に1つの式で `{fixed, band}` を得る
  - fixed = `[data-ui="topbar"]` の rect.bottom を [0,innerHeight] に丸めた値 + (innerHeight − `[data-ui="tabbar"]` の rect.top)を [0,innerHeight] に丸めた値、の四捨五入。どちらか無ければ -1 → `固定高さの対象なし`
  - band = `[data-ui="topbar"] [role="tablist"]` の rect.top − max(0, topbar の rect.top) を四捨五入(tablist が無ければ 0)
  - 判定順は band → fixed。band > 0 は `上部バーの帯 Bpx(タブ行の上)`、fixed > N は `固定高さ Hpx が上限 Npx を超える` で fail(C10・C11 の注入がそれぞれ狙った方で落ちるため)。成功時は結果に `note: '固定 Hpx 帯 0px'` を持たせ、main の出力を `'OK ' + label + (r.note ? ' ' + r.note : '')` にする
- (r2)画面の `standalone: true`: ナビゲーション前に `Page.addScriptToEvaluateOnNewDocument` で `Object.defineProperty(Navigator.prototype,'standalone',{configurable:true,get:function(){return true}})` を注入する。iOS のホーム画面アプリと同じ判定経路で、`Emulation.setEmulatedMedia` が `display-mode` を扱えるかに依存しない(実測不要)。プレビューの seed は `location.replace` で `/` へ移るが、注入は新しい文書ごとに効く
- (r2)画面の `absent: [[sel,text?]]`: outview の後。countExpr(レイアウトを持つ要素の数)が1以上なら `在ってはいけない要素 <sel>` で fail。`display:none` と未描画は0件、`visibility:hidden` は1件と数える
- 未知の操作の InfraError 判定に scrollBy・pull を追加。先頭コメントに新しい操作・項目を足す(1行)
- 画面数が増えて `TOTAL_TIMEOUT`(180000)を超えたら 300000 にする(#413 の前例)

### screens.js
```js
var COLLAPSED = ['[data-ui="topbar"][data-collapsed="true"]'];
var EXPANDED = ['[data-ui="topbar"][data-collapsed="false"]'];
var FILTERS = [['[data-ui="period-trigger"]'], ['[data-ui="ms-trigger"]'], ['[data-ui="lens-toggle"] button', '全体']];
var ACTIVE_TAB = ['[data-ui="tab"][aria-selected="true"]', '総合'];
// mobile-report-overview(置き換え): ops [{scrollBy:[600]},{wait:COLLAPSED}], required は現行のまま,
//   inview [ACTIVE_TAB], outview FILTERS, fixedMax 120, tap は現行のまま
{ id: 'mobile-report-scroll-up', viewport: M, full: false, start: 'report', ops: [{ scrollBy: [600] }, { wait: COLLAPSED }, { scrollBy: [-40] }, { wait: EXPANDED }], required: [ACTIVE_TAB], inview: FILTERS },
{ id: 'mobile-pull', viewport: M, full: false, start: 'report', standalone: true, ops: [{ wait: ['[data-ui="report-scope"]'] }, { pull: [40, 'release'] }, { pull: [200] }],
  required: [['[data-ui="pull-indicator"]', '離すと再分析'], ['[data-ui="report-scope"]', '全期間・60試合']] },
{ id: 'mobile-pull-release', viewport: M, full: false, start: 'report', standalone: true, ops: [{ wait: ['[data-ui="report-scope"]'] }, { pull: [200, 'release'] }], required: [['#loginForm'], ['#analyzeBtn']] },
{ id: 'more-reanalyze', viewport: D, full: false, start: 'report', ops: [goTab('その他'), { click: ['[data-ui="more"] button', '再分析'] }], required: [['#loginForm'], ['#analyzeBtn']] },
// more / mobile-more の required に ['[data-ui="more"] button', '再分析'] と ['[data-ui="more-brand"] img'] を追加
// r2:
var REANALYZE_BTN = ['[data-ui="reanalyze-button"]', '再分析'];
// report-overview の required に REANALYZE_BTN を追加。mobile-report-overview に absent: [['[data-ui="reanalyze-button"]']]
{ id: 'mobile-pull-browser', viewport: M, full: false, start: 'report', ops: [{ wait: ['[data-ui="report-scope"]'] }, { pull: [200] }, { absentNow: ['[data-ui="pull-indicator"]'] }, { release: [0] }],
  required: [['[data-ui="report-scope"]', '全期間・60試合']] },
{ id: 'report-reanalyze', viewport: D, full: false, start: 'report', ops: [{ click: REANALYZE_BTN }], required: [['#loginForm'], ['#analyzeBtn']] },
```
- mobile-pull / mobile-pull-release(U5 で作成済み)は `standalone: true` が要る。r2 ではブラウザのタブで引っ張りが動かないため、無いと「離すと再分析」も再分析も起きず落ちる。見た目は変わらないので基準画像は撮り直さない見込み(落ちたら理由を調べる)
- mobile-pull-browser: ブラウザのタブでは、しきい値を超えて保持しても表示が出ない(`absentNow`)ことを確かめ、その後 `release` で離す。保持のまま撮るとブラウザ標準のオーバースクロールで画素が揺れるため離してから撮る。離しても再分析せず(レポートが表示されたまま)
- `useCollapsingBar` の `apply` はスクロールロック中(シート・モーダル表示中)は状態を更新しない(隠れ状態の `visibility:hidden` が fixed のシートに継承されて消えるため)
- 再読み込みでの起動は ui-check では確かめない。プレビューのモックは `/session` が `valid:false` を返し、セッションが無い。mobile-more の `{reload:true}` は navigation type が reload になるが、セッションが無いので起動しない(既存の基準画像は不変)
- mobile-pull: 40px の離し(distance 20)で再分析しないことを「レポートが表示されたまま」で、200px の保持(distance 96)で「離すと再分析」の表示を確認し、その見た目を基準画像に撮る。プレビューはセッションが無いので、再分析が走るとログインフォームが出る(mobile-pull-release・more-reanalyze はこれで配線を確かめる)
- check.js は撮影前に `scrollTo(0,0)` と全高ビューポートにするため、スクロール中の見た目は基準画像に写らない。スクロール中の状態は inview/outview/fixedMax の数値検査で判定する

## 4. テスト計画
- topbar.test.js(新, 19件以上)
  - pullStep: enabled=false の start は idle で以後 fire しない / scrollY=1 の start は idle / slop 内の下向きは armed・prevent true、slop 内の横優勢は prevent false / 横に slop 超は idle / 上向きに slop 超は idle / dy=127 で end は fire false、dy=128 で fire true(境界) / dy=400 で distance=96 / pulling 中に scrollY>0 で idle・end で fire false / pulling 中に dy<=0 で idle / cancel で idle・fire false / pullReady の真偽
  - nextBar: y<=top は hidden からでも shown / shown から下へ23は shown・24で hidden / hidden から上へ15は hidden・16で shown / hidden 中の更なる下降で anchor が上がり、そこから16戻すと shown / shown 中の上昇で anchor が下がり、そこから24で hidden / y>max は max に丸め、下端バウンス(max+30→max)で shown にならない / 負の y は0に丸めて shown / ±5 の往復列で状態が一度も変わらない
- launch.test.js(r2 新, 16件以上): navigationType(entry の reload / entry の navigate / entry 無しで legacy 1→reload・2→back_forward / どちらも無し→navigate)/ isStandalone(standalone true / matchMedia が一致 / 両方偽 / matchMedia 無し)/ shouldReanalyzeOnReload(navigate→偽 / セッション無し→偽 / 記録なしの reload→真 / 開始から 599999ms・未終了→偽、600000ms→真(境界)/ 終了から 59999ms→偽、60000ms→真(境界)/ 終了が開始より後なら実行中扱いしない / 未来の時刻・'abc'・'1e999'(Infinity)は0扱いで真)
- runlock.test.js(新, 4件): run 中 busy・終了後 false・戻り値 true / busy 中の run は false で fn 未呼び出し / release 後に新しい run が始められ、古い run の完了で新しい run が解放されない / fn の reject で busy false かつ reject が伝播
- skeleton-actions.test.js(+2): 全 `<${MoreView}` に `onReanalyze=`(2か所以上)/ `onPull=` を持つ全 `<${AppShell}` に `canPull=`(1か所以上)
- surface.test.js(+1): static 配下の .js(`__tests__`・`htm-preact-standalone.js`・`chart.umd.min.js` を除く)で `addEventListener('scroll'` を含むのは shell.js だけで1件、`.style.maxHeight` は0件。既存「report.js に…」は名前を「report.js はスクロール連動処理を持たない(shell.js に一元化)」へ
- screens.test.js(r2 追加): selectors() に absent も含める / mobile-pull・mobile-pull-release は `standalone: true`、mobile-pull-browser は standalone でなく pull→absentNow(pull-indicator)→release の順 / report-overview は REANALYZE_BTN を必須、mobile-report-overview は absent に reanalyze-button
- screens.test.js(r1): selectors() に outview を含め、selectors テストの期待値を `['a','[data-ui="x"]','[data-ui="y"]','b']` に / 「mobile-report-overview は…フィルタ群が画面内に見える」を「正の scrollBy の後に FILTERS 3つが outview、ACTIVE_TAB が inview、fixedMax <= 120」に置換 / 新: mobile-report-scroll-up は正→負の scrollBy の後に FILTERS が inview / 新: mobile-pull は `PULL.threshold / PULL.resist` 未満の pull を release した後に以上の pull を保持し、mobile-pull-release は以上の pull を release して `#loginForm` を必須にする(PULL は static/lib/topbar.js から import)
- ui-check: 既存の基準画像更新+新4画面(§5 C6〜C12)

## 5. 完了条件(基線 B=afc9aa5。r2 後の最終状態)
| # | 条件 | コマンド | 期待値 |
|---|---|---|---|
| C1 | JS テスト全緑 | `make test-js` | exit 0、fail 0、pass 313 以上(r2 着手時 295) |
| C2 | 純粋関数テスト | `node --test static/__tests__/topbar.test.js static/__tests__/launch.test.js` | exit 0、fail 0、pass 35 以上(19+16) |
| C3 | ロックのテスト | `node --test static/__tests__/runlock.test.js` | exit 0、fail 0、pass 4 |
| C4 | props 注入・静的検査 | `node --test static/__tests__/skeleton-actions.test.js static/__tests__/surface.test.js` | exit 0、fail 0、pass 9 |
| C5 | 画面定義の規約 | `node --test tools/ui-check/screens.test.js` | exit 0、fail 0、pass 13 |
| C6 | ui-check 全 OK を2回連続 | `make ui-check` を2回 | 両方 exit 0、最終行 `ui-check: 58/58 OK` |
| C7 | console エラー0 | `make ui-check 2>&1 \| grep -c "console エラー"` | 0 |
| C8 | 固定高さ(タブバー込み)120px 以下 | `node tools/ui-check/check.js mobile-report-overview \| grep '^OK' \| grep -oE '固定 [0-9]+px' \| grep -oE '[0-9]+' \| awk '$1<=120{n++} END{print n+0}'` | 2 |
| C9 | 帯が無い | `node tools/ui-check/check.js mobile-report-overview \| grep -c '帯 0px'` | 2 |
| C10 | 固定高さ検査が効く | `UI_CHECK_INJECT='mobile-report-overview:document.querySelector("[role=tablist]").style.paddingBottom="30px"' node tools/ui-check/check.js mobile-report-overview` と同コマンドの `\| grep -c "固定高さ"` | exit 1 / 2 |
| C11 | 帯の検査が効く | `UI_CHECK_INJECT='mobile-report-overview:document.querySelector("[data-ui=topbar]").style.top="calc(12px - var(--topbar-shift))"' node tools/ui-check/check.js mobile-report-overview` と同コマンドの `\| grep -c "上部バーの帯"` | exit 1 / 2 |
| C12 | 隠れ検査が効く | `UI_CHECK_INJECT='mobile-report-overview:document.querySelector("[data-ui=topbar]").dataset.collapsed="false"' node tools/ui-check/check.js mobile-report-overview` と同コマンドの `\| grep -c "画面内に見える"` | exit 1 / 2 |
| C13 | 不在検査が効く(r2) | `UI_CHECK_INJECT='mobile-report-overview:document.querySelector("[data-ui=reanalyze-button]").style.display="inline-flex"' node tools/ui-check/check.js mobile-report-overview` と同コマンドの `\| grep -c "在ってはいけない要素"` | exit 1 / 2 |
| C14 | 再分析の入口(引っ張り・再表示・その他・ボタン・タブでは引っ張らない) | `node tools/ui-check/check.js mobile-report-scroll-up mobile-pull mobile-pull-release more-reanalyze mobile-pull-browser report-reanalyze report-overview \| grep -c "^OK"` | 14 |
| C15 | 上部の行の撤去 | `grep -rnE "topbar-head\|topbar-refresh\|onRefresh\|\.topbar \.brand" static \| wc -l` / `grep -c 'class="brand"' static/components/shell.js` | 0 / 0 |
| C16 | 上端の抑止はホーム画面アプリだけ(r2) | `grep -c "html\[data-standalone\]:has(.view-root) { overscroll-behavior-y: contain; }" static/styles/shell.css` / `grep -c "^html:has(.view-root)" static/styles/shell.css` / `grep -c "setAttribute('data-standalone'" static/app.js` | 1 / 0 / 1 |
| C17 | 起動経路の配線(r2) | `grep -c "shouldReanalyzeOnReload(" static/app.js` / `grep -c "navigationType(" static/app.js` / `grep -c "pullEnabled: STANDALONE" static/app.js` / `grep -c "actions.pullEnabled ? actions.onReanalyze : null" static/components/report/report.js` / `grep -c "hasSession && !reloadRun" static/app.js` / `grep -cE "!hasLocalData .{3}reloadRun" static/app.js` | 1 / 1 / 1 / 1 / 1 / 1 |
| C18 | 分析の記録(r2) | `grep -c "ANALYSIS_STARTED_KEY" static/app.js` / `grep -c "ANALYSIS_FINISHED_KEY" static/app.js` | 各 4 以上(定義・開始/終了の書き込み・起動時の読み出し・ログアウトの削除) |
| C19 | 分析中ガードの配線 | `grep -c "analysis.run(" static/app.js` / `grep -cE "^\s*(reanalyzeWithSession\|analyze)\(\);" static/app.js` / `grep -c "if (analysisBusy()) return;" static/app.js` / `grep -c "analysis.release()" static/app.js` / `grep -c "canReanalyze:" static/app.js` | 4 / 0 / 1 / 1 / 1 |
| C20 | #413 C8 の維持・変えない基準画像・Go 不変 | `grep -c "topbarRef" static/components/report/report.js static/components/shell.js` / `git diff --name-only afc9aa5 -- 'tools/ui-check/baseline/login-*.png' 'tools/ui-check/baseline/parts-*.png' \| wc -l` / `git diff --name-only afc9aa5 -- '*.go' go.mod go.sum \| wc -l` | 各 0 / 0 / 0 |
| C21 | CLAUDE.md | `grep -c "29画面" CLAUDE.md` / `grep -c "58枚" CLAUDE.md` / `grep -cE "23画面\|46枚\|27画面\|54枚" CLAUDE.md` / `grep -cE "static/lib/(topbar\|runlock\|launch)\.js" CLAUDE.md` / `grep -c "absent" CLAUDE.md` | 2 / 2 / 0 / 3 / 2 以上 |
| C22 | README・旧設計書 | `grep -cE "(topbar\|runlock\|launch)\.js +#" README.md` / `grep -cE "(topbar\|runlock\|launch)\.test\.js +#" README.md` / `grep -c "2026-10-05-pull-to-refresh.md" docs/design/2026-10-05-report-summary.md docs/design/2026-10-04-bottom-tabbar.md` | 3 / 3 / 各 1 |
| C23 | 色リテラルなし | `grep -oE '#[0-9a-fA-F]{3,6}\b\|rgba?\(' static/styles/topbar.css static/styles/shell.css \| wc -l` | 0 |

C11 の注入はタブ行を上端から 12px 下げる(モック 3b の帯の再現)。

CLAUDE.md の更新箇所: 検証コマンドの ui-check 行(29画面・58枚、`outview`・`absent`・`fixedMax` の検出、`standalone` 画面)、コード構成の shell.js 行(上部バーの隠し・PullToRefresh(ホーム画面アプリのみ)・その他画面のロゴと再分析)、report/ の行に「広い画面の再分析ボタン」、app.js の行に「再読み込みでの再分析」、`static/lib/topbar.js`・`runlock.js`・`launch.js` の3行、tools/ui-check 行(29画面・58枚、操作に scrollBy/pull、検査に outview/absent/fixedMax、`standalone`)、`static/__tests__/` 行に topbar/runlock/launch。README: shell.js 行、`lib/` に3行、`__tests__/` に3行、surface.test の説明。

基準画像の更新規則(各ユニット): `make ui-check 2>&1 | grep FAIL` で (a) 理由が「基準画像と不一致」「基準画像なし」だけ、(b) id が §7 のそのユニットの想定リストの部分集合、を確認し出力を報告。そのうえで `node tools/ui-check/check.js --update ${=IDS}`(zsh)で該当 id だけ更新。`make ui-baseline` は禁止。リスト外が落ちたら原因を調べてから。

レビュー観点(完了条件とは別): 再読み込みの抑止時間(10分/60秒)の妥当性 / 再分析ボタンの見た目と位置 / しきい値(128px)とヒステリシス(24/16px)の操作感 / 引っ張り表示のモック 4b との一致 / 隠れた状態のモック 3b との差(帯が無いこと) / 「再分析」行の文言と位置 / フック・部品の責務分割と依存配列 / app.js のロック導入範囲

## 6. 影響範囲
- 全 AppShell 画面(レポート5タブ・試合検索・総合戦歴・その他・Skeleton)の上部が変わる。試合検索・総合戦歴・その他は上部バーが無くなり(safe-area のみ)、本文が上がる
- 再分析の入口: 上部ボタン(3画面)→ ブラウザの再読み込み(全画面)/ホーム画面アプリの引っ張り(レポート)/広い画面のボタン(レポート)/その他の行
- **再読み込みが公式サイトへのアクセスを伴うようになる**(パソコンの F5 も含む)。60秒・10分の抑止と、サーバーのユーザーごとの lease で連続取得を防ぐ
- 分析の多重起動: 従来は防いでいなかった(ボタン連打で2本走り得た)。ロック導入で、ログイン送信・起動時復元を含む全経路が1本に制限される。全件再取得(`rebuildCache`)は従来どおり別管理
- `html` の overscroll: ホーム画面アプリのアプリ画面だけ上端の伸びを止める。ブラウザのタブとログイン画面は従来どおり
- パソコン幅(>720px)は上部の行が消えるだけで、隠す動作はしない
- 上部バーの背景を `::before` に移すのは見た目不変(同じ色を同じ範囲に塗る)
- #288 の自動取り込み(`pullAutoRefresh`/`shouldPull`)とは無関係。名前の「pull」は別概念

## 7. 実装順(各ユニット: test-js 全緑 → 上記規則で ui-check)
| U | 内容 | 想定変更画面 | コミット案 |
|---|---|---|---|
| U1 | lib/topbar.js・lib/runlock.js とテスト | なし(46/46) | feat: #363 引っ張り再分析と絞り込み行の隠し判定の純粋関数を追加 |
| U2 | app.js のロック・canReanalyze | なし(46/46) | feat: #363 分析の多重起動を防ぐ(引っ張り・その他からの再分析に備える) |
| U3 | check.js(scrollBy/pull/outview/fixedMax/タッチ)、screens.test の selectors | なし(46/46) | feat: #363 ui-check にスクロール・タッチ操作と固定高さの検査を追加 |
| U4 | AppShell・PullToRefresh・useCollapsingBar・MoreView・report.js・CSS・skeleton-actions/surface テスト・mobile-report-overview の書き換えと more/mobile-more の必須要素・規約テスト | analyzing, report-overview, report-playstyle, report-burst, report-matchup, report-time, dropdown-period, dropdown-ms, search, dropdown-search-filter, match-detail, classrecord, mobile-report-overview, mobile-dropdown-period, mobile-dropdown-ms, more, mobile-more, mobile-more-confirm, mobile-more-auto-refresh, mobile-more-auto-refresh-error | feat: #363 ロゴと再分析の行をやめ、引っ張って再分析・下スクロールで絞り込み行を隠す |
| U5 | 新4画面と規約テスト | 新 mobile-report-scroll-up, mobile-pull, mobile-pull-release, more-reanalyze | test: #363 引っ張り・再表示・その他からの再分析の画面確認を追加 |
| U6 | CLAUDE.md・README・旧設計書2本の後続行 | — | docs: #363 上部バーの変更に合わせて構成と ui-check の記述を更新 |

r2 のユニット(U1〜U4 はコミット済み、U5 は未コミット。§11 の差分を U5〜U8 で実施)
| U | 内容 | 想定変更画面 | コミット案 |
|---|---|---|---|
| U5 | lib/launch.js と launch.test.js | なし | feat: #363 再読み込み・ホーム画面アプリの判定と再読み込みでの再分析の抑止判定を追加 |
| U6 | check.js の `standalone`・`absent`、screens.test の selectors。未コミットの新4画面(mobile-pull・mobile-pull-release に `standalone: true` を足して)と基準8枚 | 新 mobile-report-scroll-up, mobile-pull, mobile-pull-release, more-reanalyze(54/54) | test: #363 引っ張り・再表示・その他からの再分析の画面確認を追加 |
| U7 | app.js(STANDALONE・pullEnabled・再読み込みでの起動・開始/終了の記録)、report.js(onPull の条件・再分析ボタン)、topbar.css・shell.css、screens(mobile-pull-browser・report-reanalyze・REANALYZE_BTN・absent)と規約テスト | report-overview, report-playstyle, report-burst, report-matchup, report-time, dropdown-period, dropdown-ms; 新 mobile-pull-browser, report-reanalyze(58/58) | feat: #363 再分析をハイブリッドにする(再読み込みで起動・ホーム画面アプリだけ引っ張り・広い画面はボタン) |
| U8 | CLAUDE.md・README・旧設計書2本の後続行 | — | docs: #363 上部バーと再分析の起動経路の変更に合わせて構成と ui-check の記述を更新 |
- r1 表の U5・U6 は上記 U6・U8 に読み替える

実装メモ
- コミットメッセージは1行目 `<type>: #363 <何を・なぜ>`、本文末尾は `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>` の1行のみ。Claude-Session 行は入れない(公開リポジトリ)
- rm/mv は `/bin/rm -f`・`/bin/mv -f` か `git rm`/`git mv`
- PR 前に origin/develop へ rebase し基準画像を撮り直す(PNG を手でマージしない)。PR base は develop
- 完了後、本設計書のステータスを implemented にする(design-doc skill)

## 8. 実機確認項目(main・オーナー。ui-check では判定できない)
1. iOS Safari・Android Chrome(ブラウザのタブ): レポート最上部の標準の引っ張り再読み込みで navigation type が `reload` になり、#status「最新データを取得中...」が1回だけ出る。自前の ↻ 表示は出ない
2. 同: 60秒以内にもう一度再読み込みすると再分析が始まらず、キャッシュのレポートが出る。再分析の途中で再読み込みしても新しい再分析が始まらず、409 のエラーも出ない
3. 同: リンク・URL 入力・ブックマーク・戻る/進むで開いたときは再分析が始まらない
4. ホーム画面アプリ(iOS・Android): アイコンから開いても再分析が始まらない。最上部で引っ張る→↻と「離すと再分析」→離すと再分析が始まる。しきい値未満で離すと何も起きない。分析中は表示が出ない
5. ホーム画面アプリ: 隠れた状態でステータスバーの下にチップが透けず、タブ行の上に帯が無い。試合検索・総合戦歴で本文がステータスバーに潜らない
6. 下スクロールで絞り込み行が隠れ、少し上に戻すと出る。ゆっくりのスクロール・下端のバウンスでちらつかない
7. 期間シート・試合詳細モーダルを開いた状態で引っ張っても再分析しない(ホーム画面アプリ)。最上部でタブ行を横にスワイプしても引っ張りにならない
8. パソコン: 絞り込み行の右端に「再分析」が出て、押すと再分析が始まる。F5 でも始まる。その他→「再分析」も動く。721px 以上では行が隠れない。幅を 720px 以下に縮めるとボタンが消える
9. スマホを横向きにして幅が 721px を超えたとき、ボタンが出ても行が崩れない
10. ログイン画面では、ブラウザ標準の引っ張り更新が従来どおり使える
11. 長時間バックグラウンドにしてタブがブラウザに破棄され、戻ったときに再分析が走るか(navigation type が reload になるか)を観察する(§9)

## 9. リスク
- ブラウザが標準の引っ張り再読み込みや破棄タブの復元で navigation type を `reload` にしない/する: §8-1・§8-11 で判定。前者なら再分析が起動しない(その他・ボタンで代替)、後者なら意図しない取得が起きる(60秒・10分の抑止とサーバーの lease が上限)。どちらも起きたら architect に戻す
- 端末の時計が狂うと抑止の判定がずれる: 未来の時刻は0扱いにして「起動する」側に倒す(テストで固定)
- 再読み込みの抑止は端末ごと(localStorage)。別端末の実行中はサーバーの lease が 409 を返し、文言が「自動更新で取得中」になる(起票候補)
- `touchmove` を passive:false で document に登録する: 処理は O(1) で、`preventDefault` は最上部の下向きだけ
- 引っ張り中の差し込みでレポート全体が再レイアウトされる: 引っ張り中のフレームに限られる。重ければ実機確認で報告し、重ね表示へ切り替える(設計の差し戻し)
- CDP のタッチ配送がヘッドレスで届かない: §3 の代替(ページ内 TouchEvent)
- `.topbar-tabs` の包みで横にはみ出す: `min-width:0` で防ぎ、ui-check の左右はみ出し検査で検出される

## 10. ナレッジ候補・起票候補
- ナレッジ(knowledge-add): (1) 上部バーの隠しは sticky の top だけで行う。高さ・margin を変えると文書高が変わり scrollY が振動する(旧実装の失敗)。transform は子孫の fixed シートを壊す。背景は ::before に持たせ、隠れた状態ではタブ行より上を塗らない(帯対策) (2) ui-check は撮影前に scrollTo(0,0)・全高ビューポートにするので、スクロール中の状態は inview/outview/fixedMax の数値で検査する (3) 分析の多重起動はロック1つ(release で古い run を切り離す)。activeJobId は POST 応答後にしか入らない (4) CDP でタッチを送る条件(実装後の実測で確定してから書く) (5) 手動の分析はサーバーのユーザーごとの lease で排他され、2本目は 409(文言は自動更新向け)。再読み込みでの起動の抑止はこれを前提に端末側で行う (6) ui-check でホーム画面アプリを再現するには `navigator.standalone` を新しい文書ごとに注入する(display-mode のメディア模擬に頼らない)
- 起票候補(issue-create): 手動分析同士の 409 の文言(「自動更新で取得中」と出る)/ 試合検索・総合戦歴で再分析が再読み込みと「その他」だけになった発見性 / 隠れている間も範囲を常時示す表現(固定高さとの両立) / 全件再取得と再分析の同時実行の整理(rebuildingCache とロックの統合)

## 11. 改訂 r2 の差分(実装者向け。U1〜U4 コミット済み・U5 未コミットの状態から)
変える
- `static/app.js`: STANDALONE の判定と `html[data-standalone]`、`REPORT_ACTIONS.pullEnabled`、分析の開始/終了の記録(2キー)とログアウトでの削除、initSession の `reloadRun`(§3「app.js(r2 の追加)」)
- `static/components/report/report.js`: レポート本体の `onPull` を `actions.pullEnabled ? actions.onReanalyze : null` に。filters の右端に再分析ボタン(Skeleton には置かない)
- `static/styles/shell.css`: `html:has(.view-root)` → `html[data-standalone]:has(.view-root)`
- `static/styles/topbar.css`: `.controls-reanalyze`(+:hover と 721px 以上の表示)を追加
- `tools/ui-check/check.js`: 画面の `standalone`(navigator.standalone の注入)と `absent`。先頭コメントも
- `tools/ui-check/screens.js`(未コミット分を含む): mobile-pull・mobile-pull-release に `standalone: true`、report-overview に REANALYZE_BTN、mobile-report-overview に absent、新 mobile-pull-browser・report-reanalyze
- `tools/ui-check/screens.test.js`: §4 の r2 追加分
- 基準画像: report-overview, report-playstyle, report-burst, report-matchup, report-time, dropdown-period, dropdown-ms(両テーマ、ボタンが写る)を更新。新 mobile-pull-browser・report-reanalyze を `--update` で作成
- `CLAUDE.md`・`README.md`: §5 C21・C22(画面数は 29画面・58枚)

足す
- `static/lib/launch.js`・`static/__tests__/launch.test.js`

捨てる
- コードとして捨てるものは無い。`PullToRefresh`・`pullStep`・`useCollapsingBar`・ui-check の `scrollBy`/`pull`/`outview`/`fixedMax`・その他画面の再分析はそのまま使う
- 方針として捨てるもの: 「引っ張りを全環境で有効」「アプリ画面の overscroll を常に止める」(r1 §1・§3 の該当記述は本改訂で置き換え済み)

変えない(確認のみ)
- 固定高さ 120px 以下・帯 0px: ボタンは 720px 以下で `display:none`、引っ張りの有無は上部バーの高さに関係しないため、mobile-report-overview の数値は r1 と同じ(C8・C9)
- mobile-pull・mobile-pull-release の基準画像: `standalone` の注入だけで見た目は同じなので撮り直さない見込み

要エスカレーション: 無し(§0 の既定値は事後確認を推奨。特に「再読み込みで公式サイトへの取得が走る」こと自体はオーナーの決定どおり)
