# GCP Configuration
project_id  = "neural-land-481705-s6"
region      = "us-central1"
zone        = "us-central1-a"
environment = "production"

github_owner  = "digitalcreationsco"
github_repo   = "cinematic-canvas"
github_branch = "main"

# Image tag (use 'latest' or specific SHA)
image_tag = "latest"

# VM Configuration
vm_name      = "ltx-video-vm"
machine_type = "n1-standard-8" # 8 vCPUs, 30 GB RAM

# GPU Configuration
gpu_type  = "nvidia-tesla-t4" # Options: nvidia-tesla-t4, nvidia-l4, nvidia-tesla-v100, nvidia-a100-80gb
gpu_count = 0

# Startup Script (CPU Mock)
startup_script = "../models/ltx/startup-cpu.sh"

# Disk Configuration
boot_disk_image   = "deeplearning-platform-release/common-cu128-ubuntu-2204-nvidia-570"
boot_disk_size_gb = 200
boot_disk_type    = "pd-ssd"

# Cost Optimization
use_preemptible     = false # Set to true for 60-91% cost savings (but VM can be terminated)
enable_auto_restart = true

# Security - IMPORTANT: Restrict these for production!
ssh_source_ranges  = ["98.237.75.240/32"] # local ip address
http_source_ranges = ["98.237.75.240/32"] # local ip address

# Model Configuration
hugging_face_model_id = "Lightricks/LTX-Video"

# Storage
make_videos_public = true # Set to false for private videos

# Automation
enable_auto_update = true

# Security & Authentication
enable_authentication = true # Enable API key authentication

# Cloud Armor Rate Limiting
rate_limit_requests_per_minute = 100 # Requests per IP per minute

# Block specific countries (optional)
blocked_countries = [] # Example: ["CN", "RU", "KP"]

# Whitelist specific IPs (bypass all Cloud Armor rules)
whitelisted_ip_ranges = ["98.237.75.240/32"] # Example: ["YOUR_OFFICE_IP/32"]

# Autoscaling Configuration (ZERO COST WHEN IDLE!)
autoscaling_min_replicas      = 1     # Set to 1 for immediate testing
autoscaling_max_replicas      = 5     # Maximum concurrent instances
autoscaling_cpu_target        = 0.7   # Scale up when CPU > 70%
autoscaling_lb_target         = 0.8   # Scale up when LB utilization > 80%
autoscaling_cooldown_period   = 300   # Wait 5 minutes before scaling down
autoscaling_initial_delay_sec = 300   # Wait 5 minutes for CPU mock startup
autoscaling_mode              = "OFF" # ON, OFF, or ONLY_SCALE_OUT
