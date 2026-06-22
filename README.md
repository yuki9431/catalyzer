<p align="center">
  <img src="static/logo.svg" alt="catalyzer" width="400">
</p>

<p align="center">
  機動戦士ガンダム EXTREME VS.2 INFINITE BOOST の戦績を多角的に分析するWebアプリケーション。
</p>

## 分析機能

### 総合
- 勝率・与被ダメ比・K/D比・EXダメージなどのKPIダッシュボード
- 勝利時/敗北時の傾向比較（レーダーチャート）
- シーズン別分析（前半/後半の推移チャート付き）
- 総合アドバイス（カテゴリ別: 耐久管理、機体、時間帯・曜日、相方、メンタル、シーズン）

### 機体別
- 基本データ・被撃墜数と勝率の関係
- 敵機体との相性・相方機体との相性
- 編成別勝率・コスト編成別勝率
- ダメージ貢献率
- 先落ち/後落ち分析
- 覚醒抱え落ち・覚醒回数

### 時間帯・曜日
- 時間帯別・曜日別（平日vs土日）・日別の勝率推移（チャート＋テーブル）

### 固定相方
- タッグ相方ごとの詳細分析（レーダーチャート比較、使用機体内訳）

### その他
- 期間指定（プリセット＋カスタム日時指定）
- SNS共有（X, Bluesky, LINE）

## プロジェクト構成

```
.
├── cmd/
│   ├── server/
│   │   └── main.go                # エントリポイント（サーバー起動のみ）
│   ├── update-mslist/
│   │   └── main.go                # MSリスト更新CLI
│   ├── delete-recent-matches/
│   │   └── main.go                # 指定ユーザーの最新N日間の戦績削除CLI
│   └── extract-grades/
│       └── main.go                # Firestoreから未登録グレードURL抽出CLI
├── internal/
│   ├── model/
│   │   └── types.go               # 型定義のみ（PlayerScore, MSInfo等）
│   ├── mslist/
│   │   └── mslist.go              # MSリストの読み書き・マージ
│   ├── gradelist/
│   │   └── gradelist.go           # グレードリストの読み込み・未知URL検出
│   ├── scraper/
│   │   ├── scraper.go             # スクレイピング処理
│   │   └── login.go               # ログイン処理
│   ├── firestore/
│   │   ├── client.go              # Firestoreクライアント初期化
│   │   ├── scores.go              # 戦績（matches）の読み書き
│   │   ├── tag_partners.go        # 固定相方データの読み書き
│   │   ├── users.go               # ユーザーデータの読み書き
│   │   └── report_cache.go        # レポートキャッシュ
│   ├── pipeline/
│   │   └── pipeline.go            # 分析パイプライン（Job管理・実行・JSON生成）
│   └── server/
│       ├── server.go              # HTTPサーバー・API
│       ├── ratelimit.go           # IPベースレート制限
│       ├── basicauth.go           # Basic認証ミドルウェア
│       └── block403.go            # 403時の一時ブロック管理
├── scripts/
│   ├── analyze.py                 # Python分析スクリプト
│   └── gen_sample.py              # ローカル確認用ダミーデータ生成
├── static/
│   ├── index.html                 # フロントエンド
│   ├── app.js                     # フロントエンドJS（CSP対応で外部化）
│   ├── preview.html               # フロント単体プレビュー（make preview）
│   ├── sample_report.json         # サンプルレポート（preview.htmlが読む）
│   ├── logo.svg                   # ロゴ
│   ├── favicon.svg                # ファビコン（SVG）
│   ├── htm-preact-standalone.js   # htm + Preactライブラリ
│   └── chart.umd.min.js          # Chart.jsライブラリ
├── testdata/
│   └── sample_matches.json        # ダミー試合データ（make sample で再生成）
├── data/
│   ├── ms_list.json               # 機体名・コストマッピング
│   └── grade_list.json            # 階級画像URL→階級名・グレードマッピング
├── infra/
│   ├── shared/                    # 共有リソース（環境非依存）
│   │   ├── index.ts               # エントリポイント
│   │   ├── apis.ts                # Google API有効化
│   │   ├── artifact-registry.ts   # Artifact Registry定義
│   │   ├── storage.ts             # Cloud Storageバケット定義
│   │   ├── firestore.ts           # Firestore定義
│   │   ├── dns.ts                 # Cloud DNS定義
│   │   ├── iam.ts                 # サービスアカウント・Workload Identity
│   │   └── budget.ts              # 予算アラート定義
│   └── app/                       # 環境別リソース（prod/stg）
│       └── index.ts               # Cloud Run・ドメインマッピング
├── .github/
│   └── workflows/
│       ├── ci.yml                 # CI（Docker build, Go vet, Python構文チェック）
│       ├── build.yml              # ビルド&プッシュ（mainマージ時）
│       ├── deploy.yml             # デプロイ（Pulumi up）
│       ├── deploy-prod.yml        # 本番デプロイ（手動実行）
│       ├── infra-ci.yml           # インフラCI（Pulumi preview）
│       └── update-mslist.yml      # MSリスト自動更新
├── Makefile                       # ビルド・起動・インフラコマンド
├── Dockerfile                     # マルチステージビルド（本番）
├── Dockerfile.dev                 # ローカル開発用（Go+Python同梱）
├── go.mod
├── go.sum
├── LICENSE
└── README.md
```

### ディレクトリの役割

