import * as pulumi from "@pulumi/pulumi";
import * as gcp from "@pulumi/gcp";

const config = new pulumi.Config();
const serviceName = config.require("serviceName");
const cpu = config.require("cpu");
const memory = config.require("memory");
const maxInstances = config.requireNumber("maxInstances");
const image = config.requireSecret("image");
const domain = config.require("domain");
const firestoreDatabase = config.require("firestoreDatabase");
const sessionEncryptionKey = config.getSecret("sessionEncryptionKey");

// 自動更新(#288)。Job と Scheduler は prod のみ(config で制御)
const autoRefreshEnabled = config.getBoolean("autoRefreshEnabled") ?? false;
const autoRefreshPaused = config.getBoolean("autoRefreshPaused") ?? false;
const autoRefreshOpen = config.getBoolean("autoRefreshOpen") ?? false;
const autoRefreshPassphraseHash = config.getSecret("autoRefreshPassphraseHash");

// shared スタックからDNSゾーン名を取得
const sharedStackName = config.require("sharedStack");
const shared = new pulumi.StackReference(sharedStackName);
const dnsZoneName = shared.getOutput("dnsZoneName") as pulumi.Output<string>;
// 有効時のみ必須。shared 未 apply なら広い権限の SA で Job を作らず失敗させる
const autoRefreshJobSaEmail = autoRefreshEnabled ? (shared.requireOutput("autoRefreshJobSaEmail") as pulumi.Output<string>) : undefined;
const autoRefreshSchedulerSaEmail = autoRefreshEnabled ? (shared.requireOutput("autoRefreshSchedulerSaEmail") as pulumi.Output<string>) : undefined;
// サービスは専用の実行 SA で動かす。compute のデフォルト SA(editor)を使わない(#460)
const runSaEmail = shared.requireOutput("runSaEmail") as pulumi.Output<string>;

// 自動更新の Cloud Run Job(サービスと同じイメージ)
const autoRefreshJob = autoRefreshEnabled
  ? new gcp.cloudrunv2.Job(`${serviceName}-auto-refresh`, {
      name: `${serviceName}-auto-refresh`,
      location: gcp.config.region!,
      launchStage: "GA",
      template: {
        parallelism: 1,
        taskCount: 1,
        template: {
          serviceAccount: autoRefreshJobSaEmail,
          timeout: "240s",
          maxRetries: 0,
          containers: [
            {
              image: image,
              commands: ["/app/auto-refresh"],
              envs: [
                { name: "FIRESTORE_DATABASE", value: firestoreDatabase },
                ...(sessionEncryptionKey !== undefined
                  ? [{ name: "SESSION_ENCRYPTION_KEY", value: sessionEncryptionKey }]
                  : []),
              ],
              resources: { limits: { cpu: "1", memory: "512Mi" } },
            },
          ],
        },
      },
    }, { ignoreChanges: ["client", "clientVersion"] })
  : undefined;

// サービスの自動更新用 env(prod のみ。無ければ機能は 404 で無効)
const autoRefreshEnvs = autoRefreshJob
  ? [
      {
        name: "AUTO_REFRESH_JOB",
        value: pulumi.interpolate`projects/${gcp.config.project!}/locations/${gcp.config.region}/jobs/${autoRefreshJob.name}`,
      },
      { name: "AUTO_REFRESH_AUDIENCE", value: `https://${domain}` },
      { name: "AUTO_REFRESH_INVOKER", value: autoRefreshSchedulerSaEmail },
      ...(autoRefreshPassphraseHash !== undefined
        ? [{ name: "AUTO_REFRESH_PASSPHRASE_HASH", value: autoRefreshPassphraseHash }]
        : []),
      ...(autoRefreshOpen ? [{ name: "AUTO_REFRESH_OPEN", value: "true" }] : []),
    ]
  : [];

// Cloud Run サービス
export const service = new gcp.cloudrunv2.Service(
  serviceName,
  {
    name: serviceName,
    location: gcp.config.region!,
    ingress: "INGRESS_TRAFFIC_ALL",
    launchStage: "GA",
    template: {
      serviceAccount: runSaEmail,
      scaling: {
        maxInstanceCount: maxInstances,
      },
      containers: [
        {
          image: image,
          ports: { containerPort: 8080, name: "http1" },
          envs: [
            {
              name: "FIRESTORE_DATABASE",
              value: firestoreDatabase,
            },
            ...(sessionEncryptionKey !== undefined
              ? [
                  {
                    name: "SESSION_ENCRYPTION_KEY",
                    value: sessionEncryptionKey,
                  },
                ]
              : []),
            ...autoRefreshEnvs,
          ],
          resources: {
            cpuIdle: true,
            startupCpuBoost: true,
            limits: {
              cpu: cpu,
              memory: memory,
            },
          },
          startupProbe: {
            failureThreshold: 5,
            periodSeconds: 10,
            tcpSocket: {
              port: 8080,
            },
            timeoutSeconds: 5,
          },
          livenessProbe: {
            httpGet: {
              path: "/health",
              port: 8080,
            },
            periodSeconds: 30,
            failureThreshold: 3,
            timeoutSeconds: 5,
          },
        },
      ],
      maxInstanceRequestConcurrency: 10,
      timeout: "300s",
    },
    traffics: [
      {
        percent: 100,
        type: "TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST",
      },
    ],
  },
  {
    ignoreChanges: ["client", "clientVersion"],
  }
);

// 未認証アクセスを許可
export const iamBinding = new gcp.cloudrunv2.ServiceIamBinding(
  "exvs-analyzer-public",
  {
    name: service.name,
    location: gcp.config.region!,
    role: "roles/run.invoker",
    members: ["allUsers"],
  }
);

// Cloud Runドメインマッピング
export const domainMapping = new gcp.cloudrun.DomainMapping(
  "exvs-analyzer-domain",
  {
    location: gcp.config.region!,
    name: domain,
    metadata: {
      namespace: gcp.config.project!,
    },
    spec: {
      routeName: service.name,
    },
  },
  {
    ignoreChanges: ["metadata"],
  }
);

// サブドメインのCNAMEレコード（Cloud Runのドメインマッピング用）
export const cnameRecord = new gcp.dns.RecordSet("cname", {
  managedZone: dnsZoneName,
  name: domain + ".",
  type: "CNAME",
  ttl: 300,
  rrdatas: ["ghs.googlehosted.com."],
});

// 5分おきに tick を叩く Scheduler(OIDC で認証)
export const autoRefreshTick = autoRefreshEnabled
  ? new gcp.cloudscheduler.Job(`${serviceName}-auto-refresh-tick`, {
      name: `${serviceName}-auto-refresh-tick`,
      region: gcp.config.region!,
      schedule: "*/5 * * * *",
      timeZone: "Asia/Tokyo",
      attemptDeadline: "30s",
      paused: autoRefreshPaused,
      retryConfig: { retryCount: 0 },
      httpTarget: {
        httpMethod: "POST",
        uri: `https://${domain}/internal/auto-refresh/tick`,
        oidcToken: {
          serviceAccountEmail: autoRefreshSchedulerSaEmail!,
          audience: `https://${domain}`,
        },
      },
    })
  : undefined;

export const url = service.uri;
export const cloudRunServiceName = service.name;
export const customDomain = domainMapping.name;
