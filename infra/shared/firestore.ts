import * as gcp from "@pulumi/gcp";
import { services } from "./apis";

// Firestoreデータベース（Native mode）
export const firestoreDb = new gcp.firestore.Database(
  "firestore-db",
  {
    name: "(default)",
    locationId: gcp.config.region!,
    type: "FIRESTORE_NATIVE",
  },
  { dependsOn: services }
);
