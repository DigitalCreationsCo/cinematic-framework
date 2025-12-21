# main.tf - Complete Terraform Configuration

terraform {
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 7.14.0"
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
    "aiplatform.googleapis.com",
    "storage.googleapis.com",
    "compute.googleapis.com",
    "cloudbuild.googleapis.com",
    "artifactregistry.googleapis.com",
    "iam.googleapis.com"
  ])

  service            = each.key
  disable_on_destroy = false
}

# Artifact Registry for container images
resource "google_artifact_registry_repository" "video_gen_repo" {
  location      = var.region
  repository_id = "video-gen-repo"
  format        = "DOCKER"
  description   = "Docker repository for LTX Video serving container"

  depends_on = [google_project_service.required_apis]
}

# Service Account for Vertex AI
resource "google_service_account" "vertex_ai_sa" {
  account_id   = "vertex-ai-video-gen"
  display_name = "Vertex AI Video Generation Service Account"
  description  = "Service account for LTX Video generation endpoint"

  depends_on = [google_project_service.required_apis]
}

# IAM permissions for Vertex AI service account
resource "google_project_iam_member" "vertex_ai_permissions" {
  for_each = toset([
    "roles/aiplatform.user",
    "roles/storage.objectAdmin",
    "roles/artifactregistry.reader",
    "roles/logging.logWriter"
  ])

  project = var.project_id
  role    = each.key
  member  = "serviceAccount:${google_service_account.vertex_ai_sa.email}"
}

