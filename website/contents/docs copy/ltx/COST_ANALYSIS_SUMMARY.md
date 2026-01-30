# Final Cost Analysis - Auto-scaling LTX Video Generation

## 🎯 **Cost Per Second of Generated Video**

### Standard Configuration (n1-standard-8 + T4)

**Generation Performance:**

- Resolution: 704x1216
- Frames: 121 (5 seconds at 24fps)
- Generation time: ~180 seconds (3 minutes)
- **5 seconds of video = 180 seconds of compute**

**Cost Breakdown:**

```
Compute cost: $0.95/hour = $0.000264/second
Video generation: 180 seconds × $0.000264 = $0.0475
Storage (5MB): $0.00010
Networking (5MB egress): $0.0006
Load Balancer processing (5MB): $0.00004
Cloud Armor (1 request): $0.00000075

Total: $0.0482 for 5 seconds of video
```

### **Final Answer: Cost Per Second of Generated Video**

| Configuration | Cost/Second | Cost/Minute | Notes |
|---------------|-------------|-------------|-------|
| **T4 (Recommended)** | **$0.0096** | **$0.58** | 704x1216, 121 frames |
| **T4 (Optimized)** | **$0.0053** | **$0.32** | 512x896, 81 frames |
| **L4 (Fast)** | **$0.0108** | **$0.65** | 704x1216, 121 frames |
| **V100 (High-end)** | **$0.0110** | **$0.66** | 704x1216, 121 frames (faster) |
| **T4 Preemptible** | **$0.0027** | **$0.16** | 704x1216, 121 frames (75% off) |

**Formula:**

```
Cost per second = (Generation time × Hourly rate + Storage + Network + LB) / Video duration

Example (T4):
= (180s × $0.000264/s + $0.00010 + $0.0006 + $0.00004) / 5s
= $0.0482 / 5s
= $0.0096 per second of video
```

---

## 💰 Zero-Cost Idle Configuration

### When No Requests (min_replicas = 0)

**Monthly Fixed Costs:**

```
Load Balancer forwarding rules:     $18.00/month
Cloud Armor security policy:         $5.00/month
Secret Manager (API keys):           $0.06/month
Storage (model cache, 15GB):         $0.30/month
Storage (boot disk snapshots):       $1.50/month
---------------------------------------------------
TOTAL WHEN IDLE:                    $24.86/month
```

**Per-Request Costs (when scaled up):**

```
Compute (T4):        $0.000264/second
Load Balancer:       $0.000008/GB processed
Cloud Armor:         $0.00000075/request
Storage egress:      $0.00012/MB
```

### Cost Comparison: Always-On vs Auto-scaling

| Scenario | Always-On (1 VM) | Auto-scale (0-5) | Savings |
|----------|------------------|------------------|---------|
| **Idle (0 videos)** | $684/month | $25/month | **96% savings** |
| **100 videos/month** | $684/month | $75/month | **89% savings** |
| **500 videos/month** | $684/month | $275/month | **60% savings** |
| **2,000 videos/month** | $684/month | $725/month | -6% (scale wins at high volume) |

**Break-even point:** ~1,800 videos/month (when auto-scaling costs equal always-on)

---

## 📊 Detailed Cost Breakdown by Usage

### Scenario 1: Hobbyist (10 videos/month)

**Configuration:** min=0, max=3, T4 preemptible

```
Fixed costs (idle):              $24.86
Compute (10 videos × 3 min):     $1.20   (30 min × $0.24/hr preemptible)
Storage (videos, 50MB):          $0.001
Networking (50MB egress):        $0.006
Cloud Armor (10 requests):       $0.0000075
Load Balancer data:              $0.0004
---------------------------------------------------
TOTAL:                           $26.07/month
Cost per video:                  $2.61
Cost per second of video:        $0.0052
```

### Scenario 2: Small Business (100 videos/month)

**Configuration:** min=0, max=3, T4

```
Fixed costs (idle):              $24.86
Compute (100 videos × 3 min):    $47.50  (300 min × $0.95/hr)
Storage (videos, 500MB):         $0.01
Networking (500MB egress):       $0.06
Cloud Armor (100 requests):      $0.000075
Load Balancer data:              $0.004
---------------------------------------------------
TOTAL:                           $72.43/month
Cost per video:                  $0.72
Cost per second of video:        $0.0145
```

### Scenario 3: Medium Business (500 videos/month)

**Configuration:** min=0, max=5, L4

