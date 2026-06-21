import * as pulumi from "@pulumi/pulumi";
import * as gcp from "@pulumi/gcp";
import { stateBucket } from "./storage";
import { services } from "./apis";

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
