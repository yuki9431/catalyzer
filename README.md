# catalyzer — EXVS2IB 戦績分析ツール

機動戦士ガンダム EXTREME VS.2 INFINITE BOOST の戦績をスクレイピングし、分析レポートを生成するWebアプリケーション。

## プロジェクト構成

```
.
├── cmd/
│   ├── server/
│   │   └── main.go              # エントリポイント（サーバー起動のみ）
│   ├── update-mslist/
│   │   └── main.go              # MSリスト更新CLI
│   ├── delete-recent-matches/
│   │   └── main.go              # 指定ユーザーの最新N日間の戦績削除CLI
│   └── extract-grades/
│       └── main.go              # Firestoreから未登録グレードURL抽出CLI
├── internal/
│   ├── model/
│   │   └── types.go             # 型定義のみ（PlayerScore, MSInfo等）
│   ├── mslist/
│   │   └── mslist.go            # MSリストの読み書き・マージ
│   ├── gradelist/
│   │   └── gradelist.go         # グレードリストの読み込み・未知URL検出
│   ├── scraper/
│   │   ├── scraper.go           # スクレイピング処理
│   │   └── login.go             # バンダイナムコIDログイン
│   ├── pipeline/
│   │   └── pipeline.go          # 分析パイプライン（Job管理・実行・CSV生成）
│   └── server/
│       ├── server.go            # HTTPサーバー・API
│       ├── ratelimit.go         # IPベースレート制限
│       ├── basicauth.go         # Basic認証ミドルウェア
│       └── block403.go          # 403時の一時ブロック管理
├── scripts/
│   └── analyze.py               # Python分析スクリプト
├── static/
│   ├── index.html               # フロントエンド
│   ├── app.js                   # フロントエンドJS（CSP対応で外部化）
│   ├── htm-preact-standalone.js # htm + Preactライブラリ
│   └── chart.umd.min.js        # Chart.jsライブラリ
├── data/
│   ├── ms_list.json             # 機体名・コストマッピング
│   └── grade_list.json          # 階級画像URL→階級名・グレードマッピング
├── infra/
│   ├── shared/                  # 共有リソース（環境非依存）
│   │   ├── index.ts             # エントリポイント
│   │   ├── apis.ts              # Google API有効化
│   │   ├── artifact-registry.ts # Artifact Registry定義
│   │   ├── storage.ts           # Cloud Storageバケット定義
│   │   ├── dns.ts               # Cloud DNS定義
│   │   ├── iam.ts               # サービスアカウント・Workload Identity
│   │   └── budget.ts            # 予算アラート定義
│   └── app/                     # 環境別リソース（prod/stg）
│       └── index.ts             # Cloud Run・ドメインマッピング
├── .github/
│   └── workflows/
│       ├── ci.yml               # CI（Docker build, Go vet, Python構文チェック）
│       ├── build.yml            # ビルド&プッシュ（mainマージ時）
│       ├── deploy.yml           # デプロイ（Pulumi up）
│       ├── infra-ci.yml         # インフラCI（Pulumi preview）
│       └── update-mslist.yml    # MSリスト自動更新
├── Makefile                     # ビルド・起動・インフラコマンド
├── Dockerfile                   # マルチステージビルド
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

# Firestoreから未登録グレードURLを抽出
FIRESTORE_DATABASE=exvs-analyzer make extract-grades
```

http://localhost:8080 にアクセスしてバンナムIDでログインすると分析レポートが表示されます。

ポートを変更したい場合は `PORT=3000 make run` のように指定できます。

### スクレイパーのペーシング設定

詳細ページの取得は二段ペーシングで行います。先頭の**バースト区間**を並列・無遅延で高速取得して速報レポートを早く表示し、以降の**スロットル区間**は直列＋待機でレート制限(403)を回避します。各区間は環境変数で調整できます（未設定時は既定値）。

| 環境変数 | 説明 | 既定値 |
| --- | --- | --- |
| `SCRAPER_BURST_COUNT` | バースト区間で高速取得する先頭リクエスト数（0でバースト無効） | 100 |
| `SCRAPER_BURST_PARALLELISM` | バースト区間の最大同時リクエスト数 | 3 |
| `SCRAPER_THROTTLE_DELAY_MS` | スロットル区間の各リクエスト完了後の待機（ミリ秒） | 900 |
| `SCRAPER_MAX_DETAIL` | 詳細取得件数の上限（0または未設定で無制限） | 0 |

スロットル区間は同時リクエスト数1で直列実行されます（403回避のため固定）。例（バーストを無効化し全件を低レート取得）: `SCRAPER_BURST_COUNT=0 SCRAPER_THROTTLE_DELAY_MS=1200`

## 分析機能

- 全体勝率・与被ダメ比・K/D比
- 機体別分析（基本データ、敵機体との相性、相方機体との相性）
- 固定相方分析（連続10戦以上）
- 被撃墜数と勝率の関係
- 時間帯別・曜日別の勝率
- 日別勝率推移
- シーズン別分析
- 総合アドバイス（カテゴリ別: 耐久管理、機体、時間帯、相方、メンタル）
- SNS共有機能（X, Bluesky, LINE）

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
