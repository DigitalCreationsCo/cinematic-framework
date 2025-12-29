#!/bin/bash
#
# LTX Video VM Startup Script
# This script installs all dependencies, downloads the model, and starts the serving API
#

set -e

# Configuration from Terraform
PROJECT_ID="${project_id}"
REGION="${region}"
MODEL_CACHE_BUCKET="${model_cache_bucket}"
OUTPUT_BUCKET="${output_bucket}"
HF_MODEL_ID="${hf_model_id}"
ENABLE_AUTO_UPDATE="${enable_auto_update}"
API_KEYS_SECRET="${api_keys_secret}"
ENABLE_AUTH="${enable_auth}"

# Logging setup
LOGFILE="/var/log/ltx-video-startup.log"
exec 1> >(tee -a "$LOGFILE")
exec 2>&1

echo "=========================================="
echo "LTX Video VM Startup Script"
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
if [ "$ENABLE_AUTO_UPDATE" = "true" ]; then
    log "Updating system packages..."
    apt-get update -y
    check_success "System package update"
fi

# Install system dependencies
log "Installing system dependencies..."
apt-get install -y \
    python3-pip \
    python3-dev \
    git \
    ffmpeg \
    libsm6 \
    libxext6 \
    libxrender-dev \
    libgomp1 \
    wget \
    curl \
    htop \
    tmux \
    vim
check_success "System dependencies installation"

# Wait for NVIDIA drivers to be ready
log "Waiting for NVIDIA GPU drivers..."
MAX_RETRIES=60
RETRY_COUNT=0
while ! nvidia-smi &> /dev/null; do
    if [ $RETRY_COUNT -ge $MAX_RETRIES ]; then
        log "✗ NVIDIA drivers failed to load after $MAX_RETRIES attempts"
        exit 1
    fi
    log "Waiting for NVIDIA drivers... (attempt $((RETRY_COUNT + 1))/$MAX_RETRIES)"
    sleep 10
    RETRY_COUNT=$((RETRY_COUNT + 1))
done
log "✓ NVIDIA drivers loaded successfully"
nvidia-smi

# Set up Python environment
log "Setting up Python environment..."
pip3 install --upgrade pip setuptools wheel
check_success "Pip upgrade"

# Install Python dependencies
log "Installing Python dependencies..."
cat > /tmp/requirements.txt << 'EOF'
torch==2.1.0
torchvision==0.16.0
torchaudio==2.1.0
transformers==4.37.0
diffusers==0.25.0
accelerate==0.26.0
sentencepiece==0.1.99
protobuf==4.25.1
safetensors==0.4.2
imageio[ffmpeg]==2.33.1
imageio-ffmpeg==0.4.9
opencv-python==4.9.0.80
Pillow==10.2.0
fastapi==0.109.0
uvicorn[standard]==0.27.0
pydantic==2.5.3
google-cloud-storage==2.14.0
google-auth==2.27.0
numpy==1.24.3
scipy==1.11.4
xformers==0.0.23
EOF

pip3 install --no-cache-dir -r /tmp/requirements.txt
check_success "Python dependencies installation"

# Create application directory
log "Creating application directory..."
mkdir -p /opt/ltx-video
cd /opt/ltx-video
check_success "Application directory creation"

# Clone LTX Video repository
log "Cloning LTX Video repository..."
if [ ! -d "/opt/ltx-video/ltx-video" ]; then
    git clone https://github.com/Lightricks/LTX-Video.git ltx-video
    check_success "LTX Video repository clone"
else
    log "LTX Video repository already exists"
fi

# Install LTX Video package
log "Installing LTX Video package..."
cd /opt/ltx-video/ltx-video
pip3 install -e .
check_success "LTX Video package installation"
cd /opt/ltx-video

# Create serving application
log "Creating serving application..."
cat > /opt/ltx-video/serve.py << 'PYEOF'
"""
LTX Video Generation Serving API
Production-grade FastAPI server with authentication
"""

from fastapi import FastAPI, HTTPException, Request, Security, Depends
from fastapi.security import APIKeyHeader
from pydantic import BaseModel, Field, validator
import os
import sys
import torch
import logging
from typing import Optional
from google.cloud import storage, secretmanager
import uuid
from datetime import datetime
import re
import traceback
import json

# Add LTX Video to path
sys.path.insert(0, '/opt/ltx-video/ltx-video')

from ltx_video.inference import infer, InferenceConfig

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

app = FastAPI(
    title="LTX Video Generation API",
    description="Text-to-video generation using Lightricks LTX-Video",
    version="1.0.0"
)

