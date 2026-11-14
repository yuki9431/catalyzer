resource "google_cloud_run_v2_service" "app" {
  name         = local.e.service
  location     = local.region
  ingress      = "INGRESS_TRAFFIC_ALL"
  launch_stage = "GA"

  template {
    service_account                  = "${local.e.run_sa}@${var.project}.iam.gserviceaccount.com"
    max_instance_request_concurrency = 10
    timeout                          = "300s"

    scaling {
      max_instance_count = local.e.max_instances
    }

    containers {
      image = local.image

      ports {
        container_port = 8080
        name           = "http1"
      }

      dynamic "env" {
        for_each = local.service_env
        content {
          name  = env.key
          value = env.value
        }
      }
      env {
        name = "SESSION_ENCRYPTION_KEY"
        value_source {
          secret_key_ref {
            secret  = local.session_key.secret
            version = local.session_key.version
          }
        }
      }

      resources {
        cpu_idle          = true
        startup_cpu_boost = true
        limits            = { cpu = local.e.cpu, memory = local.e.memory }
      }

      startup_probe {
        failure_threshold = 5
        period_seconds    = 10
        timeout_seconds   = 5
        tcp_socket {
          port = 8080
        }
      }

      liveness_probe {
        failure_threshold = 3
        period_seconds    = 30
        timeout_seconds   = 5
        http_get {
          path = "/health"
          port = 8080
        }
      }
    }
  }

  traffic {
    percent = 100
    type    = "TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST"
  }

  lifecycle {
    ignore_changes = [client, client_version]
  }
}

resource "google_cloud_run_v2_service_iam_binding" "public" {
  name     = google_cloud_run_v2_service.app.name
  location = local.region
  role     = "roles/run.invoker"
  members  = ["allUsers"]
}

resource "google_cloud_run_domain_mapping" "app" {
  name     = local.e.domain
  location = local.region

  metadata {
    namespace = var.project
  }

  spec {
    route_name = google_cloud_run_v2_service.app.name
  }

  lifecycle {
    ignore_changes = [metadata]
  }
}

resource "google_dns_record_set" "cname" {
  managed_zone = "exvs-analyzer"
  name         = "${local.e.domain}."
  type         = "CNAME"
  ttl          = 300
  rrdatas      = ["ghs.googlehosted.com."]
}

resource "google_cloud_run_v2_job" "auto_refresh" {
  count        = local.e.auto_refresh ? 1 : 0
  name         = local.auto_refresh.job
  location     = local.region
  launch_stage = "GA"

  template {
    parallelism = 1
    task_count  = 1

    template {
      service_account = "auto-refresh-job@${var.project}.iam.gserviceaccount.com"
      timeout         = "240s"
      max_retries     = 0

      containers {
        image   = local.image
        command = ["/app/auto-refresh"]

        env {
          name  = "FIRESTORE_DATABASE"
          value = local.service_env.FIRESTORE_DATABASE
        }
        env {
          name = "SESSION_ENCRYPTION_KEY"
          value_source {
            secret_key_ref {
              secret  = local.session_key.secret
              version = local.session_key.version
            }
          }
        }

        resources {
          limits = { cpu = "1", memory = "512Mi" }
        }
      }
    }
  }

  lifecycle {
    ignore_changes = [client, client_version]
  }
}

# 10:00〜翌1:00(JST)に5分おきに tick を叩く。時間帯は static/lib/autorefresh.js の表示と揃える
resource "google_cloud_scheduler_job" "auto_refresh_tick" {
  count            = local.e.auto_refresh ? 1 : 0
  name             = "${local.auto_refresh.job}-tick"
  region           = local.region
  schedule         = "*/5 0,10-23 * * *"
  time_zone        = "Asia/Tokyo"
  attempt_deadline = "30s"
  paused           = local.auto_refresh.paused

  retry_config {
    retry_count = 0
  }

  http_target {
    http_method = "POST"
    uri         = "${local.audience}/internal/auto-refresh/tick"

    oidc_token {
      service_account_email = local.auto_refresh.scheduler_sa
      audience              = local.audience
    }
  }
}
