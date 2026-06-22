# CLAUDE.md

このファイルは、Claude Code (claude.ai/code) がこのリポジトリで作業する際のガイドです。

## プロジェクト概要

catalyzer は、EXVS2IB（機動戦士ガンダム エクストリームバーサス2 インフィニットブースト）の戦績分析Webアプリ。公式サイトから対戦データをスクレイピングし、Firestoreに保存、Python分析を実行してJSONレポートを返す。

## ビルド・開発コマンド

```bash
# ダミーデータでローカル起動（Docker。ホストにGo/Python不要。stg不要で動作確認）
# スクレイピングをスキップし、同梱のダミー試合データで /analyze→/result の実フローを確認
make dev                  # → http://localhost:8080

# ダミー試合データ＋サンプルレポートを再生成
make sample

# フロント単体プレビュー（サーバー・分析不要。サンプルレポートを静的配信）
make preview              # → http://localhost:8888/preview.html

# ビルド＆起動（本番相当イメージ）
make restart

# ビルドのみ
make build

# 起動のみ（ビルド済みの場合）
make run

# コンテナ停止
make stop

# Goテスト（Docker経由）
make test

# ポート変更
PORT=3000 make run
PORT=3000 make dev

# レポート生成（ダミーデータから）
python3 scripts/analyze.py testdata/sample_matches.json --ms-list data/ms_list.json

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

**開発はDocker経由（ホストにGo/Pythonは不要）。** `make dev`/`make sample`/`make preview` はすべて Docker コンテナ内で Go/Python を実行する。Pulumi のsecretは GCP KMS で暗号化しており（各スタックの `secretsprovider: gcpkms://...`）、`gcloud auth application-default login` 済みのADCで復号する。パスフレーズは不要。

### ローカル動作確認（stg不要・ダミーデータ）

毎回 stg にデプロイして確認する手間を避けるため、ダミーデータでローカル確認できる導線を用意している。実在ユーザーの個人情報は含まない合成データ（`testdata/sample_matches.json`、`scripts/gen_sample.py` で生成）を使う。

**1. バックエンド込みの実フロー確認 — `make dev`**

`Dockerfile.dev`（Go+Python同梱）でサーバーを起動し、ソースを bind mount する。go build/mod キャッシュは名前付きvolumeで永続化するため2回目以降の起動が速い。環境変数 `DEV_SAMPLE_DATA`（既定で `testdata/sample_matches.json`）が設定されていると、`pipeline.Run` が**実スクレイピング（バンナムログイン）とFirestoreをスキップ**し、ダミーデータをそのまま `analyze.py` に通して `/analyze`→`/status`→`/result` の実フローを再現する。ログイン画面には任意のメールアドレス＋パスワードを入れればよい。

**2. フロント単体プレビュー — `make preview`**

`static/preview.html` が `static/sample_report.json`（`analyze.py` の出力）を `renderReport()` に直接渡してレポート画面を描画する。サーバーも分析も不要で、`static/` を静的配信するだけ。チャートやテーブルの見た目を最速で確認できる。`make sample` でダミーデータとサンプルレポートを再生成する。

**Firestoreを使う場合（任意）**

`make dev` のダミーモードはFirestore不要だが、Firestoreの読み書きを確認したい場合はエミュレータを使う（本番DB誤操作を避けるため）。`firestore.Init` のプロジェクトID解決は `GCP_PROJECT` / `GOOGLE_CLOUD_PROJECT` → エミュレータ時のダミーID → Cloud Run メタデータサーバー の順。エミュレータ接続時は起動ログに `against emulator ...` と明示される。

| 環境変数 | 用途 |
| --- | --- |
| `DEV_SAMPLE_DATA` | 設定するとスクレイピングせずこのパスのダミー試合データで分析（`make dev` が既定設定） |
| `FIRESTORE_DATABASE` | 接続先データベースID。**未設定なら Firestore 無効**で起動 |
| `FIRESTORE_EMULATOR_HOST` | 設定するとエミュレータに接続（例: `localhost:8081`）。本番DB誤操作回避のため推奨 |
| `GCP_PROJECT` / `GOOGLE_CLOUD_PROJECT` | プロジェクトID。エミュレータ利用時はダミー値でよい |
| `APP_DIR` | `python3 scripts/analyze.py` の作業ディレクトリ。未設定時は `/app`（Docker）が無ければカレントディレクトリ |

CIでは `go vet`、`go build`、`py_compile` を実行。ラベル `skip-ci` でスキップ可能。

## アーキテクチャ

Go HTTPサーバーによる**非同期ジョブパイプライン**（最大同時実行数: 3）:

