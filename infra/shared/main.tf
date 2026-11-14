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
    prefix = "tofu/shared"
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

provider "google" {
  project = var.project
  region  = local.region
}

locals {
  region          = "asia-northeast1"
  domain          = "exvs-analyzer.com"
  domain_txt      = "google-site-verification=TAXKxm2PncupGRZkk0mBxIxslp_7aZj-w9dxPAi-ObE"
  github_repo     = "yuki9431/catalyzer"
  github_repo_id  = "546382639"
  github_owner_id = "28643424"
  ar_repo         = split("/", var.image_uri)[2]
  kms_key         = "projects/${var.project}/locations/${local.region}/keyRings/pulumi-secrets/cryptoKeys/pulumi-state"

  apis = toset([
    "run.googleapis.com",
    "artifactregistry.googleapis.com",
    "cloudbuild.googleapis.com",
    "dns.googleapis.com",
    "iam.googleapis.com",
    "cloudresourcemanager.googleapis.com",
    "compute.googleapis.com",
    "firestore.googleapis.com",
    "cloudscheduler.googleapis.com",
    "secretmanager.googleapis.com",
  ])
}

resource "google_project_service" "api" {
  for_each           = local.apis
  service            = each.key
  disable_on_destroy = false
}

output "name_servers" {
  value = google_dns_managed_zone.zone.name_servers
}
