# 設計: デザイン刷新 段階B(4/4) ログイン・分析中・通知・空の状態

- ステータス: draft(実装着手可)
- 日付: 2026-10-07
- 関連 issue: #415(親 #410)。基線: 748968f(develop)。並行: #414(search.js/search.css/report.js の検索ビュー外枠)
- 見た目の正: `docs/design/issue-410-redesign-mock.html`(login / progress / states と NOTES)

## 1. 方針
既存の DOM 構成(`#loginForm`・`#status`・`#error`・`#report` を app.js が手続きで出し入れ)は変えず、中身だけを差し替える。通知と速報導線は既存 `Notice`(parts.js)を `#error`/`#status` 内に Preact で描いて再利用し、`#error` のインライン色上書きを撤去する。分析段階の判定は純粋関数 `static/lib/progress.js` に切り出し node:test で固定。空の状態は Report の useMemo で「期間0件」を Skeleton と区別し、本物の絞り込み行を残したまま表示する。Go は触らない。

### 主な決定
| 論点 | 採用 | 却下(理由) |
|---|---|---|
| 速報を見る | レポート未表示(スケルトン中)のときだけ速報を自動描画せず `#status` 内の Notice に「速報を見る」を出す。押したら描画し、以後の版は自動で差し替え。キャッシュ等でレポート表示中なら従来どおり自動差し替え | (a) 常に自動描画+ボタンでスクロール(ボタンが無意味) / (b) 常に要タップ(キャッシュ表示中の利用者まで挙動が変わる) / (c) モックどおり分析中を独立画面化(タブバーが消えログアウト=中断の経路を失う) |
| 分析段階 | `progressView(status)` が3段階(読み込み/取得/集計)の done/now/wait と割合・件数を返す。`#status` の既存進捗バーは残し、下に段階リストを足す | 大きな % 表示・独立画面(要求外) |
| 通知の色 | `#error` に `Notice` を描く `showNotice(tone,msg,action)`。warn=途中保存(partial)のみ、error=それ以外の失敗、info=409(自動更新で取得中) | 403 全失敗も warn(表示できる結果が無いので error が妥当) |
| 文言 | 403/セッション失効の本文は一字も変えない(#483)。見出しも足さない。新規文言は速報 Notice と空の状態だけ | モックの見出し追加(#483 の範囲) |
| 次の操作 | partial→「再分析」(reAnalyze)、セッション失効→「ログイン」(#username へスクロール+focus)、その他の失敗はボタン無し(モックどおり) | 全エラーにボタン |
| ボタン | `Notice` に `action={label,onClick}` を追加し `.ui-action`(parts.css、二次ボタン)で描く。空の状態のボタンも `.ui-action` | children に生ボタン(data-ui と見た目が呼び出しごとに散る) |
| 空の状態 | useMemo の期間0件を `{ empty: true }` で返し、絞り込み行・タブは本物のまま本文だけ `EmptyPeriod` に。「期間を変更」は PeriodSelector の `openSignal` を増やしてシートを開く | Skeleton を流用(ダミー絞り込みで戻れない=現バグ) / 全期間へ戻すだけのボタン(モックはシートを開く) |
| 保持の説明 | モーダル→チェックボックス直下の `<details>`。注意書き(囲み枠 `.security-note`)はパスワード欄の下の `.note` に移す。ボタン文言「分析開始」→「分析を始める」(モック NOTES) | |
| ポーリング重複 | 本質的に同一の「進捗表示」と「速報の取り込み」だけを `showProgress`/`takePrelim` に共通化。ループ本体(session 失効・partial・session_saved の差)は残す | ループ全体の共通化(差分が多く範囲外。起票候補) |
| ui-check の筋書き | モックは状態を持たないまま `/analyze` の username でジョブ id を選ぶ。`/session` は Cookie `preview_session=valid` で有効。日付指定は画面の `clock` で時計を固定 | サーバーに状態を持たせる(画面間で干渉) |

補足(調査で判明): `filterByPlayDays` は「試合のあった直近N日」なので試合が1件でもあれば空にならない。期間で0件になるのは日付指定(custom)だけ。0件全体はサーバーが「戦績データが見つかりませんでした」でエラーにするため Report には来ない。

## 2. 変更ファイル(変更予定ファイル)
| ファイル | 変更 |
|---|---|
| `static/index.html` | パスワード欄の下に既存注意文を `<p class="note">` で移動(`.security-note` 削除)。チェックボックス文言「ログイン状態を保持する（30日間）」、`#rememberInfoBtn` 削除、直下に `<details class="remember-info" data-ui="remember-info">`(summary「保持すると何が保存されますか」+ §3 の3項目 ul)。label に `data-ui="remember-label"`。`#analyzeBtn` 文言「分析を始める」。`#rememberModal` 削除。`#status` の `.progress-bar` に `id="progressBar" role="progressbar" aria-label="取得の進み具合" aria-valuemin="0" aria-valuemax="100"`、末尾に `<div id="statusSteps"></div><div id="prelimNotice"></div>`。`#error` は `class="notice-slot"`(`.error` を外す) |
| `static/app.js` | §3 の `showNotice`/`hideNotice`/`showProgress`/`clearProgress`/`takePrelim` を追加し、両ポーリングの進捗ブロック(現 144-161・497-515)と速報ブロック(163-176・517-531)を置換。`#error` への `textContent`/`style.*Color` 書き込みを全て `showNotice`/`hideNotice` に置換(行 97,117-119,200-201,385,400-409,426-428,435-438,558-565,569-571)。保持モーダル配線(598-615)削除。import に `Notice`(components/parts.js)と `progressView, prelimMessage`(lib/progress.js) |
| `static/lib/progress.js`(新) | `progressView`・`prelimMessage`(import なし) |
| `static/components/parts.js` | `Notice` に `action` |
| `static/components/report/report.js` | useMemo の `if (!periodFiltered.length) return null;` → `return { empty: true };`。state `periodOpen`(lensRef の直後)。`filters` の PeriodSelector に `openSignal=${periodOpen}`。pane 分岐の先頭に empty、empty 時は ReportSummary を出さない。末尾(Skeleton の後)に `EmptyPeriod`。検索ビュー分岐(現 213-219)と Skeleton は触らない |
| `static/components/report/controls.js` | PeriodSelector に `openSignal`(早期 return より前の useEffect)。適用ボタンに `data-ui="period-apply"` |
| `static/components/ui.js` | RangeCalendar の日ボタンに `data-ui="cal-day"`(属性のみ) |
| `static/styles/parts.css` | `.ui-action`、`.ui-notice .ui-action`、`.ui-notice > b`、`.ui-notice-info > b` |
| `static/styles/status.css` | `.status-steps` 一式、`.status:has(.status-steps) .spinner{display:none}`、`.status .ui-notice`(左寄せ・最大幅480px・上16px) |
| `static/styles/notice.css` | `.remember-label` に min-height 44px、`.remember-info` 一式、`.notice-slot{margin:16px 0}`。孤立する `.info-icon*`・`.modal-close*` を削除(`.modal-backdrop/.modal-content` は search.js が使うので残す) |
| `static/styles/base.css` | `.security-note` 削除、`.form-group .note{margin-top:8px}` |
| `static/styles/report-table.css` | `.error` 規則(61行)削除 |
| `static/styles/report.css` | `.report-empty` 一式 |
| `static/__tests__/progress.test.js`(新) | §4 |
| `tools/ui-check/server.js` | §3 の筋書き・`/session` の Cookie 判定・`/reanalyze` 401 本文を実文言に |
| `tools/ui-check/server.test.js` | +4 |
| `tools/ui-check/preview/seed.js` | `?session=valid` で has_session と Cookie `preview_session=valid; path=/` |
| `tools/ui-check/preview/parts.js` | `<${Notice} tone="warn" action=${{label:'再分析',onClick:function(){}}}>…` を1つ追加 |
| `tools/ui-check/page-determinism.js` | `clockSource(iso)` を export |
| `tools/ui-check/check.js` | `START_URL['report-session-valid']='/__preview/?session=valid'`、`screen.clock` があれば `clockSource` を addScriptToEvaluateOnNewDocument(不正な日時は InfraError) |
| `tools/ui-check/screens.js` | §5 の画面変更・7画面追加、冒頭コメントに `clock` |
| `tools/ui-check/screens.test.js` | +2 |
| `tools/ui-check/baseline/` | 変更7画面の更新+新7画面(14枚) |
| `CLAUDE.md` / `README.md` | 画面数 31→38・枚数 62→76、lib/progress.js・progress.test.js、parts.js の Notice action、ui-check の `clock` とモックの筋書き |

## 3. インターフェース
```js
// static/lib/progress.js
export function progressView(s) // s={status,progress?,progress_total?} → null | {pct:number|null, searching:boolean, count:string, steps:[{key:'load'|'fetch'|'build', label:string, state:'done'|'now'|'wait'}]}
export function prelimMessage(n) // → '取得済みの ' + n + ' 試合で集計しています。取得が進むと自動で更新されます。'
// static/components/parts.js
export function Notice({ tone = 'info', action, children }) // action?:{label,onClick} → 末尾に <button type="button" class="ui-action" data-ui="notice-action">
// controls.js
PeriodSelector({ periods, selected, onSelect, userKey, onCustomReport, openSignal }) // openSignal が 0 以外に変わるたび pop.open()
// report.js(非 export)
function EmptyPeriod({ scope, onChangePeriod })
// tools/ui-check/page-determinism.js
export function clockSource(iso) // Date を「iso + 実経過時間」の時計にする(引数ありの new Date は実物)。class FakeDate extends Date で now() も上書き
```
progressView の判定表(件数は `toLocaleString('ja-JP')`、pct は total>0 のとき `Math.min(100, Math.round(100*p/t))`):
| status | 条件 | steps(load/fetch/build) | count | searching |
|---|---|---|---|---|
| pending | — | now/wait/wait | '' | false |
| scraping | total=0 | done/now/wait | p>0 ? 'p 件' : '' | true |
| scraping | 0<p<total | done/now/wait | 'p / t 件' | false |
| scraping | p≥total>0 | done/done/now | 'p / t 件' | false |
| done | — | done/done/done | total>0 なら 'p / t 件' | false |
| その他(error/cancelled) | — | null を返す | | |
ラベル: '保存済みのデータを読み込み' / '新しい試合を取得'+(count ? '（'+count+'）' : '') / '集計してレポートを作成'。

app.js(内部関数):
- `showNotice(tone, message, action, source)`: `render(html\`<${Notice} tone action>${message}</${Notice}>\`, #error)`、display block、source があれば `dataset.source`、無ければ削除。`hideNotice()`: display none+source 削除。`showRebuildError` は `showNotice('error', msg, null, 'rebuild')` に置換、`clearRebuildError` はそのまま
- `showProgress(s)`: progressView が null なら clearProgress。pct あり→fill 幅・`#progressPct`=`pct+'%'`・`#progressBar` の aria-valuenow、searching→indeterminate と `#progressPct`='戦歴を検索中…'(現文言)・aria-valuenow 削除、どちらも無ければ wrap 非表示。`#progressCount`=count。`#statusSteps` に `<ol class="status-steps" data-ui="status-steps">` を render(li に `data-state`、now は `aria-current="step"`、印は `<span class="status-step-mark" aria-hidden="true">`)
- `clearProgress()`: wrap 非表示、`#statusSteps`・`#prelimNotice` を render(null)。両分析の開始時と finally で呼ぶ
- `takePrelim(jobId, s, st)`(st={version, shown, rendered}): 条件(logged_in && has_preliminary_report && version>st.version)を満たせば `/result` 取得→`activeJobId!==jobId` なら false。matches&&preliminary なら IndexedDB 保存、st.version 更新。st.shown なら即描画、でなければ `#prelimNotice` に `Notice`(`<b>速報レポートを見られます</b><p>prelimMessage(n)</p>`、action「速報を見る」)。描画時は st.shown=st.rendered=true・prelimNotice を消す。ボタンの onClick は `activeJobId===jobId` を確かめ最新の版を描く。**statusText は触らない**(次のポーリングが3秒以内に上書きし、ui-check の撮影が揺れるため)
- analyze: st={version:0, shown:usedCache, rendered:false}。`renderedReal` は st.rendered に置換(catch の `if (!renderedReal)` の意味は不変)。done 描画で st.rendered=true。partial は `showNotice('warn', 現文言そのまま, {label:'再分析', onClick:reAnalyze})`
- reanalyzeWithSession: st={version:0, shown:usedCache}。ローカル `expired` を returnToLogin を呼ぶ2箇所で true にし、401 分岐と catch で `showNotice('error', msg, expired ? LOGIN_ACTION : null)`。`LOGIN_ACTION={label:'ログイン', onClick: #username を scrollIntoView({block:'center'})+focus}`
- 409: POST の data.error を投げるとき `err.tone = res.status===409 ? 'info' : 'error'`(analyze・reanalyze とも)、catch は `showNotice(e.tone||'error', e.message, …)`。auto の409案内(statusText 経路)は不変
- 入力未入力('メールアドレスとパスワードを入力してください。')は error

ui-check モック(server.js、状態なし):
- `POST /analyze`: body.username が `prelim@example.com`→`{id:'preview-prelim'}`、`partial@example.com`→`preview-partial`、`error@example.com`→`preview-error`、他→`preview-job`(現状)
- `/status/preview-prelim`: `{status:'scraping',progress:37,progress_total:120,logged_in:true,has_preliminary_report:true,preliminary_version:1}` / `preview-partial`: `{status:'done'}` / `preview-error`: `{status:'error',error:'データの取得に失敗しました。時間をおいて再度お試しいただき、解決しない場合は開発者までお問い合わせください。'}`(pipeline.go の既定文言)/ 他: 現状
- `/result/preview-prelim`: `{user_key,matches,preliminary:true,schema_version}` / `preview-partial`: `{user_key,matches,partial:true,schema_version}` / 他: 404(現状)
- `GET /session`: Cookie に `preview_session=valid` があれば `{valid:true}`、無ければ現状 `{valid:false}`
- `POST /reanalyze`: 401 `{error:'セッションが見つかりません。再度ログインしてください。'}`(server.go:597 の実文言)

文言(新規): details 内 ul=「ログイン情報（セッション）を暗号化してサーバーに保存します。パスワードは保存しません。」「次回からパスワードを入力せずに最新の戦績を取得できます。」「期限が切れたら再ログインが必要です。「その他」のログアウトでいつでも削除できます。」/ 空の状態=見出し「この期間の試合はありません」、本文 `scope + ' に試合がありません。期間を広げると表示されます。'`(scope=`scopeText(selectedPeriod, periods, null, 'all')`)、ボタン「期間を変更」。EmptyPeriod は `<div class="report-empty" data-ui="empty-state" role="status">`

CSS の要点(トークンのみ・色リテラル禁止・余白8px単位・文字0.875rem以上): `.ui-action`= width:auto, min-height:44px, padding:0 16px, border:1px solid var(--line), radius 8px, background var(--panel), color var(--text), 0.9375rem bold, transition none, hover var(--accent-a10)。`.status-steps li`= flex/gap12/min-height44/下線 var(--line)/0.9375rem、`[data-state="wait"]` は var(--muted)、done の印は var(--accent) 塗り+var(--on-accent) のチェック、now は border-top 透明で spin(reduced-motion で停止)。`.remember-info > summary`= min-height44・var(--accent)・0.875rem・marker 非表示・回転する山形。`.report-empty`= 中央寄せ・padding 32px 8px、b は 1.0625rem、p は var(--muted) 0.9375rem・下16px

## 4. テスト計画
- `progress.test.js`(新, 9 以上): 判定表の6行(pending / total0 p0 / total0 p12='12 件' / 37/120→pct31・'37 / 120 件' / 120/120→build now・pct100 / done 全 done)、千区切り 1234/2000→'1,234 / 2,000 件'、error と cancelled→null、prelimMessage(412)
- `server.test.js`(+4): prelim の id・status・result(preliminary, MATCH_COUNT 件)/ partial の status done・result partial / error の status error と非空 error、未知 username→preview-job / `/session` が Cookie 無し false・有り true、`/reanalyze` 401 の error に「セッション」
- `screens.test.js`(+2): report-empty-period と -back が `clock` を持ち `[data-ui="cal-day"]` を click、empty は absent に skeleton、-back は absent に empty-state / analyze-partial が role="status"、analyze-error と notice-session-expired が role="alert" の `#error [data-ui="notice"]` を required に持つ
- ui-check(§5)で見た目・console・14px・タップ領域・基準比較
- 手動(完了条件外): `make ui-preview` で日付指定を空の日にして空表示→期間を変更→戻る

## 5. ui-check 画面と基準画像
既存の変更(required/ops を更新し基準を撮り直す):
- `login`: ops `[{click:['[data-ui="remember-info"] summary']}]`、required に `['[data-ui="remember-info"][open] li',null,3]` `['footer','非公式のファンツール']`、tap `['[data-ui="remember-info"] summary','[data-ui="remember-label"]','#analyzeBtn']`
- `analyzing`: required の `['#progressCount','37/120件']` → `['#progressCount','37 / 120 件']`、追加 `['[data-ui="status-steps"] [aria-current="step"]','新しい試合を取得（37 / 120 件）']`
- `parts`: required に `['[data-ui="notice-action"]']`
- 見た目だけ変わる(定義は不変): `session-expired` `more-reanalyze` `report-reanalyze` `mobile-pull-release`

新規7画面(各2テーマ=14枚。`node tools/ui-check/check.js --update <id>…` のみ。zsh は `${=IDS}`):
| id | viewport/full/start | ops | 検査 |
|---|---|---|---|
| analyzing-prelim | M/false/login | type `#username` prelim@example.com, `#password` preview-pass, click `#analyzeBtn` | required `#prelimNotice [data-ui="notice-action"]`(速報を見る)・`[data-ui="skeleton"]`・steps now(新しい試合を取得)、tap 同ボタン |
| analyzing-prelim-open | M/false/login | 上+wait 同ボタン+click 同ボタン+wait `[data-ui="report-scope"]` | required report-scope(全期間・60試合)・`#status`、absent `#prelimNotice [data-ui="notice"]`・`[data-ui="skeleton"]` |
| analyze-partial | M/false/login | username partial@example.com で分析 | required `#error [data-ui="notice"][role="status"]`(アクセスが制限)・`#error [data-ui="notice-action"]`(再分析)・report-scope、tap 同ボタン |
| analyze-error | M/true/login | username error@example.com で分析 | required `#error [data-ui="notice"][role="alert"]`(データの取得に失敗しました)・`#loginForm`、absent `#error [data-ui="notice-action"]` |
| notice-session-expired | D/true/report-session-valid | wait report-scope, click REANALYZE_BTN | required `#loginForm`・`#error [data-ui="notice"][role="alert"]`(セッションが見つかりません)・`#error [data-ui="notice-action"]`(ログイン)、expectConsole `['status of 401']` |
| report-empty-period | M/false/report, clock `2026-06-20T12:00:00+09:00` | wait report-scope, click period-trigger, click `[data-ui="period-item"]`(日付指定), click `[data-ui="cal-day"]`(3) ×2, click `[data-ui="period-apply"]`, wait `[data-ui="empty-state"]` | required empty-state(この期間の試合はありません)・`[data-ui="empty-state"] button`(期間を変更)・period-trigger(06-03 ~ 06-03)、absent `[data-ui="skeleton"]`、tap `[data-ui="empty-state"] button` |
| report-empty-period-back | 同上 | 上+click `[data-ui="empty-state"] button`, wait `[data-ui="period-panel"]`, click `[data-ui="period-item"]`(全データ), wait report-scope | required report-scope(全期間・60試合)、absent empty-state・skeleton |
(2026-06-03 は fixture の DAYS に無い日。clock で RangeCalendar の初期月が 2026年6月になる)

## 6. 完了条件(B=748968f)
| # | 条件 | コマンド | 期待値 |
|---|---|---|---|
| C1 | JS テスト全緑 | `make test-js` | exit 0、fail 0、pass 338 以上(現 323) |
| C2 | 段階判定の固定 | `node --test static/__tests__/progress.test.js` | exit 0、pass 9 以上 |
| C3 | ui-check 全 OK | `make ui-check` | exit 0、最終行 `ui-check: 76/76 OK` |
| C4 | console エラー0 | `make ui-check 2>&1 \| grep -c "console エラー"` | 0 |
| C5 | 空表示(スケルトン無し)と期間変更で戻れる | `node tools/ui-check/check.js report-empty-period report-empty-period-back \| grep -c '^OK'` | 4 |
| C6 | 警告とエラーが別の見た目 | `node tools/ui-check/check.js analyze-partial analyze-error notice-session-expired \| grep -c '^OK'` | 6 |
| C7 | 段階表示と速報を見る | `node tools/ui-check/check.js analyzing analyzing-prelim analyzing-prelim-open \| grep -c '^OK'` | 6 |
| C8 | ログイン(折りたたみ・免責・タップ領域) | `node tools/ui-check/check.js login more mobile-more \| grep -c '^OK'` | 6 |
| C9 | 色の上書き撤去 | `grep -cE "style\.(backgroundColor\|borderColor\|color) *=" static/app.js` | 0 |
| C10 | #error への直書き撤去 | `grep -cE "(error\|warning)\.textContent" static/app.js` | 0 |
| C11 | モーダル撤去 | `cat static/index.html static/app.js static/styles/notice.css \| grep -cE "rememberModal\|rememberInfoBtn\|modal-close\|info-icon"` | 0 |
| C12 | 折りたたみ1つ・囲み注意書き撤去 | `grep -c "<details" static/index.html` / `cat static/index.html static/styles/base.css \| grep -c "security-note"` | 1 / 0 |
| C13 | 注意書きがパスワード欄の下 | `node -e 'const s=require("fs").readFileSync("static/index.html","utf8");const p=s.indexOf("id=\"password\""),n=s.indexOf("サーバーには保存しません"),r=s.indexOf("id=\"remember\"");process.exit(p<n&&n<r?0:1)'` | exit 0 |
| C14 | .error 撤去 | `grep -c 'class="error"' static/index.html` / `grep -cE "^\.error *\{" static/styles/report-table.css` | 0 / 0 |
| C15 | 期間0件で null を返さない | `grep -c "if (!periodFiltered.length) return null" static/components/report/report.js` | 0 |
| C16 | PeriodSelector の hooks が早期 return より前 | `node -e 'const s=require("fs").readFileSync("static/components/report/controls.js","utf8");const b=s.slice(s.indexOf("export function PeriodSelector"),s.indexOf("export function MsSelector"));const r=b.indexOf("return null");const h=Math.max(...[...b.matchAll(/use[A-Z]\w*\(/g)].map(m=>m.index));process.exit(r>h?0:1)'` | exit 0 |
| C17 | Go 不変 | `git diff --name-only 748968f -- '*.go' go.mod go.sum \| wc -l` | 0 |
| C18 | 既存基準の更新は想定画面のみ | `git diff --name-only --diff-filter=M 748968f -- 'tools/ui-check/baseline/*.png' \| xargs -n1 basename \| sed -E 's/-(dark\|light)\.png$//' \| sort -u \| grep -vxE 'login\|session-expired\|analyzing\|more-reanalyze\|report-reanalyze\|mobile-pull-release\|parts' \| wc -l` | 0 |
| C19 | 新基準は14枚 | `git diff --name-only --diff-filter=A 748968f -- 'tools/ui-check/baseline/*.png' \| wc -l` | 14 |
| C20 | ドキュメント追従 | `grep -c "38画面" CLAUDE.md` / `grep -cE "31画面\|62枚" CLAUDE.md` / `grep -c "lib/progress.js" CLAUDE.md` / `grep -c "progress" README.md` | 2 / 0 / 1以上 / 2以上 |

基準画像更新の規則(各ユニット): `make ui-check 2>&1 | grep FAIL` の理由が「基準画像と不一致」「基準画像なし」のみで、id が §7 のそのユニットの想定リストの部分集合であることを確認(出力を報告)してから `node tools/ui-check/check.js --update <ids>`。`make ui-baseline` 禁止。

レビュー観点(完了条件とは別): 基準画像とモックの目視一致 / 速報を「レポート未表示時だけ要タップ」にした判断と導線 / warn・error・info の振り分け / Notice の action API と `.ui-action` の見た目 / EmptyPeriod の文言 / `takePrelim` 共通化の妥当性

## 7. 実装順(各ユニット: test-js 全緑 → 上記規則で ui-check)
| U | 内容 | 想定変更画面(既存)/ 新規 |
|---|---|---|
| U1 | lib/progress.js+test、server.js 筋書き+test、seed.js、page-determinism `clockSource`、check.js(clock・START_URL)、screens.test の基盤 | なし(62/62 OK) |
| U2 | ログイン(index.html・notice.css・base.css・モーダル配線削除・ボタン文言)、login 画面の ops/required/tap | login, session-expired, more-reanalyze, report-reanalyze, mobile-pull-release |
| U3 | Notice action・`.ui-action`・parts gallery、`#error` の showNotice 化・`.error` 撤去・409 info | parts / 新 analyze-partial, analyze-error, notice-session-expired |
| U4 | `#status` の段階リスト・速報導線(showProgress/clearProgress/takePrelim)、status.css | analyzing / 新 analyzing-prelim, analyzing-prelim-open |
| U5 | 空の状態(report.js・controls.js openSignal/period-apply・ui.js cal-day・report.css) | なし / 新 report-empty-period, report-empty-period-back |
| U6 | CLAUDE.md(16行・135行の画面数と `clock`・モック筋書き、112行 app.js に通知と速報導線、117行 Notice action、lib/progress.js を追加)・README(lib と __tests__ の一覧) | — |

実装メモ:
- 総時間が `TOTAL_TIMEOUT`(300000ms)に近づいたら(分析系画面は3秒ポーリングを1回以上待つ)check.js の既定を 420000 に上げる
- コミットメッセージ末尾は `Co-Authored-By` の1行のみ。Claude-Session 行は禁止(公開リポジトリ)
- PR 前に origin/develop へ rebase し、#414 が先に入っていたら基準画像を撮り直す(PNG を手でマージしない)。report.js の衝突は検索ビュー分岐を #414 側で採る

## 8. リスク
- 速報の挙動変更: 初回(キャッシュ無し)の利用者は速報が自動では出ず1タップ要る。キャッシュのある利用者は従来どおり。PR 本文に明記する
- `#error` を Preact 描画にしたため、`render()` を経ずに `#error` を書く経路が残ると表示が混ざる → C9・C10 で直書き0件を固定
- 時計固定(`clock`)は該当画面だけに注入。他画面の Date は実時間のまま
- 基準画像はマシン依存。#414 と同時期のため基準画像の衝突は rebase 後の撮り直しで解消する

## 9. エスカレーション4条件
- 不可逆・破壊的: 該当なし(ローカルのファイル変更のみ。削除はこの変更で孤立する CSS/HTML/配線だけ)
- 外部公開: 該当なし(push/PR は main が pr-create で扱う)
- 検証シグナル不在: 該当なし(test-js・ui-check で全条件を判定できる。判定手段の追加(progress.test・screens・モック筋書き・clock)は設計に含めた)
- 要件が真に曖昧: 該当なし。「速報を見る」は解釈が割れうるが、レポート未表示時だけ要タップにする既定で成果物は変わらない。ユーザーが常に自動表示を望む場合の差し戻しは `takePrelim` の分岐1つで済む

## 10. ナレッジ・起票候補
- ナレッジ: `filterByPlayDays` は「試合のあった直近N日」なので試合があれば空にならず、期間0件は日付指定だけで起きる / ui-check で現在日時に依存する UI(カレンダー初期月)は画面の `clock` で固定する / ui-check モックは username(ジョブ id)と Cookie で筋書きを選び状態を持たない
- 起票候補: セッション再分析(reanalyzeWithSession)で 403 途中保存の警告が出ない / analyze と reanalyzeWithSession のポーリングループ本体の共通化 / 通知の見出し(モックの「一部のデータで分析しています」等)は #483 の文言見直しで / `#error` がログイン欄の下にありモバイルで見落としやすい / 未使用 CSS(`.session-expired-banner`・`.info-note`)の削除
