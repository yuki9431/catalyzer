IMAGE_NAME := exvs-analyzer
PORT ?= 8080

.PHONY: build run restart stop test test-js ui-preview ui-check ui-baseline extract-grades \
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

# OpenTofu。state_bucket と image_uri は TF_VAR_* で渡す(手元は infra/.envrc)。project は gcloud の設定から入れる
TOFU_ENV = TF_VAR_project=$${TF_VAR_project:-$$(gcloud config get-value project 2>/dev/null)}
TOFU_SHARED = $(TOFU_ENV) tofu -chdir=infra/shared
TOFU_APP = $(TOFU_ENV) tofu -chdir=infra/app
# STACK は明示必須(既定値で prod に当てない)
APP_VARS = -var-file=$(if $(filter prod stg,$(STACK)),$(STACK),$(error STACK=prod か STACK=stg を指定する)).tfvars

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
