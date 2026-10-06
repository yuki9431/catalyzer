# 設計: デザイン刷新 段階B(3/4) 試合検索 全画面の絞り込み・1行1試合の結果・全画面の試合詳細

- ステータス: draft
- 日付: 2026-10-07
- 関連 issue: #414(親 #410)。基線: B=3d69aab

## 1. 方針
- 絞り込みと試合詳細は `search.js` 内の薄い全画面の器 `Layer`(`position:fixed; inset:0; z-index:300`)に載せる。一覧はマウントしたまま残すので条件・ページ・スクロール位置は失われない。
- 背面スクロールは body と html の `overflow:hidden` で止める(shell.js の `scrollLocked()` が真になり PullToRefresh は自動停止)。z-index 300 は TabBar(40)・上部バー(50)より上なので shell.js・report.js・app.js・popover.js は変更しない。
- 並べ替えは既存の `usePopover({mode:'sheet-bottom', lockScroll:true})` と `Popover title` を使う。
- `filterMatches`/`sortMatches` は変えない。表示文言の純粋関数3つを `analysis/search.js` 末尾に追加するのみ。

### 主な決定
| 論点 | 採用 | 却下 |
|---|---|---|
| 全画面シートの器 | search.js 内 `Layer`(head/body/foot、Esc は useDismiss、ロック・フォーカス・scrollY 復元を1 effect)。中身は最大720px中央 | popover.js に full モード(lockScroll がモバイル幅限定、search 専用) |
| スクロール固定 | body/html overflow hidden。閉じたら復元し scrollY がずれていれば scrollTo | body position:fixed(iOS で飛ぶ、scrollLocked と不整合) |
| 詳細の出し方 | 一覧に重ねる | 置換(scrollY 保存復元・TabBar 隠しに shell/report 変更・PullToRefresh が生きる) |
| TabBar | z-index 300 で覆う。shell.js 変更0 | AppShell に prop |
| ブラウザ戻る | 使わない。画面内「試合検索」ボタンと Esc | pushState(static 全体で未使用、standalone 挙動未確認)→起票 |
| 適用中タグ | `appliedFilterLabels`(純粋関数)を Chip で並べる | タグ押下で解除(新機能) |
| 敵機 AND/OR | ToggleGroup(すべて含む/どれかを含む)。値 'and'/'or' 維持 | |
| 他の切替 | プレイヤー名範囲・勝敗も ToggleGroup。`.search-andor*`・`.lens-*` CSS 削除 | |
| 並べ替えシート | 項目・並び順・件数を1枚。項目選択で閉じない | 選ぶと閉じる |
| 結果右端の数値 | 日付順なら与ダメ、他は並べ替え指標 | 常に与ダメ |
| 日付区切り | 直前行と日付が違えば入れる | 日付順のみ |
| ガント凡例 | 7項目のまま | 3項目(色の意味が読めなくなる)→起票 |
| esc() | search.js では使わない(Preact が escape するため二重になる) | 現状維持 |

### モックとの差分
- 行の人名は「相方 X・相手 A / B」。4人比較の切替ボタンは現部品にプレイヤー名を足すのみ。並び順文言は文脈切替(日付: 新しい順/古い順、他: 大きい順/小さい順)。ページ送り文言は現状維持(切替でスクロール先頭に戻らない=現状通り→起票)。「絞り込み（N件適用中）」の N はタグ数。
- フォーム文言変更: 詳細設定→詳細な条件、期間（カスタム指定）→期間（日付を指定）、勝敗「全て」→「すべて」、期間「30日」→「直近30日」。

