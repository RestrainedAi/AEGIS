#!/bin/bash
set -euo pipefail

PROJECT="stable-framing-482501-t9"
REGION="us-central1"
REPO="aeonimus-repo"
SERVICE="suno-viewer"
IMAGE="$REGION-docker.pkg.dev/$PROJECT/$REPO/$SERVICE:latest"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VIEWER_DIR="$ROOT_DIR/suno-viewer"

resolve_cmd() {
  local primary="$1"
  local secondary="${2:-}"
  if command -v "$primary" >/dev/null 2>&1; then
    command -v "$primary"
    return 0
  fi
  if [[ -n "$secondary" ]] && command -v "$secondary" >/dev/null 2>&1; then
    command -v "$secondary"
    return 0
  fi
  return 1
}

NPM_BIN="$(resolve_cmd npm npm.cmd || true)"
NODE_BIN="$(resolve_cmd node node.exe || true)"

if [[ -z "$NPM_BIN" || -z "$NODE_BIN" ]]; then
  echo "Could not find node/npm on PATH. Open PowerShell or add Node.js to PATH, then rerun deploy_viewer.sh."
  exit 1
fi

echo "================================================"
echo " Aeonimus Viewer Deploy"
echo " Project : $PROJECT"
echo " Service : $SERVICE"
echo " Region  : $REGION"
echo "================================================"

echo ""
echo "[1/4] Building viewer locally..."
cd "$VIEWER_DIR"
"$NPM_BIN" run build
"$NODE_BIN" --check server.js

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
  --memory=2Gi \
  --cpu=2 \
  --timeout=3600 \
  --no-cpu-throttling \
  --set-env-vars=CATALOG_EXPORT_ACTIVE_JOB_STALE_MS=1800000,CATALOG_EXPORT_RESUME_STALE_MS=1800000,CATALOG_EXPORT_STORAGE_UPLOAD_TIMEOUT_MS=1200000 \
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