# Global state
storage_client = None
secret_client = None
valid_api_keys = {}
DEFAULT_BUCKET = os.environ.get("OUTPUT_BUCKET")
PROJECT_ID = os.environ.get("PROJECT_ID")
MODEL_CONFIG = os.environ.get("MODEL_CONFIG", "/opt/ltx-video/ltx-video/configs/ltxv-13b-0.9.8-dev-fp8.yaml")
API_KEYS_SECRET = os.environ.get("API_KEYS_SECRET")
ENABLE_AUTH = os.environ.get("ENABLE_AUTH", "true").lower() == "true"

# API Key authentication
api_key_header = APIKeyHeader(name="X-API-Key", auto_error=False)


def load_api_keys():
    """Load API keys from Secret Manager"""
    global valid_api_keys, secret_client
    
    if not ENABLE_AUTH:
        logger.info("Authentication disabled")
        return
    
    try:
        if not secret_client:
            secret_client = secretmanager.SecretManagerServiceClient()
        
        name = f"projects/{PROJECT_ID}/secrets/{API_KEYS_SECRET}/versions/latest"
        response = secret_client.access_secret_version(request={"name": name})
        secret_data = json.loads(response.payload.data.decode("UTF-8"))
        
        valid_api_keys = {
            key["key"]: {
                "name": key["name"],
                "enabled": key.get("enabled", True),
                "rate_limit": key.get("rate_limit", {})
            }
            for key in secret_data.get("keys", [])
        }
        
        logger.info(f"Loaded {len(valid_api_keys)} API keys")
    except Exception as e:
        logger.error(f"Failed to load API keys: {e}")
        valid_api_keys = {}


async def verify_api_key(api_key: str = Security(api_key_header)):
    """Verify API key from request header"""
    if not ENABLE_AUTH:
        return {"name": "anonymous", "enabled": True}
    
    if api_key is None:
        raise HTTPException(
            status_code=401,
            detail="Missing API key. Include X-API-Key header."
        )
    
    if api_key not in valid_api_keys:
        logger.warning(f"Invalid API key attempted: {api_key[:8]}...")
        raise HTTPException(
            status_code=403,
            detail="Invalid API key"
        )
    
    key_info = valid_api_keys[api_key]
    if not key_info.get("enabled", True):
        raise HTTPException(
            status_code=403,
            detail="API key disabled"
        )
    
    logger.info(f"Authenticated request from: {key_info['name']}")
    return key_info


class InferenceRequest(BaseModel):
    """Request model for video generation"""
    prompt: str = Field(..., description="Text prompt for video generation", min_length=1)
    negative_prompt: Optional[str] = Field("", description="Negative prompt")
    seed: int = Field(171198, description="Random seed", ge=0)
    height: int = Field(704, description="Video height", ge=256, le=1024)
    width: int = Field(1216, description="Video width", ge=256, le=1920)
    num_frames: int = Field(121, description="Number of frames", ge=1, le=240)
    num_inference_steps: int = Field(50, description="Inference steps", ge=1, le=100)
    fps: int = Field(24, description="Frames per second", ge=1, le=60)
    gcs_destination: Optional[str] = Field(None, description="Custom GCS path")
    
    @validator('gcs_destination')
    def validate_gcs_path(cls, v):
        if v is not None:
            if not v.startswith('gs://'):
                raise ValueError("GCS destination must start with 'gs://'")
            if not v.endswith('.mp4'):
                raise ValueError("GCS destination must end with '.mp4'")
        return v


class InferenceResponse(BaseModel):
    """Response model"""
    video_url: str
    video_path: str
    seed: int
    gcs_bucket: str
    gcs_blob: str
    generation_time_seconds: float
    metadata: dict


def parse_gcs_path(gcs_path: str) -> tuple:
    """Parse GCS path into bucket and blob"""
    path = gcs_path.replace("gs://", "")
    parts = path.split("/", 1)
    return parts[0], parts[1] if len(parts) > 1 else ""


@app.on_event("startup")
async def startup_event():
    """Initialize service on startup"""
    global storage_client
    
    logger.info("=" * 60)
    logger.info("Starting LTX Video Generation Service")
    logger.info(f"Project ID: {PROJECT_ID}")
    logger.info(f"Default Bucket: {DEFAULT_BUCKET}")
    logger.info(f"Model Config: {MODEL_CONFIG}")
    logger.info(f"Authentication: {'Enabled' if ENABLE_AUTH else 'Disabled'}")
    logger.info("=" * 60)
    
    try:
        # Initialize GCS client
        storage_client = storage.Client(project=PROJECT_ID)
        logger.info("✓ GCS client initialized")
        
        # Load API keys
        if ENABLE_AUTH:
            load_api_keys()
        
        # Check GPU availability
        if torch.cuda.is_available():
            gpu_name = torch.cuda.get_device_name(0)
            gpu_memory = torch.cuda.get_device_properties(0).total_memory / 1e9
            logger.info(f"✓ GPU: {gpu_name} ({gpu_memory:.2f} GB)")
        else:
            logger.warning("⚠ No GPU detected - inference will be slow")
        
        # Verify model config exists
        if not os.path.exists(MODEL_CONFIG):
            logger.error(f"Model config not found: {MODEL_CONFIG}")
            raise FileNotFoundError(f"Model config not found: {MODEL_CONFIG}")
        
        logger.info("✓ Service ready")
        
    except Exception as e:
        logger.error(f"Startup failed: {e}")
        logger.error(traceback.format_exc())
        raise


