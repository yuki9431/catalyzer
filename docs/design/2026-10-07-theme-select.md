# 設計: テーマ選択(端末に合わせる/ダーク/ライト) #448

- ステータス: 実装完了
- 日付: 2026-10-07
- 関連 issue: #448(一部 #447)。基線: 02a001d。基線の `make test-js` は pass 358 / fail 0、ui-check は 46画面・92枚

## 1. 目的と方針
その他画面(MoreView)の「設定」でテーマを 端末に合わせる/ダーク/ライト から選べるようにする。選択は localStorage `catalyzer_theme` に保存(既定は端末に合わせる)。選ぶと即座に画面全体(Chart.js・theme-color meta 含む)が切り替わり、再読み込みでちらつかない。

- **JS が `<html data-theme="dark|light">` を必ず付ける**。tokens.css は `:root{ダーク}` と `:root[data-theme="light"]{ライト}` の2ブロック。ライト定義は1か所(72トークン)で重複しない
- 初期適用は `<head>` の同期クラシック外部スクリプト `static/theme-init.js`(CSP script-src 'self')。全 stylesheet より前に置く。判定・保存・適用・OS 変更の購読を持ち `window.catalyzerTheme` を公開する
- グラフの再描画は `data-theme` を MutationObserver で拾うフック `useThemeName()`(chart-canvas.js)で行う

