# variables.tf - Terraform Variables for Compute Engine Deployment

variable "project_id" {
  description = "GCP Project ID"
  type        = string
}

variable "region" {
  description = "GCP Region"
  type        = string
  default     = "us-east1"
}

variable "zone" {
  description = "GCP Zone for VM"
  type        = string
  default     = "us-east1-a"
}

variable "environment" {
  description = "Environment name (dev, staging, prod)"
  type        = string
  default     = "production"
}

# VM Configuration
variable "vm_name" {
  description = "Name of the VM instance"
  type        = string
  default     = "ltx-video-vm"
}

variable "machine_type" {
  description = "Machine type for the VM"
  type        = string
  default     = "n1-standard-8"

  validation {
    condition     = can(regex("^(n1-standard|n1-highmem|a2-highgpu)", var.machine_type))
    error_message = "Machine type must be compatible with GPU attachments."
  }
}

variable "gpu_type" {
  description = "GPU type to attach"
  type        = string
  default     = "nvidia-tesla-t4"

  validation {
    condition = contains([
      "nvidia-tesla-t4",
      "nvidia-tesla-v100",
      "nvidia-tesla-p4",
      "nvidia-tesla-p100",
      "nvidia-tesla-k80",
      "nvidia-l4",
      "nvidia-a100-80gb"
    ], var.gpu_type)
    error_message = "Must be a valid NVIDIA GPU type."
  }
}

variable "gpu_count" {
  description = "Number of GPUs to attach"
  type        = number
  default     = 1

  validation {
    condition     = var.gpu_count >= 1 && var.gpu_count <= 8
    error_message = "GPU count must be between 1 and 8."
  }
}

variable "boot_disk_image" {
  description = "Boot disk image (Deep Learning VM recommended)"
  type        = string
  default     = "common-cu128-ubuntu-2204-nvidia-570"
}

variable "boot_disk_size_gb" {
  description = "Boot disk size in GB"
  type        = number
  default     = 200

  validation {
    condition     = var.boot_disk_size_gb >= 100 && var.boot_disk_size_gb <= 1000
    error_message = "Boot disk size must be between 100 and 1000 GB."
  }
}

variable "boot_disk_type" {
  description = "Boot disk type"
  type        = string
  default     = "pd-ssd"

  validation {
    condition     = contains(["pd-standard", "pd-ssd", "pd-balanced"], var.boot_disk_type)
    error_message = "Boot disk type must be pd-standard, pd-ssd, or pd-balanced."
  }
}

# Scheduling
variable "use_preemptible" {
  description = "Use preemptible VM (60-91% cheaper but can be terminated)"
  type        = bool
  default     = false
}

variable "enable_auto_restart" {
  description = "Enable automatic restart on failure"
  type        = bool
  default     = true
}

# Network
variable "ssh_source_ranges" {
  description = "CIDR ranges allowed for SSH access"
  type        = list(string)
  default     = ["0.0.0.0/0"] # Change to your IP for better security
}

variable "http_source_ranges" {
  description = "CIDR ranges allowed for HTTP/API access"
  type        = list(string)
  default     = ["0.0.0.0/0"]
}

# Model Configuration
variable "hugging_face_model_id" {
  description = "Hugging Face model ID for LTX Video"
  type        = string
  default     = "Lightricks/LTX-Video"
}

# Storage
variable "make_videos_public" {
  description = "Make generated videos publicly accessible"
  type        = bool
  default     = true
}

# Automation
variable "enable_auto_update" {
  description = "Enable automatic updates of system packages"
  type        = bool
  default     = true
}

# Security
variable "enable_authentication" {
  description = "Enable API key authentication"
  type        = bool
  default     = true
}

variable "rate_limit_requests_per_minute" {
  description = "Rate limit for Cloud Armor (requests per minute per IP)"
  type        = number
  default     = 100

  validation {
    condition     = var.rate_limit_requests_per_minute >= 10 && var.rate_limit_requests_per_minute <= 10000
    error_message = "Rate limit must be between 10 and 10000 requests per minute."
  }
}

variable "blocked_countries" {
  description = "List of country codes to block (ISO 3166-1 alpha-2)"
  type        = list(string)
  default     = [] # Example: ["CN", "RU", "KP"]
}

variable "whitelisted_ip_ranges" {
  description = "IP ranges to whitelist (bypass all Cloud Armor rules)"
  type        = list(string)
  default     = [] # Example: ["YOUR_OFFICE_IP/32"]
}

variable "github_owner" {
  description = "GitHub repository owner/organization"
  type        = string
}

variable "github_repo" {
  description = "GitHub repository name"
  type        = string
}

variable "github_branch" {
  description = "GitHub branch to trigger builds from"
  type        = string
  default     = "main"
}

variable "autoscaling_min_replicas" {
  description = "Minimum number of endpoint replicas"
  type        = number
  default     = 0

  validation {
    condition     = var.autoscaling_min_replicas >= 0
    error_message = "Minimum replicas must be 0 or greater."
  }
}

variable "autoscaling_max_replicas" {
  description = "Maximum number of endpoint replicas"
  type        = number
  default     = 1

  validation {
    condition     = var.autoscaling_max_replicas >= 1 && var.autoscaling_max_replicas <= 10
    error_message = "Maximum replicas must be between 1 and 10."
  }
}

variable "autoscaling_cpu_target" {
  description = "CPU Scale up target"
  type        = number
  default     = 70
}

variable "autoscaling_lb_target" {
  description = "Load Balance Utilization Scale up target"
  type        = number
  default     = 0.8
}

variable "autoscaling_cooldown_period" {
  description = "Wait period before scaling down"
  type        = number
  default     = 300
}

variable "autoscaling_initial_delay_sec" {
  description = "Wait period before health checks"
  type        = number
  default     = 1800
}

variable "autoscaling_mode" {
  description = "ON, OFF, or ONLY_SCALE_OUT"
  type        = string
  default     = "ON"
}

variable "image_tag" {
  description = "Docker image tag to deploy"
  type        = string
  default     = "latest"
}

variable "startup_script" {
  description = "Path to the startup script (relative to module)"
  type        = string
  default     = "../models/ltx/startup.sh"
}
