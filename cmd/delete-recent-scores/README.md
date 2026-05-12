# delete-recent-scores

指定ユーザーの最新N日間の戦績データ（scores + timelines）をFirestoreから削除するCLIツール。

## オプション

| フラグ | 必須 | デフォルト | 説明 |
|--------|------|-----------|------|
| `-user` | Yes | - | 対象ユーザーキー（SHA256(email)[:8]の16進数） |
| `-days` | No | 2 | 削除する日数（最新日から遡る。1〜30） |
| `-execute` | No | false | 指定しない場合はドライラン（確認のみ） |

## 環境変数

| 変数 | 説明 |
|------|------|
| `GCP_PROJECT` | GCPプロジェクトID |
| `FIRESTORE_DATABASE` | FirestoreデータベースID |
| `GOOGLE_APPLICATION_CREDENTIALS` | GCP認証情報ファイルのパス（ローカル実行時） |

## ローカルからの実行（Docker経由）

ローカル環境にGoはインストールされていないため、Docker経由で実行する。

### ドライラン（確認のみ）

```bash
docker run --rm \
  -v "$PWD/go.mod":/app/go.mod:ro \
  -v "$PWD/go.sum":/app/go.sum:ro \
  -v "$PWD/internal":/app/internal:ro \
  -v "$PWD/cmd":/app/cmd:ro \
  -v "$HOME/.config/gcloud/application_default_credentials.json":/tmp/adc.json:ro \
  -e GOOGLE_APPLICATION_CREDENTIALS=/tmp/adc.json \
  -e GCP_PROJECT=<project-id> \
  -e FIRESTORE_DATABASE=<database-id> \
  -w /app \
  golang:1.26-alpine \
  go run ./cmd/delete-recent-scores -user <userKey> -days 3
```

### 削除実行

```bash
docker run --rm \
  -v "$PWD/go.mod":/app/go.mod:ro \
  -v "$PWD/go.sum":/app/go.sum:ro \
  -v "$PWD/internal":/app/internal:ro \
  -v "$PWD/cmd":/app/cmd:ro \
  -v "$HOME/.config/gcloud/application_default_credentials.json":/tmp/adc.json:ro \
  -e GOOGLE_APPLICATION_CREDENTIALS=/tmp/adc.json \
  -e GCP_PROJECT=<project-id> \
  -e FIRESTORE_DATABASE=<database-id> \
  -w /app \
  golang:1.26-alpine \
  go run ./cmd/delete-recent-scores -user <userKey> -days 3 -execute
```

## 動作

1. 指定ユーザーの最新試合日時を取得
2. 最新日の0:00から`(days-1)`日前をカットオフとして算出
3. カットオフ以降の`scores`と`timelines`ドキュメントを一覧表示
4. `-execute`指定時のみ、バッチ削除を実行

## 注意事項

- `-execute`を付けない限りデータは削除されない（ドライランで安全に確認可能）
- 削除は不可逆。実行前にドライランで対象を必ず確認すること
- GCP認証には`gcloud auth application-default login`で事前にADCを取得しておくこと