### トレードオフ
| 論点 | 採用 | 却下(理由) |
|---|---|---|
| ライト重複回避 | 上記(c)。重複0・トークン総数174不変 | (a) @media 内と [data-theme] に重複(食い違う) / (b) --light-* 経由(トークン倍増) / (d) light-dark()(getPropertyValue が解決しない。contrast.test のパーサも壊れる) |
| JS 失敗時 | ダーク固定 | CSS に @media を残す(結局ライト定義が重複)。JS 無しでは app.js(module)も動かない |
| theme-color meta | 1本(#0e141b)にし apply() が解決後の色を書く | 2本のまま両方書き換え(状態が2か所) |
| 初期適用と純粋ロジック | theme-init.js 1ファイルに IIFE で集約、テストは node:vm で実行 | ESM 分離(判定が2つになる)/ インライン(CSP 禁止)/ type=module(defer で FOUC) |
| グラフ再描画 | useThemeName(MutationObserver)。ChartCanvas の deps に theme 追加。themeReader() で色を解決する overview.js の2コンポーネントと search.js MatchDetail でも呼ぶ | 独自イベント / key 再マウント(タブ・スクロール消失)/ 系列色をトークン名で渡す(theme.test の「cssVar はリテラルだけ」違反) |
| 端末に合わせる中の OS 切替 | theme-init.js で matchMedia change を1回購読し system のときだけ apply(addEventListener 無ければ addListener) | コンポーネント側購読 |
| ログアウト時 | テーマ設定は消さない(app.js 不変) | VIEW_KEY 同様に消す |
| 置き場所 | 「設定」Panel の先頭。MoreView 系5画面は full:true なので既存基準は必ず変わる | 末尾 Panel |
| 保存値 | 'system'/'dark'/'light' をそのまま保存 | system を removeItem |

## 2. 変更ファイル
- 新規: `static/theme-init.js`、`static/__tests__/theme-init.test.js`、基準画像 `mobile-theme-light`・`mobile-theme-dark-reload`・`mobile-theme-os-switch`(各 -dark/-light)
- `static/index.html`: theme-color を1本に。直後・最初の `<link rel="stylesheet">` より前に `<script src="theme-init.js"></script>`(defer/async/module なし)
- `tools/ui-check/preview/parts.html`: 同位置に `<script src="/theme-init.js"></script>`
- `static/styles/tokens.css`: 末尾の `@media (prefers-color-scheme: light) { :root {…} }` を `:root[data-theme="light"] {…}` に(インデント1段下げ)。直前コメントは `/* ライト配色。data-theme は theme-init.js が付ける(JS 不在時はダーク) */`
- `static/styles/shell.css`: `.more-theme`(flex・wrap・align-items:center・justify-content:space-between・gap 8px 16px・padding-bottom 12px・margin-bottom 12px・border-bottom 1px solid var(--line))と `.more-theme-label`。トークンのみ、0.875rem 以上
- `static/components/shell.js`: `THEME_OPTIONS`(export)と `ThemeSettings`。設定 Panel 先頭。ToggleGroup を parts.js から import
- `static/components/chart-canvas.js`: `useThemeName` export。ChartCanvas deps を `deps.concat([inView, theme])`
- `static/components/report/overview.js`: BasicLensSection と FixedPartnerPanel の先頭(早期 return 前)で `useThemeName()`
- `static/components/search.js`: MatchDetail で `var theme = useThemeName();`、radarPlayers の useMemo deps を `[match, theme]`
- テスト: `contrast.test.js`・`chart-canvas.test.js`、`tools/ui-check/check.js`(colorScheme 操作)・`screens.js`・`screens.test.js`
- 基準更新: `more`・`mobile-more`・`mobile-more-confirm`・`mobile-more-auto-refresh`・`mobile-more-auto-refresh-error`(各2枚)
- ドキュメント: CLAUDE.md(:16 と :137 を 49画面・98枚に。操作一覧に colorScheme。:111 styles 説明。static/theme-init.js 項追加。shell.js/chart-canvas.js 説明に ThemeSettings・useThemeName)、README.md(static ツリーに theme-init.js、テスト一覧に theme-init.test.js、「ダークテーマ」を「ダーク/ライト(端末に合わせる・選択可)」に)
- 触らない: app.js・logo.svg・favicon.svg・components/parts.js・components/charts.js・lib/theme.js・Go 全部

## 3. インターフェース
```js
// static/theme-init.js(クラシックスクリプト。import/export 禁止。var/function・ES5)
// テーマ(端末に合わせる/ダーク/ライト)の初期適用と切替。FOUC 防止のため <head> で同期実行する
(function (w) { ... })(window);
window.catalyzerTheme = {
  KEY: 'catalyzer_theme',
  CHOICES: ['system', 'dark', 'light'],
  META: { dark: '#0e141b', light: '#f4f6f8' },   // tokens.css の --bg と一致(テストで固定)
  resolve(choice, osLight) -> 'dark'|'light',    // system は osLight で決める
  choice() -> 現在の選択,
  set(v),                                         // CHOICES 以外は 'system'。保存(例外は無視)してから apply
};
```
- 読み込み: `w.localStorage.getItem(KEY)` をプロパティアクセスごと try で囲む。`CHOICES.indexOf(v) >= 0` でなければ(null・未知・'valueOf'・例外)'system'
- matchMedia: あれば `'(prefers-color-scheme: light)'` を1回作る(作成例外は無視)。無ければ OS ダーク扱い
- apply: `documentElement.setAttribute('data-theme', t)` と `meta[name="theme-color"]` があれば content を META[t] に
- 起動時に1回 apply し change 購読。change では選択が system のときだけ apply

```js
// chart-canvas.js
export function useThemeName()  // data-theme の値(無ければ '')。effect 開始時に一度読み直し、以後 MutationObserver(attributeFilter:['data-theme'])で setState。cleanup で disconnect
// shell.js
export var THEME_OPTIONS = [{value:'system',label:'端末に合わせる'},{value:'dark',label:'ダーク'},{value:'light',label:'ライト'}];
function ThemeSettings()  // api = window.catalyzerTheme。useState(api ? api.choice() : 'system') を先に呼び、api が無ければ null
```
ThemeSettings の DOM: `div.more-theme[data-ui=theme-setting]` > `span.more-theme-label`「テーマ」+ `ToggleGroup options=THEME_OPTIONS value label="テーマ" ui="theme-toggle" onChange=v→api.set(v); setChoice(api.choice())`。ボタンは既存 `.ui-toggle-btn`(min-height 44px)。

## 4. テスト計画
- **theme-init.test.js(12件)**: readFileSync + `vm.runInNewContext(src,{window:fakeWin})`。fakeWin に document(documentElement の setAttribute/getAttribute、querySelector が返す meta)・localStorage・matchMedia(matches と発火できる listener)
  1. 保存値 dark/light/system がそのまま choice() 2. 未保存・'foo'・'valueOf'・getItem 例外・localStorage getter 例外で 'system'、例外を投げない 3. resolve 6通り 4. 初期適用: 保存light×OSダーク→light・#f4f6f8 / 保存dark×OSライト→dark・#0e141b / system×OSライト→light 5. matchMedia 無し→dark 6. set: 保存して即適用、setItem 例外でも適用、未知値は system 7. system 中は change で切替、dark 選択中は不変 8. META が tokens.css の --bg(ダーク `:root {`、ライト `:root[data-theme="light"] {`)と一致 9. index.html と parts.html で theme-init.js script が最初の `rel="stylesheet"` より前、defer/async/type=module なし。index.html の `name="theme-color"` は1本 10. shell.js THEME_OPTIONS の value 列が CHOICES と一致
- **contrast.test.js(5→6件)**: `lightMedia` を `css.slice(css.indexOf(':root[data-theme="light"] {'))`、変数名 `lightBlock`。追加1件: マーカー位置がダークブロックの `}` より後、parse(lightBlock) が70トークン以上、tokens.css に `prefers-color-scheme` が無い
- **chart-canvas.test.js(5→7件)**: ChartCanvas ソースに `deps.concat([inView, theme])`。components/ 配下で chart-canvas.js 以外の各ファイルの `useThemeName()` 呼び出し数 >= `themeReader()` 呼び出し数
- **screens.test.js(20→21件)**: テーマ3画面がそれぞれ `html[data-theme="…"]` を必須。os-switch は colorScheme で light へ。dark-reload は選択後に reload
- **check.js**: 操作 `{ colorScheme: ['dark'|'light'] }` 追加(許可リスト)。THEMES に無い値は InfraError。`Emulation.setEmulatedMedia` 後に rAF を2回待つ。screens.js 冒頭の操作一覧コメントにも追記
- **screens.js**: `THEME_BTN = '[data-ui="theme-toggle"] button'`、`SCOPE = ['[data-ui="report-scope"]', '全期間・60試合']`
  - mobile-more の required に `[THEME_BTN+'[aria-pressed="true"]','端末に合わせる']` と `[THEME_BTN,null,3]`
  - `mobile-theme-light`(M, full:true, start report): wait SCOPE → goTab('その他') → wait more → click [THEME_BTN,'ライト'] → wait [THEME_BTN+'[aria-pressed="true"]','ライト'] → goTab('レポート') → wait SCOPE。required: `['html[data-theme="light"]']`・ACTIVE_TAB・SCOPE。dark 回が「OSダーク×選択ライト」
  - `mobile-theme-dark-reload`(同): … click 'ダーク' → `{reload:true}` → wait pressed 'ダーク' → goTab('レポート') → wait SCOPE。required: `html[data-theme="dark"]`・ACTIVE_TAB・SCOPE。light 回が「OSライト×選択ダーク」
  - `mobile-theme-os-switch`(同): wait SCOPE → `{colorScheme:['light']}` → wait `['html[data-theme="light"]']`。required 同(light)。dark 回でレポート表示中にOSをライトへ切替、グラフ描き直しを検査
  - 3画面とも最後はレポート表示(MoreView の logo.svg が OS 追従で dark/light 回の画像が一致しないため)
  - 判定: 最終状態が同じなら dark 回と light 回の画像が画素一致(C9)

## 5. 完了条件(B=02a001d)
| # | 条件 | コマンド | 期待値 |
|---|---|---|---|
| C1 | JS 全緑 | `make test-js` | exit 0、fail 0、pass 372 以上 |
| C2 | テーマ判定・初期適用・FOUC 構造 | `node --test static/__tests__/theme-init.test.js` | fail 0、pass 12 |
| C3 | コントラスト | `node --test static/__tests__/contrast.test.js` | fail 0、pass 6 |
| C4 | CSS から OS 判定撤去 | `grep -r "prefers-color-scheme" static/styles \| wc -l` | 0 |
| C5 | ライトブロック1つ | `grep -c ':root\[data-theme="light"\]' static/styles/tokens.css` | 1 |
| C6 | トークン数不変 | `grep -cE '^\s*--' static/styles/tokens.css` / `awk '/:root\[data-theme="light"\]/,0' static/styles/tokens.css \| grep -cE '^\s*--'` | 174 / 72 |
| C7 | theme-color 1本 | `grep -c 'name="theme-color"' static/index.html` | 1 |
| C8 | U1 完了時点で見た目不変 | U1 コミット後 `make ui-check` | exit 0、`ui-check: 92/92 OK` |
| C9 | 選択/OS切替が優先、グラフ追従 | `cd tools/ui-check/baseline && for s in mobile-theme-light mobile-theme-dark-reload mobile-theme-os-switch; do cmp $s-dark.png $s-light.png \|\| exit 1; done` | exit 0 |
| C10 | C9 の検出力(一時的に壊して戻す) | chart-canvas.js の deps から `, theme` を一時削除 → `node tools/ui-check/check.js mobile-theme-os-switch` | exit 1、`mobile-theme-os-switch (dark)` だけ不一致 FAIL。戻すと通る |
| C11 | ui-check 2回連続全OK | `make ui-check` を2回 | 両方 exit 0、`ui-check: 98/98 OK` |
| C12 | console エラー0 | `make ui-check 2>&1 \| grep -c "console エラー"` | 0 |
| C13 | 画面定義規約 | `node --test tools/ui-check/screens.test.js` | fail 0、pass 21 |
| C14 | 基準更新は対象のみ | `git diff --name-only 02a001d -- 'tools/ui-check/baseline/*.png' \| sed -E 's#.*/##;s/-(dark\|light)\.png$//' \| LC_ALL=C sort -u \| tr '\n' ' '` | mobile-more mobile-more-auto-refresh mobile-more-auto-refresh-error mobile-more-confirm mobile-theme-dark-reload mobile-theme-light mobile-theme-os-switch more(8件) |
| C15 | 触らないファイル不変 | `git diff --name-only 02a001d -- static/app.js static/logo.svg static/favicon.svg static/components/parts.js static/components/charts.js static/lib/theme.js '*.go' go.mod go.sum \| wc -l` | 0 |
| C16 | ToggleGroup 再利用 | `grep -c 'ui="theme-toggle"' static/components/shell.js` / `grep -c "ui-toggle" static/styles/shell.css` | 1 / 0 |
| C17 | 色リテラルなし | `grep -oE '#[0-9a-fA-F]{3,6}\b\|rgba?\(' $(ls static/styles/*.css \| grep -v tokens.css) \| wc -l` | 0 |
| C18 | ドキュメント追従 | `grep -c "49画面" CLAUDE.md` / `grep -c "98枚" CLAUDE.md` / `grep -cE "46画面\|92枚\|prefers-color-scheme" CLAUDE.md` / `grep -c "theme-init" README.md` | 2 / 2 / 0 / 2以上 |

基準更新手順: (1) `make ui-check 2>&1 | grep FAIL` で失敗理由が「基準画像と不一致/なし」だけで失敗 id が C14 の8件に含まれることを確認 (2) `node tools/ui-check/check.js --update <ids>` (3) `make ui-baseline` は使わない。
レビュー観点(完了条件外): 390px 幅のテーマ行の見た目と折り返し、文言、Panel 内の並び、theme-init.js の読みやすさ、コメント1行。

## 6. 実装順(各ユニット: test-js 全緑 → ui-check)
- U1: theme-init.js、index.html・parts.html、tokens.css、contrast.test、theme-init.test(9・10 番以外。10 は U3)。基準変化なし(C8)
- U2: useThemeName・ChartCanvas deps・overview.js・search.js、chart-canvas.test、check.js colorScheme、新 mobile-theme-os-switch、screens.test
- U3: ThemeSettings・THEME_OPTIONS・shell.css、theme-init.test 10 番、mobile-more required、新2画面、基準更新
- U4: CLAUDE.md・README.md

## 7. リスクと既知の制限
- headless Chrome で setEmulatedMedia を変えたとき matchMedia change が発火する前提(未検証)。発火しなければ自己判断で削らず architect へ差し戻す
- C9 の画素一致が崩れたら bbox を添えて報告、条件は緩めない
- 既知の制限(#447 側): logo.svg・favicon・color-scheme meta は選択テーマに追従しない。JS 無効時は OS がライトでもダーク
- ログイン前は選べない(ログイン画面は保存値か OS に従う)
- 98枚で全体タイムアウト(300000ms)に掛かるなら check.js の TOTAL_TIMEOUT を 420000 に
- 並行ブランチとの衝突(screens.js・CLAUDE.md 画面数・基準画像): PR 前に rebase して撮り直す

## 8. エスカレーション
4条件に該当なし。上書き可能な既定値: ログアウトで消さない/JS 不在時ダーク/設定 Panel 先頭/保存値に 'system' を書く。