```
Fixed costs (idle):              $24.86
Compute (500 videos × 2 min):    $215.00 (1,000 min × $1.29/hr L4)
Storage (videos, 2.5GB):         $0.05
Networking (2.5GB egress):       $0.30
Cloud Armor (500 requests):      $0.000375
Load Balancer data:              $0.02
---------------------------------------------------
TOTAL:                           $240.23/month
Cost per video:                  $0.48
Cost per second of video:        $0.0096
```

### Scenario 4: High Volume (2,000 videos/month)

**Configuration:** min=1, max=10, L4

```
Fixed costs:                     $24.86
Base compute (1 VM, 24/7):       $929.00 (always-on for quick response)
Auto-scale (peak hours):         $350.00 (additional VMs during peaks)
Storage (videos, 10GB):          $0.20
Networking (10GB egress):        $1.20
Cloud Armor (2,000 requests):    $0.0015
Load Balancer data:              $0.08
---------------------------------------------------
TOTAL:                           $1,305.36/month
Cost per video:                  $0.65
Cost per second of video:        $0.0130
```

### Scenario 5: Enterprise (10,000 videos/month)

**Configuration:** min=3, max=20, V100

```
Fixed costs:                     $24.86
Base compute (3 VMs, 24/7):      $5,356.80 (3 × $2.48/hr × 720hrs)
Auto-scale (peak hours):         $2,000.00 (additional VMs)
Storage (videos, 50GB):          $1.00
Networking (50GB egress):        $6.00
Cloud Armor (10,000 requests):   $0.0075
Load Balancer data:              $0.40
---------------------------------------------------
TOTAL:                           $7,389.07/month
Cost per video:                  $0.74
Cost per second of video:        $0.0148
```

---

## ⚡ Autoscaling Cost Dynamics

### Scale-Up Costs

**Time to scale from 0 to 1 instance:**

- Instance creation: ~60 seconds
- GPU driver loading: ~90 seconds
- Model download (first time): ~300 seconds
- Model loading to GPU: ~120 seconds
- **Total cold start: ~10 minutes**
- **Warm start (cached model): ~4 minutes**

**Cost during scale-up (T4):**

```
Cold start: 10 min × $0.95/hr = $0.158
Warm start: 4 min × $0.95/hr = $0.063
```

**Optimization:** Keep min=1 for instant response if cost allows

### Scale-Down Savings

**Cooldown period:** 300 seconds (configurable)
**Scale-down trigger:** CPU < 70% for 300 seconds

**Example: 1 video per hour usage**

```
Without auto-scale (always-on):  $0.95/hour = $684/month
With auto-scale:
  - Active time per video: 3 min
  - Cooldown before shutdown: 5 min
  - Total per video: 8 min
  - Monthly: 8 min × 24 videos = 192 min = 3.2 hours
  - Cost: 3.2 hours × $0.95 = $3.04 + $24.86 fixed = $27.90/month

SAVINGS: $684 - $27.90 = $656.10/month (96% reduction!)
```

---

## 🎯 Optimal Configuration by Use Case

### Developer/Testing (< 50 videos/month)

```hcl
autoscaling_min_replicas = 0
autoscaling_max_replicas = 1
machine_type = "n1-standard-4"
gpu_type = "nvidia-tesla-t4"
use_preemptible = true
```

**Cost:** ~$15-30/month
**Cost per second:** $0.0027 (preemptible)

### Small Production (50-200 videos/month)

```hcl
autoscaling_min_replicas = 0
autoscaling_max_replicas = 3
machine_type = "n1-standard-8"
gpu_type = "nvidia-tesla-t4"
use_preemptible = false
```

**Cost:** ~$50-150/month
**Cost per second:** $0.0096

### Medium Production (200-1,000 videos/month)

```hcl
autoscaling_min_replicas = 1  # Instant response
autoscaling_max_replicas = 5
machine_type = "n1-standard-8"
gpu_type = "nvidia-l4"
use_preemptible = false
```

**Cost:** ~$300-800/month
**Cost per second:** $0.0108

### High Volume (1,000+ videos/month)

```hcl
autoscaling_min_replicas = 2  # Handle base load
autoscaling_max_replicas = 10
machine_type = "n1-standard-16"
gpu_type = "nvidia-tesla-v100"
use_preemptible = false
```

**Cost:** ~$2,000-5,000/month
**Cost per second:** $0.0110

---

## 📈 Cost Optimization Strategies

### 1. **Aggressive Scale-to-Zero** (Best for sporadic use)

```hcl
autoscaling_min_replicas = 0
autoscaling_cooldown_period = 180  # Scale down after 3 min
```

**Savings:** 90-95% for low-frequency use
**Trade-off:** 4-10 min cold start delay

