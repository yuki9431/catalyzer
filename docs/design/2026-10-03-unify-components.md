# 設計: デザイン刷新 段階A(3/3) 部品と外枠の統一

- ステータス: implemented
- 後続: #412 で HamburgerMenu を下部タブバーとその他画面に置換(2026-10-04-bottom-tabbar.md)
- 日付: 2026-10-03
- 関連 issue: #424(親 #411、依存 #423 マージ済み、関連 #400、後続 #425 / #412〜415)

## 1. 方針

見た目は1画素も変えず構造だけを入れ替える。既存の DOM・クラス名・CSS は残し、共通化するのは状態・イベント・設定組み立て・外枠の定義に限る。最初に data-ui を付け ui-check をそれで探す形に切り替え、以降の単位で目印が落ちたら必須要素チェックで検出する。見た目の作り直しは段階B(#412〜)。

### 主要判断
| 論点 | 採用 | 却下案と理由 |
|---|---|---|
| ポップオーバーの形 | `usePopover` フック(開閉・外側クリック・Esc・位置・スクロールロック)+ `Popover` 描画部品。クラス名は呼び出し側が渡す | 共通クラス `.popover` で描き直す案: CSS が変わり画素差が出る(段階Bで)/ PartnerDropdown を Dropdown に置換: label の `.panel-select-label` 包みで省略表示の画素が変わる |
| 外側クリック検出 | `useDismiss(active, rootRef, onDismiss)` が開いている間だけ document に click(capture)を登録。リスナーを書く場所はこのフック1か所 | モジュール単位の単一リスナー+登録表: コード増、ネスト・破棄順バグの余地 |
| イベント種類 | click capture に統一(PeriodSelector/SortControl の mousedown も click に) | 5種中4種が既に click capture。差は閉じる瞬間のみ |
| Esc | 追加。DetailModal の既存 Esc と HamburgerMenu も `useDismiss(…, null, …)` に乗せる | 追加しない案: issue が Esc を1か所にと明記。見た目は変わらない |
| backdrop | 期間・機体の backdrop と新設 `.popover-backdrop` は Popover が描く。`modal-backdrop`・`menu-backdrop` は全画面オーバーレイなので backdrop クリックは各部品に残し Esc のみ共通化。件数 grep に含めない | backdrop も含める案: モーダル・ドロワーはポップオーバーではない |
| `#rememberModal`(素の DOM) | 対象外(起票候補) | Preact 外で共通フックを使えない |
| モバイル body スクロールロック | `lockScroll` オプション。期間のみ true(現状どおり) | 常にロック: 機体セレクタの挙動が変わる |
| ボトムシート | `popoverStyle(mode, rect, vw)` に `sheet-bottom` を足し Dropdown/MultiSelect に `mode` prop。既存は `anchor` / `sheet-top`(現状の上端シート)のまま | 期間・機体をボトムシート化: 見た目が変わる(既定値に反する) |
| 外枠 | `AppShell`(view-root・トップバー・HamburgerMenu・本文)。レポート固有は `controls` スロット、スクロール効果用 DOM 参照は `topbarRef` prop。メニュー開閉は AppShell が持つ | Topbar のみ部品化: HamburgerMenu が4重複のまま / スクロール効果を AppShell へ: マウント時1回登録の現挙動が変わる |
| グラフ | `ChartCanvas({build, deps, className, style})` が唯一の生成箇所。設定は `winRateComboConfig` と軸・凡例・色ヘルパ | useChart フック: ref と markup が残り重複が減らない / 汎用設定関数1つ: radar・横棒・単系列でフラグだらけ |
| テーマ値の読み方 | `themeReader()` が getComputedStyle を1回だけ呼び読み取り関数を返す。描画ごと・render ごとに作り直し、キャッシュしない。呼び出し側のローカル変数名は `cssVar` のまま | モジュールキャッシュ: #425 のテーマ切替に追従せず前段設計と矛盾 |
| app.js 分割の循環参照 | `renderReport`/`showSkeleton` が `actions={onReanalyze,onLogout,onRebuildCache}` を props で注入。report/ は app.js を import しない | 循環 import: 評価順依存 / 登録モジュール: 可変グローバル増 |
| data-ui の状態表現 | ARIA 属性(aria-selected / aria-pressed / aria-expanded) | `data-ui="tab-active"`: 状態で目印が変わる |
| 新部品 CSS | `static/styles/parts.css` を新設し responsive.css の直前に link | 一覧ページのみ読込: 段階Bで link 追加が要る。既存に合致するセレクタが無く画素不変 |
| 部品一覧の撮影 | `parts`(デスクトップ全体)と `parts-sheet`(モバイル幅でボトムシートを開いた状態)の2画面 | 1画面: ボトムシートが画素で確認できない |

### 件数の定義(issue の「17か所」との差)
実コードの document への click/mousedown リスナーは7件(ui.js 186/237/283、app.js 128/299/647、search.js 496)、Esc は1件(search.js:391)で17件にならない。完了条件は実在パターンへの grep で定義する(5章)。backdrop 方式は件数に含めない。

## 2. 変更ファイルと変更内容

### 2.1 data-ui 命名規則
- `data-ui="<部品>[-<部位>]"` kebab-case、役割で命名。同じ部品の全インスタンスに同じ値。状態は ARIA。
- screens.js は `[data-ui=…]`・id・タグ名・ARIA 属性のみ(クラス名禁止。screens.test.js で検査)。CSS に属性セレクタは無く画素不変。

### 2.2 クラスから data-ui への対応
| 旧セレクタ | 新セレクタ | 付与先 |
|---|---|---|
| `.hamburger` | `[data-ui="menu-open"]` | ハンバーガーボタン |
| `.menu-item` | `[data-ui="menu-item"]` | HamburgerMenu の全項目 |
| `.tab.active` / `.tab` | `[data-ui="tab"][aria-selected="true"]` / `[data-ui="tab"]` | タブボタン(role=tab aria-selected、親 .tabs に role=tablist、Skeleton も) |
| `.panel h2` | `[data-ui="panel"] h2` | Panel |
| `.kpi-grid` | `[data-ui="kpi-grid"]` | KpiGrid、ClassRecordView(Skeleton は付けない) |
| `.lens-btn` | `[data-ui="lens"]` | LensToggle ボタン |
| `.period-trigger/.period-dropdown/.period-dropdown-item` | `period-trigger/period-panel/period-item` | PeriodSelector(日付指定ボタンも period-item)。Skeleton ダミーには付けない |
| `.ms-topbar-trigger/-dropdown/-item` | `ms-trigger/ms-panel/ms-item` | MsSelector |
| `.search-filter-panel/.search-filter-head` | `search-filter/search-filter-toggle` | FilterForm |
| `.search-item` | `search-result` | ResultItem |
| `.search-filter-panel .panel-select-trigger:not(.search-date-trigger)` | `[data-ui="search-filter"] [data-ui="select-trigger"]` | Dropdown/MultiSelect/PartnerDropdown のトリガー。日付トリガーには付けない(付けるなら date-trigger) |
| `.panel-select-dropdown` | `select-panel`(項目 `select-item`) | 同パネル |
| `.search-detail-tl-toggle` | `match-timeline-toggle` | DetailModal |
| `.modal-backdrop .search-detail-table` | `[data-ui="match-detail"] [data-ui="match-score-table"]` | DetailModal ルートとスコア表 |
| `.gantt/.gantt-bar` | `gantt/gantt-bar` | Timeline |
| `.skel` | `[data-ui="skeleton"]` | Skeleton の bar() の各 div |
その他: トップバーのルートに `topbar`。新部品に `chip/toggle/summary/row-list/notice`。一覧ルート `parts-gallery`、ボトムシートデモ `sheet-demo`。

### 2.3 ファイル別
- 新規 `static/components/popover.js`: popoverStyle / useDismiss / usePopover / Popover。document リスナー(click・keydown)と 'Escape' 判定はここだけ。
- `ui.js`: Dropdown・MultiSelect を usePopover+Popover に載せ替え(`mode` prop、既定 'anchor'、検索入力の focus は useEffect([pop.isOpen]))。Autocomplete は useDismiss。U6 で Panel(data-ui="panel")をここへ移す。
- `search.js`: SortControl を useDismiss に。DetailModal は keydown 部分のみ `useDismiss(true,null,onClose)`(overflow ロック effect は残す)。radarPlayers の色は `var cssVar = themeReader();` で1回。data-ui 付与。
- `classrecord.js`: .kpi-grid に data-ui。
- 新規 `shell.js`: AppShell(トップバー唯一の定義)、HamburgerMenu・ShareArea を app.js から移す。HamburgerMenu に `useDismiss(isOpen,null,onClose)`(既存 useEffect の後、`if(!isOpen) return null` の前)。
- 新規 `chart-canvas.js`: ChartCanvas(`new Chart(` 唯一)、charts.js から移す useInView(非export)・winRate50Plugin。ヘルパ winRateColors/xAxis/pctAxis/countAxis/comboLegend/winRateComboConfig。値と式は現状のまま(閾値 >=60 / <50、中間色は combo が --accent-2-a30、MsCompare が --accent-2-a35)。
- `charts.js`: TimeOfDay/DayOfWeek/DailyTrend/Season/WinRateBar は winRateComboConfig(差分は pointRadius/xTicks/tooltipTitle/plain)。DmgContribution/CompareRadar は軸ヘルパ。8種すべて ChartCanvas。app.js から MsCompareChart と inBarLabel(描画1回につき themeReader 1回)を移す。
- `lib/theme.js`: cssVar の export 削除、themeReader に置換。
- 新規 `components/report/`(9ファイル、本文は変えず移す。変更は data-ui・actions 注入・AppShell 化のみ): report.js(Report/Skeleton/TAB_DEFS/CLASS_RECORD_KEY/load,saveClassRecord)、controls.js(PERIOD_KEYS/TimeSelector/PeriodSelector/MsSelector/LensToggle)、kpi.js、action-plan.js(FOCUS_KEY export〜ActionPlanPanel)、overview.js(msCompareMinMatches/BasicLensSection/PartnerDropdown/FixedPartnerPanel/OverviewPane)、playstyle.js/burst.js/matchup.js/time.js。
- `app.js`: 定数・activeJobId・reAnalyze・reanalyzeWithSession・logout・showSkeleton・renderReport・rebuild系・analyze・フォーム/モーダル配線・initSession・`window.renderReport` のみ。`var REPORT_ACTIONS = {...}` を renderReport 直前(initSession IIFE 前)に置く。Preact コンポーネントは定義しない。
- 新規 `parts.js`: 新部品5種。
- styles: tokens.css「CSS 用の色」節(22-76行)を link 順の初出順に並べ替え(値不変)/ responsive.css の600px `.container` 行を削除 / filters.css 末尾に `.popover-backdrop{display:none}` / responsive.css 720px ブロックに `.popover-backdrop{display:block;position:fixed;inset:0;background:var(--scrim);z-index:99}` / 新規 parts.css(接頭辞 `ui-` のみ、既存トークンのみ、色直書き・!important 禁止、base.css の button 全体指定は各ボタンクラスで打ち消す)。
- index.html: parts.css の link を responsive.css 直前に1行(U7)。
- theme.test.js: 走査を app.js + components/・lib/・analysis/ の再帰(`readdirSync(…,{recursive:true})`)に。定義検出 `DEF_RE=/(?:^|[{;])\s*(--[a-z0-9-]+)\s*:/gm`(stray 検査にも)。テスト1は `themeReader()('--accent')===''` に。
- 新規テスト: popover.test.js、chart-canvas.test.js、tools/ui-check/screens.test.js。
- check.js: `var START_URL={login:'/',report:'/__preview/',parts:'/__preview/parts.html'}`。未知 start は InfraError。`/` への遷移待ちは report のときのみ。
- screens.js: 2.2 で書き換え+2画面追加。
- 新規 `tools/ui-check/preview/parts.html`+`parts.js`(index.html と同順で /styles/*.css を link、順序は screens.test.js で照合。`.container[data-ui="parts-gallery"]` 内に各部品を `div.panel[data-ui="panel"]`+h2 で並べ、最後に `[data-ui="sheet-demo"]` に `Dropdown mode="sheet-bottom"`(5項目)。外部リクエストなし、390px で横はみ出しなし)。
- baseline: 追加は parts.png と parts-sheet.png のみ。既存16枚と meta.json は不変。
- CLAUDE.md / README: C17・C18 の範囲(全16画面→全18画面、コード構成に report/・shell.js・popover.js・chart-canvas.js・parts.js・parts.css・data-ui 追記、styles 全15ファイル、新画面のみ基準作成する `node tools/ui-check/check.js --update <id>…` の注記)。

## 3. インターフェース
```js
// lib/theme.js
export function themeReader() // getComputedStyle を1回だけ呼び cssVar(name) を返す。Node では ''。未定義は console.error(現状同)。キャッシュしない
// 規約: 描画/render スコープ先頭で `var cssVar = themeReader();` し cssVar('--x') を文字列リテラルで呼ぶ
// components/popover.js
export var SHEET_MAX_WIDTH = 720;
export function popoverStyle(mode, triggerRect, viewportWidth)
//  'anchor' → {} / 'sheet-top' → (rect && vw<=720) ? {top: rect.bottom+4+'px'} : {}
//  'sheet-bottom' → vw<=720 ? {position:'fixed',top:'auto',bottom:'0',left:'0',right:'0',width:'100%',minWidth:'0',maxHeight:'70vh',margin:'0',borderRadius:'8px 8px 0 0'} : {}
export function useDismiss(active, rootRef, onDismiss) // active 中のみ Esc、rootRef があれば外側 click(capture)でも閉じる
export function usePopover({mode='anchor', lockScroll=false, onClose}) // => {isOpen,open,close,toggle,rootRef,triggerRef,mode,panelStyle}
//  close=setOpen(false)+onClose()。lockScroll は PeriodSelector 現行実装(132-139行)と同処理を [isOpen] で。rect は mode!=='anchor' かつ開時のみ
export function Popover({pop, panelClass, backdropClass, ui, children}) // 閉なら null。開なら [backdrop?, div.panelClass[style=pop.panelStyle][data-ui=ui]]。backdropClass 無指定は sheet-bottom のとき 'popover-backdrop'、他は無し(null、'' は返さない)
// components/shell.js
export function AppShell({topbarRef, onRefresh, controls, menu, children}) // menu:{shareData,onLogout,currentView?,onNavigate?,onRebuildCache}
// div.view-root > div.topbar[ref][data-ui=topbar](hamburger, brand, onRefresh あれば .topbar-refresh, controls) > HamburgerMenu > children
// components/chart-canvas.js
export function ChartCanvas({build, deps, className='chart-container', style}) // build(cssVar)→設定 / null なら描かない。effect deps は deps.concat([inView])
export function winRateColors(cssVar, values, midToken) // >=60 --win-a70 / <50 --terrible-a70 / 他 midToken
export function winRateComboConfig(cssVar, o) // o:{labels,winRates,matches,pointRadius=4,xTicks={},tooltipTitle?,plain=false}。plain=true(WinRateBar): 線系列に backgroundColor 無し、凡例 {labels:{color,font:{size:12}}}
// components/report/report.js
export function Report({data,userKey,actions}) / export function Skeleton({actions}) // actions:{onReanalyze,onLogout,onRebuildCache}
// components/parts.js
Chip({tone,active,onClick,children}) // span|button.ui-chip[data-ui=chip] tone good|bad、クリック可なら aria-pressed
ToggleGroup({options,value,onChange,label}) // div.ui-toggle[role=group][data-ui=toggle] > button.ui-toggle-btn[aria-pressed]
Summary({items}) // dl.ui-summary[data-ui=summary] items:[{label,value,sub?,tone?}]
RowList({rows,onSelect}) // ul.ui-rows[data-ui=row-list] > li.ui-row rows:[{key,main,sub?,aside?}]
Notice({tone='info',children}) // div.ui-notice.ui-notice-<tone>[data-ui=notice] error は role=alert、他 role=status
```
5種の載せ替え:
| 部品 | 残すもの | usePopover 設定 |
|---|---|---|
| Dropdown/MultiSelect | panel-select-* クラス、検索入力、クリア項目、type=button、aria-expanded | {mode, onClose: setQuery('')}、panelClass panel-select-dropdown |
| PartnerDropdown | trigger の `${label} <span class="period-arrow">` 構造 | {}、panelClass 同上 |
| PeriodSelector | .period-*、カスタム日付、scrollIntoView。hooks 前の早期 return は現位置のまま | {mode:'sheet-top', lockScroll:true}、backdropClass period-backdrop |
| MsSelector | .ms-topbar-* | {mode:'sheet-top'}、backdropClass ms-topbar-backdrop |

## 4. テスト計画と作業単位
追加テスト(196→207): theme.test +2(DEF_RE が1行書き `:root { --x: 1px; --y: 2px }` から2件拾う / themeReader を1回呼び2トークン読んで getComputedStyle 1回、document/getComputedStyle をスタブし finally で戻す)、screens.test +2(全画面の ops・required に `/(^|[\s>+~,(])\.[A-Za-z_-]/` 合致なし / parts.html と index.html の styles link 順一致)、popover.test +4(anchor は {} / sheet-top 720 で top、721 で {} / sheet-bottom 720 で deepEqual、721 で {} / rect null で {})、chart-canvas.test +3(`n=>n` リーダーで winRateColors [60,59.9,50,49.9]→[win-a70,mid,mid,terrible-a70] / combo: bar+line、line に --accent-2-a10、y 0-100、y1 stepSize 1、plugins winRate50Line 1件、legend.generateLabels あり / plain: 線系列に own backgroundColor なし、generateLabels なし)。
既存16画面は画素完全一致で見た目不変を判定。

追加画面:
```js
{ id:'parts', viewport:D, full:true, start:'parts', ops:[],
  required:[['[data-ui="parts-gallery"]'],['[data-ui="chip"]',null,2],['[data-ui="toggle"]'],['[data-ui="summary"]'],['[data-ui="row-list"]'],['[data-ui="notice"]',null,3]] },
{ id:'parts-sheet', viewport:M, full:false, start:'parts',
  ops:[{click:['[data-ui="sheet-demo"] [data-ui="select-trigger"]']}], required:[['[data-ui="select-panel"]']] },
```

### 作業単位(1単位=1コミット。赤のまま次へ進まない)
| 単位 | 内容 | 完了コマンドと期待値 | コミット文言案 |
|---|---|---|---|
| U0 | 基線確認 | make test-js tests 196 / make ui-check 16/16 で WARN Chrome 行なし / go build ./... && go test -race ./internal/... exit 0。外れたら着手せず main へ | (なし) |
| U1 | nit: tokens 並べ替え、responsive.css .container 削除、theme.test 再帰化・analysis/ 追加・DEF_RE+テスト | C14・C15 / test-js 197 / ui-check 16/16 | refactor: #424 tokens.css の CSS 用の色を出現順に並べ替え、重複した .container を削除し theme.test を再帰走査にする |
| U2 | data-ui 付与(2.2)、screens.js 書換、screens.test(1件) | C1 / test-js 198 / ui-check 16/16 | test: #424 部品に data-ui を付け ui-check の操作・必須要素を data-ui で探す |
| U3 | popover.js、5種+Autocomplete・SortControl・DetailModal・HamburgerMenu 載せ替え、.popover-backdrop CSS、popover.test | C3〜C6 / test-js 202 / ui-check 16/16 | refactor: #424 ドロップダウン5種を共通ポップオーバーに載せ替え、外側クリックと Esc の処理を1か所に集約 |
| U4 | shell.js(AppShell・HamburgerMenu・ShareArea)。3ビューと Skeleton を AppShell に | C8 / test-js 202 / ui-check 16/16 | refactor: #424 上部バー・本文・メニューを AppShell にまとめ、トップバーの4重複を解消 (#400) |
| U5 | chart-canvas.js、themeReader、charts.js 移行、MsCompareChart/inBarLabel 移動、残る cssVar 呼出を reader に、テスト | C7・C9・C10 / test-js 206 / ui-check 16/16 | refactor: #424 グラフ生成を ChartCanvas に一本化して凡例・軸・色を共通化し、テーマ値を1描画1回で読む |
| U6 | app.js を components/report/ へ分割、Panel を ui.js へ | C11・C12 / test-js 206 / ui-check 16/16 | refactor: #424 app.js をビュー・タブごとに static/components/report/ へ分割 |
| U7 | parts.js・parts.css・index.html link・部品一覧ページ・check.js start 追加・2画面追加・screens.test 1件。`node tools/ui-check/check.js --update parts parts-sheet` で新2画面のみ基準作成(make ui-baseline は禁止) | C2・C13 / test-js 209 / ui-check 18/18 | feat: #424 段階B向けの共通部品(チップ・切替・要約・行リスト・通知)と部品一覧プレビューを追加 |
| U8 | CLAUDE.md・README 更新 | C17・C18 | docs: #424 CLAUDE.md と README のコード構成を部品分割に合わせて更新 |
| 最終 | 全完了条件。ui-check は2回連続 | 5章すべて | (設計書ステータスは運転者が更新) |

## 5. 完了条件
worktree 内で検証。`BASE=$(git merge-base HEAD origin/main)`。
| # | 条件 | コマンド | 期待値 |
|---|---|---|---|
| C1 | screens.js にクラス名セレクタなし(.skel 含む) | `grep -oE "['\" (]\.[A-Za-z]" tools/ui-check/screens.js \| wc -l` | 0(現状40) |
| C2 | 追加基準画像は新2枚のみ | `git diff --name-status $BASE -- tools/ui-check/baseline` | 2行のみ A parts-sheet.png / A parts.png |
| C3 | 外側クリック判定1か所 | `grep -rnE "document\.addEventListener\('(click\|mousedown\|pointerdown\|touchstart)'" static/app.js static/components static/lib \| wc -l` | 1(現状7)、popover.js |
| C4 | Esc 1か所 | `grep -rnE "document\.addEventListener\('keydown'" …` と `grep -rn "'Escape'" static/app.js static/components static/lib \| wc -l` | どちらも 1 で popover.js |
| C5 | 5種が共通ポップオーバー上 | `grep -rn "usePopover(" static/components \| grep -v "function usePopover" \| wc -l` | 5 |
| C6 | パネルは Popover が描く | `grep -rnE "class=\"(period-dropdown\|ms-topbar-dropdown\|panel-select-dropdown)\"" static/app.js static/components \| wc -l` | 0 |
| C7 | new Chart( 1か所 | `grep -rn "new Chart(" static/app.js static/components static/lib \| wc -l` | 1(現状8)で chart-canvas.js |
| C8 | トップバー定義1か所 | `grep -rn 'class="topbar"' static/app.js static/components static/index.html \| wc -l` | 1(現状4)で shell.js |
| C9 | getComputedStyle は theme.js のみ | `grep -rn "getComputedStyle" static/app.js static/components static/lib static/analysis \| wc -l` | 1 |
| C10 | cssVar を import するモジュールなし | `grep -rnE "import[^;]*\bcssVar\b" static/app.js static/components static/lib \| wc -l` と `grep -c "export function cssVar" static/lib/theme.js` | どちらも 0 |
| C11 | app.js にコンポーネント定義なし | `grep -cE "^(async )?function [A-Z]" static/app.js` / `wc -l < static/app.js` / `grep -c "window.renderReport = renderReport" static/app.js` | 0 / 650以下 / 1 |
| C12 | タブごとのファイル | `ls static/components/report/*.js \| wc -l` | 9 |
| C13 | 画面一致・console エラーなし | `make ui-check` を2回連続 | 2回とも `ui-check: 18/18 OK`、exit 0 |
| C14 | tokens CSS 用の色が初出順 | 下記スクリプト | OK(現状NG) |
| C15 | 重複 .container 削除 | `grep -c "\.container" static/styles/responsive.css` | 0 |
| C16 | JS テスト全緑 | `make test-js` | tests 209 / fail 0 |
| C17 | CLAUDE.md 更新 | `grep -c "全16画面" CLAUDE.md` / `grep -c "全18画面" CLAUDE.md` / `grep -cE "components/report/\|popover.js\|shell.js\|chart-canvas.js\|parts.js\|data-ui" CLAUDE.md` | 0 / 1以上 / 6以上 |
| C18 | README 更新 | `grep -cE "report/\|popover.js\|shell.js\|chart-canvas.js\|parts.js\|parts.css" README.md` | 6以上 |
| C19 | Go oracle(Go は変更しない) | `go build ./...` / `go test -race ./internal/...` / `~/go/bin/golangci-lint run` / `gofmt -l .` / `git diff --name-only $BASE -- '*.go' \| wc -l` | exit 0 / exit 0 / 0件 / 出力なし / 0 |
| C20 | 色直書き禁止維持 | `grep -oE '#[0-9a-fA-F]{3,6}\b\|rgba?\(' $(ls static/styles/*.css \| grep -v tokens.css) \| wc -l` | 0 |

C14 スクリプト(コミットしない):
```sh
node -e 'const fs=require("fs"),d="static/styles/";const order=[...fs.readFileSync("static/index.html","utf8").matchAll(/href="styles\/([a-z-]+\.css)"/g)].map(m=>m[1]).filter(f=>f!=="tokens.css");const css=order.map(f=>fs.readFileSync(d+f,"utf8")).join("\n");const sec=fs.readFileSync(d+"tokens.css","utf8").split("/* CSS 用の色 */")[1].split("/* JS")[0];const n=[...sec.matchAll(/(--[a-z0-9-]+)\s*:/g)].map(m=>m[1]);const f=x=>css.indexOf("var("+x+")");const s=[...n].sort((a,b)=>f(a)-f(b));console.log(n.every(x=>f(x)>=0)&&JSON.stringify(n)===JSON.stringify(s)?"OK":"NG")'
```
レビュー観点(完了条件とは分離): data-ui 命名の妥当性 / 新部品 API と CSS 粒度 / Esc を足した範囲(menu・Autocomplete・SortControl) / AppShell の props / winRateComboConfig の読みやすさ / 移設後 Report の hooks 順序 / ui-check に写らない状態(Esc、デスクトップで機体・相方ドロップダウン、モバイルで機体を開いた状態)。

## 6. エスカレーション事項
4条件はすべて該当なし(基準画像は新規2枚追加のみ、make ui-baseline と既存基準更新は禁止)。既定値と違う判断なし。補足: 「17か所」を実在パターンで再定義 / Esc 追加と click 統一は挙動変更だが見た目不変 / タブへの role・aria-selected 追加は画素に影響しない。U0 で基線が 16/16 でない・WARN Chrome が出る場合(基準 Chrome 154.0.8037.95 / darwin-x64)は実装せず main へ。環境: rm/mv は対話確認でハングするので `/bin/rm -f` `/bin/mv -f`。

## 7. 起票候補・ナレッジ候補
- 起票候補: PeriodSelector(85-86行)と Report(1290行)の hooks 前早期 return / controls-row スクロール隠し処理がマウント時1回のみ登録 / `#rememberModal` が Esc で閉じず useDismiss 非対応 / responsive.css の scrim 重複4か所・period/ms トリガー同一スタイル二重(段階Bで整理)
- ナレッジ候補: 共通ポップオーバーはクラス名を呼び出し側が渡す(画素一致維持のため)/ themeReader は1描画1回・非キャッシュ(#425 追従)/ Report へのアクションは props 注入で循環回避 / ui-check は data-ui+ARIA で探す / ui-check-headless-chrome-determinism.md の「PR #428 未マージ」は古い

## 8. 変更予定ファイル
新規: static/components/{popover,shell,chart-canvas,parts}.js、static/components/report/{report,controls,kpi,action-plan,overview,playstyle,burst,matchup,time}.js、static/styles/parts.css、static/__tests__/{popover,chart-canvas}.test.js、tools/ui-check/screens.test.js、tools/ui-check/preview/{parts.html,parts.js}、tools/ui-check/baseline/{parts,parts-sheet}.png
変更: static/app.js、static/index.html、static/components/{ui,charts,search,classrecord}.js、static/lib/theme.js、static/styles/{tokens,responsive,filters}.css、static/__tests__/theme.test.js、tools/ui-check/{screens,check}.js、CLAUDE.md、README.md、docs/design/2026-10-03-unify-components.md

## 9. 実装時の規約
- 1作業単位=1コミット。メッセージは4章の文言案。
- コミットメッセージに Claude-Session 行を入れない。末尾は `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>` の1行のみ。
- コメントは1行で「なぜ」のみ。経緯・比較は本設計書を参照。
- push・PR は行わない。
