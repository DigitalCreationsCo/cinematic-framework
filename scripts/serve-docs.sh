#!/bin/bash
echo "Starting documentation server..."
echo "Open http://localhost:8000/docs/ in your browser."
# Ensure we are in the project root
cd "$(dirname "$0")/.."
python3 -m http.server 8000
