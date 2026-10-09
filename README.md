<p align="center">
  <img src="static/logo.svg" alt="catalyzer" width="400">
</p>

<p align="center">
  機動戦士ガンダム EXTREME VS.2 INFINITE BOOST の戦績を多角的に分析するWebアプリケーション。
</p>

## 分析機能

### 総合
- 勝率・与被ダメ比・K/D比・EXダメージなどをタブごとの要約と行リストで見られるレポート
- 勝利時/敗北時の傾向比較（レーダーチャート）
- シーズン別分析（前半/後半の推移チャート付き）
- 各分析の要点（時間帯・曜日・シーズン・覚醒・先落ち/後落ちなどの数値比較）

### 機体別
- 基本データ・被撃墜と勝率の関係（自分×相方の2軸）
- 敵機体との相性・相方機体との相性
- 編成別勝率・コスト編成別勝率
- ダメージ貢献率
- 先落ち/後落ち分析・順落ち分析（自機・僚機が順不同で15秒以内に続けて撃墜された試合を、順落ち（試合継続）/順落ち（そのまま負け）/順落ちなしに分けた勝率）
- 覚醒タイミング・覚醒タイプ別傾向・覚醒回数
- OLスタンバイの順番と勝率（自分と相手の両方がOLスタンバイになった試合を、相手より先/後に分けた勝率）
- 試合時間と勝率（30秒刻み＋タイムアップ。勝ち/負けの平均試合時間）

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
│   ├── extract-grades/
│   │   └── main.go                # Firestoreから未登録グレードURL抽出CLI
│   ├── auto-refresh/
│   │   └── main.go                # 自動更新の Cloud Run Job
│   └── hash-passphrase/
│       └── main.go                # 自動更新の合言葉ハッシュ生成CLI
├── internal/
│   ├── model/
│   │   └── types.go               # 型定義のみ（PlayerScore, MSInfo等）
│   ├── mslist/
│   │   └── mslist.go              # MSリストの読み書き・マージ
│   ├── gradelist/
│   │   └── gradelist.go           # グレードリストの読み込み・未知URL検出
│   ├── scraper/
│   │   ├── scraper.go             # スクレイピング処理
│   │   ├── classrecord.go         # 戦績ページのクラスマッチ通算戦績取得
│   │   └── login.go               # ログイン処理
│   ├── firestore/
│   │   ├── client.go              # Firestoreクライアント初期化
│   │   ├── scores.go              # 戦績（matches）の読み書き
│   │   ├── tag_partners.go        # 固定相方データの読み書き
│   │   └── users.go               # ユーザーデータの読み書き
│   ├── autorefresh/               # 自動更新（合言葉・Job起動・差分取り込み）
│   ├── pipeline/
│   │   └── pipeline.go            # 分析パイプライン（Job管理・実行・JSON生成）
│   └── server/
│       ├── server.go              # HTTPサーバー・API
│       ├── ratelimit.go           # IPベースレート制限
│       ├── basicauth.go           # Basic認証ミドルウェア
│       └── block403.go            # 403時の一時ブロック管理
├── static/
│   ├── index.html                 # フロントエンドHTML骨格
│   ├── styles/                    # CSS（tokens.css に色・文字・余白の定義とライト配色、parts.css に共通部品、他は画面ごと。全15ファイル）
│   ├── theme-init.js              # テーマの初期適用と切替（<head> で同期実行）
│   ├── app.js                     # フロントエンドのエントリ（ジョブ制御・フォーム配線・セッション復元）
│   ├── analysis/
│   │   ├── stats.js               # 統計分析関数（時間帯/曜日/敵相性等）
│   │   ├── coach.js               # 勝率アップミッションの診断
│   │   ├── today.js               # 今日(無ければ最後に遊んだ日)と前回プレイした日の比較
│   │   └── classrecord.js         # 通算戦績の整形（カバー率・通算K/D）
│   ├── components/
│   │   ├── ui.js                  # 汎用UIコンポーネント（Tips/Table等）
│   │   ├── classrecord.js         # モバイル総合戦歴ビュー
│   │   ├── home.js                # ホーム画面（勝率アップミッション・前回との比較）
│   │   ├── charts.js              # Chart.jsグラフ・レポートセクション・勝率の行リスト（WinRateRowList）
│   │   ├── chart-canvas.js        # ChartCanvas・軸/凡例/色ヘルパ
│   │   ├── popover.js             # 共通ポップオーバー（開閉・外側クリック・Esc）
│   │   ├── shell.js               # AppShell（絞り込み行を隠す上部バー・本文・下部タブバー・ホーム画面アプリの引っ張り再分析）とその他画面（再分析・自動更新の設定を含む）
│   │   ├── parts.js               # 共通部品（Chip/ToggleGroup/Summary/RowList/Notice。Notice は操作ボタン付き）
│   │   └── report/                # レポート画面（report.js・controls.js・各タブ Pane）
│   ├── lib/
│   │   ├── db.js                  # IndexedDBキャッシュ
│   │   ├── autorefresh.js         # 自動更新の純粋ロジック（差分の起点・取り込み可否・状態の文言）
│   │   ├── format.js              # 書式・色分け・共有テキスト生成
│   │   ├── topbar.js              # 上部バーの純粋ロジック（引っ張り再分析・絞り込み行の隠す/出す）
│   │   ├── runlock.js             # 分析の多重起動ロック
│   │   ├── tabseen.js             # 下部タブの更新の点（最後に見たときの値との比較）
│   │   ├── launch.js              # 起動経路の判定（再読み込み・ホーム画面アプリ・再分析の抑止）
│   │   ├── progress.js            # 分析の進み具合の段階判定（読み込み/取得/集計）
│   │   ├── userkey.js             # ユーザーキーの導出（サーバーの model.UserKey と同じ）
│   │   └── theme.js               # canvas/Chart.js 用に CSS 定義を読む themeReader
│   ├── __tests__/                 # JSユニットテスト（Node.js組み込みテストランナー。contrast.test はダーク・ライトのコントラスト、typography.test は14px 下限を検査）
│   │   ├── stats.test.js          # stats.js テスト
│   │   ├── coach.test.js          # coach.js テスト
│   │   ├── today.test.js          # today.js テスト
│   │   ├── tabseen.test.js        # tabseen.js テスト
│   │   ├── format.test.js         # format.js テスト
│   │   ├── db.test.js             # db.js テスト
│   │   ├── search.test.js         # search.js テスト
│   │   ├── classrecord.test.js    # classrecord.js テスト
│   │   ├── popover.test.js        # popover.js テスト
│   │   ├── chart-canvas.test.js   # chart-canvas.js テスト
│   │   ├── skeleton-actions.test.js # Skeleton/AppShell/MoreView への props 渡し忘れ検査
│   │   ├── shell.test.js          # タブ定義と画面状態の読み出し
│   │   ├── autorefresh.test.js    # autorefresh.js テスト
│   │   ├── topbar.test.js         # topbar.js テスト
│   │   ├── runlock.test.js        # runlock.js テスト
│   │   ├── launch.test.js         # launch.js テスト
│   │   ├── progress.test.js       # progress.js テスト
│   │   ├── userkey.test.js        # userkey.js テスト
│   │   ├── summary.test.js        # レポート要約（summary.js）の指標・目安テスト
│   │   ├── surface.test.js        # .panel/.kpi/.card に影・角丸が無いこと・scroll リスナが shell.js だけにあることの静的検査
│   │   ├── theme-init.test.js     # theme-init.js・FOUC 構造テスト
│   │   └── theme.test.js          # theme.js・トークン参照テスト
│   ├── logo.svg                   # ロゴ
│   ├── favicon.svg                # ファビコン（SVG）
│   ├── htm-preact-standalone.js   # htm + Preactライブラリ
│   └── chart.umd.min.js          # Chart.jsライブラリ
├── tools/ui-check/                # UIプレビュー（サンプルデータ）と画面確認スクリプト（ダーク・ライト両テーマで撮影。依存ゼロ・要Chrome）
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
│       ├── ci.yml                 # CI（Docker build, golangci-lint, Go test -race, JS test）
│       ├── build.yml              # ビルド&デプロイ（developマージ→stg、mainマージ→prod）
│       ├── deploy.yml             # デプロイ（Pulumi up）
│       ├── infra-ci.yml           # インフラCI（Pulumi preview）
│       └── update-mslist.yml      # MSリスト自動更新
├── .golangci.yml                  # golangci-lint設定
├── Makefile                       # ビルド・起動・インフラコマンド
├── Dockerfile                     # マルチステージビルド
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
| `internal/session/` | セッション暗号化（AES-256-GCM）・CookieJarシリアライズ |
| `internal/firestore/` | Firestoreクライアント・データの読み書き・セッション保存 |
| `internal/pipeline/` | 分析パイプライン（ジョブ管理・実行・JSON生成・セッション永続化） |
| `internal/nationalstats/` | 機体ごとの全国統計（勝率・使用率）JSONの読み書き |
| `internal/server/` | HTTPハンドラ・レート制限・Basic認証・403ブロック・セッション管理 |
| `static/` | フロントエンドHTML/JS/CSS |
| `static/styles/` | CSS（`tokens.css` に色・文字・余白の定義、他は画面・部品ごと） |
| `static/analysis/` | 統計分析・集計関数（ESモジュール） |
| `static/components/` | UIコンポーネント（`report/` にレポート画面、`shell.js`・`popover.js`・`chart-canvas.js`・`parts.js` に共通部品） |
| `static/lib/` | IndexedDBキャッシュ・書式ヘルパー・試合判定ヘルパー |
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

