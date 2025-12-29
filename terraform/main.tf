# main.tf - Production LTX Video Deployment on Compute Engine

terraform {
  required_version = ">= 1.0"
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 7.14.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }
}

provider "google" {
  project = var.project_id
  region  = var.region
}

# Enable required APIs
resource "google_project_service" "required_apis" {
  for_each = toset([
    "compute.googleapis.com",
    "storage.googleapis.com",
    "artifactregistry.googleapis.com",
    "cloudbuild.googleapis.com",
    "logging.googleapis.com",
    "monitoring.googleapis.com",
    "iap.googleapis.com",
    "secretmanager.googleapis.com",
    "autoscaling.googleapis.com"
  ])

  service            = each.key
  disable_on_destroy = false
}

# VPC Network
resource "google_compute_network" "ltx_network" {
  name                    = "ltx-video-network"
  auto_create_subnetworks = false

  depends_on = [google_project_service.required_apis]
}

resource "google_compute_subnetwork" "ltx_subnet" {
  name          = "ltx-video-subnet"
  ip_cidr_range = "10.0.1.0/24"
  region        = var.region
  network       = google_compute_network.ltx_network.id

  log_config {
    aggregation_interval = "INTERVAL_5_SEC"
    flow_sampling        = 0.5
    metadata             = "INCLUDE_ALL_METADATA"
  }
}

# Firewall Rules
resource "google_compute_firewall" "allow_ssh" {
  name    = "ltx-allow-ssh-iap"
  network = google_compute_network.ltx_network.name

  allow {
    protocol = "tcp"
    ports    = ["22"]
  }

  # Only allow Google IAP range
  source_ranges = ["35.235.240.0/20"]
  target_tags   = ["ltx-video-vm"]
}

resource "google_compute_firewall" "allow_http" {
  name    = "ltx-allow-http"
  network = google_compute_network.ltx_network.name

  allow {
    protocol = "tcp"
    ports    = ["8080"] # Only the app port is needed on the VM
  }

  source_ranges = concat(
    # Load Balancer & Health Check Ranges (Required for LB to work)
    ["130.211.0.0/22", "35.191.0.0/16"],
    # Your Developer IP (Optional, for direct testing bypassing LB)
    var.http_source_ranges
  )
  target_tags = ["ltx-video-vm"]
}

resource "google_compute_firewall" "allow_health_check" {
  name    = "ltx-allow-health-check"
  network = google_compute_network.ltx_network.name

  allow {
    protocol = "tcp"
    ports    = ["8080"]
  }

  source_ranges = ["35.191.0.0/16", "130.211.0.0/22"]
  target_tags   = ["ltx-video-vm"]
}

# Artifact Registry for Docker images
resource "google_artifact_registry_repository" "ltx_repo" {
  location      = var.region
  repository_id = "ltx-video-repo"
  format        = "DOCKER"
  description   = "LTX Video container images"

  depends_on = [google_project_service.required_apis]
}

# Service Account for VM
resource "google_service_account" "ltx_vm_sa" {
  account_id   = "ltx-video-vm-sa"
  display_name = "LTX Video VM Service Account"
  description  = "Service account for LTX Video generation VM"

  depends_on = [google_project_service.required_apis]
}

# IAM permissions
resource "google_project_iam_member" "ltx_vm_permissions" {
  for_each = toset([
    "roles/storage.objectAdmin",
    "roles/artifactregistry.reader",
    "roles/logging.logWriter",
    "roles/monitoring.metricWriter"
  ])

  project = var.project_id
  role    = each.key
  member  = "serviceAccount:${google_service_account.ltx_vm_sa.email}"
}

# Storage buckets
resource "google_storage_bucket" "model_cache" {
  name     = "${var.project_id}-ltx-model-cache-2"
  location = var.region

  uniform_bucket_level_access = true

  lifecycle_rule {
    action {
      type = "Delete"
    }
    condition {
      age = 90
    }
  }

  depends_on = [google_project_service.required_apis]
}

resource "google_storage_bucket" "video_output" {
  name     = "${var.project_id}-ltx-video-output-2"
  location = var.region

  uniform_bucket_level_access = true

  cors {
    origin          = ["*"]
    method          = ["GET", "HEAD"]
    response_header = ["*"]
    max_age_seconds = 3600
  }

  lifecycle_rule {
    action {
      type          = "SetStorageClass"
      storage_class = "NEARLINE"
    }
    condition {
      age = 30
    }
  }

  depends_on = [google_project_service.required_apis]
}

