# CLAUDE.md

このファイルは、Claude Code (claude.ai/code) がこのリポジトリで作業する際のガイドです。

## プロジェクト概要

catalyzer は、EXVS2IB（機動戦士ガンダム エクストリームバーサス2 インフィニットブースト）の戦績分析Webアプリ。公式サイトから対戦データをスクレイピングし、Firestoreに保存、フロントエンドのJS分析関数でレポートを生成する。

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

CIでは `go vet`、`go build`、`go test` を実行。ラベル `skip-ci` でスキップ可能。

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

**主要エンドポイント:** `POST /analyze`, `GET /status/{id}`, `GET /result/{id}`, `GET /matches`, `GET /tag-partners`, `GET /session`, `DELETE /session`, `POST /reanalyze`, `GET /health`, `GET /`（静的UI）

## コード構成

- `cmd/server/main.go` — エントリポイント。`internal/server.StartServer()` に委譲
- `cmd/update-mslist/main.go` — MSリストをスクレイピングして `data/ms_list.json` を更新するCLI
- `cmd/delete-recent-matches/` — 指定ユーザーの最新N日間の戦績を削除するCLI（ドライラン対応）
- `cmd/extract-grades/` — Firestoreから全ユーザーの未登録グレードURLを抽出するCLI
- `internal/model/` — 型定義 + `UserKey`（`PlayerScore`, `DatedScore`, `MSInfo`, `MatchEvent`, `MatchTimeline`, `TagPartner`, `JobStatus`, `JobSnapshot`）
- `internal/mslist/` — MSリストの読み書き・マージ（`LoadMSList`, `SaveMSList`, `MergeMSList`, `BuildMSNameMap`, `FillMsNames`, `CheckUnknownMS`）
- `internal/gradelist/` — グレードリストの読み込み・未知URL検出（`LoadGradeList`, `BuildGradeMap`, `CheckUnknownGrades`）
- `internal/scraper/` — Collyベースのスクレイパー（`scraper.go`）+ バンダイナムコID認証（`login.go`）
- `internal/session/` — セッション暗号化（AES-256-GCM）とCookieJarシリアライズ（`crypto.go`, `jar.go`）
- `internal/firestore/` — Firestoreクライアント初期化（`client.go`）+ matches/tag_partnersの読み書き（タイムラインはmatches内に埋め込み）+ セッション保存（`session.go`）
- `internal/pipeline/` — 分析パイプライン（`Job`型、ジョブストア、`Run`関数、JSON生成、試合データ配信（`ActionJSON`型でタイムラインイベント展開）、セッション永続化）
- `internal/server/` — HTTPハンドラ（`server.go`）+ IPベースレート制限（`ratelimit.go`）+ Basic認証（`basicauth.go`）+ 403一時ブロック（`block403.go`）+ セッション管理エンドポイント
- `static/index.html` — SPA フロントエンド（ダークテーマ、レスポンシブ対応、カスタムドロップダウン）
- `static/app.js` — フロントエンドJS本体（CSP対応で外部化。htm/Preactでレンダリング）。主要コンポーネント: Calendar/TimeSelector/PeriodSelector（期間指定）、ShareArea（SNS共有）、HamburgerMenu（左ドロワー）、MsSelector/LensToggle（トップバーフィルタ）、Panel/KpiGrid/CompareRadar/BasicLensSection/FixedPartnerPanel、5タブ構成（OverviewPane/PlaystylePane/BurstPane/MatchupPane/TimePane）、Report（状態管理・タブ切替・フロントエンド集計）。IndexedDBキャッシュからフロントエンドで全統計を計算
- `static/analysis/stats.js` — 統計分析関数。時間帯/曜日/日別/シーズン/基本データ/勝敗パターン/敵相性/相方/コスト編成/MS編成/ダメージ貢献/被撃墜影響/覚醒回数/先落ち後落ち/覚醒抱え落ち/固定相方/SNS共有データ/MS別サマリー
- `static/analysis/aggregate.js` — 集計関数。被撃墜影響/先落ち/ダメージ貢献/覚醒回数/覚醒抱え落ち/敵相性/相方の全MS横断集計
- `static/components/ui.js` — 汎用UIコンポーネント（Tips/SortableTable/Table/SubSection）
- `static/components/charts.js` — Chart.jsグラフ＋レポートセクション（EnemyMatchupSection/PartnerSection/時間帯・曜日・日別・シーズンChart等）
- `static/lib/db.js` — IndexedDBキャッシュ（試合データの保存・読み込み・差分取得）
- `static/lib/format.js` — 書式ヘルパー（数値フォーマット・色分け・SVGアイコン・共有テキスト生成）
- `static/htm-preact-standalone.js` — htm + Preact ライブラリ（スタンドアロン版）
- `static/chart.umd.min.js` — Chart.js ライブラリ（グラフ描画用）
- `static/preview.html` — フロントエンド開発用プレビュー（gitignore対象）
- `data/ms_list.json` — MS画像URL→名前・コストのマッピング（コスト: 3000/2500/2000/1500）
- `data/grade_list.json` — 階級画像URL→階級名・グレードのマッピング（Pilot/Valiant/Ace/Extreme、グレード0=∞）
- `infra/shared/` — Pulumi IaC 共有リソース（`apis.ts`, `artifact-registry.ts`, `storage.ts`, `firestore.ts`, `dns.ts`, `iam.ts`, `budget.ts`）
- `infra/app/` — Pulumi IaC 環境別リソース（`index.ts` — Cloud Run, ドメインマッピング, CNAME）

## GitHub Actions