# フロントエンド（JS）テスト
make test-js

# UIプレビュー（サンプルデータ。http://127.0.0.1:8090/__preview/）/ 全画面の画面確認 / 基準画像の更新
make ui-preview
make ui-check
make ui-baseline
# Chrome が既定パス(macOS の Google Chrome)に無い場合は CHROME_PATH で指定する

# Firestoreから未登録グレードURLを抽出
FIRESTORE_DATABASE=exvs-analyzer make extract-grades
```

http://localhost:8080 にアクセスしてログインすると分析レポートが表示されます。

ポートを変更したい場合は `PORT=3000 make run` のように指定できます。

### スクレイパーのペーシング設定

詳細ページの取得は二段ペーシングで行います。先頭の**バースト区間**を並列・無遅延で高速取得して速報レポートを早く表示し、以降の**スロットル区間**は直列＋待機でレート制限(403)を回避します。各区間は環境変数で調整できます（未設定時は既定値）。

| 環境変数 | 説明 | 既定値 |
| --- | --- | --- |
| `SCRAPER_BURST_COUNT` | バースト区間で高速取得する先頭リクエスト数（0でバースト無効） | 100 |
| `SCRAPER_BURST_PARALLELISM` | バースト区間の最大同時リクエスト数 | 3 |
| `SCRAPER_THROTTLE_DELAY_MS` | スロットル区間の各リクエスト完了後の待機（ミリ秒） | 900 |
| `SCRAPER_MAX_DETAIL` | 詳細取得件数の上限（古い順の先頭N件。0または未設定で無制限） | 0 |

スロットル区間は同時リクエスト数1で直列実行されます（403回避のため固定）。例（バーストを無効化し全件を低レート取得）: `SCRAPER_BURST_COUNT=0 SCRAPER_THROTTLE_DELAY_MS=1200`

## 技術スタック

- **バックエンド**: Go 1.26（標準 `net/http`）
- **インフラ**: Cloud Run (GCP)、Pulumi (TypeScript) でIaC管理
- **ストレージ**: Cloud Storage (GCP)
- **CI/CD**: GitHub Actions（ラベルでCI/CDを制御）
- **コンテナ**: Docker（マルチステージビルド）
- **フロントエンド**: htm/Preact（ダーク/ライト(端末に合わせる・選択可)、レスポンシブ対応）

## Author

Dillen Hiroyuki ([@yuki9431](https://github.com/yuki9431))

## License

[Apache License 2.0](LICENSE)
