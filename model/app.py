from fastapi import FastAPI
from google.cloud import aiplatform, storage
import os

app = FastAPI()
PROJECT_ID = os.getenv("GCP_PROJECT_ID")
REGION = os.getenv("GCP_REGION")

aiplatform.init(project=PROJECT_ID, location=REGION)

@app.post("/generate-video")
async def generate(prompt: str):
    # Use Vertex AI endpoint for inference
    endpoint = aiplatform.Endpoint("projects/{}/locations/{}/endpoints/{}".format(
        PROJECT_ID, REGION, "your-endpoint-id"
    ))
    
    response = endpoint.predict(instances=[{"prompt": prompt}])
    return {"video_url": response.predictions[0]}