## 2. 変更ファイル
変更: `static/analysis/search.js`(import `PERIOD_DAYS` from ./stats.js 1行+末尾に関数3つ。既存行は消さない)/`static/components/search.js`(FilterForm→FilterFields+FilterSheet、ResultItem→ResultRow+ResultList、SortControl→SortSheet、DetailModal→MatchDetail、Layer 新設。MsThumb 等旧部品削除、METRIC_LABELS は残す)/`static/styles/search.css`/`filters.css`(.lens-* 削除)/`responsive.css`(関連行削除)/`static/__tests__/search.test.js`(追加のみ)/`contrast.test.js`(pairs の great/terrible/timeup の a15 の基準面に 'bg' 追加)/`tools/ui-check/screens.js`・`screens.test.js`・基準画像/`CLAUDE.md`(:16 :135 を36画面72枚、:120 :124 更新)。
新規: 基準画像 dropdown-search-sort・mobile-search-filter・mobile-search-applied・mobile-search-sort・mobile-match-detail・mobile-search-back(各 -dark/-light)。
触らない: app.js・index.html・shell.js・popover.js・parts.js・ui.js・Go。
CSS 削除規則: js/index.html/ui-check preview で1回も使われないクラスのみ。`.modal-backdrop`(#rememberModal)・`.badge-timeup`・`.search-chevron`・`.search-detail-thumb*`・`.search-radar-*`・`.search-form`系・`.search-ac*` は残す。

## 3. インターフェース
```js
// analysis/search.js(追加のみ)
appliedFilterLabels(filters) // string[]。既定値・空・trim後空・数値にならない値は出さない
sortDirLabel(key, desc)      // date: 新しい順/古い順、他: 大きい順/小さい順
sortLabel(key, desc)         // SORT_OPTIONS の label + 'が' + sortDirLabel。未知keyは先頭
// components/search.js(export は SearchView({matches, msImages}) のみ)
Layer({ ui, label, head, foot, onClose, children })
FilterSheet({ filters, options, total, onField, onReset, onClose })
SortSheet({ sortKey, desc, pageSize, onSortKey, onDir, onPageSize })
ResultList({ items, sortKey, onOpen }) / ResultRow({ match, sortKey, onOpen })
MatchDetail({ match, msImages, onClose })
```
appliedFilterLabels の順(複数選択は `先頭 + ' ほか' + (n-1)`): 1 `期間: 直近{N}日`(PERIOD_DAYS を hasOwnProperty で引けたときのみ) / 2 自機 / 3 僚機 / 4 敵機(2件以上のみ `敵機（すべて含む）:`/`敵機（どれかを含む）:`) / 5 プレイヤー名(trim。相方のみ `プレイヤー名（相方）:`、相手のみ `（相手）`) / 6 勝敗: 勝利|敗北 / 7 日付: from〜to|from以降|to以前 / 8 味方タッグ名 / 9 相手タッグ名(trim) / 10 自機コスト / 11 僚機コスト / 12 相手コスト編成 `3000 + 3000 ほか1` / 13 数値範囲(与ダメージ→被ダメージ→撃墜数→被撃墜数→スコア→EXダメージ→覚醒回数。`500〜800`/`500以上`/`800以下`。0も表示)。
タグ表示と N は appliedFilterLabels、「条件をクリア」の出し分けは従来どおり hasActiveFilters。

SearchView 構造/data-ui:
- `div.search-toolbar[data-ui=search-filter]`(既存 wait 対象なので名前維持): `Chip ui=search-filter-toggle expanded active`(絞り込み / 絞り込み（N件適用中）)、`button.search-link[data-ui=search-clear]`、`div.search-applied-list`>`Chip ui=search-applied`
- `section.search-results`: `h2.search-total[data-ui=search-total]`(`{total}試合`+勝率 X.X%、0件は勝率なし)、SortSheet(件数に関係なく常時マウント。lockScroll 部品はマウント時 body.overflow='' を書くため)、一覧(0件は現文言)、`div.search-pager[data-ui=search-pager]`
- ResultRow: `button.search-row[data-ui=search-result]`、grid 40px/1fr/auto。1列目 `.search-row-res.win|lose`(勝/敗、great-a15/terrible-a15 背景、40x40 角丸8)、自機名+`.badge-timeup`、`.search-row-meta`(太字数値+METRIC_LABELS+時刻 date.slice(11,16))、`vs 敵機1 / 敵機2`、`相方 X・相手 A / B`(playerName()、空は—)。日付区切り `p.search-day[data-ui=search-day]`(date.slice(0,10))
- FilterSheet=`Layer ui=search-filter-sheet label=絞り込み`: head=`button[data-ui=search-filter-clear]`クリア / h2 絞り込み / `button.ui-sheet-close[data-ui=sheet-close]`閉じる。body=FilterFields(ToggleGroup ui: search-enemy-mode・search-name-scope・search-winloss。Dropdown/MultiSelect/Autocomplete/RangeCalendar は現状)。foot `[data-ui=search-filter-foot]`=`{total}試合が該当`+`button[data-ui=search-filter-apply]`結果を見る。条件はその場反映。
- SortSheet: `div.search-sort`(rootRef)+`Chip ui=search-sort-trigger expanded`(`span.search-sort-k`並べ替え+sortLabel)、`Popover panelClass=search-sort-panel ui=search-sort-panel title=並べ替え`。中身: `button.search-sort-opt[data-ui=search-sort-item][aria-pressed]`x7、`ToggleGroup ui=search-sort-dir`(desc/asc)、`h3.search-sort-label`1ページの件数、`ToggleGroup ui=search-pagesize`(10/20/50/100/200)。onSortKey は page=1、onDir は d!==desc のときのみ desc 設定+page=1、onPageSize は現状。
- MatchDetail=`Layer ui=match-detail label=試合詳細`: head=`button.search-back[data-ui=match-detail-back]`(左シェブロンSVG+「試合検索」)+muted で match.date。body 先頭 `p.search-detail-result[data-ui=match-result]`(strong 2rem 勝利/敗北+タイムアップバッジ)、`Panel title=4人の比較`(切替ボタン `data-ui=radar-toggle` min-height 44px、`span.search-radar-name`)、`Panel title=スコア`(thead は名前 `span.search-detail-name` 2行省略+title属性、team-sep 残す)、`Panel title=試合経過`(Timeline 常時)。

Layer effect:
```js
useDismiss(true, null, onClose);
useEffect(function () {
  var y = window.scrollY, back = document.activeElement;
  var b = document.body.style.overflow, h = document.documentElement.style.overflow;
  document.body.style.overflow = 'hidden'; document.documentElement.style.overflow = 'hidden';
  if (ref.current) ref.current.focus({ preventScroll: true });
  return function () {
    document.body.style.overflow = b; document.documentElement.style.overflow = h;
    if (window.scrollY !== y) window.scrollTo(0, y);
    if (back && back.focus) back.focus({ preventScroll: true });
  };
}, []);
```
DOM: `div.search-layer[data-ui][role=dialog][aria-modal=true][aria-label][tabindex=-1]`>`.search-layer-head`/`-body`/`-foot`(任意)。絞り込みと詳細は同時に開かない。

CSS 要点(トークンのみ・0.875rem以上・8の倍数): `.search-layer{position:fixed;inset:0;z-index:300;display:flex;flex-direction:column;background:var(--bg)}`、head flex:none min-height:52 border-bottom+safe-area、body flex:1 min-height:0 overflow-y:auto overscroll-behavior:contain、foot border-top padding16+safe-area(「試合が該当」flex:1+ボタン min-height48 accent/on-accent)、左右余白 `max(16px, calc((100% - 720px) / 2))`。h2 詳細度は `.search-layer-head h2`・`.search-view .search-total` で書く。`.search-row` は grid 40px minmax(0,1fr) auto、gap 0 16px、padding 8px 0、min-height 64、border-bottom line、名前/vs/人名は1行省略。`.search-day` muted 0.875rem padding 16px 0 8px 下線。`.search-applied-list` flex wrap gap8、Chip max-width 100% overflow-wrap anywhere。`.search-link`/`.search-back` 透明・accent・min-height44。`.search-page-btn` min-height44。`.search-sort{position:relative}`、`.search-sort-panel{position:absolute;top:100%;right:0;margin-top:4px;z-index:100;min-width:320px;max-height:calc(100vh - 96px);overflow-y:auto;background:var(--panel);border:1px solid var(--line);border-radius:8px;box-shadow:var(--shadow-pop)}`(モバイルは popoverStyle インラインが上書き)、`.search-sort-opt` min-height48 下線 pressed で accent・太字・チェック。`.panel` 対象規則に border-radius/box-shadow を書かない(surface.test)。

## 4. テスト計画
- search.test 34→44件以上(+10): appliedFilterLabels 8(空/基本6項目の順と文言/敵機1件はモード無し・2件で付く/相手・両方・敗北/詳細条件の順/日付の以降・以前/範囲3形と0・7項目順/空白のみ名前・'abc'・playDays='valueOf' は [](名前は hasActiveFilters が真のまま、の差も明記))、sortDirLabel と sortLabel 2(未知keyは日付)
- screens.test 13→16: mobile-search-back の ops が「scrollBy 正→結果クリック→戻る」順で outview に search-result・search-pager / match-detail・mobile-match-detail・mobile-search-filter の outview に `[data-ui="tabbar"]` / match-detail 系 absent に match-timeline-toggle
- contrast.test: pairs 追加のみ(実測 dark 8.01/6.48/8.12、light 5.09/5.10/5.09)
- screens.js(M=モバイル幅、TABBAR=`[data-ui="tabbar"]`):
  - search(D): required 試合検索・REANALYZE_BTN・search-filter-toggle「絞り込み」・search-day・search-result 20件・search-sort-trigger「日付が新しい順」・search-pager
  - dropdown-search-filter: 2つ目クリックを `[data-ui="search-filter-sheet"] [data-ui="select-trigger"]`
  - match-detail(D): 検索→結果→scroll:[gantt]。required score-table・gantt-bar・back。absent timeline-toggle、outview TABBAR
  - mobile-search-pull: ops 不変、基準のみ更新
  - 新 dropdown-search-sort(D): 検索→sort-trigger。required sort-panel と sort-item 7件
  - 新 mobile-search-filter: 検索→toggle→`[data-ui="search-winloss"] button`「勝利」。required: sheet h2「絞り込み」・foot「27試合が該当」・apply「結果を見る」・enemy-mode の すべて含む と pressed どれかを含む・winloss pressed 勝利。inview: apply・filter-clear・sheet-close。outview: TABBAR。tap: apply・clear・sheet-close・3つの ToggleGroup button
  - 新 mobile-search-applied: 上+apply クリック。required: search-applied「勝敗: 勝利」・toggle「絞り込み（1件適用中）」・search-clear・search-total「27試合」・search-result 20件・search-day 6件以上。absent: search-filter-sheet。tap: toggle・clear・sort-trigger・search-result・pager button
  - 新 mobile-search-sort: 検索→sort-trigger→sort-item「与ダメージ」。required: panel h3「並べ替え」・item 7件・pressed item 与ダメージ・dir pressed「大きい順」・pagesize pressed「20」・trigger「与ダメージが大きい順」。tap: item・dir button・pagesize button・panel sheet-close
  - 新 mobile-match-detail: 検索→結果。required: back「試合検索」・match-result「敗北」・`[data-ui="match-score-table"] thead th` の「テスト僚機1」「テスト対戦者15」・gantt-bar。absent timeline-toggle。outview TABBAR。inview back。tap back・radar-toggle
  - 新 mobile-search-back: 検索→toggle→勝利→apply→wait applied→`scrollBy:[600]`→結果クリック→wait match-detail→back クリック。required: applied「勝敗: 勝利」・total「27試合」。absent match-detail。outview: search-result・search-pager。inview: TABBAR
  - 期待値はフィクスチャ由来(60件中27勝。日付順先頭は負けで相方「テスト僚機1」、相手「テスト対戦者2 / テスト対戦者15」。勝ち先頭20件は6日にまたがる)
- 手動(完了条件外): Esc で閉じる、閉じたらトリガーにフォーカス復帰、広い画面の並べ替えパネルがはみ出さない

## 5. 完了条件(B=3d69aab)
| # | 条件 | コマンド | 期待値 |
|---|---|---|---|
| C1 | 検索挙動が現行と同じ | `node --test static/__tests__/search.test.js` | exit 0、fail 0、pass 44以上 |
| C2 | 既存コード・テストを消していない | `git diff 3d69aab -- static/analysis/search.js static/__tests__/search.test.js \| grep -c '^-[^-]'` | 0 |
| C3 | JS 全緑 | `make test-js` | exit 0、fail 0、pass 334以上(現321) |
| C4 | ui-check 2回連続全OK | `make ui-check` x2 | 両方 exit 0、最終行 `ui-check: 72/72 OK` |
| C5 | console エラー0 | `make ui-check 2>&1 \| grep -c "console エラー"` | 0 |
| C6 | 戻っても位置と条件が残る | `node tools/ui-check/check.js mobile-search-back \| grep -c "^OK"` | 2 |
| C7 | C6 の検出力 | `UI_CHECK_INJECT='mobile-search-back:window.scrollTo(0,0)' node tools/ui-check/check.js mobile-search-back` | exit 1、`画面内に見える` を含む行が2 |
| C8 | TabBar を覆い試合経過常時 | `node tools/ui-check/check.js match-detail mobile-match-detail mobile-search-filter \| grep -c "^OK"` | 6 |
| C9 | 画面定義規約 | `node --test tools/ui-check/screens.test.js` | exit 0、pass 16以上 |
| C10 | 基準更新は対象のみ | `git diff --name-only 3d69aab -- 'tools/ui-check/baseline/*.png' \| sed -E 's#.*/##;s/-(dark\|light)\.png$//' \| LC_ALL=C sort -u \| tr '\n' ' '` | `dropdown-search-filter dropdown-search-sort match-detail mobile-match-detail mobile-search-applied mobile-search-back mobile-search-filter mobile-search-pull mobile-search-sort search `(10件) |
| C11 | AND/OR 表記撤去・値維持 | `grep -cE "toUpperCase\|'AND'\|'OR'" static/components/search.js` / `grep -c "enemyMsMode: 'or'" static/analysis/search.js` | 0 / 1 |
| C12 | 旧UI撤去 | `grep -cE "match-timeline-toggle\|tlOpen\|DetailModal\|search-filter-head\|MsThumb\|SortControl" static/components/search.js` | 0 |
| C13 | 旧CSS撤去 | `cat static/styles/*.css \| grep -cE "\.(search-item\|search-ms-\|search-andor\|search-detail-tl\|search-filter-head\|search-filter-badge\|search-result-head\|search-dir\|search-pagesize\|lens-btn\|lens-toggle)"` | 0 |
| C14 | 触らないファイル | `git diff --name-only 3d69aab -- static/app.js static/index.html static/components/shell.js static/components/popover.js \| wc -l` | 0 |
| C15 | CSS ファイル数 | `ls static/styles/*.css \| wc -l` | 15 |
| C16 | 色リテラルなし | `grep -oE '#[0-9a-fA-F]{3,6}\b\|rgba?\(' $(ls static/styles/*.css \| grep -v tokens.css) \| wc -l` | 0 |
| C17 | ロックは1か所 | `grep -c "documentElement.style.overflow = 'hidden'" static/components/search.js` | 1 |
| C18 | 二重エスケープ撤去 | `grep -c "esc(" static/components/search.js` | 0 |
| C19 | Go 不変 | `git diff --name-only 3d69aab -- '*.go' go.mod go.sum \| wc -l` | 0 |
| C20 | CLAUDE.md 追従 | `grep -c "36画面" CLAUDE.md` / `grep -c "72枚" CLAUDE.md` / `grep -cE "29画面\|58枚\|試合詳細モーダル" CLAUDE.md` | 2 / 2 / 0 |

基準更新手順(ユニットごと): (1) `make ui-check 2>&1 | grep FAIL` で失敗理由が「基準画像と不一致/なし」のみで、失敗 id がそのユニットの想定リストに含まれると確認(出力を報告) (2) `node tools/ui-check/check.js --update <ids>`(zsh は `${=IDS}`) (3) `make ui-baseline` は使わない。
レビュー観点(完了条件外): モックとの見た目一致、タグ文言、項目選択で並べ替えシートが閉じない是非、行の人名文言、切替ボタンの名前追加、広い画面の720px列、塗り面が要約以外に出ていないか、フォーカス戻り先。

## 6. エスカレーション
不要。上書き可能な既定値4つ: 並べ替えシートは項目選択で閉じない/ガント凡例は7項目/行の人名は「相方 X・相手 A / B」/history を使わない。
実装メモ: 72枚で全体タイムアウトなら check.js `TOTAL_TIMEOUT` 既定を420000へ。コメントは1行。Esc でシート内ドロップダウンと絞り込みシートが同時に閉じるのは既知(#446 と同種)で対応しない。commit 末尾は Co-Authored-By 1行のみ(Claude-Session 行は付けない=公開repo)。PR 前に origin/develop へ rebase し基準画像を撮り直す。screens.js・CLAUDE.md の画面数は並行ブランチと衝突しやすい。

## 7. 実装順(各ユニット: test-js 全緑 → ui-check)
| U | 内容 | 想定変更画面 | コミット案 |
|---|---|---|---|
| U1 | label 関数3つ、search.test +10、contrast pairs | なし(60/60) | feat: #414 適用中の条件と並べ替えの表示文言を作る関数を追加 |
| U2 | Layer、FilterSheet(ToggleGroup化・文言)、ツールバーとタグ、.lens-*・.search-andor*・.search-filter-* 削除、screens(search・dropdown-search-filter・新 mobile-search-filter・mobile-search-applied) | search, dropdown-search-filter, mobile-search-pull, match-detail; 新 mobile-search-filter, mobile-search-applied | feat: #414 絞り込みを全画面シートにし、適用中の条件をタグで出す |
| U3 | ResultRow・日付区切り・SortSheet・ページ送り44px、旧カードCSS削除、新 dropdown-search-sort・mobile-search-sort | search, mobile-search-pull, mobile-search-applied, match-detail; 新 dropdown-search-sort, mobile-search-sort | feat: #414 結果を1行1試合・日付区切りにし、並べ替えをシートにまとめる |
| U4 | MatchDetail 全画面、名前見出し・切替ボタン・試合経過常時、esc 撤去、match-detail 更新、新 mobile-match-detail・mobile-search-back、screens.test +3 | match-detail; 新 mobile-match-detail, mobile-search-back | feat: #414 試合詳細を全画面にし、戻ったとき一覧の位置と条件を保つ |
| U5 | CLAUDE.md(:16 :120 :124 :135) | — | docs: #414 試合検索の刷新に合わせて構成と ui-check の記述を更新 |

## 8. ナレッジ・起票候補
ナレッジ: (1) 全画面の層は fixed+z-index300 で TabBar/上部バーを覆い body・html overflow:hidden で止める。一覧を残すので位置・状態は保存不要 (2) usePopover の lockScroll はマウント時・開閉時に body.overflow='' を書くので、全画面層の表示中に lockScroll 部品をマウントしない(常時マウント) (3) ui-check の outview は「覆われている」と「スクロールが戻っていない」を検査できる。
起票: (1) ブラウザ/Android 戻る対応(history 未使用、standalone 確認含む) (2) ガントをモックに合わせる(プレイヤー色・凡例3項目) (3) ページ切替で結果先頭へスクロールしない (4) search.js 以外の htm 内 esc() 二重エスケープ (5) usePopover lockScroll のマウント時 body.overflow 上書き(#413 起票候補と同種)。