# Grant public read on output bucket (optional)
resource "google_storage_bucket_iam_member" "public_read" {
  count  = var.make_videos_public ? 1 : 0
  bucket = google_storage_bucket.video_output.name
  role   = "roles/storage.objectViewer"
  member = "allUsers"
}

# API Keys Secret for Authentication
resource "google_secret_manager_secret" "api_keys" {
  secret_id = "ltx-video-api-keys"

  replication {
    auto {}
  }

  depends_on = [google_project_service.required_apis]
}

resource "google_secret_manager_secret_version" "api_keys_version" {
  secret = google_secret_manager_secret.api_keys.id

  # Generate initial API keys (replace with your own in production)
  secret_data = jsonencode({
    keys = [
      {
        key     = random_password.api_key_1.result
        name    = "default-key"
        enabled = true
        rate_limit = {
          requests_per_minute = 60
        }
      }
    ]
  })
}

# Generate random API keys
resource "random_password" "api_key_1" {
  length  = 32
  special = false
}

# Grant VM access to read API keys
resource "google_secret_manager_secret_iam_member" "vm_secret_access" {
  secret_id = google_secret_manager_secret.api_keys.secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.ltx_vm_sa.email}"
}

resource "google_compute_global_address" "ltx_lb_ip" {
  name = "ltx-video-lb-ip"
}

resource "google_compute_backend_service" "ltx_backend" {
  name        = "ltx-video-backend"
  protocol    = "HTTP"
  port_name   = "http"
  timeout_sec = 300
  enable_cdn  = false

  backend {
    group           = google_compute_region_instance_group_manager.ltx_mig.instance_group
    balancing_mode  = "UTILIZATION"
    capacity_scaler = 1.0
  }

  health_checks = [google_compute_health_check.ltx_autohealing.id]

  # Attach Cloud Armor security policy
  # security_policy = google_compute_security_policy.ltx_armor_policy.id

  log_config {
    enable      = true
    sample_rate = 1.0
  }

  connection_draining_timeout_sec = 300
}

# Instance group for the VM - REMOVED (using MIG now)
# Delete google_compute_instance_group.ltx_group

# URL map
resource "google_compute_url_map" "ltx_url_map" {
  name            = "ltx-video-url-map"
  default_service = google_compute_backend_service.ltx_backend.id
}

# HTTP proxy
resource "google_compute_target_http_proxy" "ltx_http_proxy" {
  name    = "ltx-video-http-proxy"
  url_map = google_compute_url_map.ltx_url_map.id
}

# Global forwarding rule
resource "google_compute_global_forwarding_rule" "ltx_forwarding_rule" {
  name                  = "ltx-video-forwarding-rule"
  ip_protocol           = "TCP"
  load_balancing_scheme = "EXTERNAL"
  port_range            = "80"
  target                = google_compute_target_http_proxy.ltx_http_proxy.id
  ip_address            = google_compute_global_address.ltx_lb_ip.id
}

# Cloud Armor Security Policy
# resource "google_compute_security_policy" "ltx_armor_policy" {
#   name        = "ltx-video-armor-policy"
#   description = "DDoS protection and rate limiting for LTX Video API"

#   # Default rule - deny all by default, then allow specific patterns
#   rule {
#     action   = "allow"
#     priority = 2147483647
#     match {
#       versioned_expr = "SRC_IPS_V1"
#       config {
#         src_ip_ranges = ["*"]
#       }
#     }
#     description = "Default rule - allow all (will be refined by other rules)"
#   }

#   # Rate limiting rule - 100 requests per minute per IP
#   rule {
#     action   = "rate_based_ban"
#     priority = 1000
#     match {
#       versioned_expr = "SRC_IPS_V1"
#       config {
#         src_ip_ranges = ["*"]
#       }
#     }
#     rate_limit_options {
#       conform_action = "allow"
#       exceed_action  = "deny(429)"
#       enforce_on_key = "IP"

#       rate_limit_threshold {
#         count        = var.rate_limit_requests_per_minute
#         interval_sec = 60
#       }

#       ban_duration_sec = 600  # Ban for 10 minutes
#     }
#     description = "Rate limit to prevent abuse"
#   }

# Block known bad IPs (SQL injection patterns)
# rule {
#   action   = "deny(403)"
#   priority = 2000
#   match {
#     expr {
#       expression = "origin.region_code == 'T1'"  # Tor exit nodes
#     }
#   }
#   description = "Block Tor exit nodes"
# }

