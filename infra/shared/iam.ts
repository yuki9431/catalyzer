import * as pulumi from "@pulumi/pulumi";
import * as gcp from "@pulumi/gcp";
import { stateBucket, mslistBucket } from "./storage";
import { services } from "./apis";
import { repository } from "./artifact-registry";

const config = new pulumi.Config();
const githubRepo = config.require("githubRepo");
// 改名・再取得で同名 repo が作られても通さないため、数値 ID でも照合する
const githubRepoId = config.require("githubRepoId");
const githubOwnerId = config.require("githubOwnerId");
const computeSa = config.requireSecret("computeSa");

// GitHub Actions用サービスアカウント
export const githubActionsSa = new gcp.serviceaccount.Account(
  "github-actions",
  {
    accountId: "github-actions",
    displayName: "GitHub Actions",
  }
);

// Workload Identity Pool
export const wifPool = new gcp.iam.WorkloadIdentityPool("github-pool", {
  workloadIdentityPoolId: "github-pool",
  displayName: "GitHub Actions Pool",
});

// Workload Identity Provider（OIDC）
export const wifProvider = new gcp.iam.WorkloadIdentityPoolProvider(
  "github-provider",
  {
    workloadIdentityPoolId: wifPool.workloadIdentityPoolId,
    workloadIdentityPoolProviderId: "github-provider",
    displayName: "GitHub Provider",
    attributeMapping: {
      "google.subject": "assertion.sub",
      "attribute.repository": "assertion.repository",
    },
    attributeCondition: `assertion.repository=='${githubRepo}' && assertion.repository_id=='${githubRepoId}' && assertion.repository_owner_id=='${githubOwnerId}'`,
    oidc: {
      issuerUri: "https://token.actions.githubusercontent.com",
    },
  }
);

// GitHub OIDC の sub で束縛する。environment を参照した job は `environment:<名前>` になる
const wifSubject = (sub: string) =>
  pulumi.interpolate`principal://iam.googleapis.com/${wifPool.name}/subject/repo:${githubRepo}:${sub}`;

// prod デプロイ専用。environment prod(main のみ)の job だけが借りられる
export const wifBinding = new gcp.serviceaccount.IAMBinding(
  "github-actions-wif",
  {
    serviceAccountId: githubActionsSa.name,
    role: "roles/iam.workloadIdentityUser",
    members: [wifSubject("environment:prod")],
  }
);

// サービスアカウント自身のserviceAccountUser権限
export const saUserBinding = new gcp.serviceaccount.IAMBinding(
  "github-actions-sa-user",
  {
    serviceAccountId: githubActionsSa.name,
    role: "roles/iam.serviceAccountUser",
    members: [githubActionsSa.member],
  }
);

// プロジェクトレベルのIAMロール（最小権限）
const projectRoles = [
  "roles/run.developer",
];

export const projectBindings = projectRoles.map(
  (role) =>
    new gcp.projects.IAMMember(
      `github-actions-${role.split("/")[1]}`,
      {
        project: gcp.config.project!,
        role: role,
        member: githubActionsSa.member,
      },
      { dependsOn: services }
    )
);

// Cloud Run はデプロイ時にデプロイ元の権限で image のタグを解決するため、prod デプロイにも読み取りが要る
export const githubActionsArtifactRegistryReader = new gcp.artifactregistry.RepositoryIamMember(
  "github-actions-artifact-registry-reader",
  {
    project: repository.project,
    location: repository.location,
    repository: repository.name,
    role: "roles/artifactregistry.reader",
    member: githubActionsSa.member,
  }
);

// --- Storage権限 ---

// Pulumiステートバケットへの管理権限（GitHub Actions SA）
export const stateBucketBinding = new gcp.storage.BucketIAMMember(
  "github-actions-state-bucket",
  {
    bucket: stateBucket.name,
    role: "roles/storage.objectAdmin",
    member: githubActionsSa.member,
  }
);

// --- Firestore権限 ---

// Cloud Runデフォルトcompute SAにFirestoreへの読み書き権限を付与
export const firestoreComputeSaIam = new gcp.projects.IAMMember(
  "firestore-compute-sa",
  {
    project: gcp.config.project!,
    role: "roles/datastore.user",
    member: pulumi.interpolate`serviceAccount:${computeSa}`,
  },
  { dependsOn: services }
);

