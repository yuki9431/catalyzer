# 設計: デザイン刷新 段階B(2/4) レポート 要約・絞り込みシート・行リスト・事実の箇条書き

- ステータス: implemented
- 日付: 2026-10-05
- 関連 issue: #413(親 #410 / 依存 #411, #425 / #446 を部分対応)。基線: 277b716(#412 の上)

## 1. 方針
6枚の KPI をタブごとの要約1つ(主指標1つ大 + 小4つ。対戦数は上のスコープ行へ)にする。勝率の横棒グラフは細いバー付き行リストにし、全件表は SubSection「表で見る」に格納。期間・機体はチップ→ボトムシート、全体/勝利/敗北は切替ボタン、スクロールで隠さない。Tips は事実の箇条書き。`.panel`/`.kpi`/`.card` から面・発光を外し、画面で塗りがあるのは要約1か所のみ。Go は触らない。

### 主な決定
| 論点 | 採用 | 却下 |
|---|---|---|
| Summary API | parts.js の `Summary({hero?, items})` を拡張。hero={label,value,unit?,aside?,note?}。hero 無しは従来のフラット dl | 新規 HeroSummary(重複) |
| `.panel` | 規則自体を直す(面・枠・半径・影なし)。検索画面も追随 | レポート専用クラス(issue 条件を満たせない) |
| `.kpi` | 残利用者(Skeleton・ClassRecordView)を Summary に移し `.kpi*` と kpi.js を削除 | 半端に剥がす |
| `.card`/`.card-grid` | JS 未使用なので削除 | |
| 行リスト | RowList に `bar` と `asideTone` を追加。charts.js に `WinRateRowList`。MsCompareChart の全6呼び出しを置換 | 別部品 |
| 行の色 | 値文字と▲▼は 60/40(wrTone/wrMark)。バーは 60/50(good/accent-2/terrible)+50%基準線 | バーも 60/40(ナレッジ winrate-color-two-axes に反する) |
| 全国平均 | バー上の縦マーカー+差分を sub のテキストで(0境界 good/bad)。差分で色分けしない | |
| issue 外の MsCompareChart(overview:196, playstyle:36,42) | 全て置換。機体vs全国平均は表、先落ち/順落ちは行(モック準拠)。コード約130行を削除 | 残す |
| RowList の見た目 | 全体をフラット化(MoreView にも波及。モックの「その他」もフラット) | 箱を残す |
| シート器 | Popover に任意 `title` → `div.ui-sheet-head`(h3+閉じる)。既存呼び出しは不変 | 別 Sheet 部品 |
| Chip/Toggle | Chip に `expanded`/`ui`(aria-expanded、data-ui 上書き)、ToggleGroup に `ui`、モックの seg 風、ボタン min-height 44px | |
| K/D 目安 | 現行 1.20(issue「既存しきい値」優先。モックの 1.50 は colorKD 由来) | 1.50 |
| 指標の tone | 勝率系は 60/40+▲▼。他は great→good, terrible→bad, 他なし。目安文言は great 値 | 4段階 |

### モックとの差分(issue/整合優先)
- matchup: 敵機の並べ替えトグル・単一リストは不採用。強/弱の2リスト(各最大10)を維持(起票候補)
- 行タップ遷移(>)・機体シートの検索入力は不採用(新機能)
- 僚機指標の「相方」→「僚機」(computePartner は partner_ms 単位)
- 要約の勝率系指標に▲▼。非勝率系は目安文言が非色の手掛かり
- チップ表記は現行(全データ/30日)。スコープ行は「全期間/直近30日」。千区切りは足さない。絞り込みバーは横スクロールでなく折り返し(PC のアンカーポップオーバーがクリップされるため)
- 現行維持: タブの見た目、SubSection(details)の見た目、burst タブの常時表示表、シート上端 8px 角

