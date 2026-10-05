# 設計: サービスアカウントの最小権限化(Cloud Run 実行 SA・ビルド・GitHub Actions SA)

- ステータス: 実装中(Step 1・2 完了、Step 3 を実装。Step 4 は prod で数日安定してから、Step 5 はその後)
- 日付: 2026-10-05
- 関連 issue: #460(#288 の PR-1 と同じ shared の手動 apply にまとめる。#288 設計書 §7・§10 U3)

識別子(プロジェクト ID・番号・SA のメール・バケット名)は書かない。`<PROJECT>`・`<RUN_SA>` 等で表す。値は `gcloud config get-value project` や Pulumi の出力で引く。

## 0. 要約と結論

- **Cloud Build の実行 SA は compute デフォルト SA**(実測。サービスの実行 SA と同一)。ログは LEGACY。`gcloud builds submit --tag` は `--service-account` 無指定。したがって compute SA の `roles/editor` を外すとビルドも壊れる。実行 SA の分離だけでは済まず、**ビルド用 SA も新設する**。
- サービスの実行時に使う GCP API は **Firestore だけ**(Secret Manager・Storage・Logging 等のクライアントは無い)。実行 SA に要るのは `roles/datastore.user` と、#288 の Job 起動用の `roles/run.invoker` のみ。
- github-actions SA は `projectIamAdmin` を外せる(CI は shared を preview するだけで apply しない。`roles/viewer` が `resourcemanager.projects.getIamPolicy` を持つことを `gcloud iam roles describe` で確認済み)。`serviceUsageAdmin` は `serviceUsageConsumer` へ縮小できる見込みだが**実地テストが要る**。
- 新設: 実行 SA 1つ、ビルド SA 1つ(+ #288 の Job SA・Scheduler SA)。追加(加算)だけの変更は shared の手動 apply **1回**(#288 PR-1 に同梱)で済む。権限を**外す**変更は動作確認の後に行うので、Pulumi 管理分の削除だけ 2 回目の apply になる(§6)。

## 1. 現状と各 SA が実際に使う権限(根拠付き)

### 1.1 構成の実測
| 対象 | 現状 | 根拠 |
|---|---|---|
| ユーザー管理 SA | compute デフォルトと github-actions の2つ | `gcloud iam service-accounts list` |
| Cloud Run サービス(prod・stg) | 両方 compute SA で実行 | `infra/app/index.ts` に `serviceAccount` 指定なし。`gcloud run services describe` |
| compute SA | project の `roles/editor` と `roles/datastore.user` | `projects get-iam-policy`。後者は `infra/shared/iam.ts` |
| Cloud Build | 実行 SA は compute SA、`options.logging: LEGACY` | `gcloud builds describe`(直近の成功ビルド) |
| github-actions SA | project に builds.editor / projectIamAdmin / run.developer / serviceUsageAdmin / viewer。ほか SA 単位・リソース単位(§1.4) | `iam.ts` と実測は一致 |
| 旧 Cloud Build SA | `cloudbuild.builds.builder` のみ。今回のビルドでは未使用 | 実測 |
| 認証 | 全 workflow が WIF(キー無し)。ci.yml・update-mslist.yml は GCP 認証なし | workflows |

### 1.2 Cloud Run 実行時(サービス)
- GCP クライアントは `cloud.google.com/go/firestore` と metadata(IAM 不要)だけ(`go.mod`、`internal/firestore/client.go`)。
- Firestore 操作: `users`・`users/{k}/matches`・`users/{k}/tag_partners`・`sessions/{token}` の Get / Set / Update / Delete / BulkWriter / Transaction(#288 で追加)。いずれも datastore.user の範囲。TTL 削除は Firestore 側の処理で SA 権限に無関係。
- シークレット(`SESSION_ENCRYPTION_KEY`)は Pulumi の config secret を env で渡す方式。Secret Manager は使わない。
- 必要: `roles/datastore.user`(read/write/delete)。Firestore に DB 単位の predefined ロールは無い(project 単位。DB での絞りは IAM Condition で任意。§7 U4)。
- #288 の Job 起動: サービスが Run API で Job を overrides なしで起動する → `run.jobs.run` のみ。`roles/run.invoker`(`run.jobs.run` を含み `runWithOverrides` は含まない。実測)で足りる。
- `cmd/delete-recent-matches`・`cmd/extract-grades` はローカル CLI(開発者の ADC)で実行 SA と無関係。

### 1.3 Cloud Build(`gcloud builds submit --tag`)
build.yml(`gcloud builds submit --tag "$IMAGE_KEY"`)が使う経路:
- 呼び出し側(github-actions): `cloudbuild.builds.create`(builds.editor)、ソース tgz のアップロード(ソース用バケットの objectUser)、ビルド SA への actAs(監査ログで `actAs` は compute SA 宛のみ)。
- ビルド SA(現状 compute SA): ソースの読み取り、Artifact Registry への push、ログ書き込み。いずれも現状は editor 由来。リポジトリ単位の権限は compute SA に無い。
- **user 指定 SA では LEGACY ログ(Google 所有バケット)が使えない**。`CLOUD_LOGGING_ONLY` か `GCS_ONLY`+自前バケットなどが必須(公式: configure-user-specified-service-accounts)。`--tag` 形式は `options` を書けないため、`--config cloudbuild.yaml` に切り替える(`--default-buckets-behavior` 等で `--tag` のまま通るかは未検証なので採らない)。
- `CLOUD_LOGGING_ONLY` だと `gcloud builds submit` はログを Cloud Logging から読むので、呼び出し側に `logging.logEntries.list` が要る。`roles/viewer` が持つことを実測で確認した(追加付与は不要)。

### 1.4 github-actions SA が使う操作と必要権限
| 操作(場所) | 必要な権限 | 付与(現状 → 目標) |
|---|---|---|
| WIF 認証 | SA 単位 `workloadIdentityUser`(principalSet) | 維持 |
| Pulumi state・secrets(build・deploy・infra-ci) | state バケット objectAdmin / KMS 鍵の encrypterDecrypter | 維持(後者は iam.ts 管理外の手動付与) |
| `gcloud builds submit` | builds.editor、ソースバケット objectUser、ビルド SA への serviceAccountUser | 維持 + ビルド SA への actAs を追加 |
| `gcloud artifacts docker tags add` | AR repo の writer | 維持 |
| app の `pulumi up`(Service・DomainMapping・IAM binding・CNAME) | `run.developer`(services.update 等)、実行 SA への serviceAccountUser | run.developer 維持。actAs の宛先を compute SA → 実行 SA へ |
| Job・Scheduler の `pulumi up`(#288) | run.developer(jobs.create/update を含む)、`cloudscheduler.admin`、Job SA・Scheduler SA への actAs | #288 のとおり追加 |
| infra-ci の `pulumi preview`(shared・app) | refresh の読み取り(viewer。projects.getIamPolicy を含む) | viewer 維持。**projectIamAdmin は不要** |
| API 利用の確認 | `serviceusage.services.use` | serviceUsageAdmin → serviceUsageConsumer(要テスト。§4 Step 5) |

- `run.developer` は `run.services.setIamPolicy`・`run.jobs.setIamPolicy` を持たない(run.admin のみ)。今の CI が通るのは Service の IAM binding・DomainMapping・CNAME(`dns.changes.create` も viewer・run.developer に無い)に変更が無いから。**変更が要る PR は CI では権限不足になる**(手動 apply か run.admin 付与が要る。付与は推奨しない)。
- `run.developer` は `run.jobs.run`・`runWithOverrides` を含む(github-actions は Job を起動できるが、CI に Job 起動の用途は無い。縮小の余地はあるが run.developer は Job 作成に要るので維持)。
- projectIamAdmin を持つ理由が CI に見当たらない: deploy.yml は app のみ up、shared は preview のみ。`projects.IAMMember` の書き込み(`setIamPolicy`)は手動 apply(オーナー権限)でだけ起きる。

### 1.5 コードと実測の差分(iam.ts 管理外の手動付与)
1. compute SA の `roles/editor`(GCP の既定付与)
2. compute SA への github-actions の serviceAccountUser(SA 単位)
3. ソースバケットへの custom role(`storage.buckets.getIamPolicy`/`setIamPolicy`。Pulumi の refresh 用 bootstrap)
4. KMS 鍵の encrypterDecrypter(github-actions とオーナー)

本 issue で 1・2 は削除する。3・4 は触らない(必要。Pulumi 管理への取り込みは別 issue)。有効な API も `apis.ts` に無いものが多数あるが対象外。

## 2. 目標の状態

| SA | ロール | 粒度 | 置き場 |
|---|---|---|---|
| **実行 SA**(新設 `catalyzer-run`、prod・stg 共用) | `roles/datastore.user` | project | shared/iam.ts |
| | `roles/run.invoker`(#288 の Job 起動用) | project(§3 D3) | shared/iam.ts |
| **ビルド SA**(新設 `catalyzer-build`) | `roles/logging.logWriter` | project | shared/iam.ts |
| | `roles/artifactregistry.writer` | AR リポジトリ単位 | shared/iam.ts |
| | `roles/storage.objectViewer` | ソースバケット単位 | shared/iam.ts |
| **Job SA**(#288 `auto-refresh-job`) | `roles/datastore.user` | project | #288 PR-1 |
| **Scheduler SA**(#288 `auto-refresh-scheduler`) | 付与なし | — | #288 PR-1 |
| **github-actions SA** | builds.editor・run.developer・viewer(維持)、`serviceUsageConsumer`(Admin から置換)、`cloudscheduler.admin`(#288) | project | shared/iam.ts |
| | `serviceAccountUser` を 実行 SA・ビルド SA・Job SA・Scheduler SA に | **各 SA 単位** | shared/iam.ts |
| | 既存のリソース単位(state バケット objectAdmin・ソースバケット objectUser・AR writer・KMS・WIF) | 維持 | — |
| **compute デフォルト SA** | **ロール無し**(editor・datastore.user を外す) | — | 手動(editor)+ iam.ts(datastore.user の削除) |

**外すもの**: compute SA の editor・datastore.user・github-actions からの SA 単位 serviceAccountUser、github-actions の `projectIamAdmin`・`serviceUsageAdmin`。

ビルド SA の最小ロールは公式に明記が無い(推測を含む)。表の3つが出発点で、§4 Step 2 の実地テストで不足を確かめる。`roles/cloudbuild.builds.builder`(project 単位で storage.objects.* や buckets.create を含み広い)は採らない。

## 3. 設計判断

| # | 論点 | 採用 | 却下・理由 |
|---|---|---|---|
| D1 | ビルドの実行 SA | **専用ビルド SA を新設** | compute SA に `builds.builder` を付けて済ませる案。実行 SA にビルド権限(AR への push・ストレージ全般)が残り、実行時の侵害からイメージ差し替え→デプロイに至る経路が残る。ビルドと実行の権限を分けるのが本 issue の目的 |
| D2 | ビルドのログ | `cloudbuild.yaml` を新設し `options.logging: CLOUD_LOGGING_ONLY`。docker build + `images` の1ステップ | `--tag` のまま回避する案は未検証。LEGACY のまま専用 SA は不可 |
| D3 | サービスの Job 起動権限 | **project 単位の `roles/run.invoker`** を実行 SA に付与(shared) | Job 単位の付与(#288 の理想形)は `run.jobs.setIamPolicy` が要り、github-actions に run.admin を足すことになる(Service の IAM まで書ける。本 issue の目的に反する)。project 単位でも、サービスは既に `allUsers` に公開されており、service への invoke は新たな露出にならない。Job は1つだけ |
| D4 | 実行 SA の共用 | prod・stg で1つ | stg と prod は Firestore DB を共有するので分けても権限は変わらない。#288 後は project 単位の run.invoker で stg から prod の Job も起動できるが、Job は差分取り込みだけで低リスクなので許容 |
| D5 | Job SA を実行 SA と共用するか | 分ける(#288 のとおり) | 現状の権限は同じ(datastore.user)だが、Job は Cookie 復号と取り込み専用で将来の差に備える。コストは SA 1つ |
| D6 | Firestore の DB 条件(IAM Condition) | 初回は付けない(§7 U4) | `resource.name=="projects/<PROJECT>/databases/<DB>"` で絞れるが、条件式の誤りは本番停止になる。利得は同一 project に別 DB が無い限り小さい |
| D7 | 既存 compute SA の扱い | ロールを全部外す(SA 自体は消さない) | 消せない(GCP が既定で用意するもので、他の GCP 機能が参照する場合がある) |
| D8 | 旧 Cloud Build SA(`builds.builder`) | 触らない | Google 管理で未使用。リスクは小さい。別途判断 |

## 4. 移行手順(本番を止めない順序)

原則: **付与を先、削除を後**。各段で確認し、確認前に次へ進まない。IAM の反映は通常約2分、7分以上かかることもあり、Firestore は IAM を5分キャッシュする。確認までに5〜10分置く。外す前に元のロール一覧を控える(`gcloud projects get-iam-policy`・SA の `get-iam-policy` をローカルに保存。コミットしない)。

### Step 0: 基線の記録(読み取りのみ)
- project と SA 単位の IAM をローカルに保存する。完了条件 C0。

### Step 1: shared の手動 apply(加算のみ。#288 PR-1 と同梱)
- 内容: 実行 SA・ビルド SA の作成とロール(§2)、github-actions への各 SA 単位 serviceAccountUser、`serviceUsageConsumer` の**追加**(Admin は残す)、#288 の API・Job SA・Scheduler SA・`cloudscheduler.admin`、shared の出力に実行 SA・ビルド SA の email を追加。
- 手順: PR をマージ → オーナーが `make pulumi-shared-preview` で差分が意図した追加だけか確認(他 PR の未適用差分が混ざることがある。ナレッジ pulumi-shared-manual-apply)→ `make pulumi-shared-shell` で `pulumi up`。
- 既存の動作に影響しない(何も外さない)。確認: C1。
- ロールバック: 追加したリソースの削除(`pulumi destroy -t` または該当コードの revert→apply)。既存に依存されていないので安全。

### Step 2: ビルド SA の実地テスト → build.yml 切替
1. (2026-10-05 実施済み: SUCCESS、実行 SA が catalyzer-build・ログ CLOUD_LOGGING_ONLY を確認し、テストイメージは削除)手元で `gcloud builds submit --config cloudbuild.yaml --service-account=<BUILD_SA> --substitutions=_IMAGE=<テスト用タグ>` を実行し成功を確認(本番のタグを使わない。AR に残るテストイメージは後で削除)。不足権限があればエラーが示すので Step 1 のロールに戻る(加算)。
2. オーナーが GitHub のシークレット `BUILD_SERVICE_ACCOUNT` を登録する(値は `--service-account` が受け付ける SA の完全リソース名)。未登録の secret は空文字になり、gcloud は空の SA を拒否せず既定 SA で黙ってビルドするので、build.yml の空チェックで失敗させる。
3. build.yml を `--config` + `--service-account` に変更する。**build.yml の変更は content key に入らず、content key が既存だと build.yml は `gcloud builds submit` を飛ばす**ので、手動 dispatch だけでは新経路を通らない。確認は COPY 対象の実変更(static/ や internal/ を含む)を載せた作業ブランチを `gh workflow run build.yml --ref <branch>` で stg に出して行う(#288 PR-2 の Go 変更で兼ねてもよい)。
- 確認: C2(GitHub Actions から起動されたビルドであること)。ロールバック: build.yml を revert(compute SA はまだ editor を持つので旧経路は生きている)。

### Step 3: サービスを実行 SA へ切替(app スタック)
- `infra/app/index.ts` の Service に `serviceAccount` = shared の出力(実行 SA)を指定。Pulumi.*.yaml の変更は不要。
- 順序: **stg → 確認 → prod**。`infra/app/index.ts` だけの変更では deploy.yml が起動しない(push トリガーは `Pulumi.*.yaml` のみ、content key 不変なら build.yml もデプロイを呼ばない)ので、マージ後に `gh workflow run deploy.yml --ref develop -f environment=stg`、prod は `--ref main -f environment=prod` を手動実行する(#288 PR-2 と同梱すれば Go 変更で自動デプロイに乗る)。stg と prod は Firestore DB を共有するので、stg の Firestore 動作確認が prod の権限確認にもなる。
- 確認: C3(`serviceAccountName`)、新リビジョンのログに権限エラーが無いこと(C4)、画面から分析・セッション復元の実操作(Firestore の read/write/delete を通す)。Job の起動に Job SA への actAs は不要(公式 Execute jobs の Required roles は `run.invoker` のみ。2026-10-06 確認)。stg は自動更新が無効なので、**prod 切替後に tick 1周(5分)待ち、新リビジョン以降の Job 実行が成功していること**(`gcloud run jobs executions list`)と、サービスログに Job 起動の 403 が無いことを確認する。
- ロールバック: 旧リビジョンへトラフィックを戻す(`gcloud run services update-traffic <svc> --to-revisions=<旧リビジョン>=100`)。恒久は PR の revert と deploy.yml の手動 dispatch。compute SA はこの時点でまだ editor を持つので戻せる。

### Step 4: compute SA の権限削除
- 前提: Step 2・3 が prod で安定(目安: prod で**数日**・**content key が変わる**ビルド(実際に `gcloud builds submit` が走るもの)とデプロイが各1回以上成功、C4 がゼロ)。
- `gcloud projects remove-iam-policy-binding` で compute SA の `roles/editor` を外す。続けて `datastore.user` と、compute SA 宛の github-actions の serviceAccountUser を外す(後者2つは iam.ts の削除と Pulumi 管理外の差分を揃える)。
- 確認: C5、反映待ち(5〜10分)後に、content key が変わるビルドとデプロイを1回通し(手動 dispatch だけではスキップされる)、`CreateBuild` と `UpdateService` が成功し、サービスの画面操作が通ること。
- ロールバック: `gcloud projects add-iam-policy-binding ... --role=roles/editor`(控えた基線で復元。反映待ち後に再確認)。

### Step 5: github-actions SA の縮小
- 5a: オーナーが `gcloud projects remove-iam-policy-binding` で `projectIamAdmin` を外す。反映待ち後に infra-ci(shared・app の preview)を再実行し成功を確認。失敗したら `add-iam-policy-binding` で戻し、原因(viewer の不足)を調べる。
- 5b: 同様に `serviceUsageAdmin` を外し(`serviceUsageConsumer` は Step 1 で付与済み)、infra-ci・deploy.yml(手動 dispatch)・build.yml(手動 dispatch。スキップ分岐でも gcloud の API 呼び出しが走る)で成功を確認。失敗したら戻す。
- 5c: iam.ts から該当コードを削除する PR をマージし、**2回目の shared の手動 apply**(`projectIamAdmin`・`serviceUsageAdmin`・compute SA の datastore.user の削除。5a・5b・Step 4 で既に外れている)。`pulumi refresh` → `pulumi preview`(差分ゼロを期待)→ `pulumi up` の順で行う。不要になる `computeSa` の config(iam.ts と Pulumi.shared.yaml)もこの PR で削除する。
- 確認: C6・C7。

## 5. #288 PR-1 との統合
- **加算は1回の apply**: #288 の PR-1(API・Job SA・Scheduler SA・`cloudscheduler.admin`・SA 単位 actAs)に、本設計の実行 SA・ビルド SA・ロール・出力を同じ PR の範囲として追加するか、別 PR にして**マージ後に1回の apply でまとめる**。推奨: 同じ `infra/shared/iam.ts` を触るので同じ PR(または連続マージ)にし、preview を1回で見る。
- #288 設計書の更新点(実装時に反映): §7 の「サービスの実行 SA(compute default)」を実行 SA に読み替え、Job 単位の `run.invoker` を project 単位に変更(D3)。§9 の「7 リソース」の数は増える。
- 順序制約: PR-2(#288 の Go・app TS)のデプロイより前に Step 1 を apply(#288 §7 と同じ)。Step 3 の app 変更は #288 PR-2 と同じ `infra/app/index.ts` を触るのでコンフリクトに注意(どちらかを先にマージして rebase)。
- Step 4・5 の削除は #288 の稼働に影響しない(Job は Job SA、起動は実行 SA の project 単位 `run.invoker`)。ただし Step 4 を #288 の検証完了前に行うと、起動権限の不足が editor の除去で初めて顕在化する。**#288 の prod 検証が終わるまで Step 4 を待つ**。

## 6. shared の apply 回数と CI デプロイの順序
- 1回目(Step 1): 加算のみ。以降の app デプロイ(Step 3)はこの出力を参照するので**必ず先**。
- 2回目(Step 5c): 削除のみ。実質、外した後の状態を Pulumi に追いつかせる作業。
- app の CI デプロイは shared の apply 前後を問わず壊れない順序にする: Step 3 のコードは shared の出力が無いと Pulumi が失敗する(StackReference)ので、Step 1 の apply 前にマージしない。
- CI は shared を apply しない(deploy.yml は infra/app のみ)。Pulumi.shared.yaml 等の変更を CI に期待しない。

## 7. 完了条件(1条件 = 1コマンド + 期待値。gcloud の読み取り)
`P` = `gcloud config get-value project`、`PN` = プロジェクト番号。

| # | コマンド | 期待値 |
|---|---|---|
| C0 | `gcloud projects get-iam-policy $P --format=json > <ローカル保存>` と、compute SA・github-actions SA それぞれの `gcloud iam service-accounts get-iam-policy <SA> --format=json > <ローカル保存>` | Step 0 で保存済み(コミットしない) |
| C1 | `gcloud iam service-accounts list --filter='email ~ "^(catalyzer-run\|catalyzer-build\|auto-refresh-job\|auto-refresh-scheduler)@"' --format='value(email)'` | 4行(Step 1 後) |
| C2 | `gcloud builds describe $(gcloud builds list --limit=1 --format='value(id)') --format='value(serviceAccount,options.logging,status)'` | ビルド SA・`CLOUD_LOGGING_ONLY`・`SUCCESS`(Step 2 後。GitHub Actions の run から起動されたビルドで確認し、手元のテストビルドで代用しない) |
| C3 | `gcloud run services describe <prod / stg サービス> --region <R> --format='value(spec.template.spec.serviceAccountName)'` | どちらも実行 SA(compute SA でない) |
| C4 | `gcloud logging read 'resource.type="cloud_run_revision" AND severity>=ERROR AND textPayload:("PermissionDenied" OR "PERMISSION_DENIED" OR "insufficient permissions")' --freshness=3d --limit=5` | 出力なし |
| C5 | `gcloud projects get-iam-policy $P --flatten='bindings[].members' --filter='bindings.members:<compute SA>' --format='value(bindings.role)'` | 出力なし(compute SA にロール無し) |
| C6 | `gcloud projects get-iam-policy $P --flatten='bindings[].members' --filter='bindings.members:<github-actions SA>' --format='value(bindings.role)'` | builds.editor・run.developer・viewer・serviceUsageConsumer(・#288 の cloudscheduler.admin)のみ。`projectIamAdmin`・`serviceUsageAdmin` が無い |
| C7 | `gcloud projects get-iam-policy $P --format=json \| jq '[.bindings[] \| select(.role=="roles/editor" or .role=="roles/owner") \| .members[] \| select(startswith("serviceAccount:"))] \| length'` | `0`(owner・editor を持つ SA が無い) |
| C8 | `gcloud builds submit` を実際に実行した build.yml の run と、その後の deploy.yml の run(`gh run view <id> --log` で submit の実行を確認) | どちらも `success` |
| C9 | infra-ci の再実行(`gh run list --workflow infra-ci.yml --limit 1 --json conclusion`) | `success` |

C4 は反映の遅れで偽陰性になりうるので、Step 3 後に画面操作を実際に行ってからログを見る。

## 8. リスクと未決事項

### リスク
- **ビルドの権限不足**: ビルド SA の最小ロールは公式に明記が無い。Step 2 の実地テストで確かめ、不足は加算で直す(失敗しても本番に影響しない)。
- **反映遅延**: IAM は数分〜7分超、Firestore は5分キャッシュ。外した直後の成功を信用しない。
- **actAs の不足**: 実行 SA で Service を更新するときの github-actions の権限が `run.developer` + 実行 SA への serviceAccountUser で足りる見込みだが未検証。Step 3 の stg で確認する。不足が出てもロールバック可能。
- **serviceUsageAdmin の除去**: `serviceusage.services.use` は Consumer も持つ(実測)。Pulumi provider がそれ以外を要する可能性が残る。Step 5b のテストで確かめ、戻せる。
- **app スタックの IAM 変更**: 今後 Service の公開設定や DomainMapping を変える PR は、CI の権限(run.developer)では書けない(現状も同じ)。手動 apply が要ることをナレッジ化する。
- **Recommender が無効**で未使用権限の自動裏取りはできない。監査ログ(直近3日)の実使用とコードの根拠で代替した。Data Access ログは無効の可能性があり、Firestore 読み書きの実使用は監査ログに出ない。

### 未決事項(ユーザー判断。推奨付き)
- **U1 ビルドの切替**: 専用ビルド SA + `cloudbuild.yaml`(推奨)/ compute SA に `builds.builder` を付けて済ませる(手早いが実行 SA に権限が残る)。
- **U2 #288 PR-1 との同梱**: 同一 PR または連続マージで1回の apply(推奨)/ 別々に2回 apply。
- **U3 Job 起動権限**: project 単位の `run.invoker`(推奨。理由は D3)/ Job 単位 + github-actions に run.admin(却下を推奨)。
- **U4 Firestore の DB 条件(IAM Condition)**: 付けない(推奨。同一 project に他 DB が無い間は利得が小さい)/ 付ける。
- **U5 Step 4 の待機期間**: prod で数日(推奨。#288 の prod 検証完了を待つ)/ もっと短く。
- **U6 旧 Cloud Build SA の `builds.builder`**: 触らない(推奨)/ 外す。

### 起票候補
- iam.ts 管理外の手動付与(カスタムロール・KMS 鍵の decrypter)と、`apis.ts` に無い有効 API を Pulumi 管理に取り込む。
- Recommender API を有効化して未使用権限を可視化する(任意)。
- `infra/shared/budget.ts` が未使用のまま(index.ts から import されていない)。
- app スタックの IAM 変更(Service IAM・DomainMapping)を CI で扱う方針(今は手動 apply)。

### ナレッジ候補
- Cloud Build の実行 SA はこの project では compute デフォルト SA(サービスの実行 SA と同一)。editor を外すとビルドが壊れる。専用 SA は `CLOUD_LOGGING_ONLY` などが必須。
- `roles/run.developer` は service/job の `setIamPolicy` を持たず、`run.jobs.run` は持つ。`roles/run.invoker` は `runWithOverrides` を含まない。
- `roles/viewer` は `resourcemanager.projects.getIamPolicy`・`logging.logEntries.list` を持つ。

## 8.1 決定事項(2026-10-05 ユーザー判断)
未決事項 U1〜U6 はすべて推奨どおり: 専用ビルド SA + cloudbuild.yaml / #288 PR-1 と同じ shared apply にまとめる / Job 起動は project 単位の run.invoker / Firestore の IAM Condition は付けない / editor 除去は prod で数日安定後 / 旧 Cloud Build SA は触らない

## 9. 変更予定ファイル(実装する場合)
`infra/shared/iam.ts`、`infra/shared/index.ts`(出力)、`infra/app/index.ts`、`.github/workflows/build.yml`、`cloudbuild.yaml`(新規)、`CLAUDE.md`(コード構成・CI の説明)、README のプロジェクト構成。`infra/shared/apis.ts` は #288 側。
