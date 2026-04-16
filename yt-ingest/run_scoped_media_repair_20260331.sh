#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MANIFEST="$SCRIPT_DIR/scoped_media_repair_manifest_20260331.csv"

echo "[scoped-repair] manifest: $MANIFEST"
echo "[scoped-repair] ensuring Playwright browser is installed..."
python3 -m playwright install
MANIFEST_CSV="$MANIFEST" python3 "$SCRIPT_DIR/download_media_gcs.py"

echo
echo "[scoped-repair] verifying repaired MP4 objects..."
gsutil stat "gs://aeonimus-suno-media/suno/handles/unshakableechos2341/63cae7f5-8d32-4ef1-9fd7-79983121501c.mp4"
gsutil stat "gs://aeonimus-suno-media/suno/handles/unshakableechos2341/c901a10f-9e5c-40a0-b395-a456e17c98d0.mp4"
