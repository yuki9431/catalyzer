IMAGE_NAME := exvs-analyzer
DEV_IMAGE := exvs-analyzer-dev
PORT ?= 8080
SAMPLE_DATA := testdata/sample_matches.json

.PHONY: build run restart stop dev dev-build sample preview test extract-grades \
	pulumi-shared-install pulumi-shared-init pulumi-shared-preview pulumi-shared-shell \
	pulumi-app-install pulumi-app-init pulumi-app-preview pulumi-app-shell

## 開発用Dockerイメージをビルド（Go+Python同梱。初回・go.mod変更時のみ）
dev-build:
	docker build -f Dockerfile.dev -t $(DEV_IMAGE) .

## ダミーデータでローカル起動（Docker。ホストにGo/Python不要）。localhost:$(PORT)
## DEV_SAMPLE_DATA によりスクレイピング(バンナムログイン)をスキップし、同梱の
## ダミー試合データで /analyze→/result の実フローを確認できる。ソースはbind mountするので
## コード変更はコンテナ再起動で反映（go build/modキャッシュは名前付きvolumeで永続化）。
dev: dev-build
	docker run --rm -it -p $(PORT):8080 \
		-v "$(CURDIR)":/app -w /app \
		-v exvs-go-build-cache:/root/.cache/go-build \
		-v exvs-go-mod-cache:/go/pkg/mod \
		-e PORT=8080 \
		-e DEV_SAMPLE_DATA=$(SAMPLE_DATA) \
		$(DEV_IMAGE)

## ダミー試合データとサンプルレポートを再生成（Docker python経由、ホスト非依存）
sample:
	docker run --rm -v "$(CURDIR)":/app -w /app python:3.11-alpine sh -c "\
		python3 scripts/gen_sample.py && \
		python3 scripts/analyze.py $(SAMPLE_DATA) --ms-list data/ms_list.json && \
		cp testdata/report.json static/sample_report.json"

## フロント単体プレビュー（サーバー不要。ダミーレポートを静的配信）
## → http://localhost:8888/preview.html
preview:
	docker run --rm -p 8888:8888 -v "$(CURDIR)/static":/static -w /static \
		python:3.11-alpine python3 -m http.server 8888

## Docker イメージをビルド（キャッシュなし・本番相当）
build:
	docker build --no-cache -t $(IMAGE_NAME) .

## コンテナを起動（localhost:$(PORT)）
run:
	@if docker ps -q -f name=$(IMAGE_NAME) | grep -q .; then \
		echo "Stopping existing container..."; \
		docker stop $(IMAGE_NAME) > /dev/null; \
	fi
	docker run --rm --name $(IMAGE_NAME) -p $(PORT):8080 $(IMAGE_NAME)

## ビルド後に起動（build + run）
restart: build run

## コンテナを停止
stop:
	docker stop $(IMAGE_NAME)

## Go テストを実行（Docker経由）
test:
	docker run --rm -v "$(CURDIR)":/app -w /app golang:1.26-alpine go test ./internal/...

## Firestoreから未登録グレードURLを抽出
extract-grades:
	docker run --rm -v "$(CURDIR)":/app -w /app \
		-v "$(HOME)/.config/gcloud":/root/.config/gcloud \
		-e GCP_PROJECT=$$(gcloud config get-value project 2>/dev/null) \
		-e FIRESTORE_DATABASE \
		-e GOOGLE_APPLICATION_CREDENTIALS=/root/.config/gcloud/application_default_credentials.json \
		golang:1.26-alpine go run ./cmd/extract-grades

PULUMI_IMAGE := pulumi/pulumi:latest
PULUMI_STATE_BUCKET ?= exvs2ib-analyzer-pulumi-state
STACK ?= prod

# shared用（スタック固定: dev）
PULUMI_SHARED_LOGIN = pulumi login gs://$(PULUMI_STATE_BUCKET) && pulumi stack select shared
PULUMI_SHARED_RUN = docker run --rm --entrypoint "" \
	-v "$(CURDIR)/infra/shared":/infra \
	-v "$(HOME)/.config/gcloud":/root/.config/gcloud \
	-w /infra \
	-e CLOUDSDK_CORE_PROJECT=$$(gcloud config get-value project 2>/dev/null) \
	-e GOOGLE_APPLICATION_CREDENTIALS=/root/.config/gcloud/application_default_credentials.json \
	$(PULUMI_IMAGE)

# app用（STACK変数で環境切り替え: prod / stg）
PULUMI_APP_LOGIN = pulumi login gs://$(PULUMI_STATE_BUCKET) && pulumi stack select $(STACK)
PULUMI_APP_RUN = docker run --rm --entrypoint "" \
	-v "$(CURDIR)/infra/app":/infra \
	-v "$(HOME)/.config/gcloud":/root/.config/gcloud \
	-w /infra \
	-e CLOUDSDK_CORE_PROJECT=$$(gcloud config get-value project 2>/dev/null) \
	-e GOOGLE_APPLICATION_CREDENTIALS=/root/.config/gcloud/application_default_credentials.json \
	$(PULUMI_IMAGE)

## === shared（環境非依存リソース） ===

## shared: 依存パッケージをインストール
pulumi-shared-install:
	$(PULUMI_SHARED_RUN) npm install

## shared: バックエンドにログイン＆スタック初期化
pulumi-shared-init:
	$(PULUMI_SHARED_RUN) sh -c "pulumi login gs://$(PULUMI_STATE_BUCKET) && pulumi stack init shared || pulumi stack select shared"

## shared: インフラ変更のプレビュー
pulumi-shared-preview:
	$(PULUMI_SHARED_RUN) sh -c "$(PULUMI_SHARED_LOGIN) && pulumi preview"

## shared: シェルで入る（pulumi up はここで実行）
pulumi-shared-shell:
	docker run --rm -it --entrypoint "" \
		-v "$(CURDIR)/infra/shared":/infra \
		-v "$(HOME)/.config/gcloud":/root/.config/gcloud \
		-w /infra \
		-e CLOUDSDK_CORE_PROJECT=$$(gcloud config get-value project 2>/dev/null) \
		-e GOOGLE_APPLICATION_CREDENTIALS=/root/.config/gcloud/application_default_credentials.json \
		$(PULUMI_IMAGE) \
		sh -c "$(PULUMI_SHARED_LOGIN) && sh"

## === app（環境ごとにデプロイ: STACK=prod|stg） ===

## app: 依存パッケージをインストール
pulumi-app-install:
	$(PULUMI_APP_RUN) npm install

## app: バックエンドにログイン＆スタック初期化
pulumi-app-init:
	$(PULUMI_APP_RUN) sh -c "pulumi login gs://$(PULUMI_STATE_BUCKET) && pulumi stack init $(STACK) || pulumi stack select $(STACK)"

## app: インフラ変更のプレビュー（STACK=prod|stg）
pulumi-app-preview:
	$(PULUMI_APP_RUN) sh -c "$(PULUMI_APP_LOGIN) && pulumi preview"

## app: シェルで入る（pulumi up はここで実行。STACK=prod|stg）
pulumi-app-shell:
	docker run --rm -it --entrypoint "" \
		-v "$(CURDIR)/infra/app":/infra \
		-v "$(HOME)/.config/gcloud":/root/.config/gcloud \
		-w /infra \
		-e CLOUDSDK_CORE_PROJECT=$$(gcloud config get-value project 2>/dev/null) \
		-e GOOGLE_APPLICATION_CREDENTIALS=/root/.config/gcloud/application_default_credentials.json \
		$(PULUMI_IMAGE) \
		sh -c "$(PULUMI_APP_LOGIN) && sh"
