# Auto-scaling Guide - Zero to Production

## 🚀 Quick Start

### Minimal Configuration (Zero Cost When Idle)

```hcl
# terraform.tfvars
project_id = "your-project-id"
region     = "us-central1"

# Zero cost when idle!
autoscaling_min_replicas = 0
autoscaling_max_replicas = 5

# Cost-effective GPU
machine_type = "n1-standard-8"
gpu_type     = "nvidia-tesla-t4"
```

**Monthly cost when idle: ~$25**

Deploy:

```bash
terraform apply
```

## 📊 Monitoring Autoscaling

### View Current Status

```bash
# Check instance group status
gcloud compute instance-groups managed describe ltx-video-mig \
  --region=us-central1 \
  --format="table(name,targetSize,currentActions.creating,currentActions.deleting)"

# List running instances
gcloud compute instances list \
  --filter='labels.application=ltx-video' \
  --format="table(name,status,zone)"

# View autoscaler status
gcloud compute instance-groups managed describe ltx-video-mig \
  --region=us-central1 \
  --format="get(status.autoscaler)"
```

### Watch Real-Time Scaling Events

```bash
# Stream scaling logs
gcloud logging read "resource.type=gce_autoscaler" \
  --format=json \
  --freshness=10m \
  --tail

# Watch instance creation/deletion
watch -n 5 'gcloud compute instances list --filter="labels.application=ltx-video"'
```

### View Scaling Metrics in Console

