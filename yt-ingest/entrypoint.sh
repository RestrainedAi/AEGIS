#!/usr/bin/env bash
set -euo pipefail

WORK_DIR="${WORK_DIR:-/app}"
HARVEST_MODE="${HARVEST_MODE:-full}"
WORKSPACES_BUCKET="${WORKSPACES_BUCKET:-gs://aeonimus-workspaces}"
MANIFEST_GCS="${MANIFEST_GCS:-${WORKSPACES_BUCKET}/exports/suno/delta_manifest.csv}"
TIMESTAMP=$(date -u +"%Y%m%dT%H%M%SZ")
MAX_RETRIES="${MAX_RETRIES:-2}"

mkdir -p "${WORK_DIR}/logs"
echo "=== Aeonimus Harvest Job | ${TIMESTAMP} | Mode: ${HARVEST_MODE} ==="
cd "${WORK_DIR}"

# ── Error trap ────────────────────────────────────────────────────────────────
# Fires on any unexpected non-zero exit. Sends an alert email once, then lets
# the shell exit normally with the original error code.
_MONITOR_SENT=0
on_error() {
    local lineno="${1:-?}"
    local exit_code="${2:-?}"
    if [ "${_MONITOR_SENT}" -eq 0 ]; then
        _MONITOR_SENT=1
        echo "[TRAP] Unexpected exit at line ${lineno} (exit ${exit_code}) — sending alert"
        python3 "${WORK_DIR}/pipeline_monitor.py" \
            --mode alert \
            --error "Harvest job failed at line ${lineno} (exit code ${exit_code}). Timestamp: $(date -u +"%Y-%m-%dT%H:%M:%SZ")" \
            2>&1 || true
    fi
}
trap 'rc=$?; on_error ${LINENO} ${rc}' ERR

# ── Retry helper ──────────────────────────────────────────────────────────────
# Usage: run_with_retry "Description" command [args...]
# Retries up to MAX_RETRIES times with a 30-second delay between attempts.
# On final failure, returns the last non-zero exit code (which triggers ERR trap).
run_with_retry() {
    local desc="$1"; shift
    local attempt=1
    while true; do
        echo "  [attempt ${attempt}/${MAX_RETRIES}] ${desc}"
        "$@"
        local rc=$?
        if [ "${rc}" -eq 0 ]; then
            return 0
        fi
        if [ "${attempt}" -ge "${MAX_RETRIES}" ]; then
            echo "  [FAIL] ${desc} failed after ${MAX_RETRIES} attempts (exit ${rc})"
            return "${rc}"
        fi
        echo "  [RETRY] ${desc} exited ${rc} — waiting 30s before retry..."
        sleep 30
        attempt=$((attempt + 1))
    done
}

# ── Auth check ────────────────────────────────────────────────────────────────
python3 -c "import google.auth; creds,proj=google.auth.default(); print(f'Auth OK: {proj}')"

# ── Step 1: Catalog sync / manifest fetch ─────────────────────────────────────
if [ "${HARVEST_MODE}" = "delta" ] && [ -f "${WORK_DIR}/catalog_sync_firestore_multi.py" ]; then
    echo "[STEP 1] Running multi-handle delta check..."
    run_with_retry "catalog_sync_firestore_multi" \
        python3 "${WORK_DIR}/catalog_sync_firestore_multi.py"
else
    echo "[STEP 1] Fetching manifest from GCS..."
    run_with_retry "gsutil cp manifest" \
        gsutil cp "${MANIFEST_GCS}" "${WORK_DIR}/delta_manifest.csv"
fi

# ── Step 2: Row count check ───────────────────────────────────────────────────
DELTA_ROWS=$(tail -n +2 "${WORK_DIR}/delta_manifest.csv" | grep -c '[^[:space:]]' || true)
echo "[STEP 2] Manifest rows: ${DELTA_ROWS}"
if [ "${DELTA_ROWS}" -eq 0 ]; then
    echo "Nothing to do."
    # Run post-harvest monitor anyway — it will check catalog freshness and
    # skip the digest email if everything is healthy.
    python3 "${WORK_DIR}/pipeline_monitor.py" --mode post-harvest 2>&1 || true
    exit 0
fi

# ── Step 3: Media harvest ─────────────────────────────────────────────────────
echo "[STEP 3] Starting harvest..."
HARVEST_EXIT=0
if run_with_retry "download_media_gcs" \
    env MANIFEST_CSV="${WORK_DIR}/delta_manifest.csv" \
    python3 "${WORK_DIR}/download_media_gcs.py"; then
    :
else
    HARVEST_EXIT=$?
    echo "[WARN] Media harvest completed with errors (exit ${HARVEST_EXIT}). Continuing to rebuild the catalog with successfully synced items."
fi

# ── Step 4: Rebuild catalog ───────────────────────────────────────────────────
if [ -f "${WORK_DIR}/enrich_suno_metadata_from_studio_api.py" ]; then
    echo "[STEP 4] Enriching SUNO metadata from Studio API before export rebuild..."
    if run_with_retry "enrich_suno_metadata_from_studio_api" \
        python3 "${WORK_DIR}/enrich_suno_metadata_from_studio_api.py" --apply; then
        :
    else
        ENRICH_EXIT=$?
        echo "[WARN] Metadata enrichment completed with errors (exit ${ENRICH_EXIT}). Continuing to rebuild the catalog with available metadata."
    fi
fi

echo "[STEP 5] Rebuilding catalog export..."
if [ -f "${WORK_DIR}/rebuild_catalog.py" ]; then
    run_with_retry "rebuild_catalog" \
        python3 "${WORK_DIR}/rebuild_catalog.py"
fi

# ── Step 6: Post-harvest monitor ──────────────────────────────────────────────
# Sends a digest email only if something is wrong (stale catalog, queue errors).
# The daily-digest Cloud Run Job sends the full healthy report every morning.
echo "[STEP 6] Running post-harvest monitor..."
_MONITOR_SENT=1   # suppress ERR trap for monitor itself
MONITOR_ARGS=(--mode post-harvest)
if [ "${HARVEST_EXIT}" -ne 0 ]; then
    MONITOR_ARGS+=(--partial-harvest-exit "${HARVEST_EXIT}")
fi
python3 "${WORK_DIR}/pipeline_monitor.py" "${MONITOR_ARGS[@]}" 2>&1 || true
if [ -f "${WORK_DIR}/pipeline_monitor_status.json" ]; then
    echo "[STEP 6] Status summary written: ${WORK_DIR}/pipeline_monitor_status.json"
fi

if [ "${HARVEST_EXIT}" -ne 0 ]; then
    echo "[WARN] Harvest finished with partial media failures (exit ${HARVEST_EXIT}). Catalog export was still rebuilt."
    exit "${HARVEST_EXIT}"
fi

echo "=== Harvest complete at $(date -u +"%Y%m%dT%H%M%SZ") ==="
