#!/usr/bin/env bash
# ==============================================================================
# redeploy_harvest.sh — Rebuild and redeploy harvest-job Cloud Run Job
#
# Run from: ~/yt-ingest/
# Prereq: gcloud auth login + gcloud auth application-default login done
#
# What this does:
#   1. Copies new files from this repo into place
#   2. Submits Docker build via Cloud Build (uses cloudbuild.harvest.yaml)
#   3. Updates the Cloud Run Job to use the new image
#   4. Optionally triggers an immediate run
# ==============================================================================

set -euo pipefail

PROJECT="stable-framing-482501-t9"
REGION="us-central1"
REPO="us-central1-docker.pkg.dev/${PROJECT}/aeonimus-repo"
IMAGE="${REPO}/harvest-job:latest"
JOB_NAME="suno-harvest"
RUNTIME_SA="${RUNTIME_SA:-cloud-run-jobs@${PROJECT}.iam.gserviceaccount.com}"
MONITOR_SECRET="${MONITOR_SECRET:-pipeline-monitor-config}"
SKIP_RUNTIME_IAM_SETUP="${SKIP_RUNTIME_IAM_SETUP:-true}"
VERIFY_ONLY="${VERIFY_ONLY:-false}"
TRIGGER_NOW="${TRIGGER_NOW:-ask}"
WORK_DIR="$(pwd)"
ENV_VARS_FILE="${WORK_DIR}/.harvest-job.env.yaml"

echo "======================================================"
echo " HARVEST JOB REDEPLOY"
echo " Project: ${PROJECT}"
echo " Image:   ${IMAGE}"
echo " Runtime: ${RUNTIME_SA}"
echo " IAM:     ${SKIP_RUNTIME_IAM_SETUP}"
echo " Verify:  ${VERIFY_ONLY}"
echo " Trigger: ${TRIGGER_NOW}"
echo " Dir:     ${WORK_DIR}"
echo "======================================================"

echo ""
echo "[0/4] Checking gcloud auth in this shell..."
if ! gcloud auth print-access-token >/dev/null 2>&1; then
  echo "ERROR: gcloud auth is not active in this bash shell."
  echo "Run this script from Cloud Shell or from a bash session where:"
  echo "  gcloud auth print-access-token"
  echo "succeeds before continuing."
  exit 1
fi
echo "  ✓ gcloud auth is active"

verify_runtime_shape() {
  echo "  Verifying deployed runtime shape..."
  JOB_JSON="$(gcloud run jobs describe "${JOB_NAME}" \
    --region "${REGION}" \
    --project "${PROJECT}" \
    --format=json)"
  export JOB_JSON
  python3 - <<'PY'
import json
import os
import sys

job = json.loads(os.environ["JOB_JSON"])
tmpl = job.get("spec", {}).get("template", {}).get("spec", {}).get("template", {}).get("spec", {})
container = (tmpl.get("containers") or [{}])[0]
env_list = container.get("env") or []
env_map = {item.get("name"): item.get("value", "") for item in env_list if item.get("name")}
required = {
    "PROJECT": "stable-framing-482501-t9",
    "WORK_DIR": "/app",
    "SUNO_MEDIA_BUCKET": "gs://aeonimus-suno-media",
    "WORKSPACES_BUCKET": "gs://aeonimus-workspaces",
    "HARVEST_HANDLE": "vanessa_primary",
    "HARVEST_MODE": "delta",
}
service_account = tmpl.get("serviceAccountName")
if service_account != "cloud-run-jobs@stable-framing-482501-t9.iam.gserviceaccount.com":
    print(f"ERROR: unexpected serviceAccountName {service_account!r}", file=sys.stderr)
    sys.exit(1)
for key, expected in required.items():
    actual = env_map.get(key)
    if actual != expected:
        print(f"ERROR: env {key} expected {expected!r} got {actual!r}", file=sys.stderr)
        sys.exit(1)
monitor = next((item for item in env_list if item.get("name") == "MONITOR_CONFIG"), None)
ref = ((monitor or {}).get("valueFrom") or {}).get("secretKeyRef") or {}
if ref.get("name") != "pipeline-monitor-config" or ref.get("key") != "latest":
    print("ERROR: MONITOR_CONFIG secret binding missing or unexpected", file=sys.stderr)
    sys.exit(1)
project_val = env_map.get("PROJECT", "")
if "WORK_DIR=" in project_val or "HARVEST_MODE=" in project_val:
    print("ERROR: PROJECT env appears collapsed with other env vars", file=sys.stderr)
    sys.exit(1)
print("  ✓ Runtime service account verified")
print("  ✓ Expected env vars verified")
print("  ✓ MONITOR_CONFIG secret binding verified")
PY
}

# ── Step 1: Verify required files ─────────────────────────────────────────────
REQUIRED_FILES=(
    "Dockerfile.harvest"
    "entrypoint.sh"
    "download_media_gcs.py"
    "delta_check_firestore.py"
    "catalog_sync_firestore_multi.py"
    "build_manifest_from_studio_api.py"
    "firestore_upsert.py"
    "gcp_access_token.py"
    "enrich_suno_metadata_from_studio_api.py"
    "rebuild_catalog.py"
    "pipeline_monitor.py"
    "requirements.txt"
    "cloudbuild.harvest.yaml"
)

echo ""
echo "[1/4] Checking required files..."
MISSING=0
for f in "${REQUIRED_FILES[@]}"; do
    if [[ -f "${WORK_DIR}/${f}" ]]; then
        echo "  ✓ ${f}"
    else
        echo "  ✗ MISSING: ${f}"
        MISSING=$((MISSING + 1))
    fi
done

