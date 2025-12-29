#!/bin/bash
#
# LTX Video VM Startup Script - CPU MOCK MODE
# This script installs minimal dependencies and starts a MOCK serving API
#

set -e

# Configuration from Terraform
PROJECT_ID="${project_id}"
REGION="${region}"
OUTPUT_BUCKET="${output_bucket}"
API_KEYS_SECRET="${api_keys_secret}"
ENABLE_AUTH="${enable_auth}"

# Logging setup
LOGFILE="/var/log/ltx-video-startup.log"
exec 1> >(tee -a "$LOGFILE")
exec 2>&1

echo "=========================================="
echo "LTX Video VM Startup Script (CPU MOCK)"
echo "Started at: $(date)"
echo "=========================================="

# Function to log with timestamp
log() {
    echo "[$(date +'%Y-%m-%d %H:%M:%S')] $1"
}

# Function to check if command succeeded
check_success() {
    if [ $? -eq 0 ]; then
        log "✓ $1"
    else
        log "✗ $1 failed"
        exit 1
    fi
}

# Update system packages
log "Updating system packages..."
apt-get update -y
check_success "System package update"

# Install minimal system dependencies
log "Installing system dependencies..."
apt-get install -y \
    python3-pip \
    python3-dev \
    ffmpeg \
    curl \
    vim
check_success "System dependencies installation"

# Set up Python environment
log "Setting up Python environment..."
pip3 install --upgrade pip
pip3 install fastapi uvicorn pydantic google-cloud-storage google-cloud-secret-manager google-auth
check_success "Python dependencies installation"

# Create application directory
mkdir -p /opt/ltx-video
cd /opt/ltx-video

# Create MOCK serving application
log "Creating MOCK serving application..."
cat > /opt/ltx-video/serve.py << 'PYEOF'
from fastapi import FastAPI, HTTPException, Security, Depends
from fastapi.security import APIKeyHeader
from pydantic import BaseModel, Field
import os
import time
import logging
from google.cloud import storage
import uuid
from datetime import datetime
import subprocess

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="LTX Video API (MOCK)", version="1.0.0-cpu")

# Mock Auth
API_KEYS_SECRET = os.environ.get("API_KEYS_SECRET")
ENABLE_AUTH = os.environ.get("ENABLE_AUTH", "true").lower() == "true"
api_key_header = APIKeyHeader(name="X-API-Key", auto_error=False)

async def verify_api_key(api_key: str = Security(api_key_header)):
    if not ENABLE_AUTH: return {"name": "anonymous"}
    if api_key: return {"name": "mock-user"} # Accept any key in mock mode
    raise HTTPException(status_code=401, detail="Missing API Key")

class InferenceRequest(BaseModel):
    prompt: str
    negative_prompt: str = ""
    width: int = 1280
    height: int = 720
    num_frames: int = 121

class InferenceResponse(BaseModel):
    video_url: str
    video_path: str
    seed: int = 42
    gcs_bucket: str
    gcs_blob: str
    generation_time_seconds: float
    metadata: dict

@app.get("/health")
async def health():
    return {
        "status": "healthy",
        "mode": "cpu-mock",
        "gpu_available": False,
        "authentication": "enabled" if ENABLE_AUTH else "disabled"
    }

@app.post("/predict", response_model=InferenceResponse)
async def predict(request: InferenceRequest, key_info: dict = Depends(verify_api_key)):
    logger.info(f"MOCK Inference request: {request.prompt}")
    start_time = datetime.now()
    
    # Simulate work
    time.sleep(2) 
    
    # Generate dummy video using ffmpeg
    output_filename = f"mock_{uuid.uuid4()}.mp4"
    local_path = f"/tmp/{output_filename}"
    
    # Create blue video with text
    cmd = [
        "ffmpeg", "-y", "-f", "lavfi", 
        f"color=c=blue:s={request.width}x{request.height}:d=2",
        "-vf", f"drawtext=text='MOCK VIDEO':fontsize=64:fontcolor=white:x=(w-text_w)/2:y=(h-text_h)/2",
        "-c:v", "libx264", "-pix_fmt", "yuv420p", 
        local_path
    ]
    subprocess.run(cmd, check=True)
    
    # Upload to GCS
    bucket_name = os.environ.get("OUTPUT_BUCKET")
    blob_path = f"videos/{output_filename}"
    
    storage_client = storage.Client()
    bucket = storage_client.bucket(bucket_name)
    blob = bucket.blob(blob_path)
    blob.upload_from_filename(local_path)
    blob.make_public()
    
    generation_time = (datetime.now() - start_time).total_seconds()
    
    return InferenceResponse(
        video_url=blob.public_url,
        video_path=blob_path,
        gcs_bucket=bucket_name,
        gcs_blob=blob_path,
        generation_time_seconds=generation_time,
        metadata={"prompt": request.prompt, "mock": True}
    )
PYEOF
check_success "Mock app creation"

# Create systemd service
log "Creating systemd service..."
cat > /etc/systemd/system/ltx-video.service << EOF
[Unit]
Description=LTX Video Mock API
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/opt/ltx-video
Environment="PROJECT_ID=$PROJECT_ID"
Environment="OUTPUT_BUCKET=$OUTPUT_BUCKET"
Environment="API_KEYS_SECRET=$API_KEYS_SECRET"
Environment="ENABLE_AUTH=$ENABLE_AUTH"
ExecStart=/usr/bin/python3 -m uvicorn serve:app --host 0.0.0.0 --port 8080
Restart=always

[Install]
WantedBy=multi-user.target
EOF
check_success "Systemd service creation"

# Start service
systemctl daemon-reload
systemctl enable ltx-video.service
systemctl start ltx-video.service
check_success "Service start"

# Verify
sleep 5
curl http://localhost:8080/health
check_success "Health check"

exit 0
