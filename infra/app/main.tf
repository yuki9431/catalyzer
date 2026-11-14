terraform {
  required_version = "~> 1.13.0"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 8.11"
    }
  }

  backend "gcs" {
    bucket = var.state_bucket
    prefix = "tofu/app/${var.env}"
  }

  encryption {
    key_provider "gcp_kms" "state" {
      kms_encryption_key = local.kms_key
      key_length         = 32
    }
    method "aes_gcm" "state" {
      keys = key_provider.gcp_kms.state
    }
    state {
      method   = method.aes_gcm.state
      enforced = true
    }
    plan {
      method   = method.aes_gcm.state
      enforced = true
    }
  }
}

variable "project" {
  type = string

  validation {
    condition     = length(var.project) > 0
    error_message = "TF_VAR_project が空(gcloud config set project を確認)"
  }
}

variable "state_bucket" {
  type = string
}

variable "image_uri" {
  type = string

  validation {
    condition     = can(regex("^[a-z0-9-]+-docker\\.pkg\\.dev/[^/]+/[^/]+/", var.image_uri))
    error_message = "image_uri は <region>-docker.pkg.dev/<project>/<repo>/... の形式にする。"
  }
}

variable "env" {
  type = string

  validation {
    condition     = contains(["prod", "stg"], var.env)
    error_message = "env は prod か stg にする。"
  }
}

variable "image_tag" {
  type = string
}

provider "google" {
  project = var.project
  region  = local.region
}

locals {
  region  = "asia-northeast1"
  kms_key = "projects/${var.project}/locations/${local.region}/keyRings/pulumi-secrets/cryptoKeys/pulumi-state"

  envs = {
    prod = { service = "exvs-analyzer", domain = "www.exvs-analyzer.com", cpu = "2", memory = "1Gi", max_instances = 3, run_sa = "catalyzer-run", auto_refresh = true }
    stg  = { service = "stg-exvs-analyzer", domain = "stg.exvs-analyzer.com", cpu = "1", memory = "512Mi", max_instances = 1, run_sa = "catalyzer-run-stg", auto_refresh = false }
  }
  e = local.envs[var.env]

  # 自動更新(#288。prod のみ)。合言葉ハッシュは一般ユーザーを除けるだけでよいので平文で置く
  auto_refresh = {
    paused          = false
    open            = false
    passphrase_hash = "$argon2id$v=19$m=19456,t=2,p=1$av+80NRF4e/uNhUGwFF+fg$f1kfSTJANTaDnFBTHWcQYxx4IJo/5HCsPTTK7MXuutY"
    job             = "${local.e.service}-auto-refresh"
    scheduler_sa    = "auto-refresh-scheduler@${var.project}.iam.gserviceaccount.com"
  }

  image    = "${var.image_uri}:${var.image_tag}"
  audience = "https://${local.e.domain}"
  # セッション鍵は版を固定する。latest だと切替中にインスタンス間でセッションを消し合う
  session_key = { secret = "session-encryption-key-${var.env}", version = "1" }

  service_env = merge(
    { FIRESTORE_DATABASE = "exvs-analyzer", RATE_LIMIT = "60", GEO_RESTRICT = "true" },
    local.e.auto_refresh ? merge(
      {
        AUTO_REFRESH_JOB             = "projects/${var.project}/locations/${local.region}/jobs/${local.auto_refresh.job}"
        AUTO_REFRESH_AUDIENCE        = local.audience
        AUTO_REFRESH_INVOKER         = local.auto_refresh.scheduler_sa
        AUTO_REFRESH_PASSPHRASE_HASH = local.auto_refresh.passphrase_hash
      },
      local.auto_refresh.open ? { AUTO_REFRESH_OPEN = "true" } : {},
    ) : {},
  )
}
