# CLAUDE.md

このファイルは、Claude Code (claude.ai/code) がこのリポジトリで作業する際のガイドです。

## プロジェクト概要

catalyzer は、EXVS2IB（機動戦士ガンダム エクストリームバーサス2 インフィニットブースト）の戦績分析Webアプリ。公式サイトから対戦データをスクレイピングし、Firestoreに保存、フロントエンドのJS分析関数でレポートを生成する。

## 検証コマンド（oracle）— 自律ループの生命線

明示宣言が自動検出より常に優先される。変更は必ずこれらで裏を取り、全緑を確認してから完了とする。

- **ビルド**: `make build`（Docker）/ 直接: `go build ./cmd/server`
- **テスト（Go）**: `make test` / 直接: `go test -race ./internal/...`
- **テスト（JS）**: `make test-js` / 直接: `node --test 'static/__tests__/*.test.js' 'tools/ui-check/*.test.js'`
- **画面確認（UI oracle）**: `make ui-check`（55画面をダーク・ライトの2テーマで計110枚、実Chromeで撮影し基準画像と比較・console エラーと14px 未満の文字・主要タップ領域の44px 未満・画面内に見えない要素(`inview`)・画面内に見えるべきでない要素(`outview`)・在ってはいけない要素(`absent`)・スクロール中の固定高さ(`fixedMax`)を検出。UI を変えたら必須。意図した変更は `make ui-baseline` で基準更新、画面を追加したときは既存基準を触らず `node tools/ui-check/check.js --update <id>…` で新画面のみ基準作成(両テーマ分)。Chrome が既定パス(macOS の Google Chrome)に無い場合は `CHROME_PATH` で指定する）
- **lint**: `golangci-lint run`
- **フォーマット**: `gofmt -l .`（差分ゼロが正）
- **実行/動作確認**: `make run` / 直接: `PORT=8080 go run cmd/server/main.go`（http://localhost:8080 ）

完了条件の既定値: 上記が全て成功していること。Go の変更は build+test+vet/lint、JS の変更は test-js を最低限通す。

## ビルド・開発コマンド

```bash
# ビルド＆起動（初回・コード変更時）
make restart

# ビルドのみ
make build

# 起動のみ（ビルド済みの場合）
make run

# コンテナ停止
make stop

# Goテスト
make test

# フロントエンド（JS）テスト
make test-js

# UIプレビュー（サンプルデータ、http://127.0.0.1:8090/__preview/）/ 画面確認 / 基準更新
make ui-preview
make ui-check
make ui-baseline

# ポート変更
PORT=3000 make run

# フロントエンド確認（サーバー不要）
# static/preview.html をローカルHTTPサーバーで開く
python3 -m http.server 8888 --directory static
# → http://localhost:8888/preview.html

# Firestoreから未登録グレードURLを抽出（要: gcloud auth application-default login）
FIRESTORE_DATABASE=exvs-analyzer make extract-grades

# Pulumiコマンド（Docker経由。secretはGCP KMSで暗号化するためパスフレーズ不要、ADCで復号）
make pulumi-shared-preview            # shared プレビュー
STACK=prod make pulumi-app-preview    # app(本番) プレビュー
STACK=stg make pulumi-app-preview     # app(検証) プレビュー
make pulumi-shared-shell              # shared シェル（pulumi upはここで）
STACK=prod make pulumi-app-shell      # app(本番) シェル
STACK=stg make pulumi-app-shell       # app(検証) シェル
```

http://localhost:8080 でアクセス可能。

**ローカル環境にGoはインストール済み。Pulumiはインストールされていない。** テストやビルドはDocker経由（Makefile）でも直接でも実行可能。Pulumi のsecretは GCP KMS で暗号化しており（各スタックの `secretsprovider: gcpkms://...`）、`gcloud auth application-default login` 済みのADCで復号する。パスフレーズは不要。

CIでは `golangci-lint`、`go test -race`（カバレッジ計測付き）、`go build`、`node --test`（JSテスト）を実行。ラベル `skip-ci` でスキップ可能。

## アーキテクチャ

Go HTTPサーバーによる**非同期ジョブパイプライン**（最大同時実行数: 3）:

```
ブラウザ → POST /analyze → ジョブ作成（pending）
  → Firestoreから既存matchesを読み取り → 速報マッチデータ生成
  → Collyで新規戦績をスクレイピング（状態: scraping）
  → data/ms_list.jsonからMS名・コストを補完
  → Firestoreにmatches/tag_partners書き込み（タイムラインはmatchesに埋め込み）
  → 全matchesからMatchData JSON生成（状態: done）
クライアントは GET /status/{id} でポーリング後、GET /result/{id} で結果取得
フロントエンドがIndexedDBにmatchesを保存し、JS分析関数で統計を計算・表示
```

**主要エンドポイント:** `POST /analyze`, `GET /status/{id}`, `GET /result/{id}`, `POST /cancel/{id}`（実行中スクレイピングの中断。ログアウト時に使用）, `GET /matches`（セッション本人の試合のみ）, `GET /schema-version`（MatchDataの現行スキーマバージョン。Firestore未アクセス。フロントのIndexedDBキャッシュ再構築判定に使用）, `GET /tag-partners`（セッション本人のみ。分析直後は `/result` にも含む）, `GET /ms-list`（機体名→画像URL）, `GET /national-ms-stats`（機体ごとの全国勝率・使用率。深夜バッチが取得した静的データを起動時に読み込んで配信）, `GET /session`, `DELETE /session`, `POST /reanalyze`, `GET /health`, `GET /`（静的UI）, 自動更新: `GET|POST /auto-refresh`（状態取得・有効化/無効化。有効化は合言葉が要る）, `POST /auto-refresh/touch`（最終アクセス更新）, `POST /internal/auto-refresh/tick`（Scheduler 専用。OIDC 検証、対象がいれば Job を起動）

## コード構成