@app.post("/predict", response_model=InferenceResponse)
async def predict(
    request: InferenceRequest,
    key_info: dict = Depends(verify_api_key)
):
    """Generate video from text prompt"""
    start_time = datetime.now()
    
    try:
        logger.info("=" * 60)
        logger.info(f"New request from: {key_info.get('name', 'anonymous')}")
        logger.info(f"Prompt: {request.prompt}")
        
        # Create output directory
        output_dir = "/tmp/ltx-output"
        os.makedirs(output_dir, exist_ok=True)
        
        # Configure inference
        config = InferenceConfig(
            pipeline_config=MODEL_CONFIG,
            prompt=request.prompt,
            negative_prompt=request.negative_prompt,
            seed=request.seed,
            height=request.height,
            width=request.width,
            num_frames=request.num_frames,
            num_inference_steps=request.num_inference_steps,
            fps=request.fps,
            output_path=output_dir,
        )
        
        # Generate video
        logger.info("Starting inference...")
        infer(config=config)
        logger.info("✓ Inference complete")
        
        # Find generated video
        files = [f for f in os.listdir(output_dir) if f.endswith('.mp4')]
        if not files:
            raise HTTPException(status_code=500, detail="No video generated")
        
        local_path = os.path.join(output_dir, files[0])
        logger.info(f"Video saved: {local_path} ({os.path.getsize(local_path) / 1e6:.2f} MB)")
        
        # Determine GCS destination
        if request.gcs_destination:
            bucket_name, blob_path = parse_gcs_path(request.gcs_destination)
        else:
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            video_id = str(uuid.uuid4())[:8]
            filename = f"ltx_video_{timestamp}_{video_id}.mp4"
            bucket_name = DEFAULT_BUCKET
            blob_path = f"videos/{filename}"
        
        # Upload to GCS
        try:
            bucket = storage_client.bucket(bucket_name)
            blob = bucket.blob(blob_path)
            blob.upload_from_filename(local_path, content_type='video/mp4')
            blob.make_public()
            video_url = blob.public_url
            logger.info(f"✓ Uploaded to: {video_url}")
            
            # Cleanup
            os.remove(local_path)
        except Exception as e:
            logger.error(f"GCS upload failed: {e}")
            video_url = local_path
        
        generation_time = (datetime.now() - start_time).total_seconds()
        logger.info(f"✓ Total time: {generation_time:.2f}s")
        
        return InferenceResponse(
            video_url=video_url,
            video_path=blob_path,
            seed=request.seed,
            gcs_bucket=bucket_name,
            gcs_blob=blob_path,
            generation_time_seconds=generation_time,
            metadata={
                "prompt": request.prompt,
                "num_frames": request.num_frames,
                "resolution": f"{request.width}x{request.height}",
                "fps": request.fps,
                "user": key_info.get('name', 'anonymous')
            }
        )
        
    except Exception as e:
        logger.error(f"Prediction failed: {e}")
        logger.error(traceback.format_exc())
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/health")
async def health():
    """Health check endpoint (no auth required)"""
    gpu_info = None
    if torch.cuda.is_available():
        gpu_info = {
            "name": torch.cuda.get_device_name(0),
            "memory_allocated_gb": torch.cuda.memory_allocated(0) / 1e9,
            "memory_total_gb": torch.cuda.get_device_properties(0).total_memory / 1e9
        }
    
    return {
        "status": "healthy",
        "gpu_available": torch.cuda.is_available(),
        "gpu_info": gpu_info,
        "model_config": MODEL_CONFIG,
        "default_bucket": DEFAULT_BUCKET,
        "authentication": "enabled" if ENABLE_AUTH else "disabled",
        "api_keys_loaded": len(valid_api_keys) if ENABLE_AUTH else 0
    }


@app.get("/")
async def root():
    """Root endpoint"""
    return {
        "service": "LTX Video Generation API",
        "version": "1.0.0",
        "authentication": "enabled" if ENABLE_AUTH else "disabled",
        "endpoints": {
            "predict": "/predict (requires X-API-Key header)" if ENABLE_AUTH else "/predict",
            "health": "/health",
            "docs": "/docs"
        },
        "security": {
            "cloud_armor": "enabled",
            "rate_limiting": "enabled",
            "authentication": "enabled" if ENABLE_AUTH else "disabled"
        }
    }