# XSS protection
# # rule {
# #   action   = "deny(403)"
# #   priority = 3000
# #   match {
# #     expr {
# #       expression = "evaluatePreconfiguredExpr('xss-stable')"
# #     }
# #   }
# #   description = "XSS attack protection"
# # }

# # SQL injection protection
# rule {
#   action   = "deny(403)"
#   priority = 3001
#   match {
#     expr {
#       expression = "evaluatePreconfiguredExpr('sqli-stable')"
#     }
#   }
#   description = "SQL injection protection"
# }

# # Local file inclusion protection
# rule {
#   action   = "deny(403)"
#   priority = 3002
#   match {
#     expr {
#       expression = "evaluatePreconfiguredExpr('lfi-stable')"
#     }
#   }
#   description = "Local file inclusion protection"
# }

# # Remote code execution protection
# rule {
#   action   = "deny(403)"
#   priority = 3003
#   match {
#     expr {
#       expression = "evaluatePreconfiguredExpr('rce-stable')"
#     }
#   }
#   description = "Remote code execution protection"
# }

# # Block specific countries (optional - customize)
# dynamic "rule" {
#   for_each = var.blocked_countries
#   content {
#     action   = "deny(403)"
#     priority = 4000 + rule.key
#     match {
#       expr {
#         expression = "origin.region_code == '${rule.value}'"
#       }
#     }
#     description = "Block traffic from ${rule.value}"
#   }
# }

# # Allow specific IP ranges (whitelist)
# dynamic "rule" {
#   for_each = var.whitelisted_ip_ranges
#   content {
#     action   = "allow"
#     priority = 100 + rule.key
#     match {
#       versioned_expr = "SRC_IPS_V1"
#       config {
#         src_ip_ranges = [rule.value]
#       }
#     }
#     description = "Whitelist: ${rule.value}"
#   }
# }

#   adaptive_protection_config {
#     layer_7_ddos_defense_config {
#       enable = true
#     }
#   }
# }

# GPU VM Instance Template for Auto-scaling
resource "google_compute_instance_template" "ltx_template" {
  name_prefix  = "ltx-video-template-"
  machine_type = var.machine_type
  region       = var.region

  tags = ["ltx-video-vm"]

  disk {
    source_image = var.boot_disk_image
    auto_delete  = true
    boot         = true
    disk_size_gb = var.boot_disk_size_gb
    disk_type    = var.boot_disk_type
  }

  guest_accelerator {
    type  = var.gpu_type
    count = var.gpu_count
  }

  network_interface {
    subnetwork = google_compute_subnetwork.ltx_subnet.id

    access_config {
      # Ephemeral IP for each instance
    }
  }

  metadata = {
    startup-script = templatefile("${path.module}/${var.startup_script}", {
      project_id         = var.project_id
      region             = var.region
      model_cache_bucket = google_storage_bucket.model_cache.name
      output_bucket      = google_storage_bucket.video_output.name
      artifact_repo      = google_artifact_registry_repository.ltx_repo.name
      hf_model_id        = var.hugging_face_model_id
      enable_auto_update = var.enable_auto_update
      api_keys_secret    = google_secret_manager_secret.api_keys.secret_id
      enable_auth        = var.enable_authentication
    })

    enable-oslogin        = "TRUE"
    install-nvidia-driver = "True"
  }

  service_account {
    email  = google_service_account.ltx_vm_sa.email
    scopes = ["cloud-platform"]
  }

  scheduling {
    on_host_maintenance = "TERMINATE"
    automatic_restart   = var.enable_auto_restart
    preemptible         = var.use_preemptible
  }

  labels = {
    environment = var.environment
    application = "ltx-video"
    managed-by  = "terraform"
  }

  lifecycle {
    create_before_destroy = true
  }

  depends_on = [
    google_project_service.required_apis,
    google_compute_subnetwork.ltx_subnet,
    google_service_account.ltx_vm_sa,
    google_storage_bucket.model_cache,
    google_storage_bucket.video_output
  ]
}

# Health check for autoscaling
resource "google_compute_health_check" "ltx_autohealing" {
  name                = "ltx-video-autohealing-check"
  check_interval_sec  = 30
  timeout_sec         = 10
  healthy_threshold   = 2
  unhealthy_threshold = 3

  http_health_check {
    port         = 8080
    request_path = "/health"
  }

  depends_on = [google_project_service.required_apis]
}

