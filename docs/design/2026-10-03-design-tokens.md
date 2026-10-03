# 設計: デザイン刷新 段階B(0) 新デザインの定義値を適用(配色・文字サイズ・ライトテーマ)

- ステータス: approved(E1 は A+ で確定。ユーザー回答済み)
- 日付: 2026-10-03
- 関連 issue: #425(親 #410、前段 #411/#423/#424 マージ済み、後続 #412〜#415)

## 1. 方針

tokens.css のトークン名は変えずに値を差し替え、ライト配色は tokens.css 内の `@media (prefers-color-scheme: light) { :root { … } }` で上書きする。文字サイズは全宣言を rem にして入れ子による縮小をなくし、14px の下限は静的テストと ui-check の computed 検査の2段で判定する。コントラストは tokens.css をパースする node テストで、実際に使う文字色×背景色の組をダーク・ライト両方で判定する。レイアウトと部品構成は変えない。

### 主要判断
| 論点 | 採用 | 却下案と理由 |
|---|---|---|
| ライトの上書き場所 | tokens.css 末尾に `@media (prefers-color-scheme: light) { :root { color-scheme: light; … } }`。上書くのは値が変わる71トークンだけ | 各 CSS に media を散らす: theme.test が禁止 / モックの `[data-theme]` 手動切替: 要求に無い |
| 別名トークン | 役割がモックの色と同じものは `var(--muted)` 等の別名にする(例: `--text-dim: var(--muted)`)。ライトで上書きしなくても追従する | 全部リテラル: ライト側に29行が重複 / color-mix で alpha 系を導出: getPropertyValue が color-mix を解決せず、Chart.js の色パーサが読めない |
| alpha 系 | `rgba(R,G,B,α)` のリテラル。元の色と α は contrast.test で検査する | 自由記述: 打ち間違えても検出できない |
| 二次文字色(text-dim/subtle/faint/legal、chart-text(-sub)、disabled-text、pager-disabled) | すべて `--muted` の別名(モックの文字色は fg/muted の2段) | 段階を残す: モックに値が無く、現ダークで4.5未満(#666 #777 #5a6b7a #566)を作り直すだけになる |
| 塗りの上に文字を置く箇所 | ヒートマップ(`--win-rgb`/`--terrible-rgb` と `--win-a85`/`--terrible-a85`)は文字を優先し、ダークは濃い色(モックのライト win/lose)、ライトは淡い色(モックのダーク win/lose)。棒グラフ(`--win-a70`/`--terrible-a70`)はモックの win/lose。棒の中のラベル(inBarLabel)はパネル色で縁取る | 棒も文字優先にする: ライトの棒が白背景に対し 1.45:1 まで薄くなり、モックの見た目から外れる / 縁取りなし: ダークの棒内文字が 2.6:1 になる(現状は 4.05) |
| 文字サイズの単位 | 全 font-size を rem にする。`1em` は `inherit`(親と同じ大きさという意味を保つ) | em のまま 0.875em 以上にする: `.report table`(0.88em) の中の `.badge`(0.875em) は 12.3px になり、入れ子で下限を守れない |
| 変換規則 | em 値 v → `max(14, round(16v))/16` rem(v=1 は inherit)。表は 2.3 | 実効 px を文脈ごとに計算する: 判断が実装者ごとに割れる |
| 14px の判定 | (a) typography.test で静的検査 (b) ui-check に computed 検査を追加し、表示中の全テキスト(::before/::after を含む)を見る。入れ子・UA 既定値(button 13.33px 等)・JS インライン style は (b) で拾う | 静的検査だけ: 入れ子と UA 既定値を見逃す |
| フォーム部品 | base.css に `button, input, select, textarea { font-family: inherit; font-variant-numeric: inherit; }` を足す。UA の `font` 一括指定が tabular-nums とフォントを打ち消すため | `font: inherit`: 太さと行の高さまで変わる |
| tabular-nums | body に1か所だけ書き、個別の7か所は削除する | 個別のまま: 数値が出る箇所を漏れなく網羅できない |
| line-height | 変えない(モックは 1.6) | 1.6 にする: 全画面の高さが変わり、レイアウトを変えない制約に反する。#412〜 で扱う |
| color-scheme | :root に `color-scheme: dark`、ライトのブロックに `light`。period/search/filters.css にある `color-scheme: dark` の3か所は削除する(継承で効く) | 3か所を残す: ライトでネイティブ部品だけが暗いままになる |
| 背景グラデ | 構造はそのまま。`--bg-glow` をテーマごとに `mix(bg, accent, 8%/6%)` とする | ライトでグラデをなくす: CSS の構造が変わる |
| ロゴ | logo.svg に `<style>@media (prefers-color-scheme: light){[fill="#f5f5f7"]{…}…}</style>` を足す。img 内の SVG もエミュレートしたメディアに従うことを実測で確認した | 何もしない: ライトでロゴの文字(#f5f5f7)と背景 #f4f6f8 の比が約 1.0 になり見えない / picture 要素で差し替え: DOM が変わる |
| ヒートマップの「N戦」 | `.heatmap-matches` の色を `--text-dim` から `--heat-text` に変える | text-dim のまま: 濃い塗りの上で 2.8:1(ダーク)、3.5:1(ライト) |
| theme-color | `<meta name="theme-color" media="(prefers-color-scheme: light)" content="#f4f6f8">` を先に置き、その後に media なしの `content="#0e141b"` を置く(先に一致したものが使われる) | media 付き2個(既定案): OS 設定が no-preference のとき CSS はダーク表示なのに theme-color が付かず、CSS と食い違う |
| manifest | theme_color と background_color を `#0e141b` の1値にする(manifest は media を持てない。CSS の既定であるダークに合わせ、読み込み後は meta が上書きする) | ライトの値: OS 既定の多くと CSS の既定がずれる |
| Chart.js のフォント | ChartCanvas が生成の直前に `Chart.defaults.font.family = cssVar('--font-sans')` を設定する。canvas の ctx.font は `canvasFont(cssVar, px, weight)` で組み立てる | 設定ごとに family を渡す: ヘルパの全箇所に引数が増える |
| canvas の文字サイズ | 目盛り・凡例・基準線ラベルは 12px 以上(11 は 12 にする)。inBarLabel の機体名は 14px、差分は 12px | 全部 14px: issue がグラフ内は 12px 以上と定めており、目盛りが詰まる |
| OS テーマ変更時の canvas | 表示中は追従しない。CSS と DOM は即時に、canvas は次の描画(タブ切替・期間変更・再読込)で追従する | matchMedia で ChartCanvas を再生成: レーダー3か所(overview.js:29-31/153-154、search.js:369 の useMemo)は色を親で確定しており、全部追従させるには #424 の部品 API を変える必要がある。表示中にテーマを切り替えることは稀 |
| ui-check | 全18画面 × dark/light = 36枚。テーマは `Emulation.setEmulatedMedia` で両方とも明示する(ヘッドレスの既定は light に一致しないことを実測)。基準画像は `<id>-<theme>.png` | 代表画面だけライト: 完了条件は両テーマで全画面 / 実測は18画面 26.2s なので36枚でも約52s。TOTAL_TIMEOUT 180s に収まる |
| サムネ内の代替文字(`.search-ms-thumb-text` 74px、`.search-detail-thumb-text` 48px/26px) | 14px にし、はみ出しは既存の overflow:hidden で切る。機体画像が無いときにだけ出る表示で、名前は title と名前行にもある | 例外として残す: 「最小14px」の判定に例外が入る / 頭文字だけにする: 表示内容が変わる。全体の成果物は変わらないのでエスカレーションしない |

## 2. 変更内容

### 2.1 トークン一覧(全100件。「同」はダークと同じ値なのでライトでは上書きしない)
由来: M=モックの値そのまま(`bg/surface/surface-2/line/fg/muted/accent/on-accent/win/lose/warn/s1-s4/font`)、E1=エスカレーション案 A+(6章)、D=導出。mix(a,b,p) は sRGB の線形補間で、各チャンネルを四捨五入する。

| トークン | ダーク | ライト | 由来・規則 |
|---|---|---|---|
| `--bg` / `--panel` / `--panel-2` / `--line` | #0e141b / #18212b / #212c38 / #2a3644 | #f4f6f8 / #ffffff / #e7ecf0 / #d5dbe1 | M bg/surface/surface-2/line |
| `--text` / `--muted` / `--accent` / `--on-accent` | #e9eef3 / #a2b1bf / #5ec6f2 / #06222f | #17202a / #4f5d6b / #0a6c99 / #ffffff | M |
| `--great` / `--terrible` / `--warn-text` | #6fdc9f / #ff8d80 / #f2c14e | #0f6833 / #a62a1a / #7d5100 | ダークは M win/lose/warn、ライトは E1(モックは #13803f/#c4321f/#8a5a00) |
| `--bad` | #ff9e7a | #ab4a1b | ダークは M s2、ライトは E1(s2 #c2541f の明度を下げた値) |
| `--accent-2` | #8ed7f6 | #08567a | D: ダーク mix(accent,#fff,.3)、ライト mix(accent,#000,.2) |
| `--good` | #a0e3c1 | #115230 | D: mix(great,text, ダーク.4/ライト.3) |
| `--bg-glow` | #14222c | #e6eef2 | D: mix(bg,accent, .08/.06) |
| `--error-bg` / `--warn-bg` | #3b3138 / #393930 | #f8eeed / #efeae0 | D: mix(panel,terrible, .15/.08)、mix(panel,warn-text, .15/.12) |
| `--gantt-ex` | #5f6a75 | #99a2aa | D: mix(muted,bg,.45) |
| `--gantt-f` / `--gantt-s` / `--gantt-e` | #ff9e7a / #5ec6f2 / #6fdc9f | #c2541f / #0a6c99 / #13803f | M s2/s1/s3(塗りだけに使うのでモック値のまま) |
| `--radar-opp2` | #f2c14e | #8a6a00 | M s4 |
| `--win-rgb` / `--terrible-rgb` | 19,128,63 / 196,50,31 | 111,220,159 / 255,141,128 | D: ヒートマップ用。ダークはモックのライト win/lose、ライトはモックのダーク win/lose |
| `--text-dim` `--text-subtle` `--text-faint` `--text-legal` `--disabled-text` `--pager-disabled` `--chart-text` `--chart-text-sub` `--chart-ref-text` `--gantt-ov-border` | `var(--muted)` | 同 | 別名 |
| `--input-border` `--spinner-track` | `var(--line)` | 同 | 別名 |
| `--surface-sub` `--disabled-bg` | `var(--panel-2)` | 同 | 別名 |
| `--heat-text` `--gantt-ov-on` | `var(--text)` | 同 | 別名 |
| `--timeup` `--warn-border` | `var(--warn-text)` | 同 | 別名 |
| `--error-text` `--error-border` | `var(--terrible)` | 同 | 別名 |
| `--accent-a05/a06/a07/a08/a10/a15/a18/a20/a25` | rgba(94,198,242,α) | rgba(10,108,153,α) | D: 元の色 --accent。α は名前の2桁/100(以下同じ) |
| `--accent-2-a10/a20/a30/a35/a50` | rgba(142,215,246,α) | rgba(8,86,122,α) | 元の色 --accent-2 |
| `--great-a15/a20/a25/a60`、`--win-a70` | rgba(111,220,159,α) | rgba(15,104,51,α) | 元の色 --great(棒グラフ) |
| `--terrible-a15/a18/a22/a60/a70` | rgba(255,141,128,α) | rgba(166,42,26,α) | 元の色 --terrible |
| `--win-a85` / `--terrible-a85` | rgba(19,128,63,.85) / rgba(196,50,31,.85) | rgba(111,220,159,.85) / rgba(255,141,128,.85) | 元の色 --win-rgb / --terrible-rgb(ヒートマップの凡例) |
| `--good-a08` / `--bad-a18` / `--timeup-a15` / `--radar-opp2-a22` | 元の色 good/bad/warn-text/s4 で α | 同じ規則でライトの元の色 | 元の色の規則どおり |
| `--bg-a82` | rgba(14,20,27,.82) | rgba(244,246,248,.82) | 元の色 --bg |
| 白の半透明 `--chart-grid`(.05) `--chart-grid-strong`(.08) `--chart-radar-grid`(.10) `--chart-ref-line`(.30) `--gantt-grid`(.09) `--gantt-grid-major`(.20) `--gantt-ov`(.18) `--heat-empty`(.03) `--heat-mid`(.08) `--mark-empty-border`(.35) | rgba(233,238,243,α) | rgba(23,32,42,α) | D: rgba(--text, 現状と同じα) |
| 黒の影 `--shadow`(.35) `--shadow-pop`(.4) `--shadow-pop-strong`(.45) `--shadow-modal`(.5) `--vs-shadow`(.5) `--gantt-diamond-ring`(.35) | 現状の値のまま | 黒の α を 0.4 倍(.14/.16/.18/.2/.2/.14)。オフセットとぼかしは同じ | D |
| `--scrim` / `--scrim-strong` | rgba(0,0,0,.5) / .6 | 同 | 覆いはテーマで変えない |
| `--share-icon` `--brand-x` `--brand-bsky` `--brand-line` `--share-copy-bg` | #fff #000 #0085ff #06c755 #334 | 同 | ブランド色なので固定 |
| `--font-sans` | `-apple-system, "Hiragino Sans", "Hiragino Kaku Gothic ProN", "Yu Gothic UI", "Noto Sans JP", system-ui, sans-serif` | 同 | M font |
| `--gutter` | 16px(600px 以下は 10px) | 同 | 変えない |

ライトのブロックで上書きするのは、値が別名でもなく「同」でもない71件。値は上の表をそのまま書く(E1 の回答が A+ と異なる場合は、great/terrible/warn-text/bad と、そこから導出する good・error-bg・warn-bg・各 alpha 系を同じ規則で計算し直す)。

### 2.2 tokens.css の書式(contrast.test のパーサが前提とする)
- 先頭の `:root {` から最初の `}` までをダークとし、先頭行に `color-scheme: dark;` を置く。1行に1トークン。
- `@media (max-width: 600px)` のブロックはそのまま残す。
- 末尾に `@media (prefers-color-scheme: light) {\n  :root {\n    color-scheme: light;\n    --x: …;\n  }\n}` を置く。ネイティブ部品の配色をテーマに合わせる理由を1行コメントで書く(period.css:36 のコメントはここへ移す)。
- 色は `#rrggbb`・`#rgb`・`rgba(R,G,B,A)`・`var(--x)`・`R,G,B`(-rgb 系)だけを使う。

### 2.3 文字サイズの変換(全143宣言。JS インラインの4か所を含む)
| em | 変換後 | 件数 |
|---|---|---|
| 0.42〜0.9 | 0.875rem | 105 |
| 0.92 / 0.95 | 0.9375rem | 8 |
| 1 | inherit | 8 |
| 1.05 / 1.1 / 1.2 / 1.3 / 1.4 / 1.5 / 1.6 / 1.8 / 2 | 1.0625 / 1.125 / 1.1875 / 1.3125 / 1.375 / 1.5 / 1.625 / 1.8125 / 2 rem | 22 |
- 変換で基本ルールと同じ値になった上書きは削除する: responsive.css:16・17・18・22 の `font-size`(padding は残す)、search.css:120・121 の @media 行。
- JS インライン: ui.js:157、report/controls.js:118・123、report/overview.js:147 → `font-size:0.875rem`。
- base.css: body に `font-size: 1rem; font-variant-numeric: tabular-nums;` を追加する。`* {…}` の直後に `button, input, select, textarea { font-family: inherit; font-variant-numeric: inherit; }` を置く。
- tabular-nums の個別指定(gantt.css:26、report-table.css:11、search.css:91・92・128・136・144)を削除する。

### 2.4 ファイル別
- `static/styles/tokens.css`: 2.1 と 2.2 のとおり。
- `static/styles/{period,search,filters}.css`: `color-scheme: dark` を削除する(period.css:36 のコメントも削除)。
- `static/styles/report-table.css`: `.heatmap-matches` の color を `var(--heat-text)` にする。
- 全 CSS と JS インライン: 2.3 のとおり。
- `static/logo.svg`: 先頭の `<path` の前に `<style>@media (prefers-color-scheme: light){[fill="#f5f5f7"]{fill:#17202a}[fill="#4fc3f7"]{fill:#0a6c99}[fill="#8aa0b3"]{fill:#4f5d6b}}</style>` を入れる。path は変えない。
- `static/index.html`: theme-color の meta 1個を、主要判断の表にある2個に置き換える。
- `static/manifest.webmanifest`: `#0d1620` 2か所を `#0e141b` にする。
- `static/components/chart-canvas.js`: `canvasFont` を export する。ChartCanvas の effect を `var cssVar = themeReader(); Chart.defaults.font.family = cssVar('--font-sans'); var config = build(cssVar);` にする。winRate50Line の `'11px sans-serif'` は `canvasFont(cssVar, 12)` に、`font: { size: 11 }`(153行)は 12 にする。
- `static/components/charts.js`: inBarLabel を `mainFont = canvasFont(cssVar, 14, '700')`、`diffFont = canvasFont(cssVar, 12, '700')` にする。`ctx.save()` の直後で `ctx.lineWidth = 3; ctx.lineJoin = 'round'; ctx.strokeStyle = cssVar('--panel');` を設定し、fillText の4か所を非 export のヘルパ `haloText(ctx, text, x, y)`(strokeText の後に fillText)に置き換える。299行の `size: 11` は 12 にする。
- `tools/ui-check/screens.js`: `export var THEMES = ['dark', 'light'];`
- `tools/ui-check/check.js`: 各画面をテーマごとに実行する。`runScreen(conn, origin, screen, theme, update)` の中で setLocaleOverride の後に `send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }] })` を呼ぶ。実画像と基準画像のファイル名は `<id>-<theme>.png`、出力は `OK <id> (<theme>)`、集計は `ui-check: N/36 OK`。ONLY は画面 id で指定し、両テーマとも実行する(ONLY 指定時に消す実画像も `<id>-<theme>.png` 単位)。overflow 検査の直後に SMALL_TEXT_EXPR(3章)を評価し、該当があれば `fail('14px 未満の文字 ' + 結果)` にする。
- `tools/ui-check/baseline/`: 旧 `<id>.png` 18枚を削除し、`make ui-baseline` で36枚と meta.json を作り直す。
- テスト: 4章。
- `CLAUDE.md` / `README.md`: 5章 C19・C20 の範囲(ダーク/ライト、36枚、新しいテストファイル、tokens.css の説明)。

## 3. インターフェース
```js
// static/components/chart-canvas.js
export function canvasFont(cssVar, px, weight) // (weight ? weight + ' ' : '') + px + 'px ' + cssVar('--font-sans')
// tools/ui-check/screens.js
export var THEMES = ['dark', 'light'];
// tools/ui-check/check.js(内部)
async function runScreen(conn, origin, screen, theme, update)
var SMALL_TEXT_EXPR = '(function(){var all=document.body.querySelectorAll("*");for(var i=0;i<all.length;i++){var e=all[i];' +
  'if(!e.getClientRects().length)continue;var cs=getComputedStyle(e);if(cs.visibility==="hidden")continue;' +
  'var own=Array.prototype.some.call(e.childNodes,function(n){return n.nodeType===3&&n.textContent.trim()});' +
  'var px=own?parseFloat(cs.fontSize):99;["::before","::after"].forEach(function(p){var s=getComputedStyle(e,p),c=s.content;' +
  'if(c&&c!=="none"&&c!=="normal"&&c!==\'""\')px=Math.min(px,parseFloat(s.fontSize))});' +
  'if(px<14)return e.tagName.toLowerCase()+(typeof e.className==="string"&&e.className?"."+e.className.trim().split(/\\s+/).join("."):"")+" "+px+"px"}return null})()';
```

## 4. テスト計画と作業単位
追加テストは11件(209 → 220)。
- 新規 `static/__tests__/contrast.test.js`(+5): tokens.css をパースし(2.2)、`var()` は再帰的に解決する。背景が半透明なら基準面に合成する(チャンネルごとに round(a·fg+(1−a)·base))。比は WCAG 2.x の相対輝度で計算する(sRGB の閾値は 0.04045)。
  1. 計算の確認: #000/#fff = 21、#777777/#ffffff が 4.47〜4.49
  2. ダークの全組 ≥ 4.5 3. ライトの全組 ≥ 4.5。失敗したときは不足している組と比を全部出す
  4. ライトのブロックの名前はすべて :root で定義済みで、`color-scheme: light` がある
  5. alpha の規則: `/^(--.+)-a(\d\d)$/` に一致するトークンは、両テーマで「元の色の RGB と α=NN/100」に一致する。元の色は既定で `--<前半>`。例外は `{'--win-a70':'--great','--win-a85':'--win-rgb','--terrible-a85':'--terrible-rgb'}`
  - 組(1テーマ174組): FG{text,muted,accent,accent-2,great,good,bad,terrible,warn-text,timeup,error-text,text-dim,text-subtle,text-faint,text-legal,chart-text,chart-text-sub,chart-ref-text,disabled-text,heat-text} × BG{bg,bg-glow,panel,panel-2,surface-sub,disabled-bg} / on-accent × {accent,accent-2,good,bad} / {text,muted,accent,accent-2,great,good,bad,terrible,warn-text} × {accent-a05,a06,a07}(panel 上) / muted×accent-a06(bg 上) / 個別の22組: text×accent-a15、text×accent-a10、muted×accent-a10、accent×accent-a10、accent×accent-a08(以上 panel 上)、accent×accent-a10(bg 上)、great×great-a15・terrible×terrible-a15・timeup×timeup-a15(panel 上と panel-2 上の各2組)、accent-2×accent-a18、text×good-a08、muted×good-a08、good×good-a08、heat-text×win-a85、heat-text×terrible-a85、heat-text×heat-mid、text-faint×heat-empty(以上 panel 上)、warn-text×warn-bg、error-text×error-bg
  - 対象外: pager-disabled(opacity .5 の無効状態)と `.search-radar-toggle.off`(opacity .4)は WCAG 1.4.3 が無効な部品を除外しているため。アイコン(share-icon とブランド色)、グラフの塗り、ガント、scrim は文字ではないため。disabled-text×disabled-bg は除外しない(4.5 を満たす)
  - 実測(2.1 の値): ダークの最小は 4.836(terrible / terrible-a15 / panel-2)、ライトの最小は 4.659(great / great-a15 / panel-2)。モック値のままだとライトで17組が不合格(6章)
- 新規 `static/__tests__/typography.test.js`(+3): (1) styles/*.css の全 font-size 値が `inherit`、0.875 以上の `Nrem`、14 以上の `Npx` のどれか (2) app.js・components/・lib/ の `font-size:` も同じ条件 (3) base.css の body ルールに `font-family: var(--font-sans)` と `font-variant-numeric: tabular-nums` がある
- `static/__tests__/chart-canvas.test.js`(+2): (1) `canvasFont(n => 'F', 12, '700') === '700 12px F'`、weight を省くと `'12px F'` (2) components/**/*.js で、`ctx.font = '` の直書きが0件、`canvasFont(cssVar, N` と `font: { size: N` の N がすべて 12 以上、`sans-serif`・`system-ui` の直書きが0件
- `tools/ui-check/screens.test.js`(+1): baseline/*.png の集合が SCREENS × THEMES の `<id>-<theme>.png` と過不足なく一致する
- 画面: 各単位で `make ui-baseline` を実行して作り直す(見た目を意図して変えるため)。--update でも console エラー・はみ出し・14px 未満・必須要素で落ちる。見た目が正しいかは reviewer が基準画像を見て判断する

### 作業単位(1単位=1コミット。赤のまま次へ進まない)
| 単位 | 内容 | 完了コマンドと期待値 | コミット文言案 |
|---|---|---|---|
| U0 | 基線の確認 | make test-js が tests 209 fail 0 / make ui-check が 18/18 で WARN Chrome 行なし / go build ./... と go test -race ./internal/... が exit 0。外れたら着手せず main へ | (なし) |
| U1 | ui-check を2テーマ対応にする(THEMES・setEmulatedMedia・ファイル名)、screens.test +1、旧基準18枚を削除して make ui-baseline | test-js 210 / ui-check 36/36 / C7 | test: #425 ui-check をダーク・ライト両テーマで撮影する |
| U2 | 配色: モック issue-410-redesign-mock.html のライト値(win/lose/warn/s2 の4値、2行)を A+ に直す、tokens.css(2.1・2.2)、color-scheme の整理、heatmap-matches、logo.svg、theme-color、manifest、contrast.test +5、make ui-baseline。E1=A+ 確定済み | C5・C10〜C13・C17・C18 / test-js 215 / ui-check 36/36 | feat: #425 新デザインの配色に切り替え、OS 設定に合わせてライト配色を出す |
| U3 | 文字: --font-sans、2.3 の変換、base.css、tabular-nums の集約、typography.test +3、SMALL_TEXT_EXPR、make ui-baseline | C1〜C3・C14・C15 / test-js 218 / ui-check 36/36 | feat: #425 文字を本文16px・最小14pxにし、OS 標準フォントと等幅数字に揃える |
| U4 | canvas: canvasFont、Chart.defaults.font.family、目盛りを 12px、inBarLabel の縁取り、chart-canvas.test +2、make ui-baseline | C4・C16 / test-js 220 / ui-check 36/36 | feat: #425 グラフの文字を 12px 以上の OS 標準フォントにし、棒内ラベルを縁取る |
| U5 | CLAUDE.md・README の更新 | C19・C20 | docs: #425 CLAUDE.md と README にライト配色と ui-check の2テーマ撮影を反映 |
| 最終 | 全完了条件。ui-check は2回続けて実行 | 5章すべて | (設計書のステータスは運転者が更新) |

## 5. 完了条件
worktree 内で検証する。`BASE=$(git merge-base HEAD origin/main)`。表の中の `\|` は Markdown のエスケープなので、実行するときは `|` に読み替える。
| # | 条件 | コマンド | 期待値 |
|---|---|---|---|
| C1 | em の font-size が0件 | `grep -rhoE "font-size: *[0-9.]+em" static/styles static/components static/app.js static/lib \| wc -l` | 0(現状143) |
| C2 | 14px 未満の px/rem が0件 | `grep -rhoE "font-size: *[0-9.]+(px\|rem)" static/styles static/components static/app.js static/lib \| awk -F'[: ]+' '{v=$2; px=(v~/rem$/)?v*16:v+0; if(px<14)n++} END{print n+0}'` | 0 |
| C3 | 表示中の文字が14px以上 | `make ui-check` の出力に `14px 未満の文字` がない(C6 に含まれる) | 0行 |
| C4 | canvas の文字が12px以上で OS 標準フォント | `grep -rnE "ctx\.font *= *'" static/components \| wc -l` / `grep -rhoE "(font: *\{ *size\|canvasFont\(cssVar,) *:? *[0-9]+" static/components \| grep -oE "[0-9]+$" \| awk '$1<12' \| wc -l` / `grep -c "Chart.defaults.font.family = cssVar('--font-sans')" static/components/chart-canvas.js` | 0 / 0 / 1 |
| C5 | コントラストがダーク・ライトとも全組 4.5 以上 | `node --test static/__tests__/contrast.test.js` | pass 5 / fail 0 |
| C6 | 両テーマで全画面一致・console エラー0 | `make ui-check` を2回続けて実行 | 2回とも `ui-check: 36/36 OK`、exit 0、WARN Chrome 行なし |
| C7 | 基準画像が36枚で命名どおり | `ls tools/ui-check/baseline/*.png \| wc -l` / `ls tools/ui-check/baseline \| grep -vE -- '-(dark\|light)\.png$\|^meta\.json$' \| wc -l` | 36 / 0 |
| C8 | JS テストが全緑 | `make test-js` | tests 220 / fail 0 |
| C9 | Go の oracle(Go は変えない) | `go build ./...` / `go test -race ./internal/...` / `~/go/bin/golangci-lint run` / `gofmt -l .` / `git diff --name-only $BASE -- '*.go' \| wc -l` | exit 0 / exit 0 / 0件 / 出力なし / 0 |
| C10 | theme-color が2個 | `grep -c 'name="theme-color"' static/index.html` / `grep -c 'media="(prefers-color-scheme: light)" content="#f4f6f8"' static/index.html` / `grep -c '<meta name="theme-color" content="#0e141b">' static/index.html` | 2 / 1 / 1 |
| C11 | manifest の色 | `grep -c '"#0e141b"' static/manifest.webmanifest` / `grep -rc 0d1620 static/index.html static/manifest.webmanifest` | 2 / 両方 0 |
| C12 | color-scheme は tokens.css だけ | `grep -rlE "(^\|[ {;])color-scheme:" static/styles` / `grep -oE "(^\|[ {;])color-scheme: *(dark\|light)" static/styles/tokens.css \| wc -l` | tokens.css のみ / 2 |
| C13 | ロゴがライトに対応 | `grep -c "prefers-color-scheme: light" static/logo.svg` | 1 |
| C14 | tabular-nums は body の1か所 | `grep -o "tabular-nums" static/styles/*.css \| wc -l` / `grep -c "font-variant-numeric: inherit" static/styles/base.css` | 1 / 1 |
| C15 | フォントは OS 標準のスタックで、外部フォントなし | `grep -c '"Hiragino Sans", "Hiragino Kaku Gothic ProN", "Yu Gothic UI", "Noto Sans JP"' static/styles/tokens.css` / `grep -rn "fonts.googleapis\|@font-face" static --include='*.css' --include='*.html' \| wc -l` | 1 / 0 |
| C16 | 棒内ラベルを縁取る | `grep -c "ctx.fillText(" static/components/charts.js` / `grep -c "ctx.strokeText(" static/components/charts.js` | 1 / 1 |
| C17 | ヒートマップの「N戦」が heat-text | `grep -cE "\.heatmap-matches \{[^}]*var\(--heat-text\)" static/styles/report-table.css` | 1 |
| C18 | 色の直書き禁止を維持 | `grep -oE '#[0-9a-fA-F]{3,6}\b\|rgba?\(' $(ls static/styles/*.css \| grep -v tokens.css) \| wc -l` | 0 |
| C19 | CLAUDE.md を更新 | `grep -c "全18画面" CLAUDE.md` / `grep -c "36枚" CLAUDE.md` / `grep -cE "contrast.test\|typography.test" CLAUDE.md` / `grep -c "ライト" CLAUDE.md` | 0 / 1以上 / 1以上 / 2以上 |
| C20 | README を更新 | `grep -cE "contrast.test\|typography.test" README.md` / `grep -c "ライト" README.md` | 1以上 / 1以上 |

レビュー観点(完了条件とは分ける): ライト基準画像18枚の見た目(ロゴ・グラデ・影・ヒートマップ・棒グラフの縁取り)/ 14px 化で詰まった箇所(トップバーのモバイル、gantt-tick と軸の高さ14px、cal-dow、バッジ、サムネ内の代替文字)/ 文字の階層が rem 化でずれた入れ子(`.action-gain strong`、`.heatmap-wr` が 15→18px、15→17px)/ 二次文字色を muted に統一した影響 / ライトの `--line` を使う入力枠の視認性(入力枠のコントラストは 1.4:1 で、1.4.11 は完了条件に入れていない)。

## 6. エスカレーション事項
- **E1(解決済み: ユーザーが A+ を採用)モックのライト値のままでは 4.5:1 を満たさない。** ライトで17組が不合格になる。主なもの: great/great-a15 on panel-2 = 3.493(検索結果の WIN バッジ)、great/panel-2 = 4.216、terrible/terrible-a15 on panel-2 = 3.708、timeup(=warn)/timeup-a15 on panel-2 = 4.076、bad(s2 #c2541f)/panel-2 = 3.853。ダークは全組合格。
  | 案 | ライトの great / terrible / warn-text / bad | 最も低い組の比 |
  |---|---|---|
  | **A+(推奨)** HSL の明度だけを下げる(色相と彩度は保つ) | #0f6833 / #a62a1a / #7d5100 / #ab4a1b | 4.659(174組すべて合格) |
  | A(変更幅が最小) | #106b35 / #aa2b1b / #805300 / #b04c1c | 4.503(余裕が 0.003 しかなく、合成の丸めで落ちうる) |
  | B モック値のまま panel-2 を #f0f3f5、tint を .08 にする | モック値 | great/panel-2 が 4.500、tint の上は 4.064 で不成立 |
  | C モック値のまま該当の組を除外する | モック値 | 完了条件「全組 4.5」と矛盾する |
  付随する質問: A+ を採るなら、モック(issue-410-redesign-mock.html)のライト値も同じ値に直すか。推奨は直す(モックを定義値の出典として保つため。2行)。
- 既定値から変えた判断(根拠は1章の表): theme-color は「light を media 付き+dark を media なし」の2個 / OS テーマ変更時の canvas は追従しない / 既定の変更範囲を超える変更が4点(logo.svg、heatmap-matches の色、inBarLabel の縁取り、フォーム部品の font-family/numeric の継承)。いずれもライト化または14px化に必須。
- 不可逆な操作: 基準画像の全面更新(旧18枚の削除と36枚の追加)。見た目を意図して変えるためで、git で戻せる。
- 環境: rm/mv は対話確認でハングするので `/bin/rm -f`・`/bin/mv -f` を使う。基線の Chrome は 154.0.8037.95 / darwin-x64。

## 7. 起票候補・ナレッジ候補
- 起票候補: OS テーマ変更時にグラフを追従させる(親で色を確定しているレーダー3か所を build 内へ移す)/ グラフの塗りの非テキストコントラスト(1.4.11、3:1)と入力枠のコントラスト / line-height 1.6 の適用(#412〜)/ 二次文字色の段階を作り直すかの判断 / `<meta name="color-scheme">` で CSS 読み込み前のちらつきを防ぐ
- ナレッジ候補: ヘッドレス Chrome の既定 prefers-color-scheme は light に一致しない。setEmulatedMedia は matchMedia の change を発火し、img で読んだ SVG 内の media にも効く(2026-10-03 に実測)/ getPropertyValue はカスタムプロパティの var() を解決するが color-mix は解決しないので、JS が読むトークンは color-mix で書かない / ヒートマップは文字優先、棒は見た目優先+縁取り、という使い分け

## 8. 変更予定ファイル
新規: static/__tests__/{contrast,typography}.test.js、tools/ui-check/baseline/<18画面>-{dark,light}.png(36枚)
変更: static/styles/{tokens,base,status,topbar,report,report-table,share,period,menu,filters,notice,search,gantt,parts,responsive}.css、static/components/{ui,charts,chart-canvas}.js、static/components/report/{controls,overview}.js、static/logo.svg、static/index.html、static/manifest.webmanifest、static/__tests__/chart-canvas.test.js、tools/ui-check/{check,screens,screens.test}.js、tools/ui-check/baseline/meta.json、CLAUDE.md、README.md、docs/design/2026-10-03-design-tokens.md(E1 で直すなら docs/design/issue-410-redesign-mock.html も)
削除: tools/ui-check/baseline/<18画面>.png

## 9. 実装時の規約
- 1作業単位=1コミット。メッセージは4章の文言案を使う。
- コミットメッセージに Claude-Session 行を入れない。末尾は `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>` の1行だけ。
- コメントは1行で「なぜ」だけを書く。経緯と比較はこの設計書を参照する。
- push と PR は行わない。
