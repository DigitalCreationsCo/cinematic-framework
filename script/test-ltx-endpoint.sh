#!/bin/bash

LB_IP=$(terraform output -raw load_balancer_ip)
API_KEY=$(terraform output -raw api_key)

curl -X POST "$LB_IP" \
  -H "X-API-Key: $API_KEY" \
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