# LTX Video Generation on GCP Vertex AI

Production-ready deployment of LTX-Video text-to-video model on Google Cloud Platform using Vertex AI with custom GCS destination control.

## Features

- 🎥 Text-to-video generation using Lightricks LTX-Video model
- ☁️ Deployed on GCP Vertex AI with GPU acceleration
- 📦 Custom GCS destination paths for generated videos
- 🔄 Auto-scaling from 0 to N replicas (cost-effective)
- 🚀 Built from Hugging Face model repository
- 🔐 Secure with IAM and service accounts
- 📊 Monitoring and logging included

## Architecture

```
User Request → Vertex AI Endpoint → Custom Container (serve.py)
                                    ↓
                                LTX-Video Model (GPU)
                                    ↓
                            Generate Video Frames
                                    ↓
                        Save to GCS (custom or default path)
                                    ↓
                            Return Video URL
```

## Prerequisites

1. **GCP Project** with billing enabled
2. **gcloud CLI** installed and authenticated
3. **Terraform** v1.0+ installed
4. **GitHub repository** for source code
5. **Required GCP APIs** (enabled automatically by Terraform):
   - Vertex AI API
   - Cloud Build API
   - Artifact Registry API
   - Cloud Storage API

## Repository Structure

```
.
├── terraform/
|     main.tf                           # Terraform infrastructure
|     variables.tf                      # Terraform variables
|     terraform.tfvars                  # Your configuration (create from example)
|     terraform.tfvars.example          # Example configuration
├── models/
|     serve.py                          # FastAPI serving application
|     Dockerfile                        # Container image definition
|     requirements.txt                  # Python dependencies
|     cloudbuild.yaml                   # Cloud Build configuration
├── .gitignore                          # Git ignore rules
└── docs/
      LTX_VIDEO_GENERATION_ENDPOINT.md  # This file
      
```

## Quick Start

### 1. Clone and Configure

```bash
# Clone your repository
git clone https://github.com/your-org/ltx-video-gcp.git
cd ltx-video-gcp

# Create configuration from example
cp terraform.tfvars.example terraform.tfvars

# Edit with your values
nano terraform.tfvars
```

### 2. Configure GCP Authentication

```bash
# Authenticate with GCP
gcloud auth login
gcloud auth application-default login

# Set your project
gcloud config set project YOUR_PROJECT_ID
```

### 3. Build and Push Container Image

```bash
# Option A: Build locally and push
PROJECT_ID=$(gcloud config get-value project)
REGION="us-central1"

docker build -t ${REGION}-docker.pkg.dev/${PROJECT_ID}/video-gen-repo/ltx-video-serve:latest .
docker push ${REGION}-docker.pkg.dev/${PROJECT_ID}/video-gen-repo/ltx-video-serve:latest

# Option B: Use Cloud Build
gcloud builds submit --config=cloudbuild.yaml
```

### 4. Deploy Infrastructure

```bash
# Initialize Terraform
terraform init

# Review the plan
terraform plan

# Deploy (takes 15-30 minutes for endpoint deployment)
terraform apply
```

### 5. Test the Endpoint

```bash
# Get endpoint URL
ENDPOINT=$(terraform output -raw predict_url)

# Make a prediction
curl -X POST "$ENDPOINT" \
  -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  -H "Content-Type: application/json" \
  -d '{
    "instances": [{
      "prompt": "A serene mountain lake at sunset with reflections",
      "num_frames": 121,
      "height": 704,
      "width": 1216,
      "seed": 42
    }]
  }'
```

## Using Custom GCS Destinations

### Default Behavior (No Custom Path)

```json
{
  "instances": [{
    "prompt": "A cat playing piano",
    "num_frames": 121
  }]
}
```

**Result**: Video saved to `gs://YOUR_PROJECT-ltx-video-output/videos/ltx_video_TIMESTAMP_ID.mp4`

### Custom GCS Path

```json
{
  "instances": [{
    "prompt": "A cat playing piano",
    "num_frames": 121,
    "gcs_destination": "gs://my-custom-bucket/my-folder/custom-name.mp4"
  }]
}
```

**Result**: Video saved to `gs://my-custom-bucket/my-folder/custom-name.mp4`

## Client Examples

### Node.js with @google-cloud/aiplatform

```javascript
const aiplatform = require('@google-cloud/aiplatform');
const {PredictionServiceClient} = aiplatform.v1;

const client = new PredictionServiceClient();

async function generateVideo() {
  const endpoint = 'projects/PROJECT_ID/locations/REGION/endpoints/ENDPOINT_ID';
  
  const instance = {
    prompt: "A beautiful sunset over the ocean",
    num_frames: 121,
    gcs_destination: "gs://my-bucket/videos/sunset.mp4"  // Optional
  };

  const request = {
    endpoint,
    instances: [instance]
  };

  const [response] = await client.predict(request);
  console.log('Video URL:', response.predictions[0].video_url);
}

generateVideo();
```

### Python

```python
from google.cloud import aiplatform

aiplatform.init(project='YOUR_PROJECT', location='us-central1')

endpoint = aiplatform.Endpoint('projects/PROJECT_ID/locations/REGION/endpoints/ENDPOINT_ID')

response = endpoint.predict(
    instances=[{
        'prompt': 'A robot dancing in the rain',
        'num_frames': 121,
        'gcs_destination': 'gs://my-bucket/videos/robot-dance.mp4'  # Optional
    }]
)

print(f"Video URL: {response.predictions[0]['video_url']}")
```