65: 1. Go to: [https://console.cloud.google.com/compute/instanceGroups](https://console.cloud.google.com/compute/instanceGroups)
2. Click on `ltx-video-mig`
3. View **Monitoring** tab for:
   - CPU utilization
   - Instance count over time
   - Scaling events

## 🎯 Autoscaling Behavior

### Scale-Up Triggers

Instance **added** when:

- CPU utilization > 70% for 60 seconds, OR
- Load balancer utilization > 80%

**Scale-up is FAST:**

- Decision: ~60 seconds
- VM creation: ~90 seconds
- GPU driver load: ~90 seconds
- Model loading (cached): ~180 seconds
- **Total: ~6-7 minutes to serve requests**

### Scale-Down Triggers

Instance **removed** when:

- CPU utilization < 70% for 300 seconds (cooldown), AND
- Load balancer utilization < 80%
- At least 1 instance has been idle

**Scale-down is GRADUAL:**

- Only 1 instance removed per 10 minutes
- Ensures graceful degradation
- Connections are drained (300s timeout)

### Cold Start vs Warm Start

**Cold Start (first instance, no cached model):**

```
VM creation:       90s
GPU driver:        90s
Model download:    300s (first time only)
Model load:        180s
Total:            ~10 minutes
```

**Warm Start (model cached in GCS):**

```
VM creation:       90s
GPU driver:        90s
Model load:        180s
Total:            ~6 minutes
```

**Optimization:** After first deployment, model is cached, all subsequent starts are warm.

## ⚙️ Configuration Tuning

### Scenario 1: Minimize Costs (Sporadic Use)

**Goal:** Pay nothing when idle, tolerate 6-10 min delay

```hcl
autoscaling_min_replicas = 0
autoscaling_max_replicas = 3
autoscaling_cooldown_period = 180  # Scale down aggressively
autoscaling_cpu_target = 80        # Allow high CPU before scaling
use_preemptible = true             # 75% cost savings
```

**Cost when idle:** $25/month
**Cost per video:** $0.50-1.00 (including startup overhead)

### Scenario 2: Balance Cost & Performance

**Goal:** Quick response most of the time, reasonable cost

```hcl
autoscaling_min_replicas = 0
autoscaling_max_replicas = 5
autoscaling_cooldown_period = 300
autoscaling_cpu_target = 70
use_preemptible = false
```

**Cost when idle:** $25/month
**First request:** 6 min delay
**Subsequent:** Instant (if within 5 min)

### Scenario 3: Always Ready (Zero Delay)

**Goal:** Instant response, cost is secondary

```hcl
autoscaling_min_replicas = 1       # Always 1 VM running
autoscaling_max_replicas = 10
autoscaling_cooldown_period = 600  # Keep VMs longer
autoscaling_cpu_target = 60        # Scale early
use_preemptible = false
```

**Cost when idle:** $709/month (1 VM + fixed costs)
**Response time:** Instant
**Scales to:** 10 VMs for burst traffic

### Scenario 4: High Volume Production

**Goal:** Handle 1000+ videos/day reliably

```hcl
autoscaling_min_replicas = 3       # Base capacity
autoscaling_max_replicas = 20
autoscaling_cooldown_period = 600
autoscaling_cpu_target = 65
machine_type = "n1-standard-16"
gpu_type = "nvidia-tesla-v100"     # Faster processing
```

**Cost when idle:** $5,380/month (3 VMs)
**Peak capacity:** 20 VMs = ~400 concurrent videos
**Cost per video:** $0.50-0.80 at scale

## 🔧 Advanced Configurations

### Schedule-Based Scaling

Scale automatically based on time of day:

**1. Create scaling schedules:**

```bash
# Scale UP during business hours (8 AM weekdays)
gcloud compute resource-policies create instance-schedule scale-up-schedule \
  --region=us-central1 \
  --vm-start-schedule='0 8 * * 1-5' \
  --timezone='America/New_York'

# Scale DOWN after hours (6 PM weekdays)
gcloud compute resource-policies create instance-schedule scale-down-schedule \
  --region=us-central1 \
  --vm-stop-schedule='0 18 * * 1-5' \
  --timezone='America/New_York'
```

**2. Attach to instance group:**

```bash
gcloud compute instance-groups managed set-instance-template ltx-video-mig \
  --region=us-central1 \
  --resource-policies=scale-up-schedule,scale-down-schedule
```

### Custom Metrics Scaling

Scale based on queue depth or custom metrics:

**1. Create custom metric:**

```python
# In your application
from google.cloud import monitoring_v3

client = monitoring_v3.MetricServiceClient()
project_name = f"projects/{PROJECT_ID}"

# Report pending requests to custom metric
series = monitoring_v3.TimeSeries()
series.metric.type = 'custom.googleapis.com/ltx/pending_requests'
series.metric.labels['queue'] = 'generation'
# ... send metric
```

**2. Update autoscaler to use custom metric:**

```bash
gcloud compute instance-groups managed set-autoscaling ltx-video-mig \
  --region=us-central1 \
  --custom-metric-utilization=metric=custom.googleapis.com/ltx/pending_requests,utilization-target=10
```

### Regional Failover

Deploy in multiple regions for high availability:

```hcl
# In main.tf, create multiple MIGs
module "us_central" {
  source = "./modules/ltx-video"
  region = "us-central1"
  ...
}

module "us_east" {
  source = "./modules/ltx-video"
  region = "us-east1"
  ...
}

# Use global load balancer to distribute traffic
```

## 📈 Scaling Performance

### Expected Scaling Times

| Event | Time | Notes |
|-------|------|-------|
| **First request (cold)** | 10 min | Initial model download |
| **First request (warm)** | 6 min | Model cached |
| **Scale up 0→1** | 6 min | Cached model |
| **Scale up 1→2** | 6 min | Parallel scaling |
| **Scale up 2→5** | 6 min | All instances start together |
| **Scale down 5→4** | 10 min | After cooldown period |
| **Scale down 1→0** | 10 min | After cooldown + idle period |

### Throughput Estimates

**Per VM (T4):**

- Video generation: ~3 minutes
- Concurrent: 1 video at a time
- Throughput: ~20 videos/hour per VM

**With 5 VMs:**

- Throughput: ~100 videos/hour
- ~2,400 videos/day
- ~72,000 videos/month

**Cost at max capacity (T4, 24/7):**

- 5 VMs × $684/month = $3,420/month
- Fixed costs: $25/month
- **Total: $3,445/month**
- **Cost per video: $0.048** (at 72,000 videos)

## 🚨 Troubleshooting

### Problem: Instances Not Scaling Up

**Check autoscaler status:**

```bash
gcloud compute instance-groups managed describe ltx-video-mig \
  --region=us-central1 \
  --format="get(status)"
```

**Common causes:**

1. **GPU quota exhausted**

   ```bash
   gcloud compute regions describe us-central1 | grep -A 2 NVIDIA_T4
   ```

   Solution: Request quota increase

2. **Autoscaler disabled**

   ```bash
   gcloud compute instance-groups managed update ltx-video-mig \
     --region=us-central1 \
     --autoscaling-mode=on
   ```

3. **CPU not reaching threshold**
   - Check if actual CPU < target
   - Lower `autoscaling_cpu_target` if needed

### Problem: Instances Scaling Down Too Quickly

**Increase cooldown period:**

```bash
gcloud compute instance-groups managed update-autoscaling ltx-video-mig \
  --region=us-central1 \
  --cooldown-period=600
```

Or in terraform:

```hcl
autoscaling_cooldown_period = 600  # 10 minutes
```

### Problem: Health Checks Failing During Startup

**Increase initial delay:**

```hcl
autoscaling_initial_delay_sec = 900  # 15 minutes for slow model loading
```

**Check actual startup time:**

```bash
gcloud compute instances get-serial-port-output INSTANCE_NAME \
  --zone=us-central1-a | grep "Service ready"
```

### Problem: Instances Stuck in "Creating" State

**Check quota and zone availability:**

```bash
# Check GPU availability
gcloud compute accelerator-types list --filter="zone:us-central1"

# Try different zone
gcloud compute instance-groups managed update ltx-video-mig \
  --region=us-central1 \
  --zones=us-central1-b,us-central1-c,us-central1-f
```

## 📊 Cost Monitoring Alerts

Set up budget alerts for autoscaling:

```bash
# Create budget alert
gcloud billing budgets create \
  --billing-account=BILLING_ACCOUNT_ID \
  --display-name="LTX Video Autoscaling Budget" \
  --budget-amount=500 \
  --threshold-rule=percent=50 \
  --threshold-rule=percent=90 \
  --threshold-rule=percent=100

# Create scaling alert
gcloud alpha monitoring policies create \
  --notification-channels=CHANNEL_ID \
  --display-name="LTX Video Scaling Alert" \
  --condition-threshold-value=4 \
  --condition-threshold-duration=300s \
  --condition-display-name="More than 4 instances"
```

## 🎓 Best Practices

### 1. Start with Zero Min Replicas

- Test the cold start experience
- Understand your actual latency requirements
- Only increase min_replicas if necessary

### 2. Monitor Actual Usage Patterns

```bash
# Analyze usage over 7 days
gcloud monitoring time-series list \
  --filter='metric.type="compute.googleapis.com/instance/cpu/utilization" 
            resource.labels.instance_name=~"ltx-video-vm.*"' \
  --interval-start-time=$(date -u -d '7 days ago' '+%Y-%m-%dT%H:%M:%SZ') \
  --interval-end-time=$(date -u '+%Y-%m-%dT%H:%M:%SZ')
```

### 3. Tune Based on Data

- High CPU but not scaling? → Lower `cpu_target`
- Scaling too aggressively? → Increase `cooldown_period`
- Too many cold starts? → Increase `min_replicas` during peak hours

### 4. Use Preemptible for Dev/Test

- 75% cost savings
- Acceptable for non-production workloads
- VMs automatically restart when preempted

### 5. Cache Model Weights

Model is automatically cached to GCS after first download:

- Cold start: 10 minutes (first time)
- Warm start: 6 minutes (subsequent)
- **300s savings per scale-up = $0.08 per scale-up (T4)**

## 📖 Additional Resources

- [GCP Autoscaling Docs](https://cloud.google.com/compute/docs/autoscaler)
- [Managed Instance Groups](https://cloud.google.com/compute/docs/instance-groups)
- [GPU Quota Management](https://cloud.google.com/compute/docs/gpus/gpu-regions-zones)
- [Cost Optimization Guide](https://cloud.google.com/compute/docs/instances/reduce-costs)

---

**Summary:** With autoscaling configured to min=0, you achieve **zero compute costs when idle** (~$25/month fixed) and automatic scaling to handle any load, making this the most cost-effective deployment option for variable workloads.
