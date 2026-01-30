# Operations & Scaling

This guide covers how to scale the Cinematic Canvas platform locally with Docker and in production on GCP.

## 1. Local Scaling (Docker Compose)

You can run multiple worker instances locally to simulate a distributed environment.

### Starting Scaled Workers
No changes to `docker-compose.yml` are required. Use the `--scale` flag:

```bash
docker compose up -d --scale worker=3
```

This spins up 3 worker containers. Each worker generates a unique ID on startup and competes for jobs using the atomic database lock.

### Verification
Check logs to see different workers processing jobs:
```bash
docker compose logs -f worker
```

## 2. Production Autoscaling (GCP)

For the LTX Video Generation service, we use **Managed Instance Groups (MIG)** with autoscaling policies.

### Configuration Scenarios

| Scenario | Min Replicas | Max Replicas | Cost (Idle) | First Request Latency |
| :--- | :--- | :--- | :--- | :--- |
| **Cost Saver** | 0 | 3 | ~$25/mo | ~6-10 min (Cold Start) |
| **Balanced** | 0 | 5 | ~$25/mo | ~6 min (Warm Start) |
| **Always Ready** | 1 | 10 | ~$709/mo | Instant |

### Terraform Setup

To configure for zero-cost idle (Scale-to-Zero):

```hcl
# terraform.tfvars
autoscaling_min_replicas = 0
autoscaling_max_replicas = 5
machine_type = "n1-standard-8"
gpu_type     = "nvidia-tesla-t4"
```

### Monitoring

View autoscaling events in real-time:

```bash
gcloud compute instance-groups managed describe ltx-video-mig \
  --region=us-central1 \
  --format="get(status.autoscaler)"
```

## 3. Scaling Performance

*   **Scale Up**: Takes ~6 minutes (VM creation + GPU driver + Model load).
*   **Scale Down**: Occurs gradually (1 instance per 10 mins) to ensure graceful termination.
*   **Throughput**: A single T4 GPU can process ~20 videos/hour.