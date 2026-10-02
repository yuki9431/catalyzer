# 設計: デザイン刷新 段階A(2/3) 定義とCSSの分割

- ステータス: implemented
- 日付: 2026-10-02
- 関連 issue: #423(親 #411、依存 #422、後続 #424 / #425)

## 1. 方針

`static/index.html` の `<style>`(19–642行)を、**元の記述順のまま連続区間で** 14 ファイルに機械的に切り出す。index.html には同じ順の `<link>` を並べる。色の直書きは `tokens.css` のカスタムプロパティに置き換える。値は元の表記のまま持たせ、color-mix は使わない。JS 側の色は描画先で読み方を分ける。
- **DOM に当てる色**(インライン style): `'var(--x)'` の文字列をそのまま渡す。CSS エンジンが解決するので、読み込みタイミングの問題が起きない
- **canvas / Chart.js に渡す色**: `var()` を解釈できないため、新設する `static/lib/theme.js` の `cssVar('--x')` で `getComputedStyle` から描画時に都度読む

### 主要判断
| 論点 | 採用 | 却下案と理由 |
|---|---|---|
| CSS 読み込み | `<link>` 14本を head に並べる | `@import` 集約: 読み込みが直列になり遅い / 1ファイル: 「画面・部品ごとに分割」の要求を満たさない |
| 分割境界 | 元の行の連続区間で切り、メディアクエリ(605–642)は末尾の `responsive.css` にまとめる | メディアクエリを各部品ファイルへ分散: ルール順が入れ替わる(制約2に反する)。#424/#425 で扱う |
| JS の色の読み方 | 描画時に `cssVar()` で都度読む(キャッシュしない) | モジュール読み込み時に1回だけ読む: CSS 読込順に依存し、#425 のテーマ切替にも追従しない / JS に値を複製: 真実源が2つになる |
| 透明度違い | 別トークン `--<基)-aNN`。値は元の rgba 表記のまま | color-mix / relative color: 丸め誤差で画素が変わる(制約3) |
| ヒートマップの動的透明度 | `'rgba(var(--win-rgb),' + a + ')'` のインライン文字列 | JS で `cssVar` から rgb を読んで組み立てる: DOM 向けなら var() の方がタイミングに依存しない。`rgba(var(--x-rgb), a)` は Bootstrap 5 と同じ定石 |
| トークン未定義の検出 | Node テストで静的に全参照を照合する。加えてブラウザ上では `cssVar` が空なら `console.error` を出す(ui-check がコンソールエラーとして FAIL にする) | JS にフォールバックの直書き値を持つ: 完了条件の grep に引っかかり、未定義も検出できなくなる |
| 文字・余白のトークン | `--font-sans`(body の font-family)、`--gutter`(ページ左右余白 16px、600px 以下は 10px)、影3種 | font-size 38種・角丸17種を全部トークン化: #425(最小14px)・#412〜415(8px グリッド)でルールごとに作り直すので、捨てる前提のトークンを約50個作ることになる(→ 6章 要確認) |
| 既存13トークン | 名前・値とも変えない | 改名すると var() の参照約200か所が変わり、見た目に効果は無い |

### トークン命名・統合ルール
1. 既存トークンと**同じ値**なら既存トークンを使う(JS の `'#81d4fa'` → `--accent-2` など)
2. 既存トークンの RGB に透明度を付けた色 → `--<既存名>-a<NN>`(NN = α×100 の2桁。例: `.2`→`a20`、`0.05`→`a05`)。同じ RGB・同じ α なら役割に関係なく1つにまとめる。表記揺れ(`.06` と `0.06`)は同じ値なので1つにしてよい
3. どちらにも当たらない色 → 役割で名前を付ける。**値が同じでも役割が違えば別トークン**にする(例: `#333` は入力枠・無効ボタンの背景・スピナーの3役で分ける)。値は一切変えない
4. 書式は既存に合わせ、kebab-case で接頭辞なし。グループ接頭辞として `--chart-*` `--gantt-*` `--brand-*` `--heat-*` を使う。rgb の三つ組は `--<名前>-rgb`(例: `76,175,80`)

## 2. 変更ファイルと変更内容

