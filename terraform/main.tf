terraform {
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 5.0"
    }
  }
}

provider "google" {
  project = var.project_id
  region  = var.region
}

variable "project_id" {
  description = "GCP Project ID"
  type        = string
}

variable "region" {
  description = "GCP Region"
  type        = string
  default     = "us-central1"
}

variable "model_id" {
  description = "Vertex AI Model ID for video generation"
  type        = string
  default     = "imagegeneration@006" # Can be adapted for video models
}

variable "enable_spot_vm" {
  description = "Use preemptible/spot VM for cost savings"
  type        = bool
  default     = true
}

variable "enable_cloud_run" {
  description = "Deploy Cloud Run API gateway (set false to use Vertex AI directly)"
  type        = bool
  default     = true
}

# Enable required APIs
resource "google_project_service" "required_apis" {
  for_each = toset([
    "aiplatform.googleapis.com",
    "storage.googleapis.com",
    "compute.googleapis.com",
    "run.googleapis.com",
    "cloudbuild.googleapis.com",
    "artifactregistry.googleapis.com"
  ])
  
  service            = each.key
  disable_on_destroy = false
}

# Artifact Registry for container images
resource "google_artifact_registry_repository" "video_gen_repo" {
  location      = var.region
  repository_id = "video-gen-repo"
  format        = "DOCKER"
  
  depends_on = [google_project_service.required_apis]
}

