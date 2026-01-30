# Security Guide - LTX Video Generation API

## 🛡️ Security Features Overview

This deployment includes multiple layers of security:

1. **Firewall Rules** - Strict IP-based access control (Primary Defense)
2. **Identity-Aware Proxy (IAP)** - Secure SSH without open ports
3. **API Key Authentication** - Secret-based access control
4. **Rate Limiting** - Application-level protection
5. **VPC Network** - Isolated network environment
6. **Cloud Armor** - DDoS protection and WAF (Requires Quota)
7. **IAM** - Least-privilege service accounts
8. **Secret Manager** - Encrypted API key storage

## 🔐 Administrative Access (SSH)

Direct SSH access on port 22 is disabled for the public internet. Access is managed via **Google Identity-Aware Proxy (IAP)**.

- **Firewall Rule:** Allows ingress from `35.235.240.0/20` (Google IAP) only.
- **Port 22:** Closed to `0.0.0.0/0`.

### Connecting via SSH

You must use the `gcloud` command which tunnels traffic through IAP:

```bash
gcloud compute ssh ltx-video-vm \
  --zone=us-central1-a \
  --tunnel-through-iap
🛡️ Cloud Armor (Optional)
Note: Cloud Armor requires a generic quota. If your project has a quota of 0, this feature is disabled by default in the Terraform configuration.

If enabled, Cloud Armor provides:

Rate Limiting (Priority 1000) - Limit requests/minute per IP
XSS/SQLi Protection (Priority 3000+) - Block common attack vectors
Tor Exit Node Blocking (Priority 2000)
Adaptive Protection - ML-based DDoS defense
Adjusting Cloud Armor (If Enabled)
# terraform.tfvars
rate_limit_requests_per_minute = 60
blocked_countries = ["XX", "YY"]
🔐 Authentication & Authorization
API Key Management
API keys are stored securely in Google Secret Manager.

View Your API Key
terraform output -raw api_key
Rotate API Keys
Access Secret Manager:
gcloud secrets versions access latest --secret="ltx-video-api-keys" > keys.json
Edit keys.json to add/remove keys.
Update Secret:
gcloud secrets versions add ltx-video-api-keys --data-file=keys.json
Restart Service:
gcloud compute ssh ltx-video-vm --zone=us-central1-a --tunnel-through-iap --command="sudo systemctl restart ltx-video"
🔍 Monitoring & Alerts
Security Metrics
Monitor your environment using Google Cloud Logging:

# Authentication failures
gcloud logging read 'jsonPayload.message=~"Invalid API key"' --limit=50

# Successful requests
gcloud logging read 'resource.type="gce_instance" AND "Authenticated request"' --limit=50
Incident Response: Compromised Access
Stop the VM immediately:
gcloud compute instances stop ltx-video-vm --zone=us-central1-a
Revoke API Keys: Disable the specific key in Secret Manager.
Review Logs: Check for unauthorized IP addresses in Cloud Logging.
📚 Best Practices Checklist
 SSH: Ensure allow_ssh uses IAP range 35.235.240.0/20.
 HTTP: Ensure http_source_ranges in tfvars is NOT 0.0.0.0/0.
 Keys: Rotate API keys every 90 days.
 Logging: Periodically review "Invalid API key" logs.
