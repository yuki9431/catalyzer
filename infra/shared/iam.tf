locals {
  rw = ["roles/storage.objectUser", "roles/storage.legacyBucketReader"] # objectUser に buckets.get が無いため併用する

  service_accounts = {
    github-actions         = "GitHub Actions"
    catalyzer-run          = "Catalyzer Cloud Run"
    catalyzer-run-stg      = "Catalyzer Cloud Run (stg)"
    catalyzer-build        = "Catalyzer Cloud Build"
    auto-refresh-job       = "Auto Refresh Job"
    auto-refresh-scheduler = "Auto Refresh Scheduler"
    gha-pr                 = "GitHub Actions (PR preview)"
    gha-stg                = "GitHub Actions (stg)"
    gha-mslist             = "GitHub Actions (MS list update)"
    mslist-build           = "MS list update build"
  }

  project_roles = { # SA => project ロール
    github-actions    = ["roles/run.developer", "roles/serviceusage.serviceUsageConsumer", "roles/cloudscheduler.admin"]
    catalyzer-run     = ["roles/datastore.user", "roles/run.invoker"]
    catalyzer-run-stg = ["roles/datastore.user"]
    catalyzer-build   = ["roles/logging.logWriter"]
    auto-refresh-job  = ["roles/datastore.user"]
    gha-stg           = ["roles/cloudbuild.builds.editor", "roles/serviceusage.serviceUsageConsumer"]
    gha-mslist        = ["roles/cloudbuild.builds.editor", "roles/serviceusage.serviceUsageConsumer"]
  }
  project_grants = merge([for sa, roles in local.project_roles :
  { for r in roles : "${sa} ${r}" => { sa = sa, role = r } }]...)

  custom_roles = { # roleId => 権限と付与先
    ciRunOperationsViewer = { title = "CI Cloud Run operations viewer", permissions = ["run.operations.get"], members = ["gha-stg"] }
    ciDeployRefreshViewer = {
      title   = "CI deploy refresh viewer"
      members = ["gha-stg", "github-actions"]
      permissions = [
        "run.domainmappings.get", "dns.resourceRecordSets.get", "dns.resourceRecordSets.list", "cloudscheduler.jobs.get"
      ]
    }
  }
  custom_grants = merge([for id, r in local.custom_roles :
  { for sa in r.members : "${id} ${sa}" => { sa = sa, role_id = id } }]...)

  # cloudbuild は管理外(#599)なので名前だけで参照する
  bucket_names = {
    state      = var.state_bucket
    cloudbuild = "${var.project}_cloudbuild"
    mslist     = "${var.project}-mslist"
  }
  bucket_roles = { # 論理バケット => SA => ロール
    state      = { github-actions = ["roles/storage.objectAdmin"], gha-stg = ["roles/storage.objectAdmin"], gha-pr = ["roles/storage.objectViewer"] }
    cloudbuild = { catalyzer-build = ["roles/storage.objectViewer"], gha-stg = local.rw }
    mslist     = { gha-mslist = local.rw, mslist-build = local.rw }
  }
  bucket_grants = merge(flatten([for b, sas in local.bucket_roles : [for sa, roles in sas :
  { for r in roles : "${b} ${sa} ${r}" => { bucket = b, sa = sa, role = r } }]])...)

  ar_roles  = { github-actions = "roles/artifactregistry.reader", catalyzer-build = "roles/artifactregistry.writer", gha-stg = "roles/artifactregistry.writer" }
  kms_roles = { gha-pr = "roles/cloudkms.cryptoKeyEncrypterDecrypter", gha-stg = "roles/cloudkms.cryptoKeyEncrypterDecrypter" }

  wif_subjects = { github-actions = "environment:prod", gha-stg = "environment:stg", gha-pr = "pull_request", gha-mslist = "environment:mslist" }
  sa_users = { # actAs される SA => actAs する SA
    github-actions         = ["github-actions"]
    catalyzer-run          = ["github-actions"]
    auto-refresh-job       = ["github-actions"]
    auto-refresh-scheduler = ["github-actions"]
    catalyzer-build        = ["gha-stg"]
    catalyzer-run-stg      = ["gha-stg"]
    mslist-build           = ["gha-mslist"]
  }

  secrets = { # Secret ID => 読める SA
    session-encryption-key-prod = ["catalyzer-run", "auto-refresh-job"]
    session-encryption-key-stg  = ["catalyzer-run-stg"]
    official-site-username      = ["mslist-build"]
    official-site-password      = ["mslist-build"]
  }
  secret_grants = merge([for s, sas in local.secrets :
  { for sa in sas : "${s} ${sa}" => { secret = s, sa = sa } }]...)
}