- `cmd/server/main.go` — エントリポイント。`internal/server.StartServer()` に委譲
- `cmd/update-mslist/main.go` — 機体使用率ランキングを1回巡回し `data/ms_list.json` と `data/national_ms_stats.json` を更新するCLI
- `cmd/delete-recent-matches/` — 指定ユーザーの最新N日間の戦績を削除するCLI（ドライラン対応）
- `cmd/auto-refresh/` — 自動更新の Cloud Run Job のエントリ（`autorefresh.RunJob`）。Dockerfile で `/app/auto-refresh` に入る
- `cmd/hash-passphrase/` — 自動更新の合言葉の argon2id ハッシュを出力するCLI
- `cmd/extract-grades/` — Firestoreから全ユーザーの未登録グレードURLを抽出するCLI
- `internal/model/` — 型定義 + `UserKey`（`PlayerScore`, `DatedScore`, `MSInfo`, `MatchEvent`, `MatchTimeline`, `TagPartner`, `JobStatus`, `JobSnapshot`, `ClassRecord`/`WinRecord`/`CountStat`）
- `internal/mslist/` — MSリストの読み書き・マージ（`LoadMSList`, `SaveMSList`, `MergeMSList`, `BuildMSNameMap`, `FillMsNames`, `CheckUnknownMS`）
- `internal/gradelist/` — グレードリストの読み込み・未知URL検出（`LoadGradeList`, `BuildGradeMap`, `CheckUnknownGrades`）
- `internal/scraper/` — Collyベースのスクレイパー（`scraper.go`）+ バンダイナムコID認証（`login.go`）+ 戦績ページのクラスマッチ通算戦績取得（`classrecord.go`。分析時に1回取得し `/result` の `class_record` で返す。永続化しない）
- `internal/session/` — セッション暗号化（AES-256-GCM）とCookieJarシリアライズ（`crypto.go`, `jar.go`）
- `internal/firestore/` — Firestoreクライアント初期化（`client.go`）+ matches/tag_partnersの読み書き（タイムラインはmatches内に埋め込み）+ セッション保存（`session.go`）
- `internal/autorefresh/` — 自動更新（10:00〜翌1:00 JST の間、最終アクセスから10分間、5分おきに差分取り込み）。合言葉の照合（`passphrase.go`）・Job 起動（`launcher.go`）・ユーザーごとの lease 付き更新（`autorefresh.go`）
- `internal/pipeline/` — 分析パイプライン（`Job`型、ジョブストア、`Run`関数、JSON生成、試合データ配信（`ActionJSON`型でタイムラインイベント展開）、セッション永続化）
- `internal/nationalstats/` — 全国統計（勝率・使用率）の読み書き（`Load`, `Save`）。全プレイヤー共通のデータなので `cmd/update-mslist` が取得し `data/national_ms_stats.json` で持ち回る
- `internal/server/` — HTTPハンドラ（`server.go`）+ IPベースレート制限（`ratelimit.go`）+ Basic認証（`basicauth.go`）+ 403一時ブロック（`block403.go`）+ セッション管理エンドポイント + 自動更新 API（`autorefresh.go`）+ Scheduler の OIDC 検証（`oidc.go`）
- `static/index.html` — SPA の HTML 骨格（CSS は `static/styles/` を `<link>` で読む）
- `static/styles/` — CSS（ダーク既定・ライトは選択可(端末に合わせる/ダーク/ライト)、レスポンシブ対応、カスタムドロップダウン）。`tokens.css` に色・文字・余白の定義を集約（ライトは同ファイル末尾の `:root[data-theme="light"]` で上書き。文字は rem で最小14px）し、他は画面・部品ごと。全15ファイル。`parts.css` は共通部品（接頭辞 `ui-`）。`<link>` の順がカスケード順なので入れ替えない
- `static/theme-init.js` — テーマの初期適用と切替（`window.catalyzerTheme`。`<head>` の同期クラシックスクリプト。`catalyzer_theme` を読み `<html data-theme>` と theme-color meta を付け、端末に合わせる中は OS 変更を購読）。import を持たない
- `static/app.js` — フロントエンドのエントリ（CSP対応で外部化）。定数・分析ジョブの開始/中断/再分析・ログアウト・キャッシュ再構築・フォーム配線・セッション復元・再読み込みでの再分析（`shouldReanalyzeOnReload`。ホーム画面アプリ判定 `STANDALONE`）・自動更新の差分取り込み（`pullAutoRefresh`）・通知（`showNotice`。`#error` に Notice を描く）・分析中の進捗表示と速報の自動描画（`showProgress`/`takePrelim`）・`window.renderReport` のみ。Preact コンポーネントは定義しない（`REPORT_ACTIONS` を props で Report に注入し、report/ から app.js を import しない）
- `static/components/report/` — レポート画面（9ファイル）。`report.js`（Report・Skeleton・タブ定義・状態管理）/ `controls.js`（TimeSelector/PeriodSelector/MsSelector/LensToggle）/ `summary.js`（ReportSummary・タブごとの要約）/ `action-plan.js`（ActionPlanPanel）/ `overview.js`（BasicLensSection/FixedPartnerPanel/OverviewPane）/ `playstyle.js` / `burst.js` / `matchup.js` / `time.js`（各タブの Pane）。720px より広い画面では絞り込み行の右端(試合検索・総合戦歴は上部バーの右端 `.topbar-trailing`)に再分析ボタン。standalone の引っ張り再分析はホーム・レポート・試合検索・総合戦歴で有効
- `static/components/shell.js` — 外枠 AppShell（トップバー・本文・下部タブバー TabBar）、その他画面 MoreView（共有タイル・データ・アカウント）、画面状態 `useView`（`catalyzer_view` の読み書き）、下部タブの更新の点 `useTabBadges`（`catalyzer_tab_seen`）、下スクロールで絞り込み行を隠す `useCollapsingBar`、ホーム画面アプリだけの引っ張り再分析 `PullToRefresh`、その他画面のロゴと「再分析」行、設定のテーマ選択（`ThemeSettings`・`THEME_OPTIONS`）と自動更新セクション（`AutoRefreshSettings`。操作は `autoRefresh` props で app.js から注入）。トップバー定義はここだけ（絞り込みもタブも無い画面は高さ0）
- `static/components/home.js` — ホーム画面（HomeView）。勝率アップミッション（ActionPlanPanel）と前回との比較。起動時は常にこの画面で開く（app.js が `catalyzer_view` を home にする）
- `static/components/popover.js` — 共通ポップオーバー（`usePopover`/`useDismiss`/`Popover`/`popoverStyle`）。外側クリック・Esc の document リスナーはここだけ。ドロップダウン5種が載る
- `static/components/chart-canvas.js` — `ChartCanvas`（`new Chart(` の唯一の生成箇所。テーマ切替で描き直す）・`useThemeName`（`data-theme` を購読。`themeReader` で色を解決する描画が呼ぶ）と軸・凡例・色ヘルパ（`winRateComboConfig` 等）
- `static/components/parts.js` — 段階B向けの共通部品5種（Chip/ToggleGroup/Summary(主指標付き)/RowList(バー付き)/Notice）。スタイルは `static/styles/parts.css`。Notice は `action={label,onClick}` で二次ボタン（`.ui-action`）を添えられる。RowList はその他画面（MoreView）が使う（部品一覧は ui-check の `parts`・`parts-sheet` 画面）
- `static/analysis/stats.js` — 統計分析関数。時間帯/曜日/日別/シーズン/基本データ/勝敗パターン/敵相性/相方/コスト編成/MS編成/ダメージ貢献/被撃墜と勝率（自分×相方の2軸・回数ベース）/覚醒回数/先落ち後落ち/順落ち（自機・僚機が順不同で15秒以内に続けて撃墜。試合継続/そのまま負け/なしに分類）/覚醒タイミング（発動時の被撃墜数で1機目/2機目/3機目に分類）/覚醒タイプ別傾向（F/S/E）/固定相方/SNS共有データ/MS別サマリー
- `static/analysis/coach.js` — 勝率アップミッションの純粋関数。試合を負け筋の状態（被撃墜回数・先落ち/後落ち・1機目覚醒・覚醒中の被撃墜・覚醒回数・順落ち・被ダメ/与ダメ/EXダメ）とそれ以外に二分し、勝率差×頻度で影響度と見込み勝率を算出（`computeActionPlan`）。選択したミッションの試合ごとの達成判定（`evaluateGoal`）、苦手機体・3連敗直後の勝率（参考情報）、直近20戦の悪化指標も算出。ホーム画面の ActionPlanPanel が全期間（機体で絞り込み可）の試合で表示
- `static/analysis/today.js` — 今日（試合が無ければ最後に遊んだ日）を前回プレイした日と比べる純粋関数（`compareToday`。日付は朝5時で切り替え `playDay`）。勝率・与ダメ・被ダメ・与被ダメ比・EXダメ・被撃墜
- `static/analysis/search.js` — 試合検索の純粋関数（機体名一覧の集計・条件絞り込み・並べ替え・適用中の条件と並べ替えの表示文言 `appliedFilterLabels`/`sortLabel`）。IndexedDBの全試合をフロントエンドでフィルタ
- `static/components/ui.js` — 汎用UIコンポーネント（Panel/Tips(事実の箇条書き)/SortableTable/Table/SubSection/Dropdown/MultiSelect/Autocomplete）
- `static/analysis/classrecord.js` — 通算戦績の整形純粋関数（分析カバー率・通算K/D）
- `static/components/classrecord.js` — モバイル総合戦歴ビュー（ClassRecordView）。通算/チーム/ソロ/日週月の戦績と通算記録（敵撃破数等）
- `static/components/search.js` — 試合検索ビュー（SearchView）。絞り込みの全画面シート（`Layer`/`FilterSheet`）＋適用中タグ＋結果一覧（`ResultItem`。機体サムネイル `MsThumb`・左端の勝敗の色帯・日付順のとき日付区切り。並べ替えシート・ページ送り）＋全画面の試合詳細（`MatchDetail`。4人の比較・スコア・試合経過）
- `static/components/charts.js` — Chart.jsグラフ＋レポートセクション（WinRateRowList/EnemyMatchupSection/PartnerSection/時間帯・曜日・日別・シーズンChart等）
- `static/lib/db.js` — IndexedDBキャッシュ（試合データの保存・読み込み・差分取得・ログアウト時の全消去 `clearAllMatches`）
- `static/lib/format.js` — 書式ヘルパー（数値フォーマット・色分け・SVGアイコン・共有テキスト生成）
- `static/lib/autorefresh.js` — 自動更新の純粋ロジック（`diffAfterParam`・`shouldPull`・状態表示の文言 `describeStatus`・`errorMessage`）。通信と描画は持たない
- `static/lib/theme.js` — canvas/Chart.js 用に CSS 定義を読む `themeReader`（1描画1回 getComputedStyle を呼び読み取り関数を返す）
- `static/lib/gantt.js` — 試合経過ガントの目盛りの純粋ロジック（`ganttTicks`。終了ラベルと重なる目盛りを画面幅別に間引く）。import を持たない
- `static/lib/topbar.js` — 上部バーの純粋ロジック（引っ張り再分析 `pullStep`・絞り込み行の隠す/出す `nextBar`）。import を持たない
- `static/lib/runlock.js` — 分析の多重起動ロック `createRunLock`（release で実行中でも切り離せる）
- `static/lib/progress.js` — 分析の進み具合を3段階（読み込み/取得/集計）の表示用に整える純粋関数 `progressView`。import を持たない
- `static/lib/tabseen.js` — 下部タブの更新の点の純粋ロジック（`tabBadges`・`markSeen`。タブごとに最後に見たときの試合数等と比べる）。import を持たない
- `static/lib/launch.js` — 起動経路の判定（`navigationType`・`isStandalone`・再読み込みでの再分析の抑止 `shouldReanalyzeOnReload`）。DOM・storage を持たない
- `static/lib/userkey.js` — サーバーの `model.UserKey` と同じユーザーキーの導出（`userKeyOf`。ログイン時に前ユーザーのキャッシュを出さない判定に使う）
- `static/lib/match.js` — 試合データの判定ヘルパー（タイムアップ判定）。import を持たず analysis 層からも使う
- `tools/ui-check/` — UI oracle（依存ゼロ・要Chrome）。`server.js`（`/auto-refresh` 系を含む API をモックし static/ を無加工配信。状態は持たず、`/analyze` の username（`prelim@`/`partial@`/`error@example.com`）でジョブ id を、Cookie `preview_session=valid` で `/session` を選ぶ、`/__preview/` でサンプル投入（`preview/seed.js`。`?today=N` で最後の N 試合を今日に、`?seen=N` でタブの点を再現））/ `fixture.js`（架空データ60件）/ `cdp.js`（CDP pipe クライアント）/ `check.js`+`screens.js`（55画面×ダーク/ライトの110枚の撮影・必須要素・console エラー・14px 未満検出・タップ領域44px検査・`inview`/`outview`/`absent` 検査・固定高さ(`fixedMax`)と帯の検査・基準比較。操作は click/type/scroll/wait/reload/scrollBy/pull（CDP のタッチ）/colorScheme（端末の配色を切り替える）。画面の `standalone` でホーム画面アプリとして開く。画面の `clock` で Date を指定日時から進む時計に固定（カレンダー初期月など日時依存の UI 用）。テーマは `Emulation.setEmulatedMedia` で明示）/ `baseline/`（基準画像 `<id>-<theme>.png` の110枚。Chrome・マシン依存）。操作・必須要素は `data-ui` と ARIA 属性で探す（コンポーネントの目印。クラス名は使わない）。`preview/parts.html` は部品一覧ページ
- `static/__tests__/` — フロントエンドJSテスト（Node.js組み込みテストランナー、依存ゼロ。stats/coach/today/tabseen/format/search/classrecord/theme/theme-init（初期適用・FOUC 構造）/topbar/runlock/launch/userkey/progress/ganttの純粋関数テスト、contrast.test（tokens.css を解析しダーク・ライトの文字色×背景色が4.5:1以上か判定）/typography.test（font-size が14px以上か静的検査）テスト、db（IndexedDBキャッシュ）テスト、shell（タブ定義と画面状態の読み出し）、autorefresh（自動更新の純粋ロジック）テスト、popover/chart-canvas/skeleton-actions のコンポーネント周辺テスト。`tools/ui-check/screens.test.js` は画面定義の規約テスト）
- `static/htm-preact-standalone.js` — htm + Preact ライブラリ（スタンドアロン版）
- `static/chart.umd.min.js` — Chart.js ライブラリ（グラフ描画用）
- `static/preview.html` — フロントエンド開発用プレビュー（gitignore対象）
- `data/ms_list.json` — MS画像URL→名前・コストのマッピング（コスト: 3000/2500/2000/1500）
- `data/national_ms_stats.json` — 機体ごとの全国平均勝率・使用率（`cmd/update-mslist` が週次で更新）
- `data/grade_list.json` — 階級画像URL→階級名・グレードのマッピング（Pilot/Valiant/Ace/Extreme、グレード0=∞）
- `infra/shared/` — Pulumi IaC 共有リソース（`apis.ts`, `artifact-registry.ts`, `storage.ts`, `firestore.ts`, `dns.ts`, `iam.ts`, `budget.ts`）
- `infra/app/` — Pulumi IaC 環境別リソース（自動更新の Cloud Run Job と Scheduler は config `autoRefreshEnabled` が true の環境（prod のみ）に作る。`index.ts` — Cloud Run, ドメインマッピング, CNAME）

