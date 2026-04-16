#!/usr/bin/env bash
# setup_alerts.sh — One-time setup for Cloud Monitoring alerting
# Run this from Cloud Shell once. It creates:
#   1. An email notification channel (alerts go to ALERT_EMAIL)
#   2. Alert policy: suno-harvest job failed (execution exit code != 0)
#   3. Alert policy: yt-upload-job failed (execution exit code != 0)
#
# Usage:
#   ALERT_EMAIL=you@gmail.com bash setup_alerts.sh
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

PROJECT="${GCP_PROJECT:-stable-framing-482501-t9}"
ALERT_EMAIL="${ALERT_EMAIL:-aeonimusai@gmail.com}"
REGION="us-central1"

echo "=== Aeonimus: setting up Cloud Monitoring alerts ==="
echo "  Project : ${PROJECT}"
echo "  Email   : ${ALERT_EMAIL}"
echo ""

# ── 1. Create email notification channel ─────────────────────────────────────
echo "[1/3] Creating email notification channel..."

CHANNEL_JSON=$(cat <<EOF
{
  "type": "email",
  "displayName": "Aeonimus Pipeline Alerts",
  "labels": {
    "email_address": "${ALERT_EMAIL}"
  }
}
EOF
)

CHANNEL_RESPONSE=$(echo "${CHANNEL_JSON}" | gcloud beta monitoring channels create \
    --channel-content-from-file=- \
    --project="${PROJECT}" \
    --format="json" 2>/dev/null || true)

# If channel already exists, look it up
if [ -z "${CHANNEL_RESPONSE}" ]; then
    echo "  Channel may already exist — looking up..."
    CHANNEL_NAME=$(gcloud beta monitoring channels list \
        --project="${PROJECT}" \
        --filter="labels.email_address=${ALERT_EMAIL}" \
        --format="value(name)" | head -1)
else
    CHANNEL_NAME=$(echo "${CHANNEL_RESPONSE}" | python3 -c "import json,sys; print(json.load(sys.stdin).get('name',''))")
fi

if [ -z "${CHANNEL_NAME}" ]; then
    echo "  [ERROR] Could not create or find notification channel."
    echo "  Create it manually in the GCP console:"
    echo "    https://console.cloud.google.com/monitoring/alerting/notifications?project=${PROJECT}"
    exit 1
fi
echo "  Channel: ${CHANNEL_NAME}"

# ── Helper: create an alert policy for a Cloud Run Job ───────────────────────
create_job_failure_alert() {
    local job_name="$1"
    local display_name="$2"

    echo ""
    echo "[?/3] Creating alert policy: ${display_name}..."

    # Cloud Run Jobs emit the metric run.googleapis.com/job/completed_execution_count
    # with label execution_environment and status (succeeded / failed).
    # We alert when status=failed count > 0 in the last 10 minutes.
    POLICY_JSON=$(cat <<POLICY
{
  "displayName": "${display_name}",
  "conditions": [
    {
      "displayName": "${job_name} execution failed",
      "conditionThreshold": {
        "filter": "resource.type = \\"cloud_run_job\\" AND metric.type = \\"run.googleapis.com/job/completed_execution_count\\" AND resource.labels.job_name = \\"${job_name}\\" AND metric.labels.result = \\"failed\\"",
        "comparison": "COMPARISON_GT",
        "thresholdValue": 0,
        "duration": "0s",
        "aggregations": [
          {
            "alignmentPeriod": "600s",
            "perSeriesAligner": "ALIGN_COUNT",
            "crossSeriesReducer": "REDUCE_SUM",
            "groupByFields": ["resource.labels.job_name"]
          }
        ],
        "trigger": {
          "count": 1
        }
      }
    }
  ],
  "notificationChannels": ["${CHANNEL_NAME}"],
  "alertStrategy": {
    "notificationRateLimit": {
      "period": "3600s"
    }
  },
  "combiner": "OR",
  "enabled": true,
  "documentation": {
    "content": "The Cloud Run Job **${job_name}** had a failed execution. Check the logs at https://console.cloud.google.com/run/jobs/details/${REGION}/${job_name}/executions?project=${PROJECT}",
    "mimeType": "text/markdown"
  }
}
POLICY
)

    echo "${POLICY_JSON}" | gcloud alpha monitoring policies create \
        --policy-from-file=- \
        --project="${PROJECT}" \
        --format="value(name)" 2>/dev/null \
        && echo "  ✓ Policy created" \
        || echo "  [WARN] Policy creation failed — may already exist or API not enabled"
}

# ── 2. Alert: suno-harvest failed ─────────────────────────────────────────────
create_job_failure_alert "suno-harvest" "Aeonimus: suno-harvest job failed"

# ── 3. Alert: yt-upload-job failed ────────────────────────────────────────────
create_job_failure_alert "yt-upload-job" "Aeonimus: yt-upload-job failed"

echo ""
echo "=== Done! ==="
echo ""
echo "To verify, visit:"
echo "  https://console.cloud.google.com/monitoring/alerting?project=${PROJECT}"
echo ""
echo "NEXT STEP — store the Gmail App Password in Secret Manager so"
echo "pipeline_monitor.py can send emails:"
echo ""
echo "  echo '{\"from\":\"aeonimusai@gmail.com\",\"password\":\"YOUR_APP_PASSWORD\",\"to\":\"aeonimusai@gmail.com\"}' \\"
echo "    | gcloud secrets create pipeline-monitor-config \\"
echo "        --data-file=- --project=${PROJECT}"
echo ""
echo "Get your App Password at: https://myaccount.google.com/apppasswords"