- CI: `ci.yml`（PRのみ。Docker build, go vet, go test。ラベル `skip-ci` でスキップ）
- Build: `build.yml`（mainマージ時 → イメージビルド&プッシュ → **stgのみ**Pulumi yaml の image 更新 → コミット → deploy.yml 呼び出し。ラベル `no-deploy` でスキップ。手動実行可）
- Deploy to Prod: `deploy-prod.yml`（**手動実行のみ**。stgのイメージをprodに適用 → コミット → deploy.yml 呼び出し）
- Deploy: `deploy.yml`（`infra/app/Pulumi.*.yaml` 変更トリガー or build.yml/deploy-prod.yml からの `workflow_dispatch` → `pulumi up`）
- Infra CI: `infra-ci.yml`（infra/配下の変更時にshared + app(prod/staging)のPulumi preview）
- MSリスト更新: `update-mslist.yml`（毎日03:00-06:00 JST、ランダムスリープ。変更時にPR自動作成）
- **サードパーティアクションを追加・変更する際は、GitHubリポジトリのリリースページで最新メジャーバージョンを確認すること。** 古いバージョンを指定するとNode.js非推奨警告やエラーが発生する（過去に複数回発生）。

## PR運用ルール

- **PRのマージは絶対に勝手に行わない。** 必ずユーザーの明示的な指示を待つ
- PRの `no-deploy` ラベルはデフォルトでは付けない（マージ時にstgへ自動デプロイして検証する）
- Go/Docker以外の軽微な変更には `skip-ci` ラベルを付ける
- **issueを作成する際は `skip-ci` や `no-deploy` ラベルを付けない。** これらはPR専用のラベル
- デプロイは `gh workflow run build.yml` で手動実行（環境選択可）、または `no-deploy` なしでPRをマージ
- **コード構成やディレクトリ構造に変更があった場合は、CLAUDE.mdの「コード構成」セクションとREADME.mdのプロジェクト構成も合わせて更新すること**

## 主要な技術情報

- **Go 1.26**、Webフレームワーク不使用（標準 `net/http`）
- **Pulumi (TypeScript)** でインフラ管理
- ストレージはFirestore（環境変数 `FIRESTORE_DATABASE` で指定）、ユーザーキーは SHA256(email)[:8] の16進数
- Cloud Runデプロイ、`PORT` 環境変数（デフォルト 8080）
- 詳細ページ取得は**二段ペーシング**。先頭のバースト区間を並列・無遅延で取得し速報を早く表示、以降のスロットル区間は同時リクエスト数1で直列＋待機しレート制限(403)を回避する。環境変数で調整可能（未設定時は既定値）:
  - `SCRAPER_BURST_COUNT`: バースト区間の件数。0でバースト無効（既定 100）
  - `SCRAPER_BURST_PARALLELISM`: バースト区間の最大同時リクエスト数（既定 3）
  - `SCRAPER_THROTTLE_DELAY_MS`: スロットル区間の各リクエスト完了後の待機ms（既定 900）
  - `SCRAPER_MAX_DETAIL`: 詳細取得件数の上限。0または未設定で無制限（既定 0）
  - 例（バースト無効・全件低レート）: `SCRAPER_BURST_COUNT=0 SCRAPER_THROTTLE_DELAY_MS=1200`
- 速報レポートは初回 `prelimFirstBatchSize`(5)試合、以降 `prelimBatchSize`(20)試合ごとに段階更新される（`onBatchReady`→`PreliminaryVersion++`、フロントがポーリングで再描画）
- セッション保持機能: `SESSION_ENCRYPTION_KEY`（64文字hex、AES-256-GCM鍵）設定時に有効化。バンナムCookieJarを暗号化してFirestoreに保存し、次回アクセス時にパスワード不要で再分析。catalyzer_session Cookie（HttpOnly/Secure/SameSite=Strict、30日有効）でセッション識別。試合データはIndexedDBにキャッシュし即時表示

## Goコーディング規約

- **パッケージの責務を明確に分離する。** 1パッケージ1責務。型定義パッケージにI/Oやビジネスロジックを混ぜない
- **`cmd/`にはmain関数のみ。** ロジックは`internal/`に置く
- **`log.Fatal`はmain関数の初期化時のみ使用可。** リクエスト処理中は`return error`でハンドリングする
- **エラーは`fmt.Errorf("文脈: %w", err)`でラップして返す。** 呼び出し元でハンドリングできるようにする
- **未使用のエクスポート関数は削除する。** テストでしか使われない関数はエクスポートしない
- **循環依存を作らない。** 依存は`model` ← `mslist` / `scraper` / `firestore` ← `pipeline` ← `server`の一方向
- **構造体のフィールド名はGoの命名規則（PascalCase）に従う。** スネークケースは使わない
- **テストは対象パッケージと同じディレクトリに置く。** `xxx_test.go`で`package xxx`を使う
- **`go vet`と`make build`がパスすることを確認してからコミットする**

## セキュリティルール

- **GCPプロジェクトID、バケット名、サービスアカウント等のインフラ識別子をコードやCLAUDE.mdにハードコードしない。** 環境変数またはGitHub Secrets/Variablesを使うこと。
- **IAM権限は最小権限の原則を徹底する。** プロジェクトレベルの広範なロール（例: `roles/storage.admin`）ではなく、バケット単位・リソース単位で必要最低限のロール（例: `roles/storage.objectUser`）を付与すること。
- 公開リポジトリのため、コミット履歴にも残ることを意識する。
- マルチステージDockerfile: `golang:1.26-alpine` でビルド、`alpine:3.22` で実行
- CSP: `script-src 'self'`（インラインスクリプト禁止）、`style-src 'self' 'unsafe-inline'`
