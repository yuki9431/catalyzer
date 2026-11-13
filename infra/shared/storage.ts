import * as pulumi from "@pulumi/pulumi";
import * as gcp from "@pulumi/gcp";

const config = new pulumi.Config();
const pulumiStateBucket = config.requireSecret("pulumiStateBucket");

// Pulumiステート保存用バケット
export const stateBucket = new gcp.storage.Bucket("pulumi-state", {
  name: pulumiStateBucket,
  location: gcp.config.region!,
  uniformBucketLevelAccess: true,
  publicAccessPrevention: "enforced",
  forceDestroy: false,
});

// MSリスト更新の受け渡し用(Cloud Build へのソース・取得結果・ビルドログ)。中身は使い捨て
export const mslistBucket = new gcp.storage.Bucket("mslist", {
  name: `${gcp.config.project}-mslist`,
  location: gcp.config.region!,
  uniformBucketLevelAccess: true,
  publicAccessPrevention: "enforced",
  lifecycleRules: [{ action: { type: "Delete" }, condition: { age: 7 } }],
});
