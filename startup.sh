#!/usr/bin/env bash
# ==============================================================================
# startup.sh — Aeonimus Cloud Shell Session Startup & Reauth
# Run this at the start of EVERY Cloud Shell session.
# Usage: bash ~/startup.sh
# ==============================================================================

set -e

PROJECT="stable-framing-482501-t9"
WORK_DIR="$HOME/yt-ingest"
REGION="us-central1"
HARVEST_JOB="suno-harvest"
VIEWER_SVC="suno-viewer"
MEDIA_BUCKET="gs://aeonimus-suno-media"
WORKSPACES_BUCKET="gs://aeonimus-workspaces"

echo "============================================================"
echo " AEONIMUS STARTUP CHECK — $(date)"
echo "============================================================"

# ─── 1. Set project ──────────────────────────────────────────
echo ""
echo "[1/8] Setting GCP project..."
gcloud config set project "$PROJECT"
echo "  ✓ Project: $PROJECT"

# ─── 2. Check auth ───────────────────────────────────────────
echo ""
echo "[2/8] Auth status:"
gcloud auth list 2>/dev/null | head -10 || echo "  ⚠ No accounts found — run: gcloud auth login"

# ─── 3. Check ADC (Firestore SDK) ────────────────────────────
echo ""
echo "[3/8] Checking Application Default Credentials..."
if gcloud auth application-default print-access-token &>/dev/null; then
    echo "  ✓ ADC is active"
else
    echo "  ⚠ ADC expired or missing. Refreshing..."
    gcloud auth application-default login
fi

# ─── 4. Work dir ─────────────────────────────────────────────
echo ""
echo "[4/8] Work directory..."
if [ -d "$WORK_DIR" ]; then
    echo "  ✓ $WORK_DIR exists"
    ls "$WORK_DIR"/*.py 2>/dev/null | head -6 | xargs -I{} basename {} || echo "  (no .py files)"
else
    echo "  ⚠ $WORK_DIR missing — clone repo or restore from GCS"
fi

# ─── 5. Playwright check ─────────────────────────────────────
echo ""
echo "[5/8] Playwright..."
if python3 -c "from playwright.async_api import async_playwright; print('  ✓ Playwright OK')" 2>/dev/null; then
    :
else
    echo "  ⚠ Playwright not available. Installing..."
    pip install playwright --break-system-packages -q
    playwright install chromium
fi

# ─── 6. Harvest log tail ─────────────────────────────────────
echo ""
echo "[6/8] Recent harvest activity:"
LOGFILE="$WORK_DIR/harvest_run.log"
if [ -f "$LOGFILE" ]; then
    echo "--- last 20 lines of $LOGFILE ---"
    tail -20 "$LOGFILE"
else
    echo "  ⚠ harvest_run.log not found at $LOGFILE"
    echo "  Check Cloud Run Job logs instead:"
    echo "  gcloud run jobs executions list --job $HARVEST_JOB --region $REGION --limit 5"
fi

# ─── 7. Cloud Run Job status ─────────────────────────────────
echo ""
echo "[7/8] Cloud Run Job — last 3 executions:"
gcloud run jobs executions list \
    --job "$HARVEST_JOB" \
    --region "$REGION" \
    --limit 3 \
    --format "table(name.basename(), status.completionTime, status.conditions[0].type)" \
    2>/dev/null || echo "  (no executions found)"

# ─── 8. GCS media count ──────────────────────────────────────
echo ""
echo "[8/8] GCS media file counts:"
echo -n "  Total objects in aeonimus-suno-media: "
gsutil ls "$MEDIA_BUCKET/suno/handles/unshakableechos2341/" 2>/dev/null | wc -l || echo "?"
echo -n "  MP3 files:  "
gsutil ls "$MEDIA_BUCKET/suno/handles/unshakableechos2341/*.mp3" 2>/dev/null | wc -l || echo "?"
echo -n "  MP4 files:  "
gsutil ls "$MEDIA_BUCKET/suno/handles/unshakableechos2341/*.mp4" 2>/dev/null | wc -l || echo "?"
echo -n "  Thumbnails: "
gsutil ls "$MEDIA_BUCKET/suno/handles/unshakableechos2341/*.jpg" 2>/dev/null | wc -l || echo "?"

echo ""
echo "============================================================"
echo " STARTUP COMPLETE"
echo ""
echo " Quick commands:"
echo "   Trigger harvest:   gcloud run jobs execute $HARVEST_JOB --region $REGION"
echo "   Watch harvest log: tail -f $WORK_DIR/harvest_run.log"
echo "   Deploy rules:      firebase deploy --only firestore:rules,firestore:indexes --project $PROJECT"
echo "   Check viewer:      gcloud run services describe $VIEWER_SVC --region $REGION"
echo "============================================================"