// --- 最小権限SA(#460・#288。加算のみ。既存の権限は移行完了後に別PRで外す) ---

// Cloud Run実行SA(prod)
export const runSa = new gcp.serviceaccount.Account("catalyzer-run", {
  accountId: "catalyzer-run",
  displayName: "Catalyzer Cloud Run",
});

// Cloud Run実行SA(stg)。セッション鍵を環境ごとに分けるため prod と別にする
export const runStgSa = new gcp.serviceaccount.Account("catalyzer-run-stg", {
  accountId: "catalyzer-run-stg",
  displayName: "Catalyzer Cloud Run (stg)",
});

// Cloud Build実行SA
export const buildSa = new gcp.serviceaccount.Account("catalyzer-build", {
  accountId: "catalyzer-build",
  displayName: "Catalyzer Cloud Build",
});

// 自動更新Jobの実行SA
export const autoRefreshJobSa = new gcp.serviceaccount.Account(
  "auto-refresh-job",
  {
    accountId: "auto-refresh-job",
    displayName: "Auto Refresh Job",
  }
);

// Schedulerのoidcトークン発行主体（ロール付与なし）
export const autoRefreshSchedulerSa = new gcp.serviceaccount.Account(
  "auto-refresh-scheduler",
  {
    accountId: "auto-refresh-scheduler",
    displayName: "Auto Refresh Scheduler",
  }
);

const newSaRoles: { name: string; sa: gcp.serviceaccount.Account; role: string }[] = [
  { name: "run-datastore", sa: runSa, role: "roles/datastore.user" },
  { name: "run-invoker", sa: runSa, role: "roles/run.invoker" },
  { name: "run-stg-datastore", sa: runStgSa, role: "roles/datastore.user" },
  { name: "build-logwriter", sa: buildSa, role: "roles/logging.logWriter" },
  { name: "auto-refresh-job-datastore", sa: autoRefreshJobSa, role: "roles/datastore.user" },
];

export const newSaProjectBindings = newSaRoles.map(
  ({ name, sa, role }) =>
    new gcp.projects.IAMMember(
      name,
      {
        project: gcp.config.project!,
        role: role,
        member: sa.member,
      },
      { dependsOn: services }
    )
);

// ビルドSA: ARリポジトリ単位のイメージ書き込み
export const buildArtifactRegistryBinding = new gcp.artifactregistry.RepositoryIamMember(
  "build-artifact-registry",
  {
    project: repository.project,
    location: repository.location,
    repository: repository.name,
    role: "roles/artifactregistry.writer",
    member: buildSa.member,
  }
);

// ビルドSA: Cloud Buildソースバケットの読み取り
export const buildSourceBucketBinding = new gcp.storage.BucketIAMMember(
  "build-cloudbuild-bucket",
  {
    bucket: `${gcp.config.project}_cloudbuild`,
    role: "roles/storage.objectViewer",
    member: buildSa.member,
  }
);

// GitHub Actions SAへの追加ロール
const githubActionsAddedRoles = [
  "roles/serviceusage.serviceUsageConsumer",
  "roles/cloudscheduler.admin",
];

export const githubActionsAddedBindings = githubActionsAddedRoles.map(
  (role) =>
    new gcp.projects.IAMMember(
      `github-actions-${role.split("/")[1]}`,
      {
        project: gcp.config.project!,
        role: role,
        member: githubActionsSa.member,
      },
      { dependsOn: services }
    )
);

// GitHub Actions SAの新設SAに対するactAs（SA単位）
export const githubActionsActAsBindings = [
  { name: "run", sa: runSa },
  { name: "auto-refresh-job", sa: autoRefreshJobSa },
  { name: "auto-refresh-scheduler", sa: autoRefreshSchedulerSa },
].map(
  ({ name, sa }) =>
    new gcp.serviceaccount.IAMMember(`github-actions-actas-${name}`, {
      serviceAccountId: sa.name,
      role: "roles/iam.serviceAccountUser",
      member: githubActionsSa.member,
    })
);

// --- CI の身元分離: PR の preview・stg(全ブランチ)・prod(main のみ)で SA を分ける ---

// PR の preview 用(読み取りと復号だけ)
export const ghaPrSa = new gcp.serviceaccount.Account("gha-pr", {
  accountId: "gha-pr",
  displayName: "GitHub Actions (PR preview)",
});