PYEOF
check_success "Serving application creation"

# Create systemd service
log "Creating systemd service..."
cat > /etc/systemd/system/ltx-video.service << EOF
[Unit]
Description=LTX Video Generation API
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/opt/ltx-video
Environment="PROJECT_ID=$PROJECT_ID"
Environment="OUTPUT_BUCKET=$OUTPUT_BUCKET"
Environment="MODEL_CONFIG=/opt/ltx-video/ltx-video/configs/ltxv-13b-0.9.8-dev-fp8.yaml"
Environment="API_KEYS_SECRET=$API_KEYS_SECRET"
Environment="ENABLE_AUTH=$ENABLE_AUTH"
Environment="PYTHONUNBUFFERED=1"
Environment="CUDA_VISIBLE_DEVICES=0"
ExecStart=/usr/bin/python3 -m uvicorn serve:app --host 0.0.0.0 --port 8080 --workers 1 --timeout-keep-alive 300
Restart=always
RestartSec=10
StandardOutput=append:/var/log/ltx-video.log
StandardError=append:/var/log/ltx-video-error.log

[Install]
WantedBy=multi-user.target
EOF
check_success "Systemd service creation"

# Model Caching Logic
CACHE_DIR="/opt/ltx-video/.cache"
ARCHIVE_NAME="ltx-video-model-cache.tar.gz"
# Escape shell variables with $${} so Terraform ignores them
GCS_ARCHIVE_PATH="gs://$${MODEL_CACHE_BUCKET}/$${ARCHIVE_NAME}"
export HF_HOME="$${CACHE_DIR}"
export TRANSFORMERS_CACHE="$${CACHE_DIR}"

log "Checking for model cache in GCS: $${GCS_ARCHIVE_PATH}..."

if gsutil -q stat "$${GCS_ARCHIVE_PATH}"; then
    log "✓ Found cache in GCS. Downloading and extracting..."
    mkdir -p "$${CACHE_DIR}"
    
    # Download archive
    gsutil cp "$${GCS_ARCHIVE_PATH}" "/tmp/$${ARCHIVE_NAME}"
    check_success "Cache download"
    
    # Extract archive (it contains full path opt/ltx-video/.cache)
    tar -xzf "/tmp/$${ARCHIVE_NAME}" -C /
    check_success "Cache extraction"
    
    rm "/tmp/$${ARCHIVE_NAME}"
    log "✓ Model cache restored from GCS"
else
    log "⚠ Cache not found in GCS. Downloading from Hugging Face..."
    
    # Run download script
    python3 << 'DLEOF'
import torch
from diffusers import DiffusionPipeline
import os

os.environ['HF_HOME'] = '/opt/ltx-video/.cache'
os.environ['TRANSFORMERS_CACHE'] = '/opt/ltx-video/.cache'

try:
    print("Downloading model from Hugging Face...")
    pipe = DiffusionPipeline.from_pretrained(
        "Lightricks/LTX-Video",
        torch_dtype=torch.float16,
        use_safetensors=True
    )
    print("Model downloaded successfully")
except Exception as e:
    print(f"Model download failed (will retry at runtime): {e}")
    exit(1)
DLEOF
    check_success "Model download from Hugging Face"

    # Upload to GCS for next time
    log "Creating cache archive and uploading to GCS..."
    # Archive the directory. -C / changes to root, so we archive opt/ltx-video/.cache
    tar -czf "/tmp/$${ARCHIVE_NAME}" -C / opt/ltx-video/.cache
    check_success "Cache compression"
    
    gsutil cp "/tmp/$${ARCHIVE_NAME}" "$${GCS_ARCHIVE_PATH}"
    check_success "Cache upload to GCS"
    
    rm "/tmp/$${ARCHIVE_NAME}"
    log "✓ Model cache uploaded to GCS"
fi

# Enable and start service
log "Enabling and starting LTX Video service..."
systemctl daemon-reload
systemctl enable ltx-video.service
systemctl start ltx-video.service
check_success "Service start"

# Wait for service to be ready
log "Waiting for service to be ready..."
sleep 10
for i in {1..30}; do
    if curl -f http://localhost:8080/health &> /dev/null; then
        log "✓ Service is healthy and responding"
        break
    fi
    if [ $i -eq 30 ]; then
        log "⚠ Service health check timeout"
    fi
    sleep 2
done

# Final status
log "=========================================="
log "LTX Video VM Setup Complete!"
log "Service status: $(systemctl is-active ltx-video.service)"
log "API endpoint: http://$(hostname -I | awk '{print $1}'):8080"
log "Logs: journalctl -u ltx-video.service -f"
log "=========================================="

exit 0