if [[ ${MISSING} -gt 0 ]]; then
    echo ""
    echo "ERROR: ${MISSING} required file(s) missing from ${WORK_DIR}"
    echo "Copy them from your scripts folder first:"
    echo "  cp ~/scripts/*.py ~/yt-ingest/"
    echo "  cp ~/scripts/Dockerfile.harvest ~/yt-ingest/"
    echo "  cp ~/scripts/entrypoint.sh ~/yt-ingest/"
    exit 1
fi

# Ensure entrypoint is executable
chmod +x "${WORK_DIR}/entrypoint.sh"

# Ensure the runtime service account exists and has the roles required by the
# harvest job for Firestore reads/writes, GCS media/export writes, and the
# monitor secret mounted into the job.
if [[ "${VERIFY_ONLY}" != "true" ]]; then
  echo ""
  echo "[1b/4] Ensuring runtime service account..."
  gcloud iam service-accounts describe "${RUNTIME_SA}" --project "${PROJECT}" &>/dev/null \
    || gcloud iam service-accounts create "cloud-run-jobs" \
      --display-name="Aeonimus Cloud Run Jobs SA" \
      --project "${PROJECT}"

  if [[ "${SKIP_RUNTIME_IAM_SETUP}" == "true" ]]; then
    echo "  Skipping project IAM binding setup; assuming runtime SA already has required roles."
  else
    for ROLE in \
      roles/datastore.user \
      roles/storage.objectAdmin \
      roles/secretmanager.secretAccessor; do
      gcloud projects add-iam-policy-binding "${PROJECT}" \
        --member="serviceAccount:${RUNTIME_SA}" \
        --role="${ROLE}" \
        --quiet >/dev/null
    done
  fi
fi

echo ""
echo "[1c/4] Verifying monitor secret exists..."
gcloud secrets describe "${MONITOR_SECRET}" \
  --project "${PROJECT}" \
  --format="value(name)" >/dev/null
echo "  ✓ Secret present: ${MONITOR_SECRET}"

if [[ "${VERIFY_ONLY}" == "true" ]]; then
  echo ""
  echo "[verify] Skipping build and job update; checking live deploy shape only..."
  verify_runtime_shape
  echo ""
  echo "======================================================"
  echo " VERIFY COMPLETE"
  echo "======================================================"
  exit 0
fi

# ── Step 2: Cloud Build ────────────────────────────────────────────────────────
echo ""
echo "[2/4] Submitting Cloud Build..."
echo "  (This uploads source and builds the Docker image)"
echo ""

# Create/update cloudbuild.harvest.yaml with correct image
cat > "${WORK_DIR}/cloudbuild.harvest.yaml" << YAML
steps:
  - name: 'gcr.io/cloud-builders/docker'
    args:
      - 'build'
      - '-t'
      - '${IMAGE}'
      - '-f'
      - 'Dockerfile.harvest'
      - '.'
images:
  - '${IMAGE}'
options:
  machineType: 'E2_HIGHCPU_8'
  diskSizeGb: 50
timeout: '1200s'
YAML

gcloud builds submit \
    --config "${WORK_DIR}/cloudbuild.harvest.yaml" \
    --project "${PROJECT}" \
    "${WORK_DIR}"

echo ""
echo "  ✓ Docker image built and pushed: ${IMAGE}"

cat > "${ENV_VARS_FILE}" << YAML
PROJECT: "${PROJECT}"
WORK_DIR: "/app"
SUNO_MEDIA_BUCKET: "gs://aeonimus-suno-media"
WORKSPACES_BUCKET: "gs://aeonimus-workspaces"
HARVEST_HANDLE: "vanessa_primary"
HARVEST_MODE: "delta"
YAML

echo "  ✓ Wrote env vars file: ${ENV_VARS_FILE}"

# ── Step 3: Update Cloud Run Job ──────────────────────────────────────────────
echo ""
echo "[3/4] Updating Cloud Run Job..."
gcloud run jobs update "${JOB_NAME}" \
    --image "${IMAGE}" \
    --region "${REGION}" \
    --project "${PROJECT}" \
    --service-account "${RUNTIME_SA}" \
    --memory "2Gi" \
    --cpu "2" \
    --tasks "1" \
    --parallelism "1" \
    --max-retries "1" \
    --task-timeout "43200s" \
    --env-vars-file "${ENV_VARS_FILE}" \
    --set-secrets "MONITOR_CONFIG=${MONITOR_SECRET}:latest"

echo "  ✓ Cloud Run Job updated"
verify_runtime_shape

# ── Step 4: Optional immediate run ────────────────────────────────────────────
echo ""

case "${TRIGGER_NOW,,}" in
  y|yes|true)
    TRIGGER_DECISION="y"
    ;;
  n|no|false)
    TRIGGER_DECISION="n"
    ;;
  ask)
    echo "[4/4] Trigger immediate run? (y/N)"
    read -r -t 10 TRIGGER_DECISION || TRIGGER_DECISION="n"
    ;;
  *)
    echo "ERROR: TRIGGER_NOW must be one of: ask, y, n" >&2
    exit 1
    ;;
esac

if [[ "${TRIGGER_DECISION,,}" == "y" ]]; then
    echo "  Triggering harvest job..."
    gcloud run jobs execute "${JOB_NAME}" \
        --region "${REGION}" \
        --project "${PROJECT}"
    echo "  ✓ Job execution started"
    echo "  Monitor: gcloud run jobs executions list --job ${JOB_NAME} --region ${REGION} --limit 3"
else
    echo "[4/4] Immediate run skipped"
    echo "  Skipped. Next nightly run is scheduled at 2AM Chicago."
    echo "  To trigger manually:"
    echo "    gcloud run jobs execute ${JOB_NAME} --region ${REGION}"
fi

echo ""
echo "======================================================"
echo " REDEPLOY COMPLETE"
echo "======================================================"
