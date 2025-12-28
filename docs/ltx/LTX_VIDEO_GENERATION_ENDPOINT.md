# LTX Video Generation on GCP Compute Engine

Production-ready deployment of LTX-Video text-to-video model on Google Cloud Platform using Compute Engine Managed Instance Groups (MIG) with Global Load Balancing and Auto-scaling.

## Features

- 🎥 Text-to-video generation using Lightricks LTX-Video model
- ⚡ **High Performance**: Deployed on G2 instances (NVIDIA L4 GPUs) with local execution
- 🔄 **Auto-scaling**: Automatically scales from 0 to N instances based on load (CPU/Queue)
- 🌐 **Global Access**: Global Load Balancer with Cloud Armor security
- 🔐 **Secure**: API Key authentication and Service Account Identity
- 💰 **Cost Optimized**: Scale-to-zero when idle, optional Preemptible/Spot instances
- 📦 **Flexible Output**: Videos saved to GCS with custom path support

## Architecture

```
User Request (HTTPS) 
      ↓
Global Load Balancer (Cloud Armor)
      ↓
Managed Instance Group (Auto-scaling)
      ↓
Compute Engine VM (NVIDIA L4)
  └─ FastAPI Server (serve.py)
      ↓
LTX-Video Model (GPU)
      ↓
Save to GCS (Output Bucket)
```

## Prerequisites

1. **GCP Project** with billing enabled
2. **gcloud CLI** installed and authenticated
3. **Terraform** v1.0+ installed
4. **Required GCP APIs** (enabled automatically by Terraform):
   - Compute Engine API
   - Cloud Storage API
   - Artifact Registry API
   - Secret Manager API
   - Autoscaling API

## Infrastructure

The solution is defined in `terraform/main.tf` and deploys:

- **VPC Network**: Dedicated network for LTX resources
- **Managed Instance Group (MIG)**: Handles VM lifecycle and auto-scaling
- **Load Balancer**: External HTTP(S) Load Balancer
- **Secret Manager**: Stores API keys securely
- **GCS Buckets**:
  - `*-ltx-model-cache`: Caches model weights to speed up boot times
  - `*-ltx-video-output`: Stores generated videos

## Quick Start

### 1. Configure

Ensure you have the repository cloned and are in the project root.

```bash
cd terraform
cp terraform.tfvars.example terraform.tfvars
# Edit terraform.tfvars with your project_id and region
```

### 2. Deploy

```bash
terraform init
terraform apply
```

This process typically takes:

- Infrastructure creation: ~5 minutes
- Initial VM startup and model download: ~10-15 minutes

### 3. Get Credentials

After deployment, retrieve your API credentials and endpoint:

```bash
# Get the Load Balancer IP
terraform output -raw load_balancer_ip

# Get the API Key
terraform output -raw api_key
```

## API Reference

The service exposes a FastAPI endpoint protected by API Key authentication.

### Endpoint

`POST http://<LB_IP>/predict`

### Headers

| Header | Value | Description |
|--------|-------|-------------|
| `Content-Type` | `application/json` | Required |
| `X-API-Key` | `<YOUR_API_KEY>` | Required |

### Request Body

**Note**: This API uses a flat JSON structure, unlike the previous Vertex AI implementation.

```json
{
  "prompt": "string",
  "negative_prompt": "string (optional)",
  "seed": 171198,
  "height": 704,
  "width": 1216,
  "num_frames": 121,
  "num_inference_steps": 50,
  "fps": 24,
  "gcs_destination": "gs://bucket/path/video.mp4 (optional)"
}
```

#### Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `prompt` | string | **required** | Description of the video to generate |
| `negative_prompt` | string | "" | Elements to avoid in the video |
| `seed` | int | 171198 | Random seed for reproducibility |
| `height` | int | 704 | Video height (must be divisible by 32) |
| `width` | int | 1216 | Video width (must be divisible by 32) |
| `num_frames` | int | 121 | Number of frames to generate |
| `num_inference_steps`| int | 50 | Number of denoising steps |
| `fps` | int | 24 | Frame rate of output video |
| `gcs_destination` | string | null | Custom GCS path for output |

### Example Request (cURL)

```bash
LB_IP=$(terraform output -raw load_balancer_ip)
API_KEY=$(terraform output -raw api_key)

curl -X POST "http://$LB_IP/predict" \
  -H "Content-Type: application/json" \
  -H "X-API-Key: $API_KEY" \
  -d '{
    "prompt": "A cinematic shot of a cyberpunk city in rain",
    "num_frames": 121,
    "width": 1216,
    "height": 704
  }'
```

### Response

```json
{
  "video_url": "https://storage.googleapis.com/...",
  "video_path": "videos/ltx_video_....mp4",
  "seed": 171198,
  "gcs_bucket": "project-ltx-video-output",
  "gcs_blob": "videos/ltx_video_....mp4",
  "generation_time_seconds": 45.2,
  "metadata": { ... }
}
```

## Operations & Monitoring

### Check Service Health

```bash
curl http://<LB_IP>/health
```

### SSH into Instance

To debug issues directly on the VM:

```bash
# Get the SSH command from Terraform output
terraform output ssh_command
# Or manually
gcloud compute ssh --zone=us-central1-a $(gcloud compute instances list --filter='name~ltx-video-vm' --format='value(name)' --limit=1)
```

### View Logs

Logs are streamed to Cloud Logging.

```bash
# View startup logs
gcloud logging read "resource.type=gce_instance AND logName:syslog" --limit 50

# View application logs
gcloud logging read "resource.type=gce_instance AND labels.application=ltx-video" --limit 50
```

### Manual Scaling

Although auto-scaling is enabled, you can manually resize the group:

```bash
gcloud compute instance-groups managed resize ltx-video-mig \
    --size=1 \
    --region=us-central1
```

## Cost Optimization

The deployment is configured for maximum cost efficiency:

1. **Scale-to-Zero**: Set `autoscaling_min_replicas = 0` in `terraform.tfvars`. The infrastructure will cost ~$25/month (Load Balancer + Storage) when idle.
2. **Spot Instances**: Set `use_preemptible = true` to save up to 70% on compute costs.
3. **Auto-Shutdown**: Instances automatically scale down after `autoscaling_cooldown_period` (default 600s) of inactivity.

## Updating the Model

To update the model or application code:

1. Edit `models/ltx/startup.sh` (for logic) or `terraform/main.tf` (for infra).
2. Run `terraform apply`.
3. To force an update of existing instances:

   ```bash
   gcloud compute instance-groups managed rolling-action replace ltx-video-mig \
       --region=us-central1 \
       --max-unavailable=0
   ```