### #446 の範囲
| 項目 | 対応 | 理由 |
|---|---|---|
| PeriodSelector:33 の hooks 前 early return | 含める(hooks の後ろへ) | 本 issue で書き直す |
| Report:25 の `if(!data)return null` | 含める(削除) | renderReport 9 呼び出し全て object リテラル |
| controls-row スクロール隠し effect | 含める(削除) | issue「隠さない」 |
| parts.js の `sub &&` 0値 | 含める | Summary/RowList を拡張 |
| Esc(select・スタック)/#rememberModal/ChartCanvas deps/usePopover の未使用 open/aria-controls | 含めない | Esc は全ポップオーバーの挙動変更で一括対応すべき。他は触らない |
PR では #446 を部分対応として参照(Closes にしない)。

## 2. 変更ファイル
新規: `static/components/report/summary.js`(kpi.js 置換)/ `static/__tests__/summary.test.js` / `static/__tests__/surface.test.js` / `tools/ui-check/baseline/mobile-dropdown-ms-{dark,light}.png`
削除: `static/components/report/kpi.js`
変更:
- `report/report.js`: KpiGrid→ReportSummary・scopeText、Skeleton を要約スケルトン+チップ/トグルに、スクロール effect・topbarRef・`if(!data)return null` 削除、controls-row に `data-ui="filter-bar"`
- `report/controls.js`: PeriodSelector/MsSelector を Chip+`sheet-bottom`+`title`、PeriodSelector の early return を hooks 後へ、LensToggle を ToggleGroup ラッパに
- `report/overview.js`: 機体別を行+表、全国平均比較は表、固定相方ラベル 自機/僚機・「僚機の内訳:」
- `report/matchup.js`: 行+SubSection「表で見る」、Tips は SubSection の外
- `report/playstyle.js`: 先落ち/順落ちを行に
- `report/time.js`: 「テーブルで詳細を見る」→「表で見る」(3か所)
- `components/charts.js`: MsCompareChart/inBarLabel/haloText と未使用 import(canvasFont, winRateColors, themeReader が未使用になれば)削除、WinRateRowList 追加、EnemyMatchupSection は表のみ・ラベル 得意な敵機/苦手な敵機/互角の敵機、FallOrderContent は表を SubSection 内・0件群は `-`、ConsecutiveFallContent も表を SubSection 内
- `components/ui.js`: Tips を `ul.facts` に、Panel の dot 削除
- `components/parts.js`: Summary hero・RowList bar/asideTone・Chip expanded/ui・ToggleGroup ui・0値ガード
- `components/popover.js`: Popover の `title`
- `components/classrecord.js`: kpi カード→Summary、dot と `kpi-sub` 削除
- `components/shell.js`: AppShell の `topbarRef` prop 削除
- `lib/format.js`: wrMark/wrTone/wrBarTone
- `analysis/stats.js`: enemyKpi 追加、burstKpi に matches2/matches0
- `styles/report.css`: `.kpi*`/`.card*`/`.dot` 削除、`.panel` フラット化、`.report-summary`/`.report-scope` 追加
- `styles/report-table.css`: blockquote 規則削除、`.facts` 追加
- `styles/responsive.css`: `.kpi`/`.card`/blockquote/`.period-trigger`/`.ms-topbar-trigger` の行を削除
- `styles/topbar.css`: `.controls-row`
- `styles/period.css` / `filters.css`: 不要になった `.period-trigger`/`.ms-topbar-trigger` を削除(`.lens-*` は search.js が使うので残す)
- `styles/parts.css`: summary・rows・chip-opener・toggle・sheet-head
- `styles/tokens.css`: `--shadow` と `--accent-2-a35`(dark/light)を参照が0になってから削除
- テスト: `format.test.js` `stats.test.js` `contrast.test.js`
- ui-check: `check.js`(inview)`screens.js` `screens.test.js` `preview/parts.js` `baseline/*.png`
- `CLAUDE.md` `README.md`
CSS 削除規則: クラスが `static/**/*.js`・`static/index.html`・`tools/ui-check/preview` で使用0のときだけ削除。`.lens-toggle`/`.lens-btn`、search.css の `.dot`、`.period-arrow`(overview の PartnerDropdown が使用)は触らない。