## GitHub Actions

- **ブランチ運用**（既定ブランチは `develop`）: 作業ブランチ → `develop`（マージで stg に自動デプロイ）→ `main`（マージで prod に自動デプロイ）。develop→main はマージコミットで行う（squash・rebase しない）。緊急修正は main 向けPRも可（マージ後 build.yml が main を develop に自動マージ。衝突時は手動解消）。ただし build.yml の paths-ignore（`infra/app/Pulumi.*.yaml`・`deploy.yml`）だけを main で変えた場合は同期されないので develop に手動で反映する
- CI: `ci.yml`（main/develop 向けPRのみ。Docker build, golangci-lint, go test -race + coverage, JS test。ラベル `skip-ci` でスキップ）
- Build: `build.yml`（develop/mainへのpush時。develop→stg、main→prod。イメージビルド&プッシュ（content key が同じなら stg で検証済みイメージを再利用）→ 対象環境の Pulumi yaml の image 更新 → コミット → deploy.yml 呼び出し。main の後は main を develop に自動マージ。ラベル `no-deploy` でスキップ（develop への同期は行うが stg 再ビルドはしない）。手動実行は main なら prod、それ以外のブランチは stg）
- Deploy: `deploy.yml`（develop の `Pulumi.stg.yaml`・main の `Pulumi.prod.yaml` の変更トリガー or build.yml からの `workflow_dispatch` → `pulumi up`。prod の手動実行は main からのみ）
- Infra CI: `infra-ci.yml`（infra/配下の変更時にshared + app(prod/staging)のPulumi preview）
- MSリスト更新: `update-mslist.yml`（毎日03:00-06:00 JST、ランダムスリープ。変更時に main 向けPRを自動作成・マージし prod に反映）
- **サードパーティアクションを追加・変更する際は、GitHubリポジトリのリリースページで最新メジャーバージョンを確認すること。** 古いバージョンを指定するとNode.js非推奨警告やエラーが発生する（過去に複数回発生）。

