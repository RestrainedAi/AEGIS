#!/usr/bin/env bash
# ============================================================
# RUNBOOK — Fix stale vault + wire YouTube pipeline
# Run this in Cloud Shell after quota resets (12:33 PM Mar 21)
# cd ~/yt-ingest first, then: bash /path/to/this/file
# OR copy-paste one section at a time
# ============================================================

PROJECT="stable-framing-482501-t9"
REGION="us-central1"

echo "=== STEP 0: Auth check & project ==="
gcloud config set project $PROJECT
gcloud auth list | head -6
# If "No credentialed accounts" → run: gcloud auth login
# Then: gcloud auth application-default login  (for Python Firestore SDK)

echo ""
echo "=== STEP 1: Check what build_items_csv.py expects ==="
cd ~/yt-ingest
head -40 build_items_csv.py      # see args/output path
echo ""
head -20 catalog_sync_firestore_multi.py  # see if it auto-builds CSV too

echo ""
echo "=== STEP 2: Run catalog sync (GCS → Firestore delta) ==="
# This syncs new clips from GCS raw_clip_json/ into Firestore
python3 catalog_sync_firestore_multi.py
# Expected output: "N new, M removed, K GCS gaps" — should show 239+ new songs

echo ""
echo "=== STEP 3: Rebuild catalog.csv from Firestore ==="
# Check the output path first (probably ~/suno-viewer/public/catalog.csv
#   or ~/suno-viewer/web/catalog.csv or outputs to stdout)
python3 build_items_csv.py
# If it needs an output arg, try:
# python3 build_items_csv.py --output ~/suno-viewer/public/catalog.csv
# Or:
# python3 build_items_csv.py > ~/suno-viewer/public/catalog.csv

echo ""
echo "=== STEP 4: Verify catalog.csv row count + newest date ==="
CSV_PATH=$(find ~/suno-viewer -name "catalog.csv" 2>/dev/null | head -1)
echo "CSV at: $CSV_PATH"
wc -l "$CSV_PATH"                  # should be 1496+ (was 1257)
# Check newest runId/lastSeenAt date:
python3 -c "
import csv
rows = list(csv.DictReader(open('$CSV_PATH')))
dates = sorted([r.get('lastSeenAt','') or r.get('runId','') for r in rows], reverse=True)
print('Newest date:', dates[0])
print('Total rows:', len(rows))
"

echo ""
echo "=== STEP 5: Deploy updated catalog to Firebase Hosting ==="
cd ~/suno-viewer
firebase deploy --only hosting --project $PROJECT
# This pushes catalog.csv to music.aeonimus.info/catalog.csv

echo ""
echo "=== STEP 6: Verify vault shows new songs ==="
echo "Open music.aeonimus.info/vanessa and confirm count > 1,257 and newest date > March 1"
# Quick API check:
curl -s "https://music.aeonimus.info/catalog.csv" | wc -l

echo ""
echo "=== STEP 7: Deploy queue-youtube API route to suno-viewer ==="
# Copy the route file built by Claude:
cp ~/Downloads/queue-youtube.ts ~/suno-viewer/routes/  2>/dev/null || \
  echo "Copy queue-youtube.ts from outputs folder to ~/suno-viewer/routes/"

# Add to server.ts (find the file and add import):
# In ~/suno-viewer/src/server.ts add:
#   import queueYt from './routes/queue-youtube';
#   app.use(express.json());
#   app.use(queueYt);

echo ""
echo "=== STEP 8: Rebuild & deploy suno-viewer with Publish button ==="
cd ~/suno-viewer
# Apply VaultGrid.publish.patch.md changes to src/VaultGrid.tsx first
# Then rebuild:
gcloud builds submit \
  --tag "$REGION-docker.pkg.dev/$PROJECT/aeonimus-repo/suno-viewer:latest" \
  --project $PROJECT
gcloud run services update suno-viewer \
  --image "$REGION-docker.pkg.dev/$PROJECT/aeonimus-repo/suno-viewer:latest" \
  --region $REGION --project $PROJECT

echo ""
echo "=== STEP 9: Queue test clip for YouTube ==="
cd ~/yt-ingest
# Find a clip songKey to test with:
python3 -c "
import csv
rows = list(csv.DictReader(open('$CSV_PATH')))
# Get a recent clip with an mp4 GCS path
candidates = [r for r in rows if r.get('gcs_mp4') and r.get('status') != 'removed_from_suno']
if candidates:
    c = candidates[-1]  # newest clip (CSV is sorted by UUID, pick last for now)
    print('Test clip:')
    print('  songKey:', c['songKey'])
    print('  title:', c['title'][:60])
    print('  gcs_mp4:', c['gcs_mp4'])
"
# Then enqueue it:
# python3 queue_manager.py enqueue <songKey>

echo ""
echo "=== STEP 10: Trigger upload job manually (don't wait for 06:00 UTC) ==="
gcloud run jobs execute yt-upload-job \
  --region=$REGION \
  --project=$PROJECT

echo ""
echo "=== STEP 11: Watch upload job logs ==="
gcloud run jobs executions list \
  --job=yt-upload-job --region=$REGION --project=$PROJECT --limit=3

# To stream logs:
# gcloud logging read "resource.type=cloud_run_job AND resource.labels.job_name=yt-upload-job" \
#   --project=$PROJECT --limit=50 --format="table(timestamp,textPayload)"

echo ""
echo "=== STEP 12: Post-harvest automation (permanent fix — task 4.8) ==="
# Add a new Cloud Scheduler job that runs catalog rebuild daily at 3 AM UTC
# (1 hour after suno-harvest at 2 AM)
# This requires building a catalog-sync Cloud Run Job image — see task 4.8

echo ""
echo "=== DONE ==="
echo "Vault should now show all 1,496+ Vanessa songs"
echo "First YouTube video should appear at youtube.com/@AeonimusAI within minutes"