## 3. インターフェース
```js
// lib/format.js (null は ''/null)
wrMark(wr)    // >=60 '▲ ' / <=40 '▼ ' / else ''
wrTone(wr)    // >=60 'good' / <=40 'bad' / else ''
wrBarTone(wr) // >=60 'good' / >=50 'mid' / else 'bad'
// analysis/stats.js
enemyKpi(enemyMatchup) // {total, worst}. total=strong+weak+even 件数; worst=最低 win_rate(同率は試合数多い方→先頭)。null/空→{total:0,worst:null}
// burstKpi の戻りに matches2 / matches0(データ無しは null)
// parts.js
Summary({ hero, items })
//  div.ui-summary[data-ui=summary] > (hero ? div.ui-summary-hero[data-ui=summary-hero] > p.ui-summary-label + p.ui-summary-big>(strong>value+small unit)+span aside + p.ui-summary-note) + dl.ui-summary-metrics > div.ui-summary-item(+' ui-summary-'+tone) > dt + dd(value + small sub)
// RowList rows[i] に追加: bar?:{value:0-100, tone:'good'|'mid'|'bad', marker?:number}, asideTone?:'good'|'bad'
//  span.ui-row-main > main + small sub + span.ui-row-bar[aria-hidden] > i.ui-row-bar-fill.ui-row-bar-<tone>[style=width:v%] + b.ui-row-bar-marker[style=left:m%]
//  aside: span.ui-row-aside(+' ui-row-aside-'+asideTone)
// 任意表示(sub/aside/unit/note)は has(v)= v != null && v !== '' (0 を表示する)
Chip({ tone, active, onClick, expanded, ui, children })
//  expanded !== undefined → ui-chip-opener, aria-expanded + aria-haspopup="dialog"(aria-pressed なし)。data-ui = ui || 'chip'
ToggleGroup({ options, value, onChange, label, ui }) // data-ui = ui || 'toggle'
// popover.js
Popover({ pop, panelClass, backdropClass, ui, title, children })
//  title → div.ui-sheet-head > h3 title + button[type=button].ui-sheet-close[data-ui=sheet-close] onClick=pop.close「閉じる」 の後に children
// report/summary.js
buildSummary(activeTab, fd)  // basic_stats 無しは null。{hero, items(4)}
ReportSummary({ activeTab, frontendData, scope })
//  div.report-summary > p.report-scope[data-ui=report-scope] scope+'・'+basic.matches+'試合' + Summary
// charts.js
WinRateRowList({ entries }) // [{name,winRate,matches,sub?,national?}] → RowList(sub 既定 matches+'試合', aside=wrMark+pct)
```

### 要約の中身(`—` は `-` 表示)
| タブ | hero(label / value+unit / aside / note) | items(label, value, sub, tone) |
|---|---|---|
| overview | 勝率 / win_rate+'%' / `W勝 L敗` | 平均与ダメージ(目安 1100 以上)/ 平均被ダメージ(目安 700 以下)/ 与被ダメ比(目安 1.20 以上)/ 平均EXダメージ(目安 200 以上) |
| playstyle | 先落ち率 / first_fall.rate+'%' / `count / total試合` / first_fall.count>0 なら `先落ちした試合の勝率 X%` | 0落ち時の勝率(no_fall.count>0: wrMark+pct, `N試合`, wrTone)/ ダメージ貢献率(チーム与ダメに占める割合)/ 勝利時の貢献率 / K/D比(目安 1.20 以上) |
| burst | 平均覚醒回数 / avg_bursts(小数2桁)+'回' / 1試合あたり | 2回覚醒した割合(`matches2試合`)/ 2回覚醒時の勝率 / 覚醒しなかった割合(`matches0試合`)/ 覚醒しなかった時の勝率 |
| matchup | 得意な敵機 / 苦手な敵機 / `S / W`+'機体' / `3試合以上対戦した N 機体のうち` / 得意は勝率 60% 以上、苦手は 40% 以下 | 3試合以上組んだ僚機(count)/ 最も多く組んだ僚機(top.ms, `N試合`)/ 僚機別の最高勝率(wr, ms)/ 最も勝率が低い敵機(wr, ms) |
| time | 最も勝率が高い時間帯 / hour+'時台' / `勝率 X%・N試合` | 最も勝率が低い時間帯(`H時台`,`勝率 X%・N試合`,wrTone)/ プレイした日数(`N日`)/ 平日の勝率(wr,`N試合`,matches>0 ガード)/ 土日の勝率(同) |
- しきい値は kpi.js の値: 与ダメ 1100/700 高良、被ダメ 700/900 低良、EX 200/100、与被比・K/D 1.2/0.8。great→good, terrible→bad。hero に tone なし
- `scopeText(periodKey, periods, ms, lens)`(report.js): all→全期間、custom→periods.custom.label、他→'直近'+label。続けて機体名、勝利のみ/敗北のみ。「・」連結
- ClassRecordView: hero 通算勝率(aside `W勝 L敗`)、items 通算対戦数 / 通算K/D比 / 分析カバー率(`N戦を分析済み`)。ラベルは現行のまま。div.report-summary で包む