### 2.1 CSS 分割(index.html の行番号。各区間は前後の空行・区切りコメントを含み、19–642 を隙間なく覆う)
`<link>` の順 = 下表の順。これがカスケード順になるので入れ替え禁止。

| # | ファイル | 元の行 | 内容 |
|---|---|---|---|
| 1 | tokens.css | 19–33 | `:root` 定義(新トークンを追記) |
| 2 | base.css | 34–62 | リセット・body・.container・h1・ログインフォーム・label/input/button(全体共通)・security-note・note |
| 3 | status.css | 63–85 | 分析中ステータス・スピナー・進捗バー・.report の外枠・スケルトン |
| 4 | topbar.css | 86–107 | トップバー・ロゴ・再取得ボタン・controls-row |
| 5 | report.css | 108–205 | KPI・パネル・アクションプラン/フォーカス・two-col・タブ・カード・バッジ |
| 6 | report-table.css | 206–265 | レポートの表/details/ソート/もっと見る・ヒートマップ・グラフ枠・.error |
| 7 | share.css | 266–277 | SNS 共有ボタン |
| 8 | period.css | 278–318 | 期間セレクタ・カレンダー・時刻選択 |
| 9 | menu.css | 319–342 | ハンバーガーメニュー・ドロワー |
| 10 | filters.css | 343–374 | 機体セレクタ・レンズ切替・パネル内ドロップダウン |
| 11 | notice.css | 375–401 | info-note・ログイン保持チェック・モーダル・セッション切れバナー・免責表示 |
| 12 | search.css | 402–569 | 試合検索(フォーム・結果・ページャー・詳細モーダル・レーダー切替・経過トグル)。521–522 の @media を含む |
| 13 | gantt.css | 570–604 | 試合経過のガントチャート |
| 14 | responsive.css | 605–642 | @media 720px / 600px |

切り出しは手作業ではなく sed で行う: `git show HEAD:static/index.html | sed -n 'A,Bp' | sed 's/^    //' > static/styles/X.css`。ファイル冒頭にコメントは足さない(既存の区切りコメントで足りる)。末尾の空行は削ってよい。

### 2.2 tokens.css(既存13トークンの後ろに、1行の見出しコメントで区切って追記)
`:root { ... }` の後に `@media (max-width: 600px) { :root { --gutter: 10px; } }` を置く。

**文字・余白・影**
| トークン | 値 | 置換箇所(元の行) |
|---|---|---|
| --font-sans | -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif | 37 |
| --gutter | 16px(600px 以下は 10px) | 41 の padding 16px ×4 / 90 の `margin: -16px -16px 16px` → `calc(var(--gutter) * -1) calc(var(--gutter) * -1) 16px`、padding の左右 16px → `var(--gutter)`(上の `calc(16px+…)` と下の 6px は変えない) / 617 の 10px ×4 / 618 の margin -10px ×2・padding の左右 10px |
| --shadow-pop | 0 8px 24px rgba(0,0,0,0.4) | 283, 349, 365 |
| --shadow-pop-strong | 0 8px 24px rgba(0,0,0,0.45) | 442, 474 |
| --shadow-modal | 0 16px 48px rgba(0,0,0,0.5) | 392, 534 |

