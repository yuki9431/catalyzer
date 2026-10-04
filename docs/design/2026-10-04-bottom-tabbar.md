# 設計: デザイン刷新 段階B(1/4) 下部タブバーと「その他」画面

- ステータス: draft
- 日付: 2026-10-04
- 関連 issue: #412(親 #410、依存 #411 / #425)

## 1. 方針
AppShell のハンバーガーとドロワー(HamburgerMenu・menu.css)を、固定の下部タブバー(TabBar)と「その他」画面(MoreView)に置き換える。どちらも shell.js に置き AppShell が描画する。`catalyzer_view` の読み書きは `useView()` フックにまとめ Report と Skeleton で共有する。その他画面は既存の `Panel`(ui.js)と `RowList`(parts.js)で作り、RowList に行種別(外部リンク・危険操作・展開)を3つ足す。上部バーの絞り込み(controls)には触らない。

### 主要判断
| 論点 | 採用 | 却下案と理由 |
|---|---|---|
| タブバー表示範囲 | AppShell を使う全画面で全幅固定(レポート・検索・総合戦歴・その他・Skeleton)。ログイン画面は出さない | PC 幅で隠す: PC 専用は対象外、全幅でも崩れない |
| Skeleton | 出す。単独 Skeleton は自前 `useView()`。その他を開ける。検索/総合戦歴は骨組みのまま現在タブだけ移り、Report が出た時点でその画面 | 出さない: 分析中のログアウト導線が消える(#424 で actions 必須にした理由) |
| その他の保存 | 保存。読み出しは TAB_ITEMS の4値のみ許可、他は report | 保存しない: 「再読込で保持」を満たせない |
| ログアウト時 | `logout()` で catalyzer_view を削除 | 残す: 次回ログインが必ずその他から始まる |
| 免責 | index.html の `footer.disclaimer` を唯一の置き場所に残し、CSS `body:has(.view-root:not(.view-more)) .disclaimer{display:none}` でログイン画面とその他だけに出す | JS に文面複製: 法的文言が2か所に分かれる |
| その他の行 | RowList 拡張(`href` / `tone:'danger'` / `expand`)。操作行右端に chevron | 専用マークアップ: ui-row 構造と CSS の複製 |
| 再取得の確認 | 行の `<li>` 内に確認パネルを展開(`aria-expanded`)。「取得し直す」で閉じ先頭へスクロールし `onRebuildCache()` | モーダル: issue は画面内展開を指定 |
| 再分析ボタン | 上部バーの現位置のまま。その他には出さない | - |
| 本文末尾 | `body:has(.tabbar) .container{padding-bottom:calc(57px + env(safe-area-inset-bottom,0px) + var(--gutter))}` | sticky: 最下部でバーが浮く |
| z-index | タブバー直書き 40(トークン化しない) | 50以上: topbar(sticky z50)がスタッキングコンテキストを作り中のドロップダウン(z100)も実質50、後に来るタブバーが覆う。トークン化は直書き約15か所の移行で範囲外 |
| 上部バー1行目 | brand と再分析を `div.topbar-head`(flex 右寄せ min-height 30px)で包む | 包まない: Skeleton で1行目が消え brand(absolute)が controls と重なる |
| 共有 | ShareArea をモックの4列タイル(丸アイコン+ラベル, min-height 64px)に作り直す。アイコンは既存 SVG(format.js) | 40px 丸: 44px 未満 |
| CSS | menu.css 削除、同じ link 位置に shell.css 新設 | 中身だけ差し替え: 名前不一致 |
| 既存設計書 | unify-components.md は本文不変、後続を指す1行のみ追記 | 書き換え: 履歴が失われる |

### モックとの差分(issue/既存との一貫性優先)
- 各セクションは既存 `Panel` カード。上部バーに「その他」見出しは出さず brand のまま。共有アイコンは既存ブランド SVG。確認文から「数分かかります」を外す(再取得は Firestore 読み出しのみ)。ログアウト色は既存 `--bad`。免責は既存 footer のまま(中央寄せ)。

## 2. 変更ファイル
新規: `static/styles/shell.css`(.tabbar/.tabbar-item(hover・aria-current・svg)、下余白、.disclaimer 出し分け、.more-lead/.more-confirm(-actions/-ok/-cancel))、`static/__tests__/shell.test.js`、baseline `{more,mobile-more,mobile-more-confirm}-{dark,light}.png`
変更:
- `static/components/shell.js`: HamburgerMenu と useDismiss/useEffect import 削除。追加 VIEW_KEY/TAB_ITEMS/readView/useView/TabBar/MoreView。ShareArea をタイル化し CopyButton をモジュール直下へ。AppShell は `menu`→`nav`、`topbar-head` 追加
- `static/components/parts.js`: RowList に href/tone/expand
- `static/styles/parts.css`: `.ui-row-main{flex:1}`、`.ui-row-btn{text-decoration:none}`、`a.ui-row-btn`(と :hover)で color/text-decoration を戻す(`.report a` と同特異度で後読み勝ち)、`.ui-row-btn::after` chevron(7px, border-right/top 2px var(--muted), rotate45deg、expanded は 135deg)、`.ui-row-danger{color:var(--bad)}`
- `static/styles/share.css`: 全面書換(.share-grid 4列 gap8、.share-item は base.css button 指定を打ち消し a も同様、.share-icon 28px 丸 svg16px、.share-x/.share-bsky/.share-line/.share-copy、.copied)
- `static/styles/topbar.css`: `.topbar-head{display:flex;align-items:center;justify-content:flex-end;flex-basis:100%;min-height:30px}`
- `static/components/report/report.js`: Report の viewRef/navigate を useView() に。`view==='more'` 分岐を Skeleton 判定の前に。全 AppShell に nav。Skeleton に nav prop と自前 useView。「メニュー由来」コメント2か所修正
- `static/app.js`: confirm 行削除、logout() に `localStorage.removeItem(VIEW_KEY)`(import VIEW_KEY)、ハンバーガー言及コメント3か所を「その他画面」に
- `static/index.html`・`tools/ui-check/preview/parts.html`: menu.css link を同位置で shell.css に(screens.test が順序一致検査)
- `tools/ui-check/check.js`: wait/reload 操作、tap 検査、未知 op は InfraError
- `tools/ui-check/screens.js`: menu 画面削除、タブバー遷移化、新3画面
- `tools/ui-check/screens.test.js`: selectors() を wait/tap 対応、タブバー切替画面の規約テスト
- `static/__tests__/skeleton-actions.test.js`: AppShell の nav=、MoreView の onLogout= 渡し忘れ検査
- `static/__tests__/contrast.test.js`: pairs() に `['bad','accent-a10','panel']`(dark 6.57 / light 4.88)
- baseline: AppShell 使用画面を更新
- `CLAUDE.md`: 「18画面」「36枚」→「20画面」「40枚」(:16,:127)、操作種類に wait/reload・tap 追記、shell.js 行(:111)更新、「既存画面ではまだ使わない」(:114)→RowList はその他画面で使用、:128 に shell テスト追記
- `README.md`: shell.js 説明(:85)、`__tests__` に shell.test.js、skeleton-actions 説明
- `docs/design/2026-10-03-unify-components.md`: ステータス行下に `- 後続: #412 で HamburgerMenu を下部タブバーとその他画面に置換(2026-10-04-bottom-tabbar.md)`
削除: `static/styles/menu.css`、`tools/ui-check/baseline/menu-{dark,light}.png`(ui-baseline は古い画像を消さないので git rm)

## 3. インターフェース
```js
// static/components/shell.js
export var VIEW_KEY = 'catalyzer_view';
export var TAB_ITEMS = [{key:'report',label:'レポート'},{key:'search',label:'試合検索'},{key:'classrecord',label:'総合戦歴'},{key:'more',label:'その他'}];
export function readView()  // localStorage 値が TAB_ITEMS の key ならそれ、他(null/未知/例外)は 'report'
export function useView()   // {view,onNavigate(v)}。onNavigate = setView + 保存(try) + body/html overflow 解除 + scrollTo(0,0)(今の Report.navigate 移植)
export function AppShell({topbarRef,onRefresh,controls,nav,children})  // nav:{view,onNavigate}必須
//  div.view-root(+' view-more' if nav.view==='more') > div.topbar[data-ui=topbar][ref] > (div.topbar-head > span.brand, onRefresh あれば button.topbar-refresh) + controls ; > children > TabBar
export function MoreView({shareData,onLogout,onRebuildCache})
function TabBar({view,onNavigate})
//  nav.tabbar[aria-label="画面切替"][data-ui=tabbar] > button.tabbar-item[type=button][data-ui=tabbar-item][aria-current=page] > svg[aria-hidden](24px)+label
//  アイコンは TAB_ICONS[key]() が描画ごとに html`` を返す(vnode 使い回し禁止)。path はモック :263-266
function ShareArea({shareData})  // 空なら null。div.share-grid > 4×(a|button).share-item[data-ui=share-item] > span.share-icon.share-x 等 + ラベル(X/Bluesky/LINE/コピー→コピー済み)
function CopyButton({text})
```
MoreView(ルート `div[data-ui=more]`):
1. shareData が非空のときのみ Panel「結果を共有」> `p.more-lead`「最多使用の機体と敵機との相性を文章にして共有します。」+ ShareArea
2. Panel「データ」> RowList: `{key:'refetch',main:'試合データを取得し直す',sub:'サーバーから全件を再取得します',expand: confirming?確認パネル:null}`、`{key:'vsmobile',main:'ガンダムモバイルを開く',sub:'外部サイト',href:'https://web.vsmobile.jp/exvs2ib/'}`
3. Panel「アカウント」> RowList: `{key:'logout',main:'ログアウト',sub:'保存したログイン情報も削除します',tone:'danger'}`
- 確認パネル `div.more-confirm[data-ui=refetch-confirm]` > `p`「試合データをサーバーから全件取得し直します。」+ `div.more-confirm-actions` > `button.more-confirm-ok`「取得し直す」/`button.more-confirm-cancel`「やめる」。min-height 44px、base.css button 指定を打ち消す。cancel hover は border-color を accent にするのみ
- onSelect: refetch は confirming 反転、logout は onLogout()。ok は `setConfirming(false); window.scrollTo(0,0); onRebuildCache()`
```js
// parts.js RowList rows[i]: {key,main,sub?,aside?,href?,tone?:'danger',expand?:VNode|null}
//  href あれば <a class="ui-row-btn" target=_blank rel="noopener noreferrer">(外部リンク専用)
//  なければ onSelect あれば <button type=button class="ui-row-btn" aria-expanded=${r.expand!==undefined?!!r.expand:undefined}>
//  どちらも無ければ div.ui-row-body。tone==='danger' は操作要素に ui-row-danger。r.expand は <li> 内の操作要素の後ろ
// report.js Skeleton({actions,nav}): var own=useView(); var n=nav||own;
//  n.view==='more' なら <AppShell nav=${n}><MoreView shareData=${null} .../></AppShell>、それ以外は今の骨組みを nav=${n} で(hooks は分岐前)
```
Report の分岐順: search → classrecord → more(onRefresh なし)→ `!frontendData` なら Skeleton → レポート。
data-ui 追加: tabbar/tabbar-item/more/share-item/refetch-confirm、削除: menu-open/menu-item。状態は aria-current/aria-expanded。
shell.css 値: `.tabbar{position:fixed;left:0;right:0;bottom:0;z-index:40;display:grid;grid-template-columns:repeat(4,1fr);background:var(--bg);border-top:1px solid var(--line);padding-bottom:env(safe-area-inset-bottom,0px)}`、`.tabbar-item{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;width:auto;min-height:56px;padding:4px 0 6px;border:none;border-radius:0;background:none;color:var(--muted);font-size:0.875rem;font-weight:normal;line-height:1.3;transition:none}`、hover `background:none;color:var(--accent)`、current `color:var(--accent);font-weight:bold`。font-size は 0.875rem 以上(typography.test)。

## 4. テスト計画
- shell.test.js(3件): TAB_ITEMS の key/label 順、readView が4値を返す(globalThis.localStorage スタブ)、null/'foo'/'valueOf'/getItem 例外で 'report'
- skeleton-actions.test.js(+2): 全 `<${AppShell}` に nav=(6か所以上)、全 `<${MoreView}` に onLogout=(2か所以上)
- screens.test.js(+1): mobile-more の ops が4ラベル全クリックを含み最後が `{reload:true}`、required に `[aria-current="page"]` その他、tap が非空。クラスセレクタ禁止は tap/wait にも適用
- contrast.test に危険行 hover の組
- check.js: `{wait:[sel,text]}`(見えるまで待つのみ)、`{reload:true}`(Page.reload + loadEventFired を初回ナビと同じ waiter/NAV_MS で待つ)、画面の `tap:[selector...]`(SMALL_TEXT 検査の後・基準比較の前。selector ごと可視要素0件は `タップ領域の対象なし <sel>` で fail、height<44 は `タップ領域 44px 未満 <sel> <文字列先頭20字> <h>px` で fail)、未知 op は InfraError
```js
var TABBAR_ITEM='[data-ui="tabbar-item"]'; var CURRENT=TABBAR_ITEM+'[aria-current="page"]';
function goTab(label){return {click:[TABBAR_ITEM,label]};}
var OPEN_SEARCH=[goTab('試合検索')];
var TAP=[TABBAR_ITEM,'[data-ui="more"] button','[data-ui="more"] a'];
// analyzing/report-overview/search/classrecord の required に [CURRENT,'レポート'|'試合検索'|'総合戦歴'] を追加。classrecord ops=[goTab('総合戦歴')]。menu 画面削除
{id:'more',viewport:D,full:true,start:'report',ops:[goTab('その他')],
 required:[[CURRENT,'その他'],['[data-ui="more"]'],['[data-ui="share-item"]',null,4]],tap:TAP},
{id:'mobile-more',viewport:M,full:true,start:'report',
 ops:[goTab('試合検索'),{wait:['[data-ui="search-filter"]']},goTab('総合戦歴'),{wait:['h2','通算記録']},goTab('その他'),{wait:['[data-ui="more"]']},goTab('レポート'),{wait:['[data-ui="tab"][aria-selected="true"]','総合']},goTab('その他'),{reload:true}],
 required:[[CURRENT,'その他'],['[data-ui="more"]'],['[data-ui="share-item"]',null,4],['[data-ui="more"] [data-ui="row-list"]',null,2],['[data-ui="more"] a','ガンダムモバイルを開く'],['[data-ui="more"] button','ログアウト'],['footer','非公式のファンツール']],tap:TAP},
{id:'mobile-more-confirm',viewport:M,full:true,start:'report',ops:[goTab('その他'),{click:['[data-ui="more"] button','試合データを取得し直す']}],
 required:[['[data-ui="more"] button[aria-expanded="true"]','試合データを取得し直す'],['[data-ui="refetch-confirm"] button','取得し直す'],['[data-ui="refetch-confirm"] button','やめる']],tap:TAP},
```
(実装時にセレクタが実 DOM と合わなければ調整してよい。search-filter 等の data-ui 名は既存コードで確認する)
- 基準画像: 18画面36枚→20画面40枚(menu -2、more/mobile-more/mobile-more-confirm +6)。変わらない: login。変わる: analyzing, report-*, dropdown-period/ms, search, dropdown-search-filter, match-detail, classrecord, mobile-*, parts(chevron), parts-sheet(RowList が写れば)
- 手確認(完了条件外): make ui-preview で「取得し直す」→ダイアログ無し・/matches 再取得・その他のまま

## 5. 完了条件
| # | 条件 | コマンド | 期待値 |
|---|---|---|---|
| C1 | menu-drawer/confirm( 無し | `grep -rnE "menu-drawer\|confirm\(" static --include='*.js' --include='*.css' \| wc -l` | 0 |
| C2 | 準備中項目無し | `grep -rnE "EXランキング\|機体使用率ランキング\|coming soon" static --include='*.js' --include='*.css' --include='*.html' \| wc -l` | 0 |
| C3 | shell.js に絵文字無し | `node -e 'process.exit(/\p{Extended_Pictographic}/u.test(require("fs").readFileSync("static/components/shell.js","utf8"))?1:0)'` | exit 0 |
| C4 | menu.css 削除・参照無し | `test ! -e static/styles/menu.css && ! grep -rn "menu.css" static tools/ui-check/preview` | exit 0 |
| C5 | JS テスト全緑 | `make test-js` | exit 0、fail 0、pass 226 以上(現 220) |
| C6 | UI oracle 全 OK | `make ui-check` | exit 0、最終行 `ui-check: 40/40 OK` |
| C7 | 4項目切替・reload 後保持 | `node tools/ui-check/check.js mobile-more` | `OK mobile-more (dark)`/`(light)`、exit 0 |
| C8 | 44px 検査が効く | `UI_CHECK_INJECT='mobile-more:document.querySelector("[data-ui=tabbar-item]").style.cssText="min-height:0;height:30px;padding:0"' node tools/ui-check/check.js mobile-more` | exit 1、`タップ領域 44px 未満` が2行 |
| C9 | その他・確認展開で 44px 以上・はみ出し/14px 未満無し | `node tools/ui-check/check.js more mobile-more-confirm` | 4行 OK、exit 0 |
| C10 | console エラー0 | `make ui-check \| grep -c "console エラー"` | 0 |
| C11 | login 基準不変 | `git diff --name-only $(git merge-base HEAD origin/develop) -- tools/ui-check/baseline/login-dark.png tools/ui-check/baseline/login-light.png \| wc -l` | 0(注: 基線が #425 のため #425 差分が出る場合は、基線コミット d46f9ad との diff で判定) |
| C12 | ログアウトで保存画面を消す | `grep -c "removeItem(VIEW_KEY)" static/app.js` | 1 |
| C13 | ハンバーガー記述消滅 | `grep -cE "HamburgerMenu\|ハンバーガー" CLAUDE.md README.md` | 両 0 |
| C14 | 画面数更新 | `grep -cE "18画面\|36枚" CLAUDE.md README.md`、`grep -c "20画面" CLAUDE.md` | 前者両 0、後者 2 |
| C15 | README にテスト追記 | `grep -c "shell.test.js" README.md` | 1 |
| C16 | 前段設計書に後続 | `grep -c "2026-10-04-bottom-tabbar.md" docs/design/2026-10-03-unify-components.md` | 1 |
基準更新前の手順(一度だけ、出力を報告): U3 の後 `make ui-baseline` の前に `make ui-check 2>&1 | grep FAIL | grep -vE "基準画像と不一致|基準画像なし" | wc -l` が 0、`make ui-check 2>&1 | grep -c "^OK login"` が 2。
レビュー観点(完了条件と分離): 基準画像の目視、chevron の妥当性、MoreView 再取得の配線、Report/Skeleton の hooks 順序、`:has()` 依存、PC 幅のタップ領域幅。

## 6. エスカレーション事項
止める事項なし。覆したい場合のみ: ログアウトで catalyzer_view 削除、Skeleton にタブバー、確認文短縮。
実装注意: ui-check 全体タイムアウト 180 秒。U1 前に `time make ui-check` を測り、タイムアウトが出たら check.js の TOTAL_TIMEOUT を 300000 に。

## 7. 実装順序
| 単位 | 内容 | 検証 | コミット案 |
|---|---|---|---|
| U1 | check.js の wait/reload/tap と InfraError、screens.test の selectors() 対応(画面定義は未変更) | test-js 全緑、ui-check 36/36 | test: #412 ui-check に待機・再読み込み操作とタップ領域検査を追加 |
| U2 | RowList 拡張、parts.css、contrast の組 | test-js 全緑。ui-check の FAIL は parts(parts-sheet)の基準不一致のみ→`node tools/ui-check/check.js --update parts parts-sheet`→36/36 | feat: #412 RowList に外部リンク・危険操作・展開の行を追加 |
| U3 | shell.js/shell.css/share.css/topbar.css/report.js/app.js/link 差替/menu.css 削除/screens.js/追加テスト | test-js→基準更新前の手順→menu-*.png を git rm→make ui-baseline→C1〜C12 | feat: #412 ハンバーガーメニューを下部タブバーとその他画面に置き換え |
| U4 | CLAUDE.md/README/unify-components.md | C13〜C16 | docs: #412 タブバー化に合わせて構成と ui-check の記述を更新 |

## 7.5 実装時の調整
- `parts.css` に `ul.ui-rows{padding:0}` を追加(`.report ul{padding-left:20px}` がその他画面の行に効くため)。
- `check.js` の full 撮影は、ビューポートを全高に広げてから撮る(固定タブバーが画面途中に写るのを防ぐ)。U3 で追加。

## 8. ナレッジ候補・起票候補
ナレッジ: 固定タブバー z-index は topbar(50)未満の 40(sticky+z-index のスタッキングコンテキスト)/免責は index.html 1か所+`:has` 出し分け/`.report a` の color・text-decoration が `<a>` 部品に効くので `a.<class>` で打ち消す/ui-check の wait・reload・tap と INJECT での検査自体の確認。
起票: Report の controls-row 折りたたみ effect(`[]` 依存)が初回 view が report 以外だと未登録/z-index トークン化(直書き約15)/上部バー「再分析」ボタンのタップ領域 44px 未満(約29px)/期間内に試合が無いと Skeleton で止まる件(既存 issue 重複確認)。
