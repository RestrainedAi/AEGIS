#!/bin/bash
set -euo pipefail

PROJECT="stable-framing-482501-t9"
REGION="us-central1"
REPO="aeonimus-repo"
SERVICE="suno-viewer"
IMAGE="$REGION-docker.pkg.dev/$PROJECT/$REPO/$SERVICE:latest"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VIEWER_DIR="$ROOT_DIR/suno-viewer"

echo "================================================"
echo " Aeonimus Viewer Deploy"
echo " Project : $PROJECT"
echo " Service : $SERVICE"
echo " Region  : $REGION"
echo "================================================"

echo ""
echo "[1/4] Building viewer locally..."
cd "$VIEWER_DIR"
npm run build
node --check server.js

echo ""
echo "[2/4] Building and pushing container via Cloud Build..."
gcloud builds submit . \
  --tag="$IMAGE" \
  --project="$PROJECT" \
  --machine-type=e2-medium

echo ""
echo "[3/4] Deploying Cloud Run service..."
gcloud run deploy "$SERVICE" \
  --image="$IMAGE" \
  --platform=managed \
  --region="$REGION" \
  --allow-unauthenticated \
  --port=8080 \
  --memory=512Mi \
  --cpu=1 \
  --min-instances=0 \
  --max-instances=5 \
  --project="$PROJECT" \
  --quiet

echo ""
echo "[4/4] Fetching deployed URL..."
URL=$(gcloud run services describe "$SERVICE" \
  --region="$REGION" \
  --project="$PROJECT" \
  --format='value(status.url)')

echo ""
echo "Viewer deployed to: $URL"