```
ブラウザ → POST /analyze → ジョブ作成（pending）
  → Firestoreから既存matchesを読み取り → 速報レポート生成
  → Collyで新規戦績をスクレイピング（状態: scraping）
  → data/ms_list.jsonからMS名・コストを補完
  → Firestoreにmatches/tag_partners書き込み（タイムラインはmatchesに埋め込み）
  → Firestoreから全matches読み取り → 試合単位JSON生成
  → scripts/analyze.py でJSONを分析（状態: analyzing）
  → JSONレポートを返却（状態: done）
クライアントは GET /status/{id} でポーリング後、GET /result/{id} で結果取得
```

**主要エンドポイント:** `POST /analyze`, `GET /status/{id}`, `GET /result/{id}`, `GET /result/{id}/period`, `GET /period`, `GET /health`, `GET /`（静的UI）

## コード構成

- `cmd/server/main.go` — エントリポイント。`internal/server.StartServer()` に委譲
- `cmd/update-mslist/main.go` — MSリストをスクレイピングして `data/ms_list.json` を更新するCLI
- `cmd/delete-recent-matches/` — 指定ユーザーの最新N日間の戦績を削除するCLI（ドライラン対応）
- `cmd/extract-grades/` — Firestoreから全ユーザーの未登録グレードURLを抽出するCLI
- `internal/model/` — 型定義 + `UserKey`（`PlayerScore`, `DatedScore`, `MSInfo`, `MatchEvent`, `MatchTimeline`, `TagPartner`, `JobStatus`, `JobSnapshot`）
- `internal/mslist/` — MSリストの読み書き・マージ（`LoadMSList`, `SaveMSList`, `MergeMSList`, `BuildMSNameMap`, `FillMsNames`, `CheckUnknownMS`）
- `internal/gradelist/` — グレードリストの読み込み・未知URL検出（`LoadGradeList`, `BuildGradeMap`, `CheckUnknownGrades`）
- `internal/scraper/` — Collyベースのスクレイパー（`scraper.go`）+ バンダイナムコID認証（`login.go`）
- `internal/firestore/` — Firestoreクライアント初期化（`client.go`）+ matches/tag_partnersの読み書き（タイムラインはmatches内に埋め込み）
- `internal/pipeline/` — 分析パイプライン（`Job`型、ジョブストア、`Run`関数、JSON生成）
- `internal/server/` — HTTPハンドラ（`server.go`）+ IPベースレート制限（`ratelimit.go`）+ Basic認証（`basicauth.go`）+ 403一時ブロック（`block403.go`）
- `scripts/analyze.py` — Python分析: カテゴリ別アドバイス、勝率、与被ダメ比、固定相方検出、JSON構造化レポート生成
- `scripts/gen_sample.py` — ローカル確認用のダミー試合データ生成（個人情報なしの合成データ）
- `static/index.html` — SPA フロントエンド（ダークテーマ、レスポンシブ対応）
- `static/app.js` — フロントエンドJS（CSP対応で外部化。htm/Preactでレンダリング）
- `static/htm-preact-standalone.js` — htm + Preact ライブラリ（スタンドアロン版）
- `static/chart.umd.min.js` — Chart.js ライブラリ（グラフ描画用）
- `static/preview.html` — フロント単体プレビュー（`make preview`。index.htmlを流用しサンプルレポートを描画）
- `static/sample_report.json` — ダミーデータから生成したサンプルレポート（preview.htmlが読む）
- `testdata/sample_matches.json` — ダミー試合データ（`make sample` で再生成。`testdata/report.json` は中間生成物でgitignore対象）
- `data/ms_list.json` — MS画像URL→名前・コストのマッピング（コスト: 3000/2500/2000/1500）
- `data/grade_list.json` — 階級画像URL→階級名・グレードのマッピング（Pilot/Valiant/Ace/Extreme、グレード0=∞）
- `Dockerfile.dev` — ローカル開発用イメージ（Go+Python同梱。`make dev` が使用。本番 `Dockerfile` とは別物）
- `infra/shared/` — Pulumi IaC 共有リソース（`apis.ts`, `artifact-registry.ts`, `storage.ts`, `firestore.ts`, `dns.ts`, `iam.ts`, `budget.ts`）
- `infra/app/` — Pulumi IaC 環境別リソース（`index.ts` — Cloud Run, ドメインマッピング, CNAME）

## GitHub Actions

- CI: `ci.yml`（PRのみ。Docker build, go vet, py_compile。ラベル `skip-ci` でスキップ）
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
- **Python 3.11** で分析（pip依存なし）
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
- マルチステージDockerfile: `golang:1.26-alpine` でビルド、`python:3.11-alpine` で実行
- CSP: `script-src 'self'`（インラインスクリプト禁止）、`style-src 'self' 'unsafe-inline'`
