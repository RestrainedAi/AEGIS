#!/usr/bin/env bash
# deploy_upload_job.sh — Task 4.4
# Builds the uploader Docker image, pushes to Artifact Registry,
# creates/updates the Cloud Run Job, and sets up a Cloud Scheduler trigger.
#
# Run from ~/yt-ingest/ after copying files there:
#   bash deploy_upload_job.sh
#
# Prerequisites:
#   - gcloud auth login / project set
#   - setup_youtube_oauth.py already run (secrets exist)
#   - Artifact Registry repo exists (created below if not)

set -euo pipefail

PROJECT="stable-framing-482501-t9"
REGION="us-central1"
REPO="aeonimus-jobs"
IMAGE="${REGION}-docker.pkg.dev/${PROJECT}/${REPO}/yt-uploader:latest"
JOB_NAME="yt-upload-job"
SA_EMAIL="cloud-run-jobs@${PROJECT}.iam.gserviceaccount.com"
SCHEDULER_JOB="yt-upload-daily"
# Run at 06:00 UTC daily (after harvest Cloud Build typically completes by 05:xx)
SCHEDULE="0 6 * * *"

echo "=== Aeonimus Vault — Deploy Upload Cloud Run Job ==="
echo "Project : $PROJECT"
echo "Region  : $REGION"
echo "Image   : $IMAGE"
echo ""

# ── 1. Ensure Artifact Registry repo ─────────────────────────────────────────
echo "[ 1/6 ] Artifact Registry repo..."
gcloud artifacts repositories describe "$REPO" \
    --location="$REGION" --project="$PROJECT" &>/dev/null \
|| gcloud artifacts repositories create "$REPO" \
    --repository-format=docker \
    --location="$REGION" \
    --project="$PROJECT" \
    --description="Aeonimus Cloud Run Job images"

# ── 2. Ensure Service Account ────────────────────────────────────────────────
echo "[ 2/6 ] Service account..."
gcloud iam service-accounts describe "$SA_EMAIL" --project="$PROJECT" &>/dev/null \
|| gcloud iam service-accounts create "cloud-run-jobs" \
    --display-name="Aeonimus Cloud Run Jobs SA" \
    --project="$PROJECT"

# Grant roles
for ROLE in \
    roles/datastore.user \
    roles/secretmanager.secretAccessor \
    roles/storage.objectViewer; do
  gcloud projects add-iam-policy-binding "$PROJECT" \
    --member="serviceAccount:${SA_EMAIL}" \
    --role="$ROLE" --quiet
done

# ── 3. Build & push Docker image ─────────────────────────────────────────────
echo "[ 3/6 ] Build & push image..."
gcloud auth configure-docker "${REGION}-docker.pkg.dev" --quiet
docker build -f Dockerfile.uploader -t "$IMAGE" .
docker push "$IMAGE"

# ── 4. Create / update Cloud Run Job ─────────────────────────────────────────
echo "[ 4/6 ] Cloud Run Job..."
if gcloud run jobs describe "$JOB_NAME" --region="$REGION" --project="$PROJECT" &>/dev/null; then
  gcloud run jobs update "$JOB_NAME" \
    --image="$IMAGE" \
    --region="$REGION" \
    --project="$PROJECT" \
    --service-account="$SA_EMAIL" \
    --max-retries=2 \
    --task-timeout=30m \
    --args="run,--limit,20"
  echo "  Job updated."
else
  gcloud run jobs create "$JOB_NAME" \
    --image="$IMAGE" \
    --region="$REGION" \
    --project="$PROJECT" \
    --service-account="$SA_EMAIL" \
    --max-retries=2 \
    --task-timeout=30m \
    --args="run,--limit,20"
  echo "  Job created."
fi

# ── 5. Grant Scheduler → Cloud Run invoker ───────────────────────────────────
echo "[ 5/6 ] Scheduler service account..."
SCHEDULER_SA="scheduler-sa@${PROJECT}.iam.gserviceaccount.com"
gcloud iam service-accounts describe "$SCHEDULER_SA" --project="$PROJECT" &>/dev/null \
|| gcloud iam service-accounts create "scheduler-sa" \
    --display-name="Cloud Scheduler SA" \
    --project="$PROJECT"

gcloud projects add-iam-policy-binding "$PROJECT" \
  --member="serviceAccount:${SCHEDULER_SA}" \
  --role="roles/run.invoker" --quiet

# ── 6. Cloud Scheduler job ───────────────────────────────────────────────────
echo "[ 6/6 ] Cloud Scheduler..."
JOB_RESOURCE="projects/${PROJECT}/locations/${REGION}/jobs/${JOB_NAME}"

if gcloud scheduler jobs describe "$SCHEDULER_JOB" \
    --location="$REGION" --project="$PROJECT" &>/dev/null; then
  gcloud scheduler jobs update http "$SCHEDULER_JOB" \
    --location="$REGION" \
    --project="$PROJECT" \
    --schedule="$SCHEDULE" \
    --time-zone="UTC" \
    --uri="https://${REGION}-run.googleapis.com/apis/run.googleapis.com/v1/namespaces/${PROJECT}/jobs/${JOB_NAME}:run" \
    --http-method=POST \
    --oauth-service-account-email="$SCHEDULER_SA"
  echo "  Scheduler job updated."
else
  gcloud scheduler jobs create http "$SCHEDULER_JOB" \
    --location="$REGION" \
    --project="$PROJECT" \
    --schedule="$SCHEDULE" \
    --time-zone="UTC" \
    --uri="https://${REGION}-run.googleapis.com/apis/run.googleapis.com/v1/namespaces/${PROJECT}/jobs/${JOB_NAME}:run" \
    --http-method=POST \
    --oauth-service-account-email="$SCHEDULER_SA"
  echo "  Scheduler job created."
fi

echo ""
echo "=== Deploy complete ==="
echo "  Cloud Run Job : $JOB_NAME ($REGION)"
echo "  Schedule      : $SCHEDULE UTC (daily at 06:00)"
echo "  Image         : $IMAGE"
echo ""
echo "To run manually:"
echo "  gcloud run jobs execute $JOB_NAME --region=$REGION --project=$PROJECT"
