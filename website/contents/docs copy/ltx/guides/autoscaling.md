# LTX Autoscaling Guide

## Quick Start

### Minimal Configuration (Zero Cost Idle)

```hcl
# terraform.tfvars
autoscaling_min_replicas = 0
autoscaling_max_replicas = 5
machine_type = "n1-standard-8"
gpu_type     = "nvidia-tesla-t4"
```

## Scaling Behavior

### Scale-Up
*   **Trigger**: CPU > 70% or Load Balancer > 80%
*   **Speed**: ~6-7 minutes total (VM creation + Driver + Model Load)

### Scale-Down
*   **Trigger**: CPU < 70% for 5 minutes
*   **Speed**: Gradual (1 instance per 10 minutes)

## Cold vs Warm Start
*   **Cold Start (10 mins)**: First deployment. Downloads model from Hugging Face.
*   **Warm Start (6 mins)**: Subsequent starts. Loads model from GCS cache.