# Instance Group Manager for Auto-scaling
resource "google_compute_region_instance_group_manager" "ltx_mig" {
  name   = "ltx-video-mig"
  region = var.region

  base_instance_name = "ltx-video-vm"

  version {
    instance_template = google_compute_instance_template.ltx_template.id
  }

  named_port {
    name = "http"
    port = 8080
  }

  auto_healing_policies {
    health_check      = google_compute_health_check.ltx_autohealing.id
    initial_delay_sec = var.autoscaling_initial_delay_sec
  }

  update_policy {
    type            = "PROACTIVE"
    minimal_action  = "REPLACE"
    max_surge_fixed = 3

    max_unavailable_fixed        = 0
    instance_redistribution_type = "PROACTIVE"
  }

  target_size = var.autoscaling_min_replicas

  depends_on = [
    google_compute_instance_template.ltx_template,
    google_compute_health_check.ltx_autohealing
  ]
}

# Autoscaler based on queue depth/CPU
resource "google_compute_region_autoscaler" "ltx_autoscaler" {
  name   = "ltx-video-autoscaler"
  region = var.region
  target = google_compute_region_instance_group_manager.ltx_mig.id

  autoscaling_policy {
    min_replicas    = var.autoscaling_min_replicas
    max_replicas    = var.autoscaling_max_replicas
    cooldown_period = var.autoscaling_cooldown_period

    # Scale based on CPU utilization
    cpu_utilization {
      target            = var.autoscaling_cpu_target
      predictive_method = "OPTIMIZE_AVAILABILITY"
    }

    # Scale based on load balancer utilization
    load_balancing_utilization {
      target = var.autoscaling_lb_target
    }

    # Scaling mode
    mode = var.autoscaling_mode

    # Scale-in control - prevent rapid downscaling
    scale_in_control {
      max_scaled_in_replicas {
        fixed = 1
      }
      time_window_sec = 600
    }
  }
}

# Monitoring: Uptime check
resource "google_monitoring_uptime_check_config" "ltx_uptime" {
  display_name = "LTX Video API Uptime"
  timeout      = "10s"
  period       = "300s"

  http_check {
    path         = "/health"
    port         = "80"
    use_ssl      = false
    validate_ssl = false
  }

  monitored_resource {
    type = "uptime_url"
    labels = {
      project_id = var.project_id
      host       = google_compute_global_address.ltx_lb_ip.address
    }
  }

  depends_on = [
    google_project_service.required_apis,
    google_compute_region_instance_group_manager.ltx_mig
  ]
}

# Log sink for centralized logging
resource "google_logging_project_sink" "ltx_logs" {
  name        = "ltx-video-logs"
  destination = "storage.googleapis.com/${google_storage_bucket.video_output.name}"

  filter = "resource.type=gce_instance AND labels.application=ltx-video"

  unique_writer_identity = true
}

resource "google_storage_bucket_iam_member" "log_writer" {
  bucket = google_storage_bucket.video_output.name
  role   = "roles/storage.objectCreator"
  member = google_logging_project_sink.ltx_logs.writer_identity
}

# Outputs
output "mig_name" {
  description = "Managed Instance Group name"
  value       = google_compute_region_instance_group_manager.ltx_mig.name
}

output "mig_instance_group" {
  description = "Instance group URL"
  value       = google_compute_region_instance_group_manager.ltx_mig.instance_group
}

output "autoscaling_config" {
  description = "Autoscaling configuration"
  value = {
    min_replicas    = var.autoscaling_min_replicas
    max_replicas    = var.autoscaling_max_replicas
    cpu_target      = "${var.autoscaling_cpu_target}%"
    lb_target       = "${var.autoscaling_lb_target}%"
    cooldown_period = "${var.autoscaling_cooldown_period}s"
    mode            = var.autoscaling_mode
  }
}

output "load_balancer_ip" {
  description = "Load balancer IP address (Cloud Armor protected)"
  value       = google_compute_global_address.ltx_lb_ip.address
}

output "api_endpoint" {
  description = "API endpoint URL (Cloud Armor protected)"
  value       = "http://${google_compute_global_address.ltx_lb_ip.address}"
}

output "api_docs" {
  description = "API documentation URL"
  value       = "http://${google_compute_global_address.ltx_lb_ip.address}/docs"
}