# Storage Buckets
resource "google_storage_bucket" "model_artifacts" {
  name     = "${var.project_id}-video-gen-models"
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
  name     = "${var.project_id}-video-gen-output"
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

# Service Account for Vertex AI
resource "google_service_account" "vertex_ai_sa" {
  account_id   = "vertex-ai-video-gen"
  display_name = "Vertex AI Video Generation Service Account"
  
  depends_on = [google_project_service.required_apis]
}

resource "google_project_iam_member" "vertex_ai_permissions" {
  for_each = toset([
    "roles/aiplatform.user",
    "roles/storage.objectAdmin",
    "roles/artifactregistry.reader"
  ])
  
  project = var.project_id
  role    = each.key
  member  = "serviceAccount:${google_service_account.vertex_ai_sa.email}"
}

# Cloud Run service for API Gateway
# Optional: Set enable_cloud_run=false to skip and use Vertex AI directly
resource "google_cloud_run_service" "video_gen_api" {
  count    = var.enable_cloud_run ? 1 : 0
  name     = "video-gen-api"
  location = var.region

  template {
    spec {
      service_account_name = google_service_account.vertex_ai_sa.email
      
      containers {
        image = "${var.region}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.video_gen_repo.repository_id}/video-gen-api:latest"
        
        ports {
          container_port = 8080
        }
        
        env {
          name  = "PROJECT_ID"
          value = var.project_id
        }
        
        env {
          name  = "REGION"
          value = var.region
        }
        
        env {
          name  = "OUTPUT_BUCKET"
          value = google_storage_bucket.video_output.name
        }
        
        env {
          name  = "MODEL_BUCKET"
          value = google_storage_bucket.model_artifacts.name
        }
        
        env {
          name  = "VERTEX_ENDPOINT"
          value = google_vertex_ai_endpoint.video_gen_endpoint.name
        }
        
        resources {
          limits = {
            cpu    = "2"
            memory = "4Gi"
          }
        }
      }
      
      timeout_seconds = 300
    }
    
    metadata {
      annotations = {
        "autoscaling.knative.dev/maxScale" = "10"
        "autoscaling.knative.dev/minScale" = "0"
      }
    }
  }
  
  traffic {
    percent         = 100
    latest_revision = true
  }
  
  depends_on = [
    google_project_service.required_apis,
    google_artifact_registry_repository.video_gen_repo
  ]
  
  lifecycle {
    ignore_changes = [
      template[0].spec[0].containers[0].image
    ]
  }
}

# IAM for Cloud Run
resource "google_cloud_run_service_iam_member" "public_access" {
  count    = var.enable_cloud_run ? 1 : 0
  service  = google_cloud_run_service.video_gen_api[0].name
  location = google_cloud_run_service.video_gen_api[0].location
  role     = "roles/run.invoker"
  member   = "allUsers"
}

# Vertex AI Model Registry
resource "google_vertex_ai_endpoint" "video_gen_endpoint" {
  name         = "video-gen-endpoint"
  display_name = "Video Generation Endpoint"
  location     = var.region
  region       = var.region
  
  depends_on = [google_project_service.required_apis]
}

# Cost-effective GPU VM for batch processing (optional)
resource "google_compute_instance" "batch_processor" {
  count        = var.enable_spot_vm ? 1 : 0
  name         = "video-gen-batch-processor"
  machine_type = "n1-standard-4"
  zone         = "${var.region}-a"

  tags = ["video-gen-batch"]

  boot_disk {
    initialize_params {
      image = "deeplearning-platform-release/pytorch-latest-gpu"
      size  = 100
      type  = "pd-standard"
    }
  }

  guest_accelerator {
    type  = "nvidia-tesla-t4"
    count = 1
  }

  network_interface {
    network = "default"
    
    access_config {
      # Ephemeral IP
    }
  }

  scheduling {
    preemptible                 = true
    automatic_restart           = false
    on_host_maintenance         = "TERMINATE"
    provisioning_model          = "SPOT"
    instance_termination_action = "STOP"
  }

  service_account {
    email  = google_service_account.vertex_ai_sa.email
    scopes = ["cloud-platform"]
  }

  metadata = {
    install-nvidia-driver = "True"
    startup-script = <<-EOF
      #!/bin/bash
      set -e
      
      until nvidia-smi; do sleep 10; done
      
      apt-get update
      apt-get install -y git python3-pip ffmpeg
      
      pip3 install --upgrade pip
      pip3 install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu118
      pip3 install diffusers transformers accelerate xformers google-cloud-storage
      pip3 install opencv-python pillow imageio[ffmpeg]
      
      # Create batch processing script
      mkdir -p /opt/video-gen
      cat > /opt/video-gen/batch_process.py << 'PYEOF'
import os
from google.cloud import storage
import torch
from diffusers import DiffusionPipeline

PROJECT_ID = "${var.project_id}"
OUTPUT_BUCKET = "${var.project_id}-video-gen-output"

def process_video_generation():
    print("Initializing video generation pipeline...")
    
    if not torch.cuda.is_available():
        print("WARNING: GPU not available, using CPU")
    
    # Initialize storage client
    storage_client = storage.Client()
    bucket = storage_client.bucket(OUTPUT_BUCKET)
    
    # Add your video generation model here
    # Example: Using Zeroscope or ModelScope
    # pipe = DiffusionPipeline.from_pretrained(
    #     "cerspense/zeroscope_v2_576w",
    #     torch_dtype=torch.float16
    # )
    # pipe.to("cuda" if torch.cuda.is_available() else "cpu")
    
    print("Batch processor ready for video generation tasks")

if __name__ == "__main__":
    process_video_generation()
PYEOF
      
      python3 /opt/video-gen/batch_process.py
    EOF
  }

  allow_stopping_for_update = true
  
  depends_on = [google_project_service.required_apis]
}

# Cloud Function for serverless inference triggers
resource "google_storage_bucket" "function_source" {
  name     = "${var.project_id}-function-source"
  location = var.region
  
  uniform_bucket_level_access = true
  
  depends_on = [google_project_service.required_apis]
}

# Create Cloud Build trigger for API container
resource "google_cloudbuild_trigger" "api_build" {
  name     = "video-gen-api-build"
  location = var.region

  github {
    owner = "your-github-org"
    name  = "your-repo"
    push {
      branch = "^main$"
    }
  }

  build {
    step {
      name = "gcr.io/cloud-builders/docker"
      args = [
        "build",
        "-t",
        "${var.region}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.video_gen_repo.repository_id}/video-gen-api:$SHORT_SHA",
        "-f",
        "Dockerfile",
        "."
      ]
    }

    step {
      name = "gcr.io/cloud-builders/docker"
      args = [
        "push",
        "${var.region}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.video_gen_repo.repository_id}/video-gen-api:$SHORT_SHA"
      ]
    }

    step {
      name = "gcr.io/google.com/cloudsdktool/cloud-sdk"
      entrypoint = "gcloud"
      args = [
        "run",
        "deploy",
        "video-gen-api",
        "--image=${var.region}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.video_gen_repo.repository_id}/video-gen-api:$SHORT_SHA",
        "--region=${var.region}",
        "--platform=managed"
      ]
    }

    images = [
      "${var.region}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.video_gen_repo.repository_id}/video-gen-api:$SHORT_SHA"
    ]
  }
  
  depends_on = [
    google_project_service.required_apis,
    google_artifact_registry_repository.video_gen_repo
  ]
}

# Outputs
output "cloud_run_url" {
  description = "Cloud Run service URL (if enabled)"
  value       = var.enable_cloud_run ? google_cloud_run_service.video_gen_api[0].status[0].url : "Cloud Run disabled - use Vertex AI directly"
}

output "vertex_ai_endpoint" {
  description = "Vertex AI endpoint name"
  value       = google_vertex_ai_endpoint.video_gen_endpoint.name
}

output "output_bucket" {
  description = "Storage bucket for video outputs"
  value       = google_storage_bucket.video_output.url
}

output "model_bucket" {
  description = "Storage bucket for model artifacts"
  value       = google_storage_bucket.model_artifacts.url
}

output "spot_vm_name" {
  description = "Spot VM instance name (if enabled)"
  value       = var.enable_spot_vm ? google_compute_instance.batch_processor[0].name : "Not enabled"
}

output "artifact_registry" {
  description = "Artifact registry repository"
  value       = google_artifact_registry_repository.video_gen_repo.name
}

output "cost_optimization_notes" {
  description = "Cost optimization features enabled"
  value = {
    cloud_run_autoscaling = "0-10 instances (pay per request)"
    spot_vm              = var.enable_spot_vm ? "Enabled (60-91% cost savings)" : "Disabled"
    storage_lifecycle    = "Auto-archive to Nearline after 30 days"
    vertex_ai_endpoints  = "Pay-per-prediction model"
  }
}