resource "google_service_account" "sa" {
  for_each     = local.service_accounts
  account_id   = each.key
  display_name = each.value
}

resource "google_iam_workload_identity_pool" "github" {
  workload_identity_pool_id = "github-pool"
  display_name              = "GitHub Actions Pool"

  # 消すと同じ ID を30日使えず CI の認証が止まる
  lifecycle {
    prevent_destroy = true
  }
}

resource "google_iam_workload_identity_pool_provider" "github" {
  workload_identity_pool_id          = google_iam_workload_identity_pool.github.workload_identity_pool_id
  workload_identity_pool_provider_id = "github-provider"
  display_name                       = "GitHub Provider"

  attribute_mapping = {
    "google.subject"       = "assertion.sub"
    "attribute.repository" = "assertion.repository"
  }
  # 改名・再取得で同名 repo が作られても通さないため、数値 ID でも照合する
  attribute_condition = "assertion.repository=='${local.github_repo}' && assertion.repository_id=='${local.github_repo_id}' && assertion.repository_owner_id=='${local.github_owner_id}'"

  oidc {
    issuer_uri = "https://token.actions.githubusercontent.com"
  }
}

resource "google_project_iam_custom_role" "r" {
  for_each    = local.custom_roles
  role_id     = each.key
  title       = each.value.title
  permissions = each.value.permissions
}

resource "google_project_iam_member" "sa" {
  for_each = local.project_grants
  project  = var.project
  role     = each.value.role
  member   = google_service_account.sa[each.value.sa].member
}

resource "google_project_iam_member" "custom" {
  for_each = local.custom_grants
  project  = var.project
  role     = google_project_iam_custom_role.r[each.value.role_id].name
  member   = google_service_account.sa[each.value.sa].member
}

resource "google_storage_bucket_iam_member" "sa" {
  for_each = local.bucket_grants
  bucket   = local.bucket_names[each.value.bucket]
  role     = each.value.role
  member   = google_service_account.sa[each.value.sa].member
}

resource "google_artifact_registry_repository_iam_member" "sa" {
  for_each   = local.ar_roles
  location   = google_artifact_registry_repository.repo.location
  repository = google_artifact_registry_repository.repo.name
  role       = each.value
  member     = google_service_account.sa[each.key].member
}

resource "google_kms_crypto_key_iam_member" "sa" {
  for_each      = local.kms_roles
  crypto_key_id = local.kms_key
  role          = each.value
  member        = google_service_account.sa[each.key].member
}

# WIF と actAs は借りられる主体を固定するため権威的に持つ
resource "google_service_account_iam_binding" "wif" {
  for_each           = local.wif_subjects
  service_account_id = google_service_account.sa[each.key].name
  role               = "roles/iam.workloadIdentityUser"
  members            = ["principal://iam.googleapis.com/${google_iam_workload_identity_pool.github.name}/subject/repo:${local.github_repo}:${each.value}"]
}

resource "google_service_account_iam_binding" "act_as" {
  for_each           = local.sa_users
  service_account_id = google_service_account.sa[each.key].name
  role               = "roles/iam.serviceAccountUser"
  members            = [for u in each.value : google_service_account.sa[u].member]
}

resource "google_secret_manager_secret_iam_member" "sa" {
  for_each  = local.secret_grants
  secret_id = google_secret_manager_secret.s[each.value.secret].id
  role      = "roles/secretmanager.secretAccessor"
  member    = google_service_account.sa[each.value.sa].member
}

# サービス名は infra/app の serviceName(stg)と揃える
resource "google_cloud_run_v2_service_iam_member" "gha_stg_developer" {
  name     = "stg-exvs-analyzer"
  location = local.region
  role     = "roles/run.developer"
  member   = google_service_account.sa["gha-stg"].member
}