### CSS の要点(トークンのみ、色リテラル禁止)
- `.report .panel{background:none;border:none;padding:0;margin:0 0 36px}`、`.report .panel > h2{font-size:1.125rem;color:var(--text);margin:0 0 12px}`(`.report h2` に負けない詳細度)
- `.report-summary{margin-bottom:36px}`、`.report-scope{font-size:0.875rem;color:var(--muted);margin-bottom:8px}`
- `.ui-summary{background:var(--panel);border-radius:16px;padding:20px 16px}`、hero strong 2.75rem/line-height1.1(単位 1.375rem、aside は muted)、`.ui-summary-metrics{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:16px}`、hero 有りは `margin-top:20px;padding-top:16px;border-top:1px solid var(--line)`、dt 0.875rem muted、dd 1.375rem bold `overflow-wrap:anywhere`、dd small 0.875rem muted block。項目ごとの枠・背景は撤去
- `ul.ui-rows`: 枠なし・radius 0。`.ui-row-body,.ui-row-btn{background:none;padding:10px 0;min-height:56px}`。バー `.ui-row-bar{display:block;position:relative;height:4px;margin-top:6px;background:var(--panel-2);border-radius:2px}`、::after で 50% に 1px `var(--text)` opacity .35、fill good/mid/bad→`--great`/`--accent-2`/`--terrible`、marker 2px `var(--text)`。aside tone good/bad→`--great`/`--terrible`
- `.ui-chip-opener{min-height:44px;border-radius:8px;padding:0 12px;background:var(--panel)}`+::after シェブロン、`.ui-chip-text{max-width:7.5em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}`
- `.ui-toggle`(seg): `background:var(--panel-2);border:none;border-radius:8px;padding:2px`、ボタン radius6/min-height44/透明/muted、pressed は `--panel` 背景・`--text`・bold
- `.ui-sheet-head`: sticky top0、`--panel` 背景、下線。h3 margin0 `--text`、`.ui-sheet-close` min-height44
- `.controls-row{display:flex;flex-wrap:wrap;align-items:center;gap:8px;flex-basis:100%;padding-top:4px}`、`.controls-row .ui-toggle{margin-left:auto}`。max-height/opacity 撤去
- `.facts`: `.report ul.facts{list-style:none;padding:0;margin:12px 0 0;display:flex;flex-direction:column;gap:6px}`、li 0.9375rem padding-left16px、::before 6px 円 `--muted`(モック 117-119)
- 文字は 14px(0.875rem)以上(typography.test)

