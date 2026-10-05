import * as pulumi from "@pulumi/pulumi";
import * as gcp from "@pulumi/gcp";
import { stateBucket } from "./storage";
import { services } from "./apis";
import { repository } from "./artifact-registry";

const config = new pulumi.Config();
const githubRepo = config.require("githubRepo");
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
    attributeCondition: `assertion.repository=='${githubRepo}'`,
    oidc: {
      issuerUri: "https://token.actions.githubusercontent.com",
    },
  }
);

// WIF → サービスアカウントへのworkloadIdentityUser権限
export const wifBinding = new gcp.serviceaccount.IAMBinding(
  "github-actions-wif",
  {
    serviceAccountId: githubActionsSa.name,
    role: "roles/iam.workloadIdentityUser",
    members: [
      pulumi.interpolate`principalSet://iam.googleapis.com/${wifPool.name}/attribute.repository/${githubRepo}`,
    ],
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
  "roles/cloudbuild.builds.editor",
  "roles/resourcemanager.projectIamAdmin",
  "roles/run.developer",
  "roles/serviceusage.serviceUsageAdmin",
  "roles/viewer",
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

// Cloud Buildバケットへのストレージ権限（gcloud builds submitのソースアップロード用）
export const cloudbuildBucketBinding = new gcp.storage.BucketIAMMember(
  "github-actions-cloudbuild-bucket",
  {
    bucket: `${gcp.config.project}_cloudbuild`,
    role: "roles/storage.objectUser",
    member: githubActionsSa.member,
  }
);

// --- Artifact Registry権限 ---

// イメージへのコミットSHA追跡タグ付与用（artifactregistry.tags.create。リポジトリ単位に限定）
export const artifactRegistryBinding = new gcp.artifactregistry.RepositoryIamMember(
  "github-actions-artifact-registry",
  {
    project: repository.project,
    location: repository.location,
    repository: repository.name,
    role: "roles/artifactregistry.writer",
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

// Cloud Run実行SA(prod・stg共用)
export const runSa = new gcp.serviceaccount.Account("catalyzer-run", {
  accountId: "catalyzer-run",
  displayName: "Catalyzer Cloud Run",
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

// GitHub Actions SAへの追加ロール（serviceUsageAdminは移行完了後に外す）
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
  { name: "build", sa: buildSa },
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
