resource "google_artifact_registry_repository" "repo" {
  repository_id = local.ar_repo
  location      = local.region
  format        = "DOCKER"
  description   = "Cloud Run Source Deployments"
}

resource "google_storage_bucket" "state" {
  name                        = var.state_bucket
  location                    = local.region
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"
  force_destroy               = false

  lifecycle {
    prevent_destroy = true
  }
}

resource "google_storage_bucket" "mslist" {
  name                        = local.bucket_names.mslist
  location                    = local.region
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"

  lifecycle_rule {
    action {
      type = "Delete"
    }
    condition {
      age = 7
    }
  }
}

resource "google_dns_managed_zone" "zone" {
  name        = "exvs-analyzer"
  dns_name    = "${local.domain}."
  description = "catalyzer DNS zone"

  dnssec_config {
    state = "on"
  }

  # 作り直すと NS と DS が変わり名前解決が止まる
  lifecycle {
    prevent_destroy = true
  }
}

resource "google_dns_record_set" "domain_verification" {
  managed_zone = google_dns_managed_zone.zone.name
  name         = "${local.domain}."
  type         = "TXT"
  ttl          = 300
  rrdatas      = ["\"${local.domain_txt}\""]
}

resource "google_firestore_database" "db" {
  name        = "exvs-analyzer"
  location_id = local.region
  type        = "FIRESTORE_NATIVE"
}

# 空の ttl_config で有効化し、index_config を空にして TTL 列のホットスポットを避ける(#368)
resource "google_firestore_field" "session_ttl" {
  database   = google_firestore_database.db.name
  collection = "sessions"
  field      = "expire_at"

  ttl_config {}
  index_config {}
}

# 版は gcloud で足す。消すと復元できない
resource "google_secret_manager_secret" "s" {
  for_each  = local.secrets
  secret_id = each.key

  deletion_protection = true

  replication {
    auto {}
  }

  lifecycle {
    prevent_destroy = true
  }
}