// ビルドと stg デプロイ用
export const ghaStgSa = new gcp.serviceaccount.Account("gha-stg", {
  accountId: "gha-stg",
  displayName: "GitHub Actions (stg)",
});

export const ciWifBindings = [
  { name: "gha-pr", sa: ghaPrSa, sub: "pull_request" },
  { name: "gha-stg", sa: ghaStgSa, sub: "environment:stg" },
].map(
  ({ name, sa, sub }) =>
    new gcp.serviceaccount.IAMBinding(`${name}-wif`, {
      serviceAccountId: sa.name,
      role: "roles/iam.workloadIdentityUser",
      members: [wifSubject(sub)],
    })
);

export const ghaStgProjectBindings = [
  "roles/cloudbuild.builds.editor",
  "roles/serviceusage.serviceUsageConsumer",
].map(
  (role) =>
    new gcp.projects.IAMMember(
      `gha-stg-${role.split("/")[1]}`,
      { project: gcp.config.project!, role, member: ghaStgSa.member },
      { dependsOn: services }
    )
);

// Cloud Run は stg のサービスだけ操作できる。project には LRO の待ち合わせだけを許す
export const ciRunOperationsRole = new gcp.projects.IAMCustomRole("ci-run-operations", {
  roleId: "ciRunOperationsViewer",
  title: "CI Cloud Run operations viewer",
  permissions: ["run.operations.get"],
});

// deploy は refresh(Pulumi.yaml)で app スタックの全リソースを読むため、run.developer に無い読み取りを足す
export const ciDeployRefreshRole = new gcp.projects.IAMCustomRole("ci-deploy-refresh", {
  roleId: "ciDeployRefreshViewer",
  title: "CI deploy refresh viewer",
  permissions: [
    "run.domainmappings.get",
    "dns.resourceRecordSets.get",
    "dns.resourceRecordSets.list",
    "cloudscheduler.jobs.get",
  ],
});

export const ciDeployRefreshBindings = [
  { name: "gha-stg", sa: ghaStgSa },
  { name: "github-actions", sa: githubActionsSa },
].map(
  ({ name, sa }) =>
    new gcp.projects.IAMMember(
      `${name}-deploy-refresh`,
      { project: gcp.config.project!, role: ciDeployRefreshRole.name, member: sa.member },
      { dependsOn: services }
    )
);

export const ghaStgRunOperationsBinding = new gcp.projects.IAMMember(
  "gha-stg-run-operations",
  { project: gcp.config.project!, role: ciRunOperationsRole.name, member: ghaStgSa.member },
  { dependsOn: services }
);

// サービス名は infra/app/Pulumi.stg.yaml の serviceName
export const ghaStgRunServiceBinding = new gcp.cloudrunv2.ServiceIamMember("gha-stg-run-developer", {
  name: "stg-exvs-analyzer",
  location: gcp.config.region!,
  role: "roles/run.developer",
  member: ghaStgSa.member,
});

export const ghaStateBucketBindings = [
  { name: "gha-pr", sa: ghaPrSa, role: "roles/storage.objectViewer" },
  { name: "gha-stg", sa: ghaStgSa, role: "roles/storage.objectAdmin" },
].map(
  ({ name, sa, role }) =>
    new gcp.storage.BucketIAMMember(`${name}-state-bucket`, {
      bucket: stateBucket.name,
      role,
      member: sa.member,
    })
);

// preview がロックを書く場合に備え、locks/ 配下だけ書ける
export const ghaPrStateLockBinding = new gcp.storage.BucketIAMMember("gha-pr-state-lock", {
  bucket: stateBucket.name,
  role: "roles/storage.objectUser",
  member: ghaPrSa.member,
  condition: {
    title: "pulumi-locks-only",
    expression: pulumi.interpolate`resource.name.startsWith("projects/_/buckets/${stateBucket.name}/objects/.pulumi/locks/")`,
  },
});

// gcloud builds submit は既定バケットの buckets.get を要する(objectUser に無い)
export const ghaStgCloudbuildBucketBindings = [
  "roles/storage.objectUser",
  "roles/storage.legacyBucketReader",
].map(
  (role) =>
    new gcp.storage.BucketIAMMember(`gha-stg-cloudbuild-bucket-${role.split(".")[1]}`, {
      bucket: `${gcp.config.project}_cloudbuild`,
      role,
      member: ghaStgSa.member,
    })
);

