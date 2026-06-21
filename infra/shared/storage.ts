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
