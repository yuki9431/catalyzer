# 設計: infra を Pulumi(TypeScript) から OpenTofu(HCL) へ移行

- ステータス: draft
- 日付: 2026-11-14
- 関連: issue #598(合言葉ハッシュの Secret Manager 化。本移行ではやらない)・#599(管理外の整理)・PR #610(マージ済み。deploy を refresh 付きにし、`ciDeployRefreshViewer` を追加)
- 前提: 実装は #610 を含む origin/develop の上で行う(feat-opentofu-migration は 6ca913b に rebase 済み)

## 1. 方針

採用した決定と、それを選んだ理由(代替案とのトレードオフ)。

| # | 決定 | 退けた案と理由 |
|---|---|---|
| 1 | root は `infra/shared` と `infra/app` の2つ。app の prod/stg は同じ root を `-var-file=<env>.tfvars` で切り替える。backend の prefix も `var.env` で決める(OpenTofu は init 時に変数を解決できる)。module は作らない | 1 root: shared は手動 apply・app は CI apply という権限の分離が崩れる。workspaces: 認証やアクセス制御が分かれる用途には向かないと公式が明記。module: 重複は2 root の terraform/provider 定義だけ(約20行)で、間接参照を増やすほどの量ではない |
| 2 | 環境ごとの差は `infra/app/main.tf` の `locals.envs` に表として持つ。tfvars に書くのは `env` と `image_tag` だけ | 設定を tfvars に分散させる案: 変数宣言が10個増え、prod と stg を並べて見比べられない |
| 3 | shared の値は app に渡さない。app は SA メール・Secret ID・ゾーン名を命名規則で組み立てる | `terraform_remote_state`: 暗号化した state を読むために `remote_state_data_sources` の設定が要り、app の身元に shared state の復号権限も要る。data source: `-refresh=false` でも plan 時に読み取りが走り、gha-pr の権限を広げることになる |
| 4 | 識別子(プロジェクト ID・state バケット・AR repo)はコミットしない。CI では `TF_VAR_*` で渡す(project は auth の `project_id` 出力、それ以外は secret)。ローカルでは gitignore 済みの `infra/.envrc` と gcloud の設定から渡す。image タグ(content key)は平文の tfvars に置く | tfvars に暗号化して置く手段が無い。タグは Dockerfile 入力から作るハッシュで識別子ではない。これまで secret だったのは、URI 全体にプロジェクト ID と repo 名が含まれていたため |
| 5 | state は既存の state バケットに `tofu/shared`・`tofu/app/<env>` の prefix で置く。暗号化には既存の KMS 鍵(`pulumi-secrets/pulumi-state`)を使い、`gcp_kms` + `aes_gcm` で state と plan の両方を `enforced` にする | 新しい鍵: GCP の keyring は削除できず、github-actions とオーナーへの手動付与もやり直しになる。バケットを tofu の外に出す案: 今も Pulumi が自分の state バケットを管理しているので、同じ形(`prevent_destroy`)で困らない |
| 6 | refresh の扱いは #610 と同じにする。手元の plan/apply と deploy の apply は refresh 付き(既定)。PR の plan だけ `-refresh=false -lock=false -json` で、plan ファイルを作らない | deploy も `-refresh=false`: #608 と同じく、更新に失敗した後に state と実物が食い違っても再デプロイで拾えない。tofu も provider の実装次第で、失敗した更新の値を state に残しうる(未確認)。PR も refresh 付き: gha-pr に全リソースの読み取り(Cloud Run の env の平文を含む)を与えることになる。deploy の身元に要る読み取りは、#610 の `ciDeployRefreshViewer` で既に揃っている(tofu の refresh が読むリソースは Pulumi と同じ) |
| 7 | gha-pr の KMS ロールを `cryptoKeyEncrypterDecrypter` に上げる。`.pulumi/locks/` 条件付きの書き込み権限(#27)は削除する | `gcp_kms` の key provider は、読むだけの実行でも毎回 Encrypt を呼ぶ(ソースで確認済み)。gha-pr は state に書き込めない(objectViewer)ので、暗号化できても改ざんには使えない |
| 8 | 移行は「import → plan が N to import / 0 add / 0 change / 0 destroy → apply → import ブロックを削除」の順。Pulumi 側は `stack export` でバックアップしてから `stack rm --force` で外す。`pulumi destroy` は使わない | `retainOnDelete` を付けて回す案: Pulumi のコードに手を入れて up する工程が増える。`stack rm --force` だけでリソースを残したまま外せる |
| 9 | compute 既定 SA の `datastore.user`(#6)は import しない。最後に gcloud で外す | import してから削除する案: 識別子の変数がもう1つ増える |
| 10 | budget.ts は移植せずに削除する(現在 import されておらず未使用) | - |
| 11 | ローカルでは tofu を直接使う(`brew install opentofu`)。Makefile の `pulumi-*` を `tofu-*` に置き換える | Docker: 1.10 以降は公式イメージを直接実行できず(minimal のみ)、自前の Dockerfile が要る |
| 12 | 自動更新の合言葉ハッシュ(argon2id)は prod の `locals.envs` に平文で置く。#598 はやらない | GitHub secret + sensitive 変数: secret と CI の配線が増える。合言葉は一般ユーザーに使わせないためのもので、ハッシュを解析できる相手に使われても許容する(ユーザー判断 2026-11-14) |

## 2. 変更ファイル(PR 単位。詳細な段取りは §6)

### PR-1: shared を tofu で import する(Pulumi のファイルには触れない)
- `infra/.opentofu-version`(新規): `1.13.9`
- `infra/shared/main.tf`: terraform ブロック(`required_version = "~> 1.13.0"`、google `~> 8.11`、backend、encryption)、provider、変数、定数、API 10個(`for_each` で回す)、output `name_servers`
- `infra/shared/iam.tf`: SA 10個・WIF pool/provider・カスタムロール2個(`ciRunOperationsViewer` と `ciDeployRefreshViewer`)・全 IAM(§3 の map + `for_each`)。#610 のカスタムロール1個と付与2件は Pulumi に既にあるので import 対象に含め、新規作成はしない
- `infra/shared/resources.tf`: AR repo、バケット2つ(state バケットには `prevent_destroy`)、DNS ゾーンと TXT、Firestore の DB と TTL、Secret(`for_each` で回し `prevent_destroy`)
- `infra/shared/imports.tf`: 一時ファイル。§3 と同じ locals から `import { for_each }` で組み立て、ID は `var.project` から作る。apply の後、同じ PR で削除する
- `infra/shared/.terraform.lock.hcl`: `tofu providers lock -platform=linux_amd64 -platform=darwin_amd64 -platform=darwin_arm64`
- `infra/.gitignore`: `.terraform/`・`*.tfstate*`・`*.tfplan` を追記(`.envrc` は既にある)
- `Makefile`: `tofu-shared-plan` と `tofu-shared-apply` を追加
- `renovate.json5`: §3 のルールを追加
- CLAUDE.md の oracle に `tofu fmt -check -recursive infra` を追記

### PR-2: app を import し、Infra CI を tofu に切り替える(build と deploy はまだ Pulumi)
- `infra/app/main.tf`: terraform ブロック、provider、変数(`project`・`state_bucket`・`image_uri`・`env`・`image_tag`)、`locals.envs`、命名規則。自動更新の paused/open は変数にせず `local.auto_refresh` に置く(`-var` で変えても次の deploy で戻るため、変えるときはコードで変える)
- `infra/app/run.tf`: Service・公開 IAM(`allUsers` の binding)・DomainMapping(`ignore_changes = [metadata]`)・CNAME・Job と Scheduler(`count = local.e.auto_refresh ? 1 : 0`)。Service と Job は `ignore_changes = [client, client_version]`
- `infra/app/{prod,stg}.tfvars`(新規): `env` と `image_tag`。`image_tag` は空行で区切った最終行に置く(`tofu fmt` の揃えに巻き込まれないようにする)
- `infra/app/imports.tf`(一時)・`infra/app/.terraform.lock.hcl`
- `infra/shared/iam.tf`: gha-pr の KMS ロールを EncrypterDecrypter に変え、#27 を削除する
- `.github/scripts/tofu-plan-summary.sh`(新規)。`pulumi-preview-summary.sh` は削除する
- `.github/scripts/scripts.test.js`: 偽の `tofu` を使うテストに置き換える
- `.github/workflows/infra-ci.yml`: §4 の内容に書き換える
- `Makefile`: `tofu-app-plan` を追加(`tofu-app-apply` は tfvars の image_tag が CI で更新されるようになる PR-3 で足す)

### PR-3: build と deploy を tofu に切り替える
- `build.yml`: `pulumi/actions` と Pulumi config の更新手順を削除し、`infra/app/${STACK}.tfvars` の `image_tag` を sed で書き換える。`paths-ignore` を `infra/app/**` と deploy.yml にする。sync-develop の除外を `':!infra/app' ':!.github/workflows/deploy.yml'` にする
- `deploy.yml`: push の `paths` を `infra/app/**` にする。detect は「main なら prod、それ以外は stg」だけにする(HEAD~1 との比較はやめる)。steps は setup-opentofu → mask → auth → `init` → `apply -auto-approve -input=false -var-file`(refresh は既定のまま。`-refresh=false` を付けない)
- `Makefile`: `tofu-app-apply` を追加する

### PR-4: 後始末(prod が tofu で動くのを確認してから)
- 削除: `infra/**/*.ts`・`package*.json`・`tsconfig.json`・`Pulumi*.yaml`・`infra/.gitignore` の `node_modules/` と `bin/`
- `Makefile`: `pulumi-*` ターゲットと、直書きされていた state バケット名を削除する
- `CLAUDE.md` / `README.md` / `infra/README.md` を tofu 版に書き直す(infra/README.md の既に古くなっている記述もここで直す)。`docs/design/` の過去分は履歴なので触らない

## 3. インターフェース

**変数と値の出どころ**: `project` は CI では auth の `project_id`、ローカルでは `gcloud config get-value project`。`state_bucket` は secret `TF_STATE_BUCKET`(新規。値は今の `PULUMI_STATE_BUCKET` と同じ)。`image_uri` は secret `IMAGE_URI`。shared は `split("/", var.image_uri)[2]` から AR repo 名を取り出し、`validation` で形式を検査する。

**encryption**(両 root で同じ):
```hcl
encryption {
  key_provider "gcp_kms" "state" {
    kms_encryption_key = "projects/${var.project}/locations/asia-northeast1/keyRings/pulumi-secrets/cryptoKeys/pulumi-state"
    key_length         = 32
  }
  method "aes_gcm" "state" { keys = key_provider.gcp_kms.state }
  state {
    method   = method.aes_gcm.state
    enforced = true
  }
  plan {
    method   = method.aes_gcm.state
    enforced = true
  }
}
```

**IAM のデータ構造**(shared/iam.tf):
- for_each のキーは論理名だけで組む。キーはアドレスとして PR コメントに出るので、識別子を混ぜない
- 種類ごとに resource を1本ずつ置く:
  - `project_iam_member` / `storage_bucket_iam_member` / `artifact_registry_repository_iam_member` / `kms_crypto_key_iam_member` / `secret_manager_secret_iam_member` は非権威
  - SA 単位(WIF と actAs)は権威的な `service_account_iam_binding` で、SA 1つ・ロール1つにつき1件。借りられる主体を固定するため
  - stg サービスへの run.developer(#24)は単独の resource にする
- カスタムロールは定義と付与先を1つの map にまとめる(下の例)
```hcl
locals {
  project_roles = { # SA => project ロール
    github-actions    = ["roles/run.developer", "roles/serviceusage.serviceUsageConsumer", "roles/cloudscheduler.admin"]
    catalyzer-run     = ["roles/datastore.user", "roles/run.invoker"]
    catalyzer-run-stg = ["roles/datastore.user"]
    # ... catalyzer-build / auto-refresh-job / gha-stg / gha-mslist
  }
  project_grants = merge([for sa, roles in local.project_roles :
    { for r in roles : "${sa} ${r}" => { sa = sa, role = r } }]...)
  custom_roles = { # roleId => 権限と付与先
    ciRunOperationsViewer = { title = "CI Cloud Run operations viewer", permissions = ["run.operations.get"], members = ["gha-stg"] }
    ciDeployRefreshViewer = { title = "CI deploy refresh viewer", members = ["gha-stg", "github-actions"], permissions = [
      "run.domainmappings.get", "dns.resourceRecordSets.get", "dns.resourceRecordSets.list", "cloudscheduler.jobs.get"] }
  }
  bucket_roles = { # 論理バケット => SA => ロール。cloudbuild は管理外(#599)なので名前だけで参照する
    state      = { github-actions = ["roles/storage.objectAdmin"], gha-stg = ["roles/storage.objectAdmin"], gha-pr = ["roles/storage.objectViewer"] }
    cloudbuild = { catalyzer-build = ["roles/storage.objectViewer"], gha-stg = ["roles/storage.objectUser", "roles/storage.legacyBucketReader"] }
    mslist     = { gha-mslist = local.rw, mslist-build = local.rw }
  }
  wif_subjects = { github-actions = "environment:prod", gha-stg = "environment:stg", gha-pr = "pull_request", gha-mslist = "environment:mslist" }
  sa_users = { # actAs される SA => actAs する SA
    github-actions = ["github-actions"], catalyzer-run = ["github-actions"], auto-refresh-job = ["github-actions"]
    auto-refresh-scheduler = ["github-actions"], catalyzer-build = ["gha-stg"], catalyzer-run-stg = ["gha-stg"], mslist-build = ["gha-mslist"]
  }
  secrets = { # Secret ID => 読める SA
    session-encryption-key-prod = ["catalyzer-run", "auto-refresh-job"]
    session-encryption-key-stg  = ["catalyzer-run-stg"]
    official-site-username      = ["mslist-build"]
    official-site-password      = ["mslist-build"]
  }
}
resource "google_project_iam_member" "sa" {
  for_each = local.project_grants
  project  = var.project
  role     = each.value.role
  member   = google_service_account.sa[each.value.sa].member
}
```

カスタムロールの付与は次のように展開する:
- キーは `"<roleId> <sa>"`
- `role` には `google_project_iam_custom_role.r[roleId].name` を入れる。キーは静的に決まるので、値が未確定でも for_each に使える

その他:
- SA 10個は `local.service_accounts = { id => display_name }` の `for_each` で作る
- Cloud Run の `env` は provider 上 set ブロックなので、並びは差分にならない(Pulumi の定義順に合わせる必要はない)。平文の env は map(`local.service_env`)で持ち `dynamic "env"` で展開し、Secret 参照の `SESSION_ENCRYPTION_KEY` は別の `env` ブロックで書く

**`.github/scripts/tofu-plan-summary.sh <label> <dir> [plan引数...]`**
- 実行するコマンド: `tofu -chdir=<dir> plan -json -input=false -lock=false -refresh=false -detailed-exitcode`
- 終了コード: plan が 0 か 2 なら 0、1 なら 1
- PR コメント(`${PLAN_OUT:-/tmp/tofu-plan.txt}`)に書くもの: `planned_change` の action ごとの件数と、各アドレスの `- <action> \`<addr>\``。変更が無ければ「変更なし」
- 出力を JSON Lines として読めないときや、形が想定外のときは、中身を出さずに失敗とだけ書く
- diagnostic(severity と summary)はジョブログにだけ出す

**Makefile**: `tofu-shared-{plan,apply}` / `tofu-app-{plan,apply} STACK=prod|stg`(STACK は必須で、既定値を置かない)。`init -input=false -reconfigure` を毎回先に実行する。`TF_VAR_project` は gcloud の設定から自動で入れる。それ以外の `TF_VAR_*` は環境変数で渡す。refresh は既定のまま。

**renovate.json5**:
- `{ matchDatasources: ['terraform-provider'], registryUrls: ['https://registry.opentofu.org'] }`
- `{ matchManagers: ['terraform'], matchDepTypes: ['required_version'], enabled: false }`
- `.opentofu-version` を追跡する customManager(regex。datasource `github-releases`・depName `opentofu/opentofu`・`extractVersionTemplate: '^v(?<version>.+)$'`)
- opentofu の minor/major は `automerge: false`(state の形式と required_version の更新を人が揃える)
- 既存の `minimumReleaseAge: '3 days'` はそのまま全体に効く

## 4. CI

- 3つの workflow で共通: `opentofu/setup-opentofu` v2(v2.0.2 のタグを SHA で固定。SHA は実装時に `gh api` で解決する)に `tofu_version_file: infra/.opentofu-version` と `tofu_wrapper: false` を渡す。`TF_PLUGIN_CACHE_DIR` は `$RUNNER_TEMP/tofu-plugins` を mkdir して `$GITHUB_ENV` に入れ、同じジョブの init 間で provider を共有する。actions/cache は使わない(pull_request だけの workflow では base 側にキャッシュが作られず効かない)。CI の init には `-lockfile=readonly` を付け、lock の更新漏れを失敗にする
- infra-ci: secret 確認(`TF_STATE_BUCKET`)→ checkout → setup → mask → auth(gha-pr)→ `tofu fmt -check -recursive infra` → shared の init と要約 → app の prod と stg をそれぞれ `init -reconfigure -var-file` してから要約(要約は `-refresh=false`)→ `always()` で PR コメント(見出しは `## OpenTofu Plan`)
- deploy: refresh 付きの apply。読み取り権限は、#610 の `ciDeployRefreshViewer` と run.developer で足りる。PR-3 で stg を dispatch して確かめる
- WIF の subject・environment・`mask-gcp-ids.sh` はそのまま使う。shared は今後も手動で apply する(CI は apply しない)

## 5. テスト計画

- `scripts.test.js` の tofu 要約テストは8件:
  1. 件数とアドレスだけを書き、diagnostic の識別子をコメントに出さない
  2. 変更が無ければ「変更なし」と書く
  3. exit 2 は成功として扱う
  4. exit 1 なら非ゼロで終わり、コメントには失敗とだけ書く
  5. JSON でない出力は中身を出さずに失敗する
  6. 失敗していて出力も JSON でなければ、tofu の終了コードを返す
  7. 形が想定外の JSON なら失敗する
  8. 偽の tofu に渡った引数に `-refresh=false` と `-lock=false` が含まれる
- mask のテスト4件はそのまま残す
- import の正しさは、オーナーの ADC で回す refresh 付き plan の Plan 行で判定する
- build と deploy の変更は PR の CI では動かないので、PR ブランチから `workflow_dispatch`(stg)で動かして確かめる

## 6. 移行手順(事故防止)

**事前準備**
- (1) worktree を origin/develop(#610 を含む)に rebase する
- (2) 合言葉ハッシュは Pulumi の prod config から取り出し、`local.auto_refresh.passphrase_hash` に平文で書く(決定#12)
- (3) `pulumi preview --expect-no-changes` が shared・prod・stg の3つとも exit 0 になること(#610 以降は refresh 付き)。#610 の shared apply(カスタムロール1・付与2)が済んでいなければ、ここで差分として出る。差分があれば先に解消する
- (4) `pulumi stack export --show-secrets` で3スタックをリポジトリ外(`~/catalyzer-pulumi-backup/`)に保存する
- (5) secret `TF_STATE_BUCKET` を登録する。`IMAGE_URI` が environment にだけ登録されているなら、repo にも登録する

**PR-1**
- `make tofu-shared-plan` の結果が `83 to import, 0 to add, 4 to change, 0 to destroy` であること。change は Secret 4つの `deletion_protection` false→true だけ(provider 側の属性で、import 時は false になる。state だけの更新)
- N は Pulumi の shared state にある `gcp:` 型のリソース数から1を引いた数(#6 の分)。#610 のカスタムロール1と付与2も N に含まれる
- deletion_protection 以外の change が出たら、HCL を cloud の値に合わせる。それでも消えない差分は止めて報告する
- apply → imports.tf を削除 → plan が exit 0 → マージ
- この時点から shared の `pulumi up` は禁止する(Pulumi の shared state は app の StackReference が読むので、まだ残しておく)
- PR-2 で Infra CI が tofu になるまで、infra/shared/*.tf を変える他の PR は入れない(CI の Pulumi preview は .tf の差分を見ない)

**PR-2**
- shared: plan が `1 to add, 0 to change, 2 to destroy`(KMS の付け替えと #27 の削除)であることを確かめてから apply する
- app: stg は `4 to import`、prod は `6 to import`で、いずれも 0 add / 0 change / 0 destroy であること。各 tfvars の `image_tag` は今デプロイされているタグにする
- apply → imports.tf を削除 → Infra CI のコメントが3つとも「変更なし」→ マージ
- この PR から PR-3 のマージまでは、infra/ を変える他の PR をマージしない
- この間も Pulumi が image を出し続けるので、tofu の state は実物より古くなる。CI の plan は refresh しないので、差分は出ない
- 切り替えの後は、deploy の refresh が state を実物に合わせてから適用する

**PR-3**
- マージの前に、PR ブランチで `deploy.yml`(stg)を dispatch し、成功して `0 added, 0 changed, 0 destroyed` と出ることを確かめる(refresh の権限確認を兼ねる)
- develop にマージすると build が新しいタグを書き、stg に tofu で出す
- prod へのリリースの直前に次のゲートを通す:
  - `gh workflow disable update-mslist.yml` で MS リスト更新を止める
  - `make tofu-app-plan STACK=prod` が exit 0 であること
  - exit 0 にならず image_tag の差なら、develop の prod.tfvars を今の prod のタグに更新する PR を先に入れる。古いタグのまま deploy が push で走り、巻き戻るのを防ぐため
- リリースして prod の build と deploy が成功したら、update-mslist を有効に戻す

**PR-4 の前**
- `pulumi stack rm --force -y` を shared・prod・stg の3つで実行する
- #6 を gcloud で外す(決定#9)
- secret `PULUMI_STATE_BUCKET` を削除する

**ロールバック**
- PR-3 より前なら、PR を revert して `tofu state rm` するだけで済む(cloud のリソースは消さない)
- stack rm の後なら、`pulumi stack import --file <backup>` で戻して workflow を revert する

## 7. 完了条件

| 条件 | 検証コマンド | 期待値 |
|---|---|---|
| HCL の整形 | `tofu fmt -check -recursive infra` | exit 0 |
| shared の import | PR-1 で imports.tf がある状態の `make tofu-shared-plan` | `83 to import, 0 to add, 4 to change, 0 to destroy`(change は Secret の deletion_protection のみ) |
| shared の変更(PR-2) | `make tofu-shared-plan` | `1 to add, 0 to change, 2 to destroy` |
| shared に差分が無い | `tofu -chdir=infra/shared plan -detailed-exitcode` | exit 0 |
| app の import | PR-2 の `make tofu-app-plan STACK=stg` / `STACK=prod` | `4 to import` / `6 to import`で、いずれも 0 add/change/destroy |
| app に差分が無い | `tofu -chdir=infra/app plan -var-file=<env>.tfvars -detailed-exitcode`(refresh 付き。prod と stg) | どちらも exit 0 |
| 件数が Pulumi と一致 | `tofu state list \| wc -l` を3つの root で実行 | §6 の N、4、6 |
| deploy が refresh する | `grep -c -- '-refresh=false' .github/workflows/deploy.yml .github/workflows/build.yml` | どちらも 0 |
| PR の plan は refresh しない | `grep -c -- '-refresh=false' .github/scripts/tofu-plan-summary.sh` | 1 |
| JS テスト | `node --test .github/scripts/*.test.js` | pass 12・fail 0 |
| JS テスト全体 | `make test-js` | exit 0 |
| PR の plan | 該当 PR の `gh pr checks` | Infra CI が pass |
| PR のコメント | `gh pr view <n> --comments` | `## OpenTofu Plan` があり、3つの節がどれも「変更なし」 |
| build と deploy の切り替え | PR-3 ブランチで `gh workflow run deploy.yml --ref <branch> -f environment=stg` を実行し、その run を `gh run view` で見る | conclusion success、ログに `0 added, 0 changed, 0 destroyed` |
| stg の更新経路 | develop マージ後の `gh run list --workflow=deploy.yml --branch develop -L1` | success |
| prod の更新経路 | リリース後の `gh run list --workflow=deploy.yml --branch main -L1` | success |
| Pulumi のファイルが残っていない | `git ls-files infra \| grep -E '\.ts$\|package.*\.json$\|tsconfig\|Pulumi'` | 0行 |
| Pulumi への言及が残っていない | `grep -rniI pulumi .github Makefile infra CLAUDE.md README.md renovate.json5 \| grep -v 'keyRings/pulumi-secrets'` | 0行 |
| 識別子をコミットしていない | `git grep -nE '[0-9]{12}\|iam\.gserviceaccount\.com' -- infra .github Makefile \| grep -v '\${'` | 0行 |
| Renovate の設定 | `npx --yes --package renovate -- renovate-config-validator renovate.json5` | exit 0 |

レビュー観点(完了条件とは別):
- for_each のキーに識別子が入っていないか
- map の粒度が読みやすいか
- 権威的な binding を選んだ箇所は妥当か
- CLAUDE.md・README の記述が実態と合っているか
- Renovate が registry.opentofu.org の provider で PR を作るか(マージ後に Dependency Dashboard で確認する)

## 8. ユーザー判断(2026-11-14 回答済み)

1. #6 は import せず、PR-4 の前に gcloud で外す
2. #598 はやらない。合言葉ハッシュは平文で置く(決定#12)
3. 本番の操作(apply・`stack rm --force`・update-mslist の一時停止・GitHub secret の追加と削除)は main が実行してよい。implementer は plan(読み取り)まで
4. state バケットの `.pulumi/` は残し、削除は別 issue にする

## 9. ナレッジ候補・起票候補

ナレッジ候補:
- gcp_kms の key provider は plan でも Encrypt を呼ぶので、PR 用の SA にも EncrypterDecrypter が要る
- refresh は「手元と deploy は付ける、PR の plan だけ付けない」。更新に失敗すると state と実物が食い違うので deploy の refresh で拾う(#608・#610)。PR の身元の読み取り権限は広げない
- 1.10 以降は公式の Docker イメージを直接実行できない
- 既存ナレッジの更新が要るもの: pulumi-shared-manual-apply、cicd-branch-flow-content-key(deploy は `infra/app/**` で起動するようになる)、gha-ubuntu-2604-no-pulumi(廃止)、dependabot-npm-lock-text-merge(infra は対象外になる)

起票候補:
- state ごとに KMS 鍵を分け、gha-stg の state 権限を prefix で絞る
- budget を tofu で作り直す
- 旧 `.pulumi/` を削除する
- #599 は移行後に tofu で取り込む(KMS 鍵・cloudbuild バケット・手動付与)