| ディレクトリ | 説明 |
|-------------|------|
| `cmd/` | エントリポイント。main関数のみ |
| `internal/` | プライベートパッケージ。外部から参照不可 |
| `internal/model/` | データ型の定義・UserKey生成 |
| `internal/mslist/` | MSリストの読み書き・マージ |
| `internal/gradelist/` | グレードリストの読み込み・未知URL検出 |
| `internal/scraper/` | スクレイピング・ログイン処理 |
| `internal/firestore/` | Firestoreクライアント・データの読み書き |
| `internal/pipeline/` | 分析パイプライン（ジョブ管理・実行・CSV生成） |
| `internal/server/` | HTTPハンドラ・レート制限・Basic認証・403ブロック |
| `scripts/` | Go以外のスクリプト（Python分析等） |
| `static/` | フロントエンドHTML/JS/CSS |
| `data/` | 静的データファイル（MSリスト等） |
| `infra/` | Pulumi IaC（GCPリソース管理） |

## 使い方

```bash
# ダミーデータでローカル起動（Docker。ホストにGo/Python不要・stg不要で動作確認）
make dev                  # → http://localhost:8080

# ダミー試合データ＋サンプルレポートを再生成
make sample

# フロント単体プレビュー（サーバー・分析不要）
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

# Firestoreから未登録グレードURLを抽出
FIRESTORE_DATABASE=exvs-analyzer make extract-grades
```

http://localhost:8080 にアクセスしてログインすると分析レポートが表示されます。

ポートを変更したい場合は `PORT=3000 make run`（または `PORT=3000 make dev`）のように指定できます。

### ローカル動作確認（stg不要・ダミーデータ）

毎回 stg にデプロイせずに動作確認できるよう、ダミーデータでローカル確認する導線を用意しています。開発はすべて Docker 経由のため、ホストに Go/Python は不要です。ダミーデータは実在ユーザーの個人情報を含まない合成データです（`scripts/gen_sample.py` で生成）。

- **`make dev`** — `Dockerfile.dev`（Go+Python同梱）でサーバーを起動。`DEV_SAMPLE_DATA` が設定されているとスクレイピング（バンナムログイン）とFirestoreをスキップし、ダミー試合データで `/analyze`→`/result` の実フローを再現します。ログイン画面には任意の値を入力すれば分析が始まります。ソースは bind mount するためコード変更は再起動で反映され、ビルドキャッシュは永続化されます。
- **`make preview`** — `static/preview.html` がサンプルレポート（`static/sample_report.json`）を描画。サーバーも分析も不要で、フロントの見た目を最速で確認できます。
- **`make sample`** — ダミー試合データとサンプルレポートを再生成します。

Firestore の読み書きを確認したい場合は、本番DBの誤操作を避けるためエミュレータを使ってください（`make dev` のダミーモード自体はFirestore不要）。

| 環境変数 | 説明 |
| --- | --- |
| `DEV_SAMPLE_DATA` | 設定するとスクレイピングせずこのパスのダミーデータで分析（`make dev` が既定設定） |
| `FIRESTORE_DATABASE` | 接続先データベースID。未設定なら Firestore 無効で起動 |
| `FIRESTORE_EMULATOR_HOST` | 設定するとエミュレータに接続（例: `localhost:8081`）。本番DB誤操作回避のため推奨 |
| `GCP_PROJECT` / `GOOGLE_CLOUD_PROJECT` | プロジェクトID。エミュレータ利用時はダミー値で可 |

```bash
# Firestoreエミュレータを使う安全なローカル起動（任意）
gcloud emulators firestore start --host-port=localhost:8081
FIRESTORE_EMULATOR_HOST=localhost:8081 FIRESTORE_DATABASE=exvs-analyzer GCP_PROJECT=local-dev make dev
```

### スクレイパーのペーシング設定

詳細ページの取得は二段ペーシングで行います。先頭の**バースト区間**を並列・無遅延で高速取得して速報レポートを早く表示し、以降の**スロットル区間**は直列＋待機でレート制限(403)を回避します。各区間は環境変数で調整できます（未設定時は既定値）。

| 環境変数 | 説明 | 既定値 |
| --- | --- | --- |
| `SCRAPER_BURST_COUNT` | バースト区間で高速取得する先頭リクエスト数（0でバースト無効） | 100 |
| `SCRAPER_BURST_PARALLELISM` | バースト区間の最大同時リクエスト数 | 3 |
| `SCRAPER_THROTTLE_DELAY_MS` | スロットル区間の各リクエスト完了後の待機（ミリ秒） | 900 |
| `SCRAPER_MAX_DETAIL` | 詳細取得件数の上限（0または未設定で無制限） | 0 |

スロットル区間は同時リクエスト数1で直列実行されます（403回避のため固定）。例（バーストを無効化し全件を低レート取得）: `SCRAPER_BURST_COUNT=0 SCRAPER_THROTTLE_DELAY_MS=1200`

## 技術スタック

- **バックエンド**: Go 1.26（標準 `net/http`）
- **分析**: Python 3.11
- **インフラ**: Cloud Run (GCP)、Pulumi (TypeScript) でIaC管理
- **ストレージ**: Cloud Storage (GCP)
- **CI/CD**: GitHub Actions（ラベルでCI/CDを制御）
- **コンテナ**: Docker（マルチステージビルド）
- **フロントエンド**: htm/Preact（ダークテーマ、レスポンシブ対応）

## Author

Dillen Hiroyuki ([@yuki9431](https://github.com/yuki9431))

## License

[Apache License 2.0](LICENSE)
