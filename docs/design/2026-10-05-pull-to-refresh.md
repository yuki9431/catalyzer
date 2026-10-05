# 設計: 上部バーを減らす 引っ張って再分析・スクロール中は絞り込み行を隠す

- ステータス: draft
- 日付: 2026-10-05
- 関連 issue: #363(#413 の「スクロールで隠さない」をオーナー判断で変更)。基線: afc9aa5
- 参考モック: 2b・3b・4b(ロゴ位置は下記の決定が優先)

## 0. 決定事項(オーナー確定)と残りの既定値
確定
- ロゴは「その他」画面の先頭だけに出す。レポート・試合検索・総合戦歴には出さない。ログイン画面のロゴ(`h1#pageTitle`)は現状維持。`.topbar-head`(ロゴ+再分析の行)は廃止
- head 廃止で空になる試合検索・総合戦歴(とその他)の上部バーは出さない(高さ0)
- 再分析はレポート画面の一番上で下に引っ張って行う。上端に円形の枠に ↻、その下に文字(muted)。しきい値以上は「離すと再分析」、未満は「引っ張って再分析」で、離しても何もしない。分析中は受け付けない
- 下スクロール中は絞り込み行を隠し、上に少し戻すと出す。タブ行は隠さない
- 隠れた状態で、タブ行の上に `.topbar::before` のぼかしの帯を残さない(モック 3b の不具合)
- パソコン向けに「その他」へ再分析の入口を残す

既定値(停止不要。事後確認を推奨)
| 論点 | 採用 | 理由・影響 |
|---|---|---|
| パソコン幅(721px 以上)で隠すか | 隠さない(CSS をスマホ幅だけに当てる) | 721px 以上はポップオーバーがアンカー型でスクロールロックが無く、開いたまま隠れた行に残る。境界は `SHEET_MAX_WIDTH`(720)に揃える |
| 試合検索・総合戦歴の引っ張り | 受け付けない(レポートのみ) | 決定の文言どおり。両画面の再分析は「その他」から。旧ボタンが消える分の発見性は起票候補 |
| 「高さ0」の上部バー | 上部バーの中身は出さず、高さは `env(safe-area-inset-top)` だけ(通常のブラウザと ui-check では 0px) | ホーム画面アプリ(`black-translucent`)ではステータスバーの下に本文が透けるのを防ぐ必要がある。safe-area の無い環境では決定どおり高さ0 |
| 隠している間の範囲表示 | 既存の本文先頭 `.report-scope` で足りる | issue の文言は「本文先頭の範囲表示で分かること」。バーに常時出すと固定高さが 120px を超える |

## 1. 方針
- 上部バーは「絞り込み行+タブ行」を持つ1つの sticky 要素のまま、`.topbar-head` を撤去する
- 隠す仕組み: **sticky の `top` を負にするだけで、高さ・margin を変えない**。旧実装(67018e9〜1c6218f)は行の高さを縮めたため文書高が変わり scrollY が振動した。今回は文書高が不変なので、判定の入力(scrollY)が表示状態に依存せず、構造上振動しない
  - `transform` は不可(topbar.css:9-10 の注記のとおり、子孫の fixed シートの包含ブロックが変わる)。`max-height`・`margin` も不可(文書高が変わる)
  - 隠れた状態: `top: calc(env(safe-area-inset-top) - タブ行のバー内位置)` → タブ行の上端が画面上端(safe-area の直下)に付く。絞り込み行は `visibility:hidden`(レイアウトは保つ)
