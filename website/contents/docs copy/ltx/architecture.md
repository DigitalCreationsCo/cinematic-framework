# LTX Video Generation Architecture

## Overview
This service provides production-ready deployment of the Lightricks LTX-Video text-to-video model on Google Cloud Platform. It uses Managed Instance Groups (MIG) for auto-scaling and Global Load Balancing for high availability.

## Architecture Diagram

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

## Infrastructure Components
*   **VPC Network**: Isolated network for video processing.
*   **MIG**: Handles VM lifecycle, auto-healing, and scaling (0 to N).
*   **Cloud Storage**:
    *   `model-cache`: Caches weights to speed up boot times.
    *   `video-output`: Stores generated MP4s.
*   **Secret Manager**: Stores API keys.

## API Reference
**POST** `/predict`

```json
{
  "prompt": "A cinematic shot of...",
  "width": 1216,
  "height": 704,
  "num_frames": 121
}
```

Response:
```json
{
  "video_url": "https://storage.googleapis.com/...",
  "generation_time_seconds": 45.2
}