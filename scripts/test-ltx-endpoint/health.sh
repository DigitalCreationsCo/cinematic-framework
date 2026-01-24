#!/bin/bash

LB_IP=$(terraform output -raw load_balancer_ip)
API_KEY=$(terraform output -raw api_key)

curl -X GET "$LB_IP/health" \
  -H "X-API-Key: $API_KEY" \
  -H "Content-Type: application/json"