- **帯を出さない構造**: 3b の帯は、タブ行の上に上部バー自身の背景と `::before` のぼかしが残ることで出る。今回は (1) 上部バーの背景色 `--bg-a82` を要素本体から `::before` へ移し(見た目は同じ)、(2) 隠れた状態では `::before` の上端を「タブ行の位置 − safe-area」まで下げる。これで画面上の背景は「safe-area(ステータスバー)+タブ行〜バー下端」だけになり、safe-area 0 ではタブ行より上に何も塗らない。ui-check で帯の高さ 0px を数値検査する
- 判定はすべて純粋関数(`static/lib/topbar.js`)。DOM の読み取り・イベント登録は shell.js のフック/部品に閉じる
  - 旧実装の失敗(report.js 内の `useEffect([])` が `.controls-row` の style を直書きし、Skeleton⇔Report 切替で参照が切れる)を繰り返さない: 状態は Preact の state、描画は属性 `data-collapsed`。登録は AppShell の `useLayoutEffect([collapsible])` で、AppShell の再マウント(Skeleton→Report)と同一インスタンス内の画面切替(レポート→試合検索)の両方で登録・解除される
- 引っ張り: `document` に touchstart(passive)/touchmove(**passive:false**)/touchend/touchcancel。純粋関数が `prevent` を返したときだけ `preventDefault`(ページ最上部で下向きが優勢な移動のみ)。離したとき `distance >= しきい値` なら `onPull()`
  - 表示はモック 4b のとおり上部バーの上に差し込む(本文が下がる)。引っ張り中だけ描き、高さ = distance
- ブラウザ標準の引っ張り更新: `html:has(.view-root){overscroll-behavior-y:contain}`(アプリ画面だけ。ログイン画面は標準の再読み込みを残す)+上記の `preventDefault` の二重で止める。Safari での効き方は実機でしか判定できない(§8)
- 分析中は受け付けない: app.js に多重起動ロック(`static/lib/runlock.js`)を置き、`reAnalyze` 冒頭のガードと `REPORT_ACTIONS.canReanalyze` が同じ判定 `analysisBusy()` を使う。`activeJobId` は POST の応答後にしか入らないため、それより前の二重起動はロックで防ぐ
- パソコン向け: その他画面の「データ」先頭に「再分析」行。押すとレポート画面へ移ってから `onReanalyze()`
- 既存設計との整合
  - surface.test.js の「report.js に scroll リスナと `.style.maxHeight` が無い」は維持。新たに「scroll リスナは static 全体で shell.js の1か所だけ」「`.style.maxHeight` はどこにも無い」を足す
  - report-summary 設計書 C8(`topbarRef` が report.js・shell.js に0件)は維持。ref 名は `barRef`/`tabsRef`
  - #413 の「スクロールで隠さない」・#412 の「再分析ボタンは上部バーのまま、その他には出さない」は本設計で置き換える(両設計書に後続の1行を追記)

## 2. 変更予定ファイル
新規
- `static/lib/topbar.js` — `PULL`/`PULL_IDLE`/`pullStep`/`pullReady`/`BAR`/`BAR_SHOWN`/`nextBar`(純粋関数のみ。import なし)
- `static/lib/runlock.js` — `createRunLock`
- `static/__tests__/topbar.test.js`、`static/__tests__/runlock.test.js`
- `tools/ui-check/baseline/{mobile-report-scroll-up,mobile-pull,mobile-pull-release,more-reanalyze}-{dark,light}.png`

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
var REPORT_ACTIONS = { onReanalyze: reAnalyze, canReanalyze: function () { return !analysisBusy(); }, onLogout: logout, onRebuildCache: rebuildCache, autoRefresh: AUTO_REFRESH_ACTIONS };
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
- レポート本体: `<${AppShell} filters=${filters} tabs=${tabs} onPull=${actions.onReanalyze} canPull=${actions.canReanalyze} nav=${nav}>`
- search / classrecord: `<${AppShell} nav=${nav}>`(引っ張りなし。上部バーは bare)
- more: `<${AppShell} nav=${nav}>` の MoreView に `onReanalyze=${function () { nav.onNavigate('report'); actions.onReanalyze(); }}`
- Skeleton: 本体 `<${AppShell} filters=${filters} tabs=${tabs} nav=${n}>`(引っ張りなし)、more の MoreView に `onReanalyze=${function () { n.onNavigate('report'); actions.onReanalyze(); }}`
- MoreView: 先頭に `<div class="more-brand" data-ui="more-brand"><img src="logo.svg" alt="catalyzer" /></div>`。dataRows 先頭に `{ key: 'reanalyze', main: '再分析', sub: '公式サイトから新しい戦績を取得して分析し直します' }`。onSelect は `k === 'reanalyze'` で `onReanalyze()`、refetch は従来どおり