export const ghaStgArtifactRegistryBinding = new gcp.artifactregistry.RepositoryIamMember(
  "gha-stg-artifact-registry",
  {
    project: repository.project,
    location: repository.location,
    repository: repository.name,
    role: "roles/artifactregistry.writer",
    member: ghaStgSa.member,
  }
);

// stg 用は prod の実行 SA を actAs できない(prod の実行 SA で新しいリビジョンを作れない)
export const ghaStgActAsBindings = [
  { name: "build", sa: buildSa },
  { name: "run-stg", sa: runStgSa },
].map(
  ({ name, sa }) =>
    new gcp.serviceaccount.IAMMember(`gha-stg-actas-${name}`, {
      serviceAccountId: sa.name,
      role: "roles/iam.serviceAccountUser",
      member: ghaStgSa.member,
    })
);

// 各スタックの secretsprovider と同じ鍵(手動作成。既存の手動付与は残すため非権威の Member で足す)
const pulumiKmsKey = `projects/${gcp.config.project}/locations/${gcp.config.region}/keyRings/pulumi-secrets/cryptoKeys/pulumi-state`;

export const ghaKmsBindings = [
  { name: "gha-pr", sa: ghaPrSa, role: "roles/cloudkms.cryptoKeyDecrypter" },
  { name: "gha-stg", sa: ghaStgSa, role: "roles/cloudkms.cryptoKeyEncrypterDecrypter" },
].map(
  ({ name, sa, role }) =>
    new gcp.kms.CryptoKeyIAMMember(`${name}-kms`, {
      cryptoKeyId: pulumiKmsKey,
      role,
      member: sa.member,
    })
);

// --- MSリスト更新: 公式サイトは日本の IP しか通さないため、取得だけ東京の Cloud Build で行う(#595) ---

// GitHub Actions が借りる。environment mslist(develop のみ)の job だけ
export const ghaMslistSa = new gcp.serviceaccount.Account("gha-mslist", {
  accountId: "gha-mslist",
  displayName: "GitHub Actions (MS list update)",
});

// Cloud Build の実行 SA。公式サイトのログイン情報を読めるのはこれだけ
export const mslistBuildSa = new gcp.serviceaccount.Account("mslist-build", {
  accountId: "mslist-build",
  displayName: "MS list update build",
});

export const ghaMslistWifBinding = new gcp.serviceaccount.IAMBinding("gha-mslist-wif", {
  serviceAccountId: ghaMslistSa.name,
  role: "roles/iam.workloadIdentityUser",
  members: [wifSubject("environment:mslist")],
});

export const ghaMslistProjectBindings = [
  "roles/cloudbuild.builds.editor",
  "roles/serviceusage.serviceUsageConsumer",
].map(
  (role) =>
    new gcp.projects.IAMMember(
      `gha-mslist-${role.split("/")[1]}`,
      { project: gcp.config.project!, role, member: ghaMslistSa.member },
      { dependsOn: services }
    )
);

export const ghaMslistActAsBinding = new gcp.serviceaccount.IAMMember("gha-mslist-actas-mslist-build", {
  serviceAccountId: mslistBuildSa.name,
  role: "roles/iam.serviceAccountUser",
  member: ghaMslistSa.member,
});

// objectUser に buckets.get が無い。gcloud のステージングと Cloud Build の成果物・ログの書き込みが使う
export const mslistBucketBindings = [
  { name: "gha-mslist-objectUser", sa: ghaMslistSa, role: "roles/storage.objectUser" },
  { name: "gha-mslist-legacyBucketReader", sa: ghaMslistSa, role: "roles/storage.legacyBucketReader" },
  { name: "mslist-build-objectUser", sa: mslistBuildSa, role: "roles/storage.objectUser" },
  { name: "mslist-build-legacyBucketReader", sa: mslistBuildSa, role: "roles/storage.legacyBucketReader" },
].map(
  ({ name, sa, role }) =>
    new gcp.storage.BucketIAMMember(`mslist-bucket-${name}`, {
      bucket: mslistBucket.name,
      role,
      member: sa.member,
    })
);
