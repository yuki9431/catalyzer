IMAGE_NAME := exvs-analyzer
PORT ?= 8080

.PHONY: build run restart stop test test-js ui-preview ui-check ui-baseline extract-grades \
	pulumi-shared-install pulumi-shared-init pulumi-shared-preview pulumi-shared-shell \
	pulumi-app-install pulumi-app-init pulumi-app-preview pulumi-app-shell \
	tofu-shared-plan tofu-shared-apply tofu-app-plan tofu-app-apply

## Docker イメージをビルド（キャッシュなし）
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

## Go テストを実行
test:
	docker run --rm -v "$(CURDIR)":/app -w /app golang:1.26-alpine go test ./internal/...

## JS テストを実行（フロントエンド・ui-check・CI スクリプト。CI スクリプトのテストは bash と jq が要る）
test-js:
	node --test 'static/__tests__/*.test.js' 'tools/ui-check/*.test.js' '.github/scripts/*.test.js'

## サンプルデータのUIプレビューを起動（http://127.0.0.1:8090/__preview/）
ui-preview:
	node tools/ui-check/server.js

## 全画面をヘッドレスChromeで撮影し検査（要: Google Chrome。基準画像との比較は PR の CI で行う）
ui-check:
	node tools/ui-check/check.js

## CI(PR の ui-baseline ラベル)が撮った基準画像を取り込む（例: make ui-baseline RUN=<run-id>。gh run download は上書きしないので一時ディレクトリを経由する）
ui-baseline:
	@test -n "$(RUN)" || { echo "RUN=<run-id> を指定する"; exit 1; }
	rm -rf tmp/ui-baseline
	gh run download $(RUN) -n ui-baseline -D tmp/ui-baseline
	cp tmp/ui-baseline/* tools/ui-check/baseline/

## Firestoreから未登録グレードURLを抽出
extract-grades:
	docker run --rm -v "$(CURDIR)":/app -w /app \
		-v "$(HOME)/.config/gcloud":/root/.config/gcloud \
		-e GCP_PROJECT=$$(gcloud config get-value project 2>/dev/null) \
		-e FIRESTORE_DATABASE \
		-e GOOGLE_APPLICATION_CREDENTIALS=/root/.config/gcloud/application_default_credentials.json \
		golang:1.26-alpine go run ./cmd/extract-grades

# CI(pulumi/actions)と同じく常に最新の CLI を使う。latest は手元にキャッシュされるので毎回取り直す
PULUMI_IMAGE := pulumi/pulumi:latest
PULUMI_STATE_BUCKET ?= exvs2ib-analyzer-pulumi-state
STACK ?= prod

# shared用（スタック固定: dev）
PULUMI_SHARED_LOGIN = pulumi login gs://$(PULUMI_STATE_BUCKET) && pulumi stack select shared
PULUMI_SHARED_RUN = docker run --rm --pull=always --entrypoint "" \
	-v "$(CURDIR)/infra/shared":/infra \
	-v "$(HOME)/.config/gcloud":/root/.config/gcloud \
	-w /infra \
	-e CLOUDSDK_CORE_PROJECT=$$(gcloud config get-value project 2>/dev/null) \
	-e GOOGLE_APPLICATION_CREDENTIALS=/root/.config/gcloud/application_default_credentials.json \
	$(PULUMI_IMAGE)

# app用（STACK変数で環境切り替え: prod / stg）
PULUMI_APP_LOGIN = pulumi login gs://$(PULUMI_STATE_BUCKET) && pulumi stack select $(STACK)
PULUMI_APP_RUN = docker run --rm --pull=always --entrypoint "" \
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
	docker run --rm -it --pull=always --entrypoint "" \
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
	docker run --rm -it --pull=always --entrypoint "" \
		-v "$(CURDIR)/infra/app":/infra \
		-v "$(HOME)/.config/gcloud":/root/.config/gcloud \
		-w /infra \
		-e CLOUDSDK_CORE_PROJECT=$$(gcloud config get-value project 2>/dev/null) \
		-e GOOGLE_APPLICATION_CREDENTIALS=/root/.config/gcloud/application_default_credentials.json \
		$(PULUMI_IMAGE) \
		sh -c "$(PULUMI_APP_LOGIN) && sh"

# OpenTofu。state_bucket と image_uri は TF_VAR_* で渡す(手元は infra/.envrc)。project は gcloud の設定から入れる
TOFU_ENV = TF_VAR_project=$${TF_VAR_project:-$$(gcloud config get-value project 2>/dev/null)}
TOFU_SHARED = $(TOFU_ENV) tofu -chdir=infra/shared
TOFU_APP = $(TOFU_ENV) tofu -chdir=infra/app
# STACK は明示必須(上の Pulumi 用の既定値 prod を使わない)
APP_VARS = -var-file=$(if $(and $(filter prod stg,$(STACK)),$(filter-out file,$(origin STACK))),$(STACK),$(error STACK=prod か STACK=stg を指定する)).tfvars

## shared: plan（refresh 付き）
tofu-shared-plan:
	$(TOFU_SHARED) init -input=false -reconfigure
	$(TOFU_SHARED) plan -input=false

## shared: apply（手動で実行する）
tofu-shared-apply:
	$(TOFU_SHARED) init -input=false -reconfigure
	$(TOFU_SHARED) apply

## app: plan（refresh 付き。STACK=prod|stg が必須）
tofu-app-plan:
	$(TOFU_APP) init -input=false -reconfigure $(APP_VARS)
	$(TOFU_APP) plan -input=false $(APP_VARS)

## app: apply（通常は deploy が行う。手元で当てるときは最新を pull してから。古い tfvars だと image が戻る）
tofu-app-apply:
	$(TOFU_APP) init -input=false -reconfigure $(APP_VARS)
	$(TOFU_APP) apply $(APP_VARS)