## PR運用ルール

- **PRのマージは絶対に勝手に行わない。** 必ずユーザーの明示的な指示を待つ
- 作業ブランチのPRは `develop` 向けに作る。本番リリースは `develop` → `main` のPR
- PRの `no-deploy` ラベルはデフォルトでは付けない（develop マージで stg、main マージで prod に自動デプロイされる）
- Go/Docker以外の軽微な変更には `skip-ci` ラベルを付ける
- **issueを作成する際は `skip-ci` や `no-deploy` ラベルを付けない。** これらはPR専用のラベル
- デプロイは `no-deploy` なしでPRをマージ、または `gh workflow run build.yml --ref <branch>` で手動実行（main は prod、それ以外は stg）
- **コード構成やディレクトリ構造に変更があった場合は、CLAUDE.mdの「コード構成」セクションとREADME.mdのプロジェクト構成も合わせて更新すること**

## 主要な技術情報

- **Go 1.26**、Webフレームワーク不使用（標準 `net/http`）
- **Pulumi (TypeScript)** でインフラ管理
- ストレージはFirestore（環境変数 `FIRESTORE_DATABASE` で指定）、ユーザーキーは SHA256(email)[:8] の16進数
- Cloud Runデプロイ、`PORT` 環境変数（デフォルト 8080）
- 戦績は**古い順**に取得する（日別一覧・日内の試合とも）。403 で途中終了したときは古い側から途切れず取れた分だけを保存し、次回はその続きから取る（#456）
- 詳細ページ取得は**二段ペーシング**。先頭のバースト区間を並列・無遅延で取得し速報を早く表示、以降のスロットル区間は同時リクエスト数1で直列＋待機しレート制限(403)を回避する。環境変数で調整可能（未設定時は既定値）:
  - `SCRAPER_BURST_COUNT`: バースト区間の件数。0でバースト無効（既定 100）
  - `SCRAPER_BURST_PARALLELISM`: バースト区間の最大同時リクエスト数（既定 3）
  - `SCRAPER_THROTTLE_DELAY_MS`: スロットル区間の各リクエスト完了後の待機ms（既定 900）
  - `SCRAPER_MAX_DETAIL`: 詳細取得件数の上限（古い順の先頭N件）。0または未設定で無制限（既定 0）
  - 例（バースト無効・全件低レート）: `SCRAPER_BURST_COUNT=0 SCRAPER_THROTTLE_DELAY_MS=1200`
