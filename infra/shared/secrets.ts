import * as gcp from "@pulumi/gcp";
import { services } from "./apis";
import { runSa, runStgSa, autoRefreshJobSa, mslistBuildSa } from "./iam";

// セッション暗号化鍵の入れ物。版(鍵の値)は Pulumi に入れず gcloud で手作業で足す
const newSecret = (env: string) =>
  new gcp.secretmanager.Secret(
    `session-key-${env}`,
    {
      secretId: `session-encryption-key-${env}`,
      replication: { auto: {} },
      // 版は Pulumi 管理外で、消えると復元できない
      deletionProtection: true,
    },
    { dependsOn: services }
  );

export const sessionKeySecretProd = newSecret("prod");
export const sessionKeySecretStg = newSecret("stg");

export const sessionKeyAccessors = [
  { name: "prod-run", secret: sessionKeySecretProd, sa: runSa },
  { name: "prod-auto-refresh-job", secret: sessionKeySecretProd, sa: autoRefreshJobSa },
  { name: "stg-run", secret: sessionKeySecretStg, sa: runStgSa },
].map(
  ({ name, secret, sa }) =>
    new gcp.secretmanager.SecretIamMember(`session-key-${name}`, {
      secretId: secret.id,
      role: "roles/secretmanager.secretAccessor",
      member: sa.member,
    })
);

// 公式サイトのログイン情報(MSリスト更新用)。版は gcloud で手作業で足す
const newCredentialSecret = (name: string) =>
  new gcp.secretmanager.Secret(
    `official-site-${name}`,
    {
      secretId: `official-site-${name}`,
      replication: { auto: {} },
      deletionProtection: true,
    },
    { dependsOn: services }
  );

export const officialSiteSecrets = ["username", "password"].map((name) => ({
  name,
  secret: newCredentialSecret(name),
}));

export const officialSiteAccessors = officialSiteSecrets.map(
  ({ name, secret }) =>
    new gcp.secretmanager.SecretIamMember(`official-site-${name}-mslist-build`, {
      secretId: secret.id,
      role: "roles/secretmanager.secretAccessor",
      member: mslistBuildSa.member,
    })
);
