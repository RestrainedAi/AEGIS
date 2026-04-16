#!/usr/bin/env bash
# deploy_monitor_job.sh — Build and deploy the pipeline monitor as a Cloud Run Job
# with a Cloud Scheduler trigger for the daily 8am digest.
#
# Run from Cloud Shell inside ~/yt-ingest:
#   bash deploy_monitor_job.sh
#
# Prerequisites:
#   1. Secret Manager secret 'pipeline-monitor-config' exists with email creds
#      (see setup_alerts.sh output for the command to create it)
#   2. Cloud Build has submitted cloudbuild.monitor.yaml successfully
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

PROJECT="${GCP_PROJECT:-stable-framing-482501-t9}"
REGION="us-central1"
JOB_NAME="pipeline-monitor-daily"
IMAGE="us-central1-docker.pkg.dev/${PROJECT}/aeonimus-jobs/pipeline-monitor:latest"
SCHEDULER_JOB="pipeline-monitor-daily-digest"
# 8:00 AM America/Chicago = 14:00 UTC
SCHEDULE="0 14 * * *"
SA="cloud-run-jobs@${PROJECT}.iam.gserviceaccount.com"

echo "=== Aeonimus: deploying pipeline monitor job ==="
echo "  Project  : ${PROJECT}"
echo "  Job      : ${JOB_NAME}"
echo "  Image    : ${IMAGE}"
echo "  Schedule : ${SCHEDULE} (UTC = 8am Chicago)"
echo ""

# ── Step 1: Build the container ───────────────────────────────────────────────
echo "[1/4] Building monitor container..."
gcloud builds submit \
    --config cloudbuild.monitor.yaml \
    --project="${PROJECT}" \
    .

# ── Step 2: Create or update the Cloud Run Job ────────────────────────────────
echo ""
echo "[2/4] Deploying Cloud Run Job: ${JOB_NAME}..."

# Check if job already exists
JOB_EXISTS=$(gcloud run jobs describe "${JOB_NAME}" \
    --region="${REGION}" \
    --project="${PROJECT}" \
    --format="value(name)" 2>/dev/null || true)

if [ -n "${JOB_EXISTS}" ]; then
    echo "  Job exists — updating..."
    gcloud run jobs update "${JOB_NAME}" \
        --image="${IMAGE}" \
        --region="${REGION}" \
        --project="${PROJECT}" \
        --service-account="${SA}" \
        --set-secrets="MONITOR_CONFIG=pipeline-monitor-config:latest" \
        --memory="256Mi" \
        --cpu="1" \
        --max-retries=1 \
        --task-timeout="120s"
else
    echo "  Creating new job..."
    gcloud run jobs create "${JOB_NAME}" \
        --image="${IMAGE}" \
        --region="${REGION}" \
        --project="${PROJECT}" \
        --service-account="${SA}" \
        --set-secrets="MONITOR_CONFIG=pipeline-monitor-config:latest" \
        --memory="256Mi" \
        --cpu="1" \
        --max-retries=1 \
        --task-timeout="120s"
fi

# ── Step 3: Grant service account access to secrets ───────────────────────────
echo ""
echo "[3/4] Ensuring service account can read secrets..."
gcloud secrets add-iam-policy-binding pipeline-monitor-config \
    --member="serviceAccount:${SA}" \
    --role="roles/secretmanager.secretAccessor" \
    --project="${PROJECT}" \
    --quiet 2>/dev/null || true

# ── Step 4: Create or update Cloud Scheduler trigger ─────────────────────────
echo ""
echo "[4/4] Setting up Cloud Scheduler: ${SCHEDULER_JOB}..."

# Build the job execution URL
JOB_RESOURCE="projects/${PROJECT}/locations/${REGION}/jobs/${JOB_NAME}"
TRIGGER_URL="https://${REGION}-run.googleapis.com/apis/run.googleapis.com/v1/namespaces/${PROJECT}/jobs/${JOB_NAME}:run"

SCHEDULER_EXISTS=$(gcloud scheduler jobs describe "${SCHEDULER_JOB}" \
    --location="${REGION}" \
    --project="${PROJECT}" \
    --format="value(name)" 2>/dev/null || true)

if [ -n "${SCHEDULER_EXISTS}" ]; then
    echo "  Scheduler job exists — updating schedule..."
    gcloud scheduler jobs update http "${SCHEDULER_JOB}" \
        --location="${REGION}" \
        --project="${PROJECT}" \
        --schedule="${SCHEDULE}" \
        --time-zone="America/Chicago" \
        --quiet
else
    echo "  Creating Cloud Scheduler job..."
    # Use Cloud Run Jobs direct trigger via gcloud
    gcloud scheduler jobs create http "${SCHEDULER_JOB}" \
        --location="${REGION}" \
        --project="${PROJECT}" \
        --schedule="${SCHEDULE}" \
        --time-zone="America/Chicago" \
        --uri="${TRIGGER_URL}" \
        --message-body="{}" \
        --oauth-service-account-email="${SA}" \
        --oauth-token-scope="https://www.googleapis.com/auth/cloud-platform" \
        --attempt-deadline="120s"
fi

echo ""
echo "=== Deploy complete! ==="
echo ""
echo "The daily digest will run at 8:00 AM America/Chicago and email"
echo "a pipeline health summary to the address in 'pipeline-monitor-config'."
echo ""
echo "To test immediately:"
echo "  gcloud run jobs execute ${JOB_NAME} --region=${REGION} --project=${PROJECT}"
echo ""
echo "Or trigger the scheduler manually:"
echo "  gcloud scheduler jobs run ${SCHEDULER_JOB} --location=${REGION} --project=${PROJECT}"