- 速報レポートは初回 `prelimFirstBatchSize`(5)試合、以降 `prelimBatchSize`(20)試合ごとに段階更新される（`onBatchReady`→`PreliminaryVersion++`、フロントがポーリングで再描画）
- 自動更新(#288): prod のみ有効。サービスの env `AUTO_REFRESH_JOB`/`AUTO_REFRESH_AUDIENCE`/`AUTO_REFRESH_INVOKER`/`AUTO_REFRESH_PASSPHRASE_HASH`/`AUTO_REFRESH_OPEN` は infra/app が設定（未設定の環境は有効化 POST が503・tick が404・状態取得 GET が200で available:false・touch が200で status:"off"）。合言葉は `go run ./cmd/hash-passphrase` でハッシュを作り `STACK=prod make pulumi-app-shell` で `pulumi config set --secret autoRefreshPassphraseHash <hash>`。設計は `docs/design/2026-10-05-auto-refresh.md`
- セッション保持機能: `SESSION_ENCRYPTION_KEY`（64文字hex、AES-256-GCM鍵）設定時に有効化。バンナムCookieJarを暗号化してFirestoreに保存し、次回アクセス時にパスワード不要で再分析。catalyzer_session Cookie（HttpOnly/Secure/SameSite=Strict、30日有効）でセッション識別。試合データはIndexedDBにキャッシュし即時表示。Firestoreのセッションドキュメントは `expire_at`（保存時+30日）フィールドのTTLポリシー（`infra/shared/firestore.ts`）で自動削除され、Cookie失効後に浮いたセッションが残らない
- 試合の一意キーは詳細ページURL由来の `MatchID`（`model.DatedScore.GroupKey()` に一元化）。MatchID未設定のlegacyデータは分精度日時にフォールバックする（#358。実データでは同じ分に試合は1つで、同一分の区別は保険）。詳細URLの param は日を跨ぐと変わるため、保存済みの試合を MatchID で照合しない（差分取得の since は保存済みの最新日時ちょうど。#522）

## Goコーディング規約

- **パッケージの責務を明確に分離する。** 1パッケージ1責務。型定義パッケージにI/Oやビジネスロジックを混ぜない
- **`cmd/`にはmain関数のみ。** ロジックは`internal/`に置く
- **`log.Fatal`はmain関数の初期化時のみ使用可。** リクエスト処理中は`return error`でハンドリングする
- **エラーは`fmt.Errorf("文脈: %w", err)`でラップして返す。** 呼び出し元でハンドリングできるようにする
- **未使用のエクスポート関数は削除する。** テストでしか使われない関数はエクスポートしない
- **循環依存を作らない。** 依存は`model` ← `mslist` / `scraper` / `firestore` ← `pipeline` ← `server`の一方向
- **構造体のフィールド名はGoの命名規則（PascalCase）に従う。** スネークケースは使わない
- **テストは対象パッケージと同じディレクトリに置く。** `xxx_test.go`で`package xxx`を使う
- **`go vet`（または`golangci-lint run`）と`make build`がパスすることを確認してからコミットする**

## セキュリティルール

- **GCPプロジェクトID、バケット名、サービスアカウント等のインフラ識別子をコードやCLAUDE.mdにハードコードしない。** 環境変数またはGitHub Secrets/Variablesを使うこと。
- **IAM権限は最小権限の原則を徹底する。** プロジェクトレベルの広範なロール（例: `roles/storage.admin`）ではなく、バケット単位・リソース単位で必要最低限のロール（例: `roles/storage.objectUser`）を付与すること。
- 公開リポジトリのため、コミット履歴にも残ることを意識する。
- マルチステージDockerfile: `golang:1.26-alpine` でビルド、`alpine:3.22` で実行
- CSP: `script-src 'self'`（インラインスクリプト禁止）、`style-src 'self' 'unsafe-inline'`