### app.js
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
/* shell.css */
html:has(.view-root) { overscroll-behavior-y: contain; }
.pull-zone { display: flex; flex-direction: column; align-items: center; justify-content: flex-end; gap: 4px; overflow: hidden; margin: calc(var(--gutter) * -1) 0 var(--gutter); color: var(--muted); font-size: 0.875rem; }
.pull-icon { display: flex; align-items: center; justify-content: center; flex: none; width: 32px; height: 32px; border: 2px solid var(--accent); border-radius: 50%; color: var(--accent); }
.pull-icon svg { width: 18px; height: 18px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
.more-brand { display: flex; justify-content: center; margin: 8px 0 24px; }
.more-brand img { display: block; height: 28px; width: auto; }
```
- `.topbar.topbar-bare` は2クラス(responsive.css の `.topbar` の padding が後読みで勝つため)
- `.pull-zone` の margin は、直後の上部バーの `margin-top:-gutter` と相殺して、引っ張り開始時にバーが跳ねないため
- 隠れた状態の `::before` は `top` だけ動かす(`inset:0` の他辺はそのまま)。これでタブ行より上を塗らない

### 固定高さの定義と見込み(390×844、safe-area 0)
- **定義**: 「スクロール中に固定される高さ」= 下スクロールで絞り込み行が隠れた状態での (A) 画面上端〜上部バー下端の高さ(上部バーの画面内に見えている部分)+ (B) 下部タブバーの高さ。**完了条件は A+B ≦ 120px(タブバー込み)**。あわせて「帯」= タブ行の上端 − 上部バーの見えている上端 = 0px を検査する
- 見込み: A = タブ行 49 + 下余白 6 + 下線 1 = 56px、B = 57px、**計 113px**(モック 3b は帯 約12px を含み 125px)。展開時の上部バーは 12+48+8+49+6+1 = 124px(現 169px)。上スクロールで再表示中は 124+57px になる(一時的)
- 実測が 120 を超えたら architect に戻す(タブ行・タブバーの寸法を独断で変えない)

### ui-check の追加仕様(check.js)
- `{ scrollBy: [dy] }`: `scrollBy(0,dy)` の後に2フレーム待つ(`awaitPromise`)。`{ pull: [dy, 'release'?] }`: CDP `Input.dispatchTouchEvent` で (幅/2, 300) から touchStart → touchMove 10段で y+dy → `'release'` のときだけ touchEnd。どちらも a[0] は数値(違えば InfraError)。操作前の要素待ち(:155)は click/type/scroll/wait だけにする
- ops に pull を含む画面はナビゲーション前に `Emulation.setTouchEmulationEnabled({enabled:true,maxTouchPoints:1})`。CDP のタッチが届かない場合の代替は、ページ内で `new TouchEvent(..., {touches:[new Touch({...})], cancelable:true})` を document に dispatch
- `outview: [[sel,text?]]`: inview の直後。まず countExpr で1件以上あること(無ければ `outview の対象なし <sel>`)、次に inviewExpr が true なら `画面内に見える <sel>` で fail
- `fixedMax: N`: outview の後・`scrollTo(0,0)` の前に1つの式で `{fixed, band}` を得る
  - fixed = `[data-ui="topbar"]` の rect.bottom を [0,innerHeight] に丸めた値 + (innerHeight − `[data-ui="tabbar"]` の rect.top)を [0,innerHeight] に丸めた値、の四捨五入。どちらか無ければ -1 → `固定高さの対象なし`
  - band = `[data-ui="topbar"] [role="tablist"]` の rect.top − max(0, topbar の rect.top) を四捨五入(tablist が無ければ 0)
  - 判定順は band → fixed。band > 0 は `上部バーの帯 Bpx(タブ行の上)`、fixed > N は `固定高さ Hpx が上限 Npx を超える` で fail(C10・C11 の注入がそれぞれ狙った方で落ちるため)。成功時は結果に `note: '固定 Hpx 帯 0px'` を持たせ、main の出力を `'OK ' + label + (r.note ? ' ' + r.note : '')` にする
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
{ id: 'mobile-pull', viewport: M, full: false, start: 'report', ops: [{ wait: ['[data-ui="report-scope"]'] }, { pull: [40, 'release'] }, { pull: [200] }],
  required: [['[data-ui="pull-indicator"]', '離すと再分析'], ['[data-ui="report-scope"]', '全期間・60試合']] },
{ id: 'mobile-pull-release', viewport: M, full: false, start: 'report', ops: [{ wait: ['[data-ui="report-scope"]'] }, { pull: [200, 'release'] }], required: [['#loginForm'], ['#analyzeBtn']] },
{ id: 'more-reanalyze', viewport: D, full: false, start: 'report', ops: [goTab('その他'), { click: ['[data-ui="more"] button', '再分析'] }], required: [['#loginForm'], ['#analyzeBtn']] },
// more / mobile-more の required に ['[data-ui="more"] button', '再分析'] と ['[data-ui="more-brand"] img'] を追加
```
- mobile-pull: 40px の離し(distance 20)で再分析しないことを「レポートが表示されたまま」で、200px の保持(distance 96)で「離すと再分析」の表示を確認し、その見た目を基準画像に撮る。プレビューはセッションが無いので、再分析が走るとログインフォームが出る(mobile-pull-release・more-reanalyze はこれで配線を確かめる)
- check.js は撮影前に `scrollTo(0,0)` と全高ビューポートにするため、スクロール中の見た目は基準画像に写らない。スクロール中の状態は inview/outview/fixedMax の数値検査で判定する

## 4. テスト計画
- topbar.test.js(新, 19件以上)
  - pullStep: enabled=false の start は idle で以後 fire しない / scrollY=1 の start は idle / slop 内の下向きは armed・prevent true、slop 内の横優勢は prevent false / 横に slop 超は idle / 上向きに slop 超は idle / dy=127 で end は fire false、dy=128 で fire true(境界) / dy=400 で distance=96 / pulling 中に scrollY>0 で idle・end で fire false / pulling 中に dy<=0 で idle / cancel で idle・fire false / pullReady の真偽
  - nextBar: y<=top は hidden からでも shown / shown から下へ23は shown・24で hidden / hidden から上へ15は hidden・16で shown / hidden 中の更なる下降で anchor が上がり、そこから16戻すと shown / shown 中の上昇で anchor が下がり、そこから24で hidden / y>max は max に丸め、下端バウンス(max+30→max)で shown にならない / 負の y は0に丸めて shown / ±5 の往復列で状態が一度も変わらない
- runlock.test.js(新, 4件): run 中 busy・終了後 false・戻り値 true / busy 中の run は false で fn 未呼び出し / release 後に新しい run が始められ、古い run の完了で新しい run が解放されない / fn の reject で busy false かつ reject が伝播
- skeleton-actions.test.js(+2): 全 `<${MoreView}` に `onReanalyze=`(2か所以上)/ `onPull=` を持つ全 `<${AppShell}` に `canPull=`(1か所以上)
- surface.test.js(+1): static 配下の .js(`__tests__`・`htm-preact-standalone.js`・`chart.umd.min.js` を除く)で `addEventListener('scroll'` を含むのは shell.js だけで1件、`.style.maxHeight` は0件。既存「report.js に…」は名前を「report.js はスクロール連動処理を持たない(shell.js に一元化)」へ
- screens.test.js: selectors() に outview を含め、selectors テストの期待値を `['a','[data-ui="x"]','[data-ui="y"]','b']` に / 「mobile-report-overview は…フィルタ群が画面内に見える」を「正の scrollBy の後に FILTERS 3つが outview、ACTIVE_TAB が inview、fixedMax <= 120」に置換 / 新: mobile-report-scroll-up は正→負の scrollBy の後に FILTERS が inview / 新: mobile-pull は `PULL.threshold / PULL.resist` 未満の pull を release した後に以上の pull を保持し、mobile-pull-release は以上の pull を release して `#loginForm` を必須にする(PULL は static/lib/topbar.js から import)
- ui-check: 既存の基準画像更新+新4画面(§5 C6〜C12)

## 5. 完了条件(基線 B=afc9aa5)
| # | 条件 | コマンド | 期待値 |
|---|---|---|---|
| C1 | JS テスト全緑 | `make test-js` | exit 0、fail 0、pass 285 以上(現 262) |
| C2 | 純粋関数テスト | `node --test static/__tests__/topbar.test.js` | exit 0、fail 0、pass 19 以上 |
| C3 | ロックのテスト | `node --test static/__tests__/runlock.test.js` | exit 0、fail 0、pass 4 |
| C4 | props 注入・静的検査 | `node --test static/__tests__/skeleton-actions.test.js static/__tests__/surface.test.js` | exit 0、fail 0、pass 9 |
| C5 | 画面定義の規約 | `node --test tools/ui-check/screens.test.js` | exit 0、fail 0、pass 10 |
| C6 | ui-check 全 OK を2回連続 | `make ui-check` を2回 | 両方 exit 0、最終行 `ui-check: 54/54 OK` |
| C7 | console エラー0 | `make ui-check 2>&1 \| grep -c "console エラー"` | 0 |
| C8 | 固定高さ(タブバー込み)120px 以下 | `node tools/ui-check/check.js mobile-report-overview \| grep '^OK' \| grep -oE '固定 [0-9]+px' \| grep -oE '[0-9]+' \| awk '$1<=120{n++} END{print n+0}'` | 2 |
| C9 | 帯が無い | `node tools/ui-check/check.js mobile-report-overview \| grep -c '帯 0px'` | 2 |
| C10 | 固定高さ検査が効く | `UI_CHECK_INJECT='mobile-report-overview:document.querySelector("[role=tablist]").style.paddingBottom="30px"' node tools/ui-check/check.js mobile-report-overview` と同コマンドの `\| grep -c "固定高さ"` | exit 1 / 2 |
| C11 | 帯の検査が効く | `UI_CHECK_INJECT='mobile-report-overview:document.querySelector("[data-ui=topbar]").style.top="calc(12px - var(--topbar-shift))"' node tools/ui-check/check.js mobile-report-overview` と同コマンドの `\| grep -c "上部バーの帯"` | exit 1 / 2 |
| C12 | 隠れ検査が効く | `UI_CHECK_INJECT='mobile-report-overview:document.querySelector("[data-ui=topbar]").dataset.collapsed="false"' node tools/ui-check/check.js mobile-report-overview` と同コマンドの `\| grep -c "画面内に見える"` | exit 1 / 2 |
| C13 | 引っ張り・再表示・その他の再分析 | `node tools/ui-check/check.js mobile-report-scroll-up mobile-pull mobile-pull-release more-reanalyze \| grep -c "^OK"` | 8 |
| C14 | 上部の行の撤去 | `grep -rnE "topbar-head\|topbar-refresh\|onRefresh\|\.topbar \.brand" static \| wc -l` / `grep -c 'class="brand"' static/components/shell.js` | 0 / 0 |
| C15 | 標準の引っ張り更新を止める | `grep -c "html:has(.view-root) { overscroll-behavior-y: contain; }" static/styles/shell.css` | 1 |
| C16 | 分析中ガードの配線 | `grep -c "analysis.run(" static/app.js` / `grep -cE "^\s*(reanalyzeWithSession\|analyze)\(\);" static/app.js` / `grep -c "if (analysisBusy()) return;" static/app.js` / `grep -c "analysis.release()" static/app.js` / `grep -c "canReanalyze:" static/app.js` | 4 / 0 / 1 / 1 / 1 |
| C17 | #413 C8 の維持・変えない基準画像・Go 不変 | `grep -c "topbarRef" static/components/report/report.js static/components/shell.js` / `git diff --name-only afc9aa5 -- 'tools/ui-check/baseline/login-*.png' 'tools/ui-check/baseline/parts-*.png' \| wc -l` / `git diff --name-only afc9aa5 -- '*.go' go.mod go.sum \| wc -l` | 各 0 / 0 / 0 |
| C18 | CLAUDE.md | `grep -c "27画面" CLAUDE.md` / `grep -c "54枚" CLAUDE.md` / `grep -cE "23画面\|46枚" CLAUDE.md` / `grep -cE "static/lib/(topbar\|runlock)\.js" CLAUDE.md` / `grep -c "outview" CLAUDE.md` | 2 / 2 / 0 / 2 / 2 以上 |
| C19 | README・旧設計書 | `grep -cE "(topbar\|runlock)\.js +#" README.md` / `grep -cE "(topbar\|runlock)\.test\.js +#" README.md` / `grep -c "2026-10-05-pull-to-refresh.md" docs/design/2026-10-05-report-summary.md docs/design/2026-10-04-bottom-tabbar.md` | 2 / 2 / 各 1 |
| C20 | 色リテラルなし | `grep -oE '#[0-9a-fA-F]{3,6}\b\|rgba?\(' static/styles/topbar.css static/styles/shell.css \| wc -l` | 0 |

C11 の注入はタブ行を上端から 12px 下げる(モック 3b の帯の再現)。

CLAUDE.md の更新箇所: 検証コマンドの ui-check 行(画面数・枚数、`outview`・`fixedMax` の検出)、コード構成の shell.js 行(上部バーの隠し・PullToRefresh・その他画面のロゴと再分析)、`static/lib/topbar.js`・`static/lib/runlock.js` の2行追加、tools/ui-check 行(27画面・54枚、操作に scrollBy/pull、検査に outview/fixedMax)、`static/__tests__/` 行に topbar/runlock。README: shell.js 行、`lib/` に2行、`__tests__/` に2行、surface.test の説明。

基準画像の更新規則(各ユニット): `make ui-check 2>&1 | grep FAIL` で (a) 理由が「基準画像と不一致」「基準画像なし」だけ、(b) id が §7 のそのユニットの想定リストの部分集合、を確認し出力を報告。そのうえで `node tools/ui-check/check.js --update ${=IDS}`(zsh)で該当 id だけ更新。`make ui-baseline` は禁止。リスト外が落ちたら原因を調べてから。

レビュー観点(完了条件とは別): しきい値(128px)とヒステリシス(24/16px)の操作感 / 引っ張り表示のモック 4b との一致 / 隠れた状態のモック 3b との差(帯が無いこと) / 「再分析」行の文言と位置 / フック・部品の責務分割と依存配列 / app.js のロック導入範囲

## 6. 影響範囲
- 全 AppShell 画面(レポート5タブ・試合検索・総合戦歴・その他・Skeleton)の上部が変わる。試合検索・総合戦歴・その他は上部バーが無くなり(safe-area のみ)、本文が上がる
- 再分析の入口: 上部ボタン(3画面)→ レポートの引っ張り+その他の行。試合検索・総合戦歴からの直接の再分析は無くなる
- 分析の多重起動: 従来は防いでいなかった(ボタン連打で2本走り得た)。ロック導入で、ログイン送信・起動時復元を含む全経路が1本に制限される。全件再取得(`rebuildCache`)は従来どおり別管理
- `html` の overscroll: アプリ画面ではブラウザ標準の引っ張り更新と上端の伸びが止まる。ログイン画面は従来どおり
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

実装メモ
- コミットメッセージは1行目 `<type>: #363 <何を・なぜ>`、本文末尾は `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>` の1行のみ。Claude-Session 行は入れない(公開リポジトリ)
- rm/mv は `/bin/rm -f`・`/bin/mv -f` か `git rm`/`git mv`
- PR 前に origin/develop へ rebase し基準画像を撮り直す(PNG を手でマージしない)。PR base は develop
- 完了後、本設計書のステータスを implemented にする(design-doc skill)

## 8. 実機確認項目(main・オーナー。ui-check では判定できない)
1. iOS Safari(ブラウザ): レポート最上部で引っ張る→↻と「離すと再分析」→離すと #status「最新データを取得中...」が出て、ページの再読み込みが起きない
2. iOS ホーム画面アプリ: 同上。隠れた状態でステータスバーの下に絞り込みのチップが透けず、タブ行の上に帯が無い(ステータスバーの範囲だけ塗られる)。試合検索・総合戦歴で本文がステータスバーに潜らない
3. Android Chrome: 同上。標準の更新スピナーが出ない
4. しきい値未満で離すと何も起きない。分析中(#status 表示中)は引っ張っても表示が出ない
5. 下スクロールで絞り込み行が隠れ、少し上に戻すと出る。ゆっくりのスクロール・下端のバウンスでちらつかない
6. 期間シート・試合詳細モーダルを開いた状態で引っ張っても再分析しない
7. 最上部でタブ行を横にスワイプするとタブが横に流れ、引っ張りにならない
8. 端末の回転・文字サイズ変更の後も、隠れた状態のタブ行の位置が正しい
9. パソコン: その他→「再分析」でレポート画面に移り再分析が始まる。721px 以上では行が隠れない
10. ログイン画面ではブラウザ標準の引っ張り更新が従来どおり使える

## 9. リスク
- iOS Safari で `overscroll-behavior` と `preventDefault` の両方が効かず標準の再読み込みと二重に動く: §8-1 で判定。起きたら architect に戻す(再読み込みされてもキャッシュから即時表示されるため、データは失われない)
- `touchmove` を passive:false で document に登録する: 処理は O(1) で、`preventDefault` は最上部の下向きだけ
- 引っ張り中の差し込みでレポート全体が再レイアウトされる: 引っ張り中のフレームに限られる。重ければ実機確認で報告し、重ね表示へ切り替える(設計の差し戻し)
- CDP のタッチ配送がヘッドレスで届かない: §3 の代替(ページ内 TouchEvent)
- `.topbar-tabs` の包みで横にはみ出す: `min-width:0` で防ぎ、ui-check の左右はみ出し検査で検出される

## 10. ナレッジ候補・起票候補
- ナレッジ(knowledge-add): (1) 上部バーの隠しは sticky の top だけで行う。高さ・margin を変えると文書高が変わり scrollY が振動する(旧実装の失敗)。transform は子孫の fixed シートを壊す。背景は ::before に持たせ、隠れた状態ではタブ行より上を塗らない(帯対策) (2) ui-check は撮影前に scrollTo(0,0)・全高ビューポートにするので、スクロール中の状態は inview/outview/fixedMax の数値で検査する (3) 分析の多重起動はロック1つ(release で古い run を切り離す)。activeJobId は POST 応答後にしか入らない (4) CDP でタッチを送る条件(実装後の実測で確定してから書く)
- 起票候補(issue-create): 試合検索・総合戦歴・パソコン幅で再分析が「その他」だけになった発見性 / 隠れている間も範囲を常時示す表現(固定高さとの両立) / 全件再取得と再分析の同時実行の整理(rebuildingCache とロックの統合)