# Default storage bucket for video outputs
resource "google_storage_bucket" "video_output" {
  name     = "${var.project_id}-ltx-video-output"
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

# Grant public read access to the output bucket (optional - remove if you want private videos)
resource "google_storage_bucket_iam_member" "public_read" {
  bucket = google_storage_bucket.video_output.name
  role   = "roles/storage.objectViewer"
  member = "allUsers"
}

# Vertex AI Endpoint with Hugging Face Model
resource "google_vertex_ai_endpoint_with_model_garden_deployment" "ltx_endpoint" {
  location = var.region
  hugging_face_model_id = var.hugging_face_model_id

  endpoint_config {
    endpoint_display_name = "LTX Video Generation Endpoint"
  }

  deploy_config {
    dedicated_resources {
      machine_spec {
        machine_type      = var.machine_type
        accelerator_type  = var.accelerator_type
        accelerator_count = var.accelerator_count
      }
      min_replica_count = var.min_replicas
      max_replica_count = var.max_replicas

      # Automatic scaling configuration
      autoscaling_metric_specs {
        metric_name = "aiplatform.googleapis.com/prediction/online/accelerator/duty_cycle"
        target      = 60
      }
    }
    
  }

  model_config {
    model_display_name = "LTX Video 13B FP8"
    
    # Custom container with serving logic
    container_spec {
      image_uri = "${var.region}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.video_gen_repo.repository_id}/ltx-video-serve:${var.image_tag}"

      env {
        name  = "HF_MODEL_ID"
        value = var.hugging_face_model_id
      }
      
      env {
        name  = "DEFAULT_OUTPUT_BUCKET"
        value = google_storage_bucket.video_output.name
      }
      
      env {
        name  = "PROJECT_ID"
        value = var.project_id
      }
      
      env {
        name  = "ENABLE_XFORMERS"
        value = "true"
      }

      ports {
        container_port = 8080
      }

      predict_route = "/predict"
      health_route  = "/health"
      
      # Startup probe for longer model loading times
      startup_probe {
        period_seconds    = 30
        timeout_seconds   = 10
        failure_threshold = 10
        
        http_get {
          path = "/health"
          port = 8080
        }
      }
    }
  }

  depends_on = [
    google_project_service.required_apis,
    google_artifact_registry_repository.video_gen_repo,
    google_storage_bucket.video_output
  ]
}

# Cloud Build trigger for automatic container builds
resource "google_cloudbuild_trigger" "api_build" {
  name        = "ltx-video-serve-build"
  location    = var.region
  description = "Build and deploy LTX Video serving container"

  github {
    owner = var.github_owner
    name  = var.github_repo
    push {
      branch = var.github_branch
    }
  }

  build {
    # Build the Docker image
    step {
      name = "gcr.io/cloud-builders/docker"
      args = [
        "build",
        "-t",
        "${var.region}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.video_gen_repo.repository_id}/ltx-video-serve:latest",
        "-t",
        "${var.region}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.video_gen_repo.repository_id}/ltx-video-serve:$SHORT_SHA",
        "-f",
        "models/ltx/Dockerfile",
        "."
      ]
    }

    # Push both tags
    step {
      name = "gcr.io/cloud-builders/docker"
      args = [
        "push",
        "${var.region}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.video_gen_repo.repository_id}/ltx-video-serve:latest"
      ]
    }

    step {
      name = "gcr.io/cloud-builders/docker"
      args = [
        "push",
        "${var.region}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.video_gen_repo.repository_id}/ltx-video-serve:$SHORT_SHA"
      ]
    }

    images = [
      "${var.region}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.video_gen_repo.repository_id}/ltx-video-serve:latest",
      "${var.region}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.video_gen_repo.repository_id}/ltx-video-serve:$SHORT_SHA"
    ]
    
    timeout = "3600s"
  }

  depends_on = [
    google_project_service.required_apis,
    google_artifact_registry_repository.video_gen_repo
  ]
}

# Monitoring: Log-based metric for tracking predictions
resource "google_logging_metric" "prediction_count" {
  name   = "ltx_video_predictions"
  filter = "resource.type=\"aiplatform.googleapis.com/Endpoint\" AND jsonPayload.endpoint_display_name=\"${google_vertex_ai_endpoint_with_model_garden_deployment.ltx_endpoint.endpoint_config[0].endpoint_display_name}\""
  
  metric_descriptor {
    metric_kind = "DELTA"
    value_type  = "INT64"
    display_name = "LTX Video Prediction Count"
  }
}

# Outputs
output "endpoint_id" {
  description = "Vertex AI endpoint ID"
  value       = google_vertex_ai_endpoint_with_model_garden_deployment.ltx_endpoint.id
}

output "endpoint_display_name" {
  description = "Vertex AI endpoint resource name"
  value       = google_vertex_ai_endpoint_with_model_garden_deployment.ltx_endpoint.endpoint_config[0].endpoint_display_name
}

output "predict_url" {
  description = "Prediction endpoint URL (use with authentication)"
  value       = "https://${var.region}-aiplatform.googleapis.com/v1/${google_vertex_ai_endpoint_with_model_garden_deployment.ltx_endpoint.endpoint}:predict"
}

output "default_output_bucket" {
  description = "Default GCS bucket for video outputs"
  value       = "gs://${google_storage_bucket.video_output.name}"
}

output "artifact_registry_repo" {
  description = "Artifact Registry repository URL"
  value       = "${var.region}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.video_gen_repo.repository_id}"
}

output "service_account_email" {
  description = "Service account email for the endpoint"
  value       = google_service_account.vertex_ai_sa.email
}

output "deployment_instructions" {
  description = "Next steps for deployment"
  value       = <<-EOT
    Deployment Configuration Created!
    
    Next Steps:
    1. Build and push your Docker image:
       cd your-repo
       gcloud builds submit --config=cloudbuild.yaml
    
    2. Wait for endpoint deployment (can take 15-30 minutes)
    
    3. Test the endpoint:
       curl -X POST "https://${var.region}-aiplatform.googleapis.com/v1/${google_vertex_ai_endpoint_with_model_garden_deployment.ltx_endpoint.endpoint}:predict" \
         -H "Authorization: Bearer $(gcloud auth print-access-token)" \
         -H "Content-Type: application/json" \
         -d '{
           "instances": [{
             "prompt": "A serene mountain lake at sunset",
             "num_frames": 121
           }]
         }'
    
    4. Monitor in Cloud Console:
       https://console.cloud.google.com/vertex-ai/endpoints?project=${var.project_id}
  EOT
}