# インフラ管理 (OpenTofu)

GCP リソースを OpenTofu (HCL) で管理する。1つの GCP プロジェクトに、共有リソースと環境ごと(prod / stg)のリソースを置く。

## ディレクトリ構成

```
infra/
├── .opentofu-version  ← CI と手元で使う OpenTofu の版
├── */.terraform.lock.hcl ← provider のハッシュ(CI は -lockfile=readonly。provider を上げたら更新してコミット)
├── shared/            ← 共有リソース。手元から手動で apply する
│   ├── main.tf        ← backend・state 暗号化・変数・API
│   ├── iam.tf         ← SA・WIF・カスタムロール・IAM の付与
│   └── resources.tf   ← Artifact Registry・GCS・DNS・Firestore・Secret Manager
└── app/               ← 環境ごとのリソース。deploy.yml が apply する
    ├── main.tf        ← backend・変数・環境差(locals.envs)・自動更新の設定
    ├── run.tf         ← Cloud Run サービス・公開 IAM・ドメインマッピング・CNAME・自動更新の Job と Scheduler
    └── {prod,stg}.tfvars ← env と image_tag(image_tag は build.yml が書き換える)
```

state は GCS バケットの `tofu/shared`・`tofu/app/<env>` に置き、KMS 鍵(`keyRings/pulumi-secrets/cryptoKeys/pulumi-state`)で state と plan を暗号化する。

## 前提条件

- OpenTofu(`brew install opentofu`。版は `infra/.opentofu-version`)
- GCP 認証(`gcloud auth application-default login`)と `gcloud config set project <PROJECT_ID>`
- `infra/.envrc`(gitignore 済み)で `TF_VAR_state_bucket` と `TF_VAR_image_uri` を export し、make の前に `source infra/.envrc` する(Makefile はリポジトリのルートで動く)。`TF_VAR_project` は Makefile が gcloud の設定から入れる

## 日常操作

```bash
make tofu-shared-plan          # shared の plan(refresh 付き)
make tofu-shared-apply         # shared の apply(CI は shared を apply しない)
STACK=prod make tofu-app-plan  # app の plan(STACK=prod|stg は必須)
STACK=stg make tofu-app-apply  # app は通常 deploy.yml が当てる。手元で当てるときは最新を pull してから
```

差分が無いかをスクリプトで判定するときは `-detailed-exitcode` を付ける(付けないと差分があっても exit 0)。

## 手作業で入れる値

```bash
# セッション鍵の版を追加（環境ごとに別の鍵。末尾に改行が入ると鍵が不正になり暗号化が黙って無効になる）
openssl rand -hex 32 | tr -d '\n' | gcloud secrets versions add <Secret ID> --data-file=-
# 使う版は infra/app/main.tf の local.session_key.version で変える(PR → deploy 後に旧版を destroy)

# 公式サイトのログイン情報の版を追加（MSリスト更新用。履歴に残さないよう read で受け、末尾に改行を入れない）
read -r U && printf '%s' "$U" | gcloud secrets versions add official-site-username --data-file=-
read -rs P && printf '%s' "$P" | gcloud secrets versions add official-site-password --data-file=-; unset U P
```

## GitOps

| タイミング | ワークフロー | 内容 |
|-----------|-------------|------|
| PR作成/更新 | `infra-ci.yml` | `tofu fmt -check` と shared + app (prod/stg) の `tofu plan`（refresh・lock なし）。PR コメントは件数とアドレスだけ |
| develop / main への push | `build.yml` | イメージをビルドし、`infra/app/<env>.tfvars` の `image_tag` を書き換えて deploy を呼ぶ |
| `infra/app/**` の push・dispatch | `deploy.yml` | `tofu apply`(refresh 付き)。develop → stg、main → prod |

## GitHub Secrets

| Secret | 説明 |
|--------|------|
| `TF_STATE_BUCKET` | OpenTofu の state を置く GCS バケット名 |
| `IMAGE_URI` | コンテナイメージURIベース（Infra CI は environment を使わないので repo の secret に置く） |
| `WIF_PROVIDER` | Workload Identity Provider |
| `BUILD_SERVICE_ACCOUNT` | Cloud Build の実行 SA(`catalyzer-build`。build.yml) |
| `GH_PAT` | MS リスト更新の PR 作成・マージ用トークン(update-mslist.yml) |
| `WIF_PR_SERVICE_ACCOUNT` | PR の plan 用 SA(`gha-pr`)。repo の secret |
| `WIF_SERVICE_ACCOUNT` | environment の secret。`stg` は `gha-stg`(ビルドと stg デプロイ)、`prod` は `github-actions`(prod デプロイ)、`mslist` は `gha-mslist`(MSリスト更新の Cloud Build 起動)。environment `prod` は main、`mslist` は develop のみ |

## 鍵と権限

ローカルは ADC、CI は WIF で連合した SA(PR の plan は `gha-pr`、ビルドと stg は `gha-stg`、prod は `github-actions`)が KMS 鍵で state を復号・暗号化する。OpenTofu の state 暗号化は plan でも Encrypt を呼ぶので、`gha-pr` にも暗号化の権限がある。KMS 鍵・cloudbuild バケット・`github-actions` の KMS 付与は tofu の管理外(#599)。