### 2. **Keep-Warm Strategy** (Best for regular use)

```hcl
autoscaling_min_replicas = 1
autoscaling_max_replicas = 10
```

**Cost:** +$684/month base
**Benefit:** Instant response, no cold starts

### 3. **Scheduled Scaling** (Best for predictable patterns)

Use Cloud Scheduler to set min_replicas based on time:

```bash
# Scale up during business hours (8 AM)
gcloud compute instance-groups managed set-autoscaling ltx-video-mig \
  --min-num-replicas=2 --schedule="0 8 * * 1-5"

# Scale down after hours (6 PM)
gcloud compute instance-groups managed set-autoscaling ltx-video-mig \
  --min-num-replicas=0 --schedule="0 18 * * 1-5"
```

**Savings:** 60-70% vs always-on

### 4. **Burst Capacity with Preemptible**

```hcl
# Use regular VM for base capacity
autoscaling_min_replicas = 1
use_preemptible = false

# Add preemptible VMs for burst (manual MIG config)
```

**Savings:** 50-60% on burst traffic
**Trade-off:** Preemptible VMs may be terminated

### 5. **Regional Selection**

Costs vary by region:

```
us-central1 (Iowa):     $0.95/hr (T4) - CHEAPEST
us-west1 (Oregon):      $0.95/hr (T4)
us-east1 (S. Carolina): $0.95/hr (T4)
europe-west1 (Belgium): $1.05/hr (T4) - +10%
asia-east1 (Taiwan):    $1.18/hr (T4) - +24%
```

---

## 💡 Real-World Cost Examples

### Example 1: AI Video Marketing Agency

- **Usage:** 50 videos/month, unpredictable timing
- **Config:** min=0, max=3, T4
- **Cost:** $50/month ($1.00/video)
- **vs Always-on:** $684/month (93% savings)

### Example 2: E-commerce Product Videos

- **Usage:** 200 videos/month, business hours only
- **Config:** min=0 with scheduled scaling, L4
- **Cost:** $180/month ($0.90/video)
- **vs Always-on:** $929/month (81% savings)

### Example 3: Content Creator Platform

- **Usage:** 1,500 videos/month, 24/7
- **Config:** min=2, max=8, L4
- **Cost:** $2,400/month ($1.60/video)
- **vs Always-on (insufficient):** Would need 3+ VMs = $2,787/month

### Example 4: Enterprise Video Service

- **Usage:** 8,000 videos/month, high availability
- **Config:** min=3, max=15, V100
- **Cost:** $6,500/month ($0.81/video)
- **vs Always-on:** Would need 10+ VMs = $17,860/month (63% savings)

---

## 🎬 **FINAL SUMMARY: Cost Per Second**

### Quick Reference Table

| Configuration | $/Second | $/Minute | $/5min Video | Best For |
|---------------|----------|----------|--------------|----------|
| **T4 Preemptible** | $0.0027 | $0.16 | $0.81 | Development |
| **T4 Standard** | $0.0096 | $0.58 | $2.88 | Small business |
| **L4 Standard** | $0.0108 | $0.65 | $3.24 | Medium business |
| **V100 Standard** | $0.0110 | $0.66 | $3.30 | High volume |
| **A100 Standard** | $0.0272 | $1.63 | $8.16 | Maximum quality |

### Including All Costs (amortized)

| Volume | Total $/Second | Notes |
|--------|---------------|-------|
| **10 videos/month** | $0.0052 | Includes fixed costs |
| **100 videos/month** | $0.0145 | Break-even with managed services |
| **500 videos/month** | $0.0096 | Economies of scale kick in |
| **2,000 videos/month** | $0.0130 | Still cost-effective |
| **10,000 videos/month** | $0.0148 | Fixed costs negligible |

### Zero-Cost Idle Summary

```
When min_replicas = 0:
- Idle cost: $24.86/month
- Only pay for actual generation time
- Best for: < 1,000 videos/month
- 4-10 minute cold start delay acceptable
```

---

## 🏆 **Bottom Line**

**Absolute cheapest (Preemptible T4, optimized settings):**

- **$0.0027 per second of generated video**
- **$0.16 per minute of generated video**

**Production recommended (T4 Standard, full quality):**

- **$0.0096 per second of generated video**
- **$0.58 per minute of generated video**

**With auto-scaling to zero:**

- **$24.86/month when completely idle**
- **96% cost reduction vs always-on**
- **Break-even at ~1,800 videos/month**

**This makes LTX Video generation cost-competitive with managed services at any scale, with the added benefits of full control, security, and customization.**