**CSS 用の色**(`:root` 外の直書き 92件 → 0件)
| トークン | 値 | 元の行 |
|---|---|---|
| --bg-glow | #14283a | 38 |
| --text-dim | #aaa | 48, 61(color), 64, 73, 255, 256, 302, 308 |
| --input-border | #333 | 50 |
| --on-accent | #062536 | 56, 145, 170, 174, 189, 296, 310, 358, 385, 394 |
| --disabled-bg | #333 | 60, 298(background) |
| --disabled-text | #666 | 60, 298(color) |
| --surface-sub | #162029 | 61(background), 243, 303, 309 |
| --text-subtle | #777 | 62 |
| --spinner-track | #333 | 65 |
| --bg-a82 | rgba(13,22,32,.82) | 91 |
| --accent-a05 / a06 / a07 / a08 / a10 / a15 / a18 | rgba(79,195,247, .05 / .06 / .07 / 0.08 / 0.1 / 0.15 / .18) | 144 / 159・376 / 219 / 409 / 103・527 / 311 / 118 |
| --warn-text | #ffd54f | 149, 398(color)(JS の警告バナーと共用) |
| --good-a08 | rgba(168,230,207,.08) | 160 |
| --mark-empty-border | rgba(255,255,255,.35) | 171 |
| --great-a15 / --terrible-a15 | rgba(105,240,174,.15) / rgba(239,83,80,.15) | 201 / 202 |
| --timeup / --timeup-a15 | #ffc107 / rgba(255,193,7,.15) | 204 |
| --heat-empty / --text-faint | rgba(255,255,255,0.03) / #666 | 252 / 252(color), 306, 316 |
| --heat-text | #eee | 254 |
| --terrible-a85 / --heat-mid / --win-a85 | rgba(239,83,80,0.85) / rgba(255,255,255,0.08) / rgba(76,175,80,0.85) | 257 |
| --error-bg / --error-border / --error-text | #3d1f1f / #ff5252 / #ff8a80 | 264 / 264 / 264, 299 |
| --share-icon / --brand-x / --brand-bsky / --brand-line / --share-copy-bg | #fff / #000 / #0085ff / #06c755 / #334 | 271 / 272 / 273 / 274 / 275 |
| --scrim | rgba(0,0,0,0.5) | 322, 611, 613, 630 |
| --scrim-strong | rgba(0,0,0,0.6) | 391 |
| --warn-bg / --warn-border | #4a3800 / #d4a017 | 398(JS と共用) |
| --text-legal | #5a6b7a | 400 |
| --vs-shadow | rgba(0,0,0,0.5) | 512(drop-shadow の色だけ) |
| --pager-disabled | #566 | 528 |
| --gantt-grid / --gantt-grid-major | rgba(255,255,255,0.09) / rgba(255,255,255,0.20) | 575 / 576 |
| --gantt-ex / -f / -s / -e | #5a6b7a / #ff5722 / #2196f3 / #4caf50 | 585 / 586 / 587 / 588 |
| --gantt-ov / --gantt-ov-border / --gantt-ov-on | rgba(255,255,255,0.18) / #cfd8e0 / #eef2f5 | 589 / 589 / 590 |
| --gantt-diamond-ring | rgba(0,0,0,0.35) | 592 |

件数の照合: 1行内の複数件を数えると合計 92件になり、現状の grep 出力と一致する。

**JS 用の色**(元の直書き → 置換後。この対応は場所によらず一意)
| 元の直書き | 置換後 |
|---|---|
| '#aaa'(凡例・y軸の目盛り・fontColor・レーダー軸ラベル) | cssVar('--chart-text') → 新設 `--chart-text: #aaa` |
| '#888'(x軸の目盛り) | `--chart-text-sub: #888` |
| 'rgba(255,255,255,0.05)' / '0.08' / '0.1' | `--chart-grid` / `--chart-grid-strong` / `--chart-radar-grid` |
| 'rgba(255, 255, 255, 0.3)' / '0.4'(50%基準線とその文字) | `--chart-ref-line` / `--chart-ref-text` |
| '#81d4fa' '#69f0ae' '#ef5350' '#4fc3f7' '#ff8a65' '#e6edf3' '#a8e6cf' '#8aa0b3' | 既存の --accent-2 / --great / --terrible / --accent / --bad / --text / --good / --muted |
| rgba(129,212,250, 0.1 / .2 / 0.3 / 0.35 / 0.5) | --accent-2-a10 / a20 / a30 / a35 / a50 |
| rgba(79,195,247, .2 / .25) | --accent-a20 / a25 |
| rgba(105,240,174, .2 / .25 / 0.6) | --great-a20 / a25 / a60 |
| rgba(239,83,80, .18 / .22 / 0.6 / 0.7) | --terrible-a18 / a22 / a60 / a70 |
| rgba(76, 175, 80, 0.7) | --win-a70 |
| rgba(255,138,101,.18) | --bad-a18 |
| '#ffca28' / rgba(255,202,40,.22) | 新設 `--radar-opp2` / `--radar-opp2-a22` |
| charts.js `heatColor` の 'rgba(76,175,80,' / 'rgba(239,83,80,' | `'rgba(var(--win-rgb),' + a + ')'` / `'rgba(var(--terrible-rgb),' + a + ')'`。`--win-rgb: 76,175,80`、`--terrible-rgb: 239,83,80` を新設 |
| app.js 警告バナーの '#4a3800' '#d4a017' '#ffd54f' | `'var(--warn-bg)'` `'var(--warn-border)'` `'var(--warn-text)'`(インライン style。cssVar は使わない) |