### cURL

```bash
curl -X POST \
  "https://REGION-aiplatform.googleapis.com/v1/projects/PROJECT_ID/locations/REGION/endpoints/ENDPOINT_ID:predict" \
  -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  -H "Content-Type: application/json" \
  -d '{
    "instances": [{
      "prompt": "A futuristic city at night",
      "num_frames": 121,
      "height": 704,
      "width": 1216,
      "num_inference_steps": 50,
      "guidance_scale": 7.5,
      "seed": 42,
      "gcs_destination": "gs://my-bucket/city-video.mp4"
    }]
  }'
```

## API Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `prompt` | string | **required** | Text description of the video to generate |
| `negative_prompt` | string | "" | What to avoid in the generation |
| `seed` | integer | 42 | Random seed for reproducibility |
| `height` | integer | 704 | Video height (256-1024) |
| `width` | integer | 1216 | Video width (256-1920) |
| `num_frames` | integer | 121 | Number of frames (1-240) |
| `num_inference_steps` | integer | 50 | Denoising steps (1-100) |
| `guidance_scale` | float | 7.5 | Guidance scale (1.0-20.0) |
| `gcs_destination` | string | null | Custom GCS path (e.g., `gs://bucket/path/file.mp4`) |

## Cost Optimization

### Current Configuration

- **Min replicas**: 0 (scales to zero when idle)
- **Max replicas**: 1
- **Machine**: G2-standard-8 with NVIDIA L4 GPU
- **Cost**: ~$1.29/hour when active, $0 when idle

### Cost-Saving Tips

1. **Scale to Zero**: Keep `min_replicas = 0` in `terraform.tfvars`
2. **Right-size GPU**: Use L4 ($1.29/hr) instead of V100 ($2.48/hr) for most workloads
3. **Batch requests**: Process multiple videos in sequence
4. **Storage lifecycle**: Auto-archive old videos (configured in Terraform)
5. **Monitor usage**: Check Cloud Monitoring for idle time

## Monitoring

### View Logs

```bash
gcloud logging read "resource.type=aiplatform.googleapis.com/Endpoint" --limit 50
```

### Check Endpoint Status

```bash
gcloud ai endpoints describe ENDPOINT_ID --region=us-central1
```

### Monitor GPU Usage

Navigate to: Cloud Console → Vertex AI → Endpoints → Your Endpoint → Monitoring

## Troubleshooting

### Model Not Loading

```bash
# Check container logs
gcloud logging read "resource.type=aiplatform.googleapis.com/Endpoint AND severity>=ERROR" --limit 50
```

### GCS Upload Fails

Ensure service account has `roles/storage.objectAdmin`:

```bash
gcloud projects add-iam-policy-binding PROJECT_ID \
  --member="serviceAccount:vertex-ai-video-gen@PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/storage.objectAdmin"
```

### Out of Memory

Reduce video resolution or frame count:

```json
{
  "height": 512,
  "width": 896,
  "num_frames": 81
}
```

## Updating the Deployment

### Update Container Image

```bash
# Make changes to serve.py or Dockerfile
git commit -am "Update serving logic"
git push origin main

# Cloud Build trigger will automatically build and push
# Or build manually:
gcloud builds submit --config=cloudbuild.yaml
```

### Update Infrastructure

```bash
# Modify main.tf or variables.tf
terraform plan
terraform apply
```

### Update Model Version

Edit `terraform.tfvars`:

```hcl
hugging_face_model_id = "Lightricks/LTX-Video-v2"  # New version
```

Then apply:

```bash
terraform apply
```

## Cleanup

To avoid ongoing charges:

```bash
# Destroy all resources
terraform destroy

# Or manually:
gcloud ai endpoints delete ENDPOINT_ID --region=us-central1
gcloud artifacts repositories delete video-gen-repo --location=us-central1
gsutil -m rm -r gs://PROJECT_ID-ltx-video-output
```

## Security Best Practices

1. **Private Videos**: Remove `blob.make_public()` from `serve.py` for private videos
2. **VPC**: Deploy endpoint in VPC for network isolation
3. **Service Account**: Use least-privilege IAM roles
4. **API Keys**: Implement API key authentication for production
5. **Signed URLs**: Use signed URLs instead of public URLs

## Performance Tuning

### For Faster Generation

- Use fewer inference steps (25-30)
- Reduce frame count (60-80 frames)
- Lower resolution (512x896)

### For Higher Quality

- Increase inference steps (50-100)
- Higher guidance scale (9-12)
- More frames (121-240)

## Support

- **GCP Issues**: Check [GCP Status](https://status.cloud.google.com/)
- **Model Issues**: See [LTX-Video on Hugging Face](https://huggingface.co/Lightricks/LTX-Video)
- **Terraform Issues**: Check provider version compatibility

## License

This deployment configuration is provided as-is. The LTX-Video model has its own license terms - see the [model card](https://huggingface.co/Lightricks/LTX-Video) for details.

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

---

**Built with** ❤️ **using Terraform, Vertex AI, and LTX-Video**