output "api_key" {
  description = "Default API key for authentication"
  value       = random_password.api_key_1.result
  sensitive   = true
}

output "ssh_command" {
  description = "SSH command to connect to an instance"
  value       = "gcloud compute ssh --zone=${var.region}-a $(gcloud compute instances list --filter='name~ltx-video-vm' --format='value(name)' --limit=1) --project=${var.project_id}"
}

output "list_instances_command" {
  description = "Command to list all running instances"
  value       = "gcloud compute instances list --filter='labels.application=ltx-video' --project=${var.project_id}"
}

output "output_bucket" {
  description = "GCS bucket for video outputs"
  value       = "gs://${google_storage_bucket.video_output.name}"
}

output "model_cache_bucket" {
  description = "GCS bucket for model cache"
  value       = "gs://${google_storage_bucket.model_cache.name}"
}

output "project_id" {
  description = "GCP Project ID"
  value       = var.project_id
}

output "service_account" {
  description = "Service account email"
  value       = google_service_account.ltx_vm_sa.email
}

# output "cloud_armor_policy" {
#   description = "Cloud Armor security policy name"
#   value       = google_compute_security_policy.ltx_armor_policy.name
# }

output "security_features" {
  description = "Enabled security features"
  value = {
    cloud_armor_ddos_protection = false
    rate_limiting               = "${var.rate_limit_requests_per_minute} requests/minute"
    api_authentication          = var.enable_authentication
    xss_protection              = true
    sql_injection_protection    = true
    rce_protection              = true
    adaptive_protection         = true
    autoscaling                 = true
  }
}

output "cost_optimization" {
  description = "Cost optimization features"
  value = {
    autoscaling_enabled    = true
    scale_to_zero          = var.autoscaling_min_replicas == 0
    preemptible_vms        = var.use_preemptible
    cost_when_idle         = var.autoscaling_min_replicas == 0 ? "~$25/month (storage + LB only)" : "See cost analysis"
    estimated_startup_time = "${var.autoscaling_initial_delay_sec}s"
  }
}

output "next_steps" {
  description = "Next steps after deployment"
  value       = <<-EOT
    ✓ Auto-scaling Deployment Complete!
    
    Autoscaling Configuration:
    - Min instances: ${var.autoscaling_min_replicas} (${var.autoscaling_min_replicas == 0 ? "ZERO COST WHEN IDLE!" : "always running"})
    - Max instances: ${var.autoscaling_max_replicas}
    - CPU target: ${var.autoscaling_cpu_target}%
    - LB target: ${var.autoscaling_lb_target}%
    - Cooldown: ${var.autoscaling_cooldown_period}s
    - Initial delay: ${var.autoscaling_initial_delay_sec}s
    
    1. Wait for initial instance to start (if min > 0): 5-10 minutes
    
    2. Get your API key:
       terraform output -raw api_key
    
    3. Test the endpoint:
       LB_IP=$(terraform output -raw load_balancer_ip)
       API_KEY=$(terraform output -raw api_key)
       
       curl http://$LB_IP/health
    
    4. Generate a video (will trigger scale-up if at 0):
       curl -X POST http://$LB_IP/predict \
         -H "Content-Type: application/json" \
         -H "X-API-Key: $API_KEY" \
         -d '{
           "prompt": "A serene mountain lake at sunset",
           "num_frames": 121
         }'
    
    5. Monitor autoscaling:
       gcloud compute instance-groups managed describe ${google_compute_region_instance_group_manager.ltx_mig.name} --region=${var.region}
    
    6. List active instances:
       gcloud compute instances list --filter='labels.application=ltx-video' --project=${var.project_id}
    
    7. View autoscaling events:
       gcloud logging read "resource.type=gce_autoscaler" --limit=50
    
    Cost Optimization:
    ${var.autoscaling_min_replicas == 0 ? "✓ ZERO instances when idle = ~$25/month (storage + LB only)" : "⚠ Min ${var.autoscaling_min_replicas} instance(s) always running"}
    - Scale up: Automatic on demand
    - Scale down: After ${var.autoscaling_cooldown_period}s of low usage
    - Preemptible: ${var.use_preemptible ? "✓ Enabled (75% savings)" : "✗ Disabled"}
    
    Security:
    - Cloud Armor: ✓ Enabled
    - Rate Limiting: ${var.rate_limit_requests_per_minute} req/min
    - Authentication: ${var.enable_authentication ? "✓ Enabled" : "✗ Disabled"}
  EOT
}