新設トークンは文字・余白・影5 + CSS 用の色55 + JS 専用27 = 約87。既存と合わせて約100になる。

### 2.3 ファイルごとの変更
- `static/index.html`: 18–643行の `<style>…</style>` を削除し、その位置に `<link rel="stylesheet" href="styles/<name>.css">` を 2.1 の順で14行置く。`<meta name="theme-color" content="#0d1620">` は HTML から CSS 変数を参照できないので残す
- `static/styles/*.css`(新規14): 2.1 / 2.2 のとおり
- `static/lib/theme.js`(新規): `cssVar` だけを置く(3章)
- `static/components/charts.js`: `import { cssVar } from '../lib/theme.js'`。直書きの色を 2.2 の対応表で置換し、`heatColor` は var() の文字列を返す形にする。生成箇所の共通化はしない(#424 の範囲)
- `static/app.js`: import を追加。`seriesByLens`(461–463)、`inBarLabel`(afterDatasetsDraw の冒頭で `--text`/`--good`/`--bad` をローカル変数に1回だけ読む)、MsCompareChart(613, 625)、固定相方のレーダー(725–726)、警告バナー(1861–1863)を置換
- `static/components/search.js`: import を追加。`radarPlayers` の4系列(366–369)を置換。スウォッチは解決済みの `p.color` を使うので変更しない
- `internal/server/server.go`: `staticCacheControl` の条件に `|| strings.HasSuffix(p, ".css")` を加え、コメントの「HTML/JS」を「HTML/JS/CSS」にする。`.css` の MIME は Go 組み込みの表にあるので追加の登録は要らない
- `internal/server/static_cache_test.go`(新規): basicauth_test.go と同じ httptest 形式のテーブルテスト
- `static/__tests__/theme.test.js`(新規): 4章
- `CLAUDE.md`「コード構成」:
  - `static/index.html` の説明を「SPA の HTML 骨格(CSS は static/styles/ を `<link>` で読む)」に変える
  - `static/styles/` の行を追加する(tokens.css に色・文字・余白の定義を集約。他は画面・部品ごと。`<link>` の順がカスケード順なので入れ替えない)
  - `static/lib/theme.js` の行を追加する(canvas/Chart.js 用に CSS 定義を読む `cssVar`)
  - `static/__tests__/` の説明に theme を加える
- `README.md`: プロジェクト構成のツリーに `styles/`(14ファイル)・`lib/theme.js`・`__tests__/theme.test.js` を追加し、表に `static/styles/` の行を追加する
- 変更しないもの: `tools/ui-check/**`(baseline を含む)、Makefile、CI(test-js の glob が新しいテストを既に拾う)

## 3. インターフェース

```js
// static/lib/theme.js
// tokens.css の値を読む。var() を使えない canvas/Chart.js 用。document が無い環境(Node)では ''。
export function cssVar(name) {
  if (typeof document === 'undefined') return '';
  var v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  if (!v) console.error('tokens.css に未定義のトークン: ' + name);
  return v;
}
```
- 呼び出しの規約: **引数は必ず `'--xxx'` の文字列リテラル**にする(文字列連結は禁止。テストで静的に照合するため)。呼び出しはモジュールのトップレベルではなく、描画時(render、useEffect、プラグインの描画コールバック)に限る
- 読み込みタイミング: head の `<link>` は script-blocking stylesheet にあたる。module スクリプトと body 末尾の classic スクリプトは、それが読み込まれるまで実行されない(HTML 仕様の "the end")。描画時に読むので CSS 読み込み前に読む経路は無い
- Go: シグネチャの変更は無い。`func staticCacheControl(next http.Handler) http.Handler` の条件だけを変える

## 4. テスト計画

- **Go** `TestStaticCacheControl`(テーブル形式): `/`、`/index.html`、`/app.js`、`/styles/tokens.css` は `Cache-Control: no-cache`。`/logo.svg`、`/manifest.webmanifest` は空
- **JS** `static/__tests__/theme.test.js`(3件。193 → 196)
  1. `cssVar('--accent')` が Node では `''` を返し、例外を投げない
  2. `static/app.js`、`static/components/*.js`、`static/lib/*.js` 中の `cssVar('--x')` の名前がすべて tokens.css に定義されている。リテラル以外の引数による呼び出し(`/cssVar\((?!'--)/` に一致するもの。定義行は除く)が0件
  3. `static/styles/*.css` と上記の JS 中の `var(--x)` の名前がすべて tokens.css に定義されている。かつ tokens.css 以外の styles/*.css にカスタムプロパティの定義(`/^\s*--[a-z0-9-]+\s*:/m`)が無い
- **分割が純粋か(U2)**: `diff -B <(git show HEAD:static/index.html | sed -n '19,642p' | sed 's/^    //') <(for f in $ORDER; do cat static/styles/$f.css; done)` が exit 0
- **置換で値が変わっていないか(U4)**: スクラッチパッドに置く一時スクリプト `token-expand-check.mjs`(コミットしない)。ui-check に写らない状態(無効ボタン・エラー・警告バナー・ホバーなど)も含めて全ルールを照合する。処理の要点:
  - tokens.css の `:root` から定義を読む
  - tokens.css 以外の13ファイルを ORDER 順に連結する。その際、既存13トークン以外の `var(--x)` を値に展開する。`--gutter` は responsive.css 内だけ 10px、他は 16px に展開する
  - 両辺を同じ関数で正規化する: `calc(Npx * -1)`→`-Npx`、空白の連続→1個、rgba 内の空白除去と `0.`→`.`、小文字化
  - 比較対象は `git show $(git merge-base HEAD origin/main):static/index.html` の 34–642 行
  - 一致すれば `OK`、不一致なら最初に食い違う位置の前後80文字を出す
- **画面(全工程)**: `node tools/ui-check/check.js`(16画面をピクセル完全一致で照合)

### 実装の小単位(各単位の終わりに検証。赤になったら次へ進まない)
| 単位 | 内容 | 検証 |
|---|---|---|
| U0 | 基線の確認 | `make test-js` が 193 pass、ui-check が 16/16 OK。**不一致なら着手せずに止まる**(基準画像は Chrome 154・darwin-x64 に依存) |
| U1 | server.go と Go のテスト | go build / go test -race / golangci-lint / gofmt |
| U2 | CSS の機械的な分割と `<link>` への置き換え(値は変えない) | 上記 diff が exit 0、`<link>` の順が ORDER と一致、ui-check 16/16、test-js 193 |
| U3 | theme.js と theme.test.js | test-js 196 |
| U4a | --font-sans・--gutter・影3種 | ui-check 16/16 |
| U4b | CSS の色をトークン化 | CSS grep 0件、expand-check が OK、ui-check 16/16 |
| U5 | JS の DOM 向けの色(警告バナー・heatColor) | ui-check 16/16(ヒートマップは report-playstyle に写る) |
| U6 | JS の canvas/Chart.js 向けの色を cssVar に | JS grep 0件、test-js 196、ui-check 16/16 |
| U7 | CLAUDE.md・README | 完了条件 C11 |
| 最終 | 全完了条件 | ui-check を2回連続で実行 |

ORDER=`tokens base status topbar report report-table share period menu filters notice search gantt responsive`

## 5. 完了条件(done-criteria)

| # | 条件 | 検証コマンド | 期待値 |
|---|---|---|---|
| C1 | tokens.css 以外の CSS に色の直書きが無い | `grep -oE '#[0-9a-fA-F]{3,6}\b\|rgba?\(' $(ls static/styles/*.css \| grep -v tokens.css) \| wc -l` | `0` |
| C2 | JS の色の直書き(issue の定義) | `grep -oE "'#[0-9a-fA-F]{3,6}'\|rgba?\([0-9., ]+\)" static/app.js static/components/*.js static/lib/*.js \| wc -l` | `0`(現状 101) |
| C3 | JS で数値から rgba を組み立てていない(heatColor のように C2 では拾えない形) | `grep -cE "rgba?\([0-9]" static/app.js static/components/*.js static/lib/*.js \| awk -F: '{s+=$2} END{print s}'` | `0`(現状 38行) |
| C4 | index.html に `<style>` が無い | `grep -c '<style' static/index.html` | `0` |
| C5 | CSS が14ファイルで、すべて link されている | `ls static/styles/*.css \| wc -l` と `grep -c 'rel="stylesheet" href="styles/' static/index.html` | どちらも `14` |
| C6 | 見た目が変わっていない | `node tools/ui-check/check.js` を2回連続で実行 | 2回とも最終行が `ui-check: 16/16 OK`、exit 0 |
| C7 | 基準画像を更新していない | `git status --porcelain tools/ui-check/baseline \| wc -l` と `git diff origin/main --stat -- tools/ui-check/baseline \| wc -l` | どちらも `0` |
| C8 | JS テストが全緑 | `make test-js` | exit 0、`ℹ tests 196`、`ℹ fail 0` |
| C9 | .css に no-cache が付く | `go test -race -run TestStaticCacheControl -v ./internal/server/` | `/styles/tokens.css` のサブテストを含め PASS |
| C10 | Go の oracle | `go build ./...` / `go test -race ./internal/...` / `golangci-lint run` / `gofmt -l .` | exit 0 / exit 0 / 指摘0件 / 出力なし |
| C11 | ドキュメントの更新 | `grep -c 'static/styles/' CLAUDE.md`、`grep -c 'theme.js' CLAUDE.md`、`grep -c 'styles/' README.md`、`grep -c 'theme.js' README.md` | いずれも 1 以上 |

レビュー観点(完了条件とは別。reviewer に渡す): トークン名と役割の対応が妥当か、同じ値の統合・分離の判断、分割境界の名前、CLAUDE.md の説明の粒度。

## 6. エスカレーション事項

- 不可逆操作: 該当なし(`<style>` の削除はファイル編集で、git で戻せる)
- 外部公開: 該当なし(PR 作成は main の判断)
- 検証手段の不在: 該当なし。ただし ui-check の基準画像は Chrome 154 / darwin-x64 に依存する。U0 で 16/16 にならなければ基線不一致なので、実装せずに main へ戻すこと(`--update` は禁止)
- 要件の曖昧さ(作業は止めない。既定値で進める): 「文字・余白の定義」の範囲を `--font-sans`・`--gutter`・影3種とし、font-size / padding / 角丸のルールごとの値はトークン化しない。理由は #425(最小14px)・#412〜415(8px グリッド)でルールごとに作り直すため。ユーザーが「全 font-size / 余白をトークン化」を望むなら U4a の範囲が広がる。その場合でも画素は変わらない
- 環境: `rm` / `mv` は対話確認でハングする。`/bin/rm -f` と `/bin/mv -f` を使う

## 7. ナレッジ候補・起票候補

ナレッジ候補(knowledge-add):
- CSS は `<link>` の順がカスケード順になる。styles/ のファイル間でルールを移すときは、同じ要素に当たる同じ詳細度のルールの前後関係が変わらないか確認が要る。メディアクエリを末尾の responsive.css にまとめているのはこのため
- canvas / Chart.js は `var()` を解決できないので `cssVar()` で読む。DOM 向けは `'var(--x)'` の文字列で渡す。トークン未定義は Node テストと ui-check のコンソールエラーで検出する
- rgba を color-mix に置き換えると丸めで画素が変わる。トークンは元の値のまま持ち、透明度違いは `-aNN` の別トークンにする

起票候補(issue-create):
- README のプロジェクト構成ツリーが古い(components/search.js・analysis/search.js・lib/match.js などが欠けている)。今回は追加分だけ書く
- server.go の `// securityHeaders は…` コメントが staticCacheControl の上にずれて置かれている(今回は触らない)
- `meta theme-color`・manifest の色と、canvas のフォント指定('11px sans-serif' など)は tokens の外に残る。#425 でライト配色やフォントを入れるときの残件として記録する

## 変更予定ファイル一覧(コンフリクト予防用)
static/index.html, static/styles/{tokens,base,status,topbar,report,report-table,share,period,menu,filters,notice,search,gantt,responsive}.css(新規), static/lib/theme.js(新規), static/__tests__/theme.test.js(新規), static/app.js, static/components/charts.js, static/components/search.js, internal/server/server.go, internal/server/static_cache_test.go(新規), CLAUDE.md, README.md