## 4. テスト計画
- format.test(+3): wrMark/wrTone/wrBarTone の境界 60/59.9/50/49.9/40/40.1/null
- stats.test(+4): enemyKpi の null/空・最小+total・同率の試合数優先、burstKpi matches2/matches0。既存の空 deepEqual を更新
- summary.test(新, 5): 5タブの hero ラベルと items 4件 / overview sub に「目安 1100 以上」/ playstyle K/D sub「目安 1.20 以上」/ first_fall.count 0 で note 無し・0落ち `-` / matchup の最低勝率敵機の ms が sub
- surface.test(新, 2): styles/*.css からコメントを除いて規則単位に分解、セレクタ各リストの末尾 compound の subject が `/\.(panel|kpi|card)(?![\w-])/` に一致する規則に box-shadow/border-radius が無い / report.js に `addEventListener('scroll'` と `.style.maxHeight` が無い
- screens.test(+2): selectors() が inview も含む / mobile-report-overview に scroll op と inview(period-trigger, ms-trigger, lens-toggle)/ 5 レポート画面の summary-hero 期待テキストが5種別
- contrast.test: pairs に `['text','accent-a10','bg']`,`['muted','accent-a10','bg']`,`['bad','accent-a10','bg']`(light bad は 4.53 実測)
- check.js: screen に `inview:[[sel,text?]...]`。`missing(required,false)` の後(INJECT 後)・`scrollTo(0,0)` の前に検査。条件=最初の可視一致要素の中心がビューポート内、かつ `elementFromPoint(中心)` が自身か子孫。不一致は `画面内に見えない <sel>` で失敗。screens.js 冒頭コメントも更新
- screens.js:
  - report(): required に `['[data-ui="summary-hero"]',HERO[tab]]` `['[data-ui="summary"] dt',null,4]` `['[data-ui="report-scope"]','全期間・60試合']`、moreOps 引数追加
  - report-overview: kpi-grid→summary-hero 勝率、`[data-ui="lens"]`→`['[data-ui="lens-toggle"] button[aria-pressed="true"]','全体']`
  - report-matchup: ops に `{click:['summary','表で見る']}`、required に `['details[open] table']` `['[data-ui="panel"] [data-ui="row-list"]',null,N]`(N は実測、3以上)
  - classrecord: kpi-grid→`['[data-ui="summary-hero"]','通算勝率']`
  - mobile-report-overview: ops `[{scroll:['[data-ui="row-list"]']}]`、inview `[['[data-ui="period-trigger"]'],['[data-ui="ms-trigger"]'],['[data-ui="lens-toggle"] button','全体']]`、tap 同3つ
  - mobile-dropdown-period: required に `['[data-ui="period-panel"] h3','期間']` `['[data-ui="sheet-close"]']`、tap `['[data-ui="period-item"]','[data-ui="sheet-close"]']`
  - 新規 `{id:'mobile-dropdown-ms',viewport:M,full:false,start:'report',ops:[{click:['[data-ui="ms-trigger"]']}],required:[['[data-ui="ms-panel"] h3','機体'],['[data-ui="ms-item"]',null,2]],tap:['[data-ui="ms-item"]','[data-ui="sheet-close"]']}`
- preview/parts.js: Summary に hero、RowList 2行目に bar と asideTone
- 手動確認(完了条件外): `make ui-preview` をモバイル幅で、期間シートでカスタム日付を設定して適用できる/Esc で閉じる

## 5. 完了条件(B=277b716)
| # | 条件 | コマンド | 期待値 |
|---|---|---|---|
| C1 | 💡 なし | `grep -c '💡' static/components/ui.js` | 0 |
| C2 | .panel/.kpi/.card に影・半径なし | `node --test static/__tests__/surface.test.js` | exit 0, pass 2 |
| C3 | JS テスト全緑 | `make test-js` | exit 0, fail 0, pass 244 以上(現 230) |
| C4 | ui-check 全 OK 2回連続 | `make ui-check` を2回 | 両方 exit 0、最終行 `ui-check: 42/42 OK` |
| C5 | console エラー0 | `make ui-check 2>&1 \| grep -c "console エラー"` | 0 |
| C6 | 5タブ×2テーマ OK | `node tools/ui-check/check.js report-overview report-playstyle report-burst report-matchup report-time \| grep -c "^OK"` | 10 |
| C7 | inview が機能する | `UI_CHECK_INJECT='mobile-report-overview:document.querySelector("[data-ui=filter-bar]").style.cssText="max-height:0;overflow:hidden;pointer-events:none"' node tools/ui-check/check.js mobile-report-overview` | exit 1、`画面内に見えない` が2行 |
| C8 | スクロール隠し撤去 | `grep -c "topbarRef" static/components/report/report.js static/components/shell.js` | 各 0 |
| C9 | 横棒グラフコード撤去 | `grep -rnE "MsCompareChart\|inBarLabel\|haloText" static \| wc -l` | 0 |
| C10 | KPI 撤去 | `grep -rnE "kpi\|KpiGrid" static/components static/styles static/app.js tools/ui-check/screens.js \| wc -l` | 0 |
| C11 | 発光ドット撤去 | `grep -c 'class="dot"' static/components/ui.js static/components/classrecord.js` と `grep -c '\.dot' static/styles/report.css` | 全て 0 |
| C12 | 用語 | `grep -cE "'自分 \(\|'相方 \(\|相方の使用機体" static/components/report/overview.js` / `grep -cE "'自機 \(\|'僚機 \(" 同ファイル` | 0 / 2 |
| C13 | 0値ガード | `grep -cE "\b(it\|r\|hero)\.[a-z]+ && html" static/components/parts.js` | 0 |
| C14 | hooks 前 early return なし | `grep -c "if (!data) return null" static/components/report/report.js` と下記 node | 0 / exit 0 |
| C15 | 未使用トークン削除 | `grep -rnE "\-\-shadow:\|\-\-shadow\)\|accent-2-a35" static \| wc -l` | 0 |
| C16 | 色リテラルなし | `grep -oE '#[0-9a-fA-F]{3,6}\b\|rgba?\(' $(ls static/styles/*.css \| grep -v tokens.css) \| wc -l` | 0 |
| C17 | Go 不変 | `git diff --name-only 277b716 -- '*.go' go.mod go.sum \| wc -l` | 0 |
| C18 | login 基準不変 | `git diff --name-only 277b716 -- tools/ui-check/baseline/login-dark.png tools/ui-check/baseline/login-light.png \| wc -l` | 0 |
| C19 | CLAUDE.md 画面数 | `grep -c "21画面" CLAUDE.md` / `grep -cE "20画面\|40枚" CLAUDE.md` | 2 / 0 |
| C20 | ドキュメント追従 | `grep -c "kpi.js" CLAUDE.md README.md` / `grep -c "summary.js" CLAUDE.md` / `grep -cE "summary.test.js\|surface.test.js" README.md` / `grep -c "KPIダッシュボード" README.md` | 各0 / 1以上 / 2 / 0 |
C14 の node: `node -e 'const s=require("fs").readFileSync("static/components/report/controls.js","utf8");const b=s.slice(s.indexOf("export function PeriodSelector"),s.indexOf("export function MsSelector"));const r=b.indexOf("return null");const h=Math.max(...[...b.matchAll(/use[A-Z]\w*\(/g)].map(m=>m.index));process.exit(r>h?0:1)'`

基準画像更新の規則(各ユニット): `make ui-check 2>&1 | grep FAIL` で (a) 理由が「基準画像と不一致」「基準画像なし」のみ、(b) 画面 id が §7 のそのユニットの想定変更リストの部分集合、であることを確認(出力を報告)。そのうえで `node tools/ui-check/check.js --update <ids>` で該当 id のみ更新。`make ui-baseline` 禁止。リスト外が落ちたら原因を調べてから。

レビュー観点(完了条件とは別): 基準画像のモックとの目視一致 / 要約指標の選択と tone 規則 / Chip・Summary の API / `.panel` フラット化後の検索画面の許容性 / hooks 削除後の Report の依存配列 / inview 検査の妥当性

## 6. エスカレーション
停止不要。上書き余地: ClassRecordView の Summary 化 / `.panel` 変更で検索画面が変わる(issue 条件上不可避)/ 「僚機」ラベル / 敵機並べ替え不採用 / K/D 目安 1.20。

実装メモ:
- ui-check が画面追加後 180 秒を超えたら check.js の `TOTAL_TIMEOUT` を 300000 に
- rm/mv は `/bin/rm -f` `/bin/mv -f` または `git rm`/`git mv`
- コミットメッセージ末尾は `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>` の1行のみ。Claude-Session 行は禁止(公開リポジトリ)
- PR 前に origin/develop へ rebase し基準画像を撮り直す(PNG を手でマージしない)。PR base は develop。#446 は部分対応として参照

## 7. 実装順(各ユニット: test-js 全緑 → 上記規則で ui-check)
| U | 内容 | 想定変更画面 | コミット案 |
|---|---|---|---|
| U1 | format wr*、stats enemyKpi/burstKpi、テスト | なし(40/40) | feat: #413 勝率の色分け・最も勝率が低い敵機の判定関数を追加 |
| U2 | parts.js(Summary hero・RowList bar/asideTone・0値ガード・Chip/ToggleGroup)、parts.css、Popover title、check.js inview、screens.test selectors、contrast pairs、preview/parts.js | parts, parts-sheet, more, mobile-more, mobile-more-confirm | feat: #413 要約・行リスト・チップ・シート見出しの部品を拡張 |
| U3 | summary.js/ReportSummary/scopeText、kpi.js 削除、Skeleton と ClassRecordView を Summary に、`.kpi*` 削除、summary.test、screens required | report-*5, mobile-report-overview, dropdown-period, dropdown-ms, mobile-dropdown-period, analyzing, classrecord | feat: #413 KPI 6枚をタブごとの要約1つにする |
| U4 | `.panel` フラット化、dot 削除、`.card` 削除、Tips→facts、`--shadow` 削除、surface.test(1本目) | login 以外の全画面 | feat: #413 パネルの枠・影・発光を外し、アドバイスを事実の箇条書きにする |
| U5 | チップとボトムシート、lens ToggleGroup、スクロール effect/topbarRef/early return 削除、controls CSS 整理、surface.test(2本目)、screens(mobile-report-overview, mobile-dropdown-period, 新 mobile-dropdown-ms) | report-*5, mobile-report-overview, dropdown-period, dropdown-ms, mobile-dropdown-period, analyzing; 新 mobile-dropdown-ms | feat: #413 絞り込みをチップとボトムシートにし、スクロールで隠さない |
| U6 | WinRateRowList と6呼び出し置換、MsCompareChart 削除、全国平均表、SubSection「表で見る」、FallOrderContent ガード、固定相方用語、time 改名、`--accent-2-a35` 削除、report-matchup 表 op | report-overview, report-playstyle, report-matchup, report-time, mobile-report-overview | feat: #413 横棒グラフを勝率の行リストにし、全件の表を「表で見る」に格納 |
| U7 | CLAUDE.md(:16 と :127→21画面/42枚・inview、:110 report/ に summary.js、:114 parts.js、:118 Tips、:122 charts.js WinRateRowList)/ README(:12,:82,:86、__tests__ 一覧に2テスト) | — | docs: #413 要約・行リスト化に合わせて構成と ui-check の記述を更新 |

## 8. ナレッジ・起票候補
- ナレッジ: 要約だけが塗り面(`.panel` はフラット、surface.test で固定)/ 行バーは 60/50・値と▲▼は 60/40・50%基準線 / ui-check の `inview`(elementFromPoint)は「在るが隠れている」を捕まえる / computePartner は僚機機体単位なので「僚機」表記
- 起票候補: 敵機の並べ替えトグル・単一リスト(モック)/ 行タップ遷移と機体シートの検索入力 / K/D しきい値の不一致(KPI 1.2 vs 表 colorKD 1.5)/ burst タブの表を「表で見る」に格納・タブと details のモック見た目 / シート上端 16px 角 / useView.onNavigate と Report view effect の二重スクロールロック解除
