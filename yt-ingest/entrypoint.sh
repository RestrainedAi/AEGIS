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
        if [ "${rc}" -eq 3 ] && [ "${desc}" = "enrich_suno_metadata_from_studio_api" ]; then
            echo "  [PARTIAL] Metadata sweep finished; unavailable songs are recorded for the next scheduled sweep."
            return 3
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
SOURCE_SYNC_PARTIAL=0
if [ "${HARVEST_MODE}" = "delta" ] && [ -f "${WORK_DIR}/catalog_sync_firestore_multi.py" ]; then
    echo "[STEP 1] Running multi-handle delta check..."
    run_with_retry "catalog_sync_firestore_multi" \
        python3 "${WORK_DIR}/catalog_sync_firestore_multi.py"

    SOURCE_SYNC_RESULT=$(python3 - "${WORK_DIR}/delta_report.json" <<'PY'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as report_file:
    report = json.load(report_file)

result = report.get("result")
if result not in {"healthy", "partial_source"}:
    raise SystemExit(f"Unexpected or missing source snapshot result: {result!r}")
print(result)
PY
)
    if [ "${SOURCE_SYNC_RESULT}" = "partial_source" ]; then
        SOURCE_SYNC_PARTIAL=1
        echo "[WARN] One or more active sources are public-only or unreadable. Publishing available account slices only; the overall run will be reported as partial."
    fi
else
    echo "[STEP 1] Fetching manifest from GCS..."
    run_with_retry "gsutil cp manifest" \
        gsutil cp "${MANIFEST_GCS}" "${WORK_DIR}/delta_manifest.csv"
fi

# ── Step 2: Row count check ───────────────────────────────────────────────────
# CSV values such as lyrics may span multiple physical lines. Count records
# with the CSV parser so progress reflects the real download workload.
DELTA_ROWS=$(python3 - "${WORK_DIR}/delta_manifest.csv" <<'PY'
import csv
import sys

with open(sys.argv[1], newline="", encoding="utf-8") as manifest:
    print(sum(1 for _ in csv.DictReader(manifest)))
PY
)
echo "[STEP 2] Manifest CSV records: ${DELTA_ROWS}"
SKIP_MEDIA_HARVEST=0
if [ "${DELTA_ROWS}" -eq 0 ]; then
    echo "No delta rows found. Skipping media harvest, but continuing with metadata enrichment and catalog rebuild so the published export stays aligned with Firestore."
    SKIP_MEDIA_HARVEST=1
fi

# ── Step 3: Media harvest ─────────────────────────────────────────────────────
HARVEST_EXIT=0
ENRICH_EXIT=0
LYRICS_ARTIFACT_EXIT=0
if [ "${SKIP_MEDIA_HARVEST}" -eq 0 ]; then
    echo "[STEP 3] Starting harvest..."
    if run_with_retry "download_media_gcs" \
        env MANIFEST_CSV="${WORK_DIR}/delta_manifest.csv" \
        python3 "${WORK_DIR}/download_media_gcs.py"; then
        :
    else
        HARVEST_EXIT=$?
        echo "[WARN] Media harvest completed with errors (exit ${HARVEST_EXIT}). Continuing to rebuild the catalog with successfully synced items."
    fi
else
    echo "[STEP 3] Media harvest skipped because the delta manifest is empty."
fi

# ── Step 4: Rebuild catalog ───────────────────────────────────────────────────
if [ -f "${WORK_DIR}/enrich_suno_metadata_from_studio_api.py" ]; then
    echo "[STEP 4] Enriching SUNO metadata from Studio API before export rebuild..."
    if run_with_retry "enrich_suno_metadata_from_studio_api" \
        python3 "${WORK_DIR}/enrich_suno_metadata_from_studio_api.py" --apply; then
        :
    else
        ENRICH_EXIT=$?
        echo "[WARN] Metadata enrichment completed with errors (exit ${ENRICH_EXIT}). Continuing to rebuild the catalog, but this harvest will be reported as partial."
    fi
fi

if [ -f "${WORK_DIR}/backfill_lyrics_artifacts.py" ]; then
    echo "[STEP 4b] Backfilling missing lyrics artifacts before export rebuild..."
    if run_with_retry "backfill_lyrics_artifacts" \
        python3 "${WORK_DIR}/backfill_lyrics_artifacts.py" --missing-only; then
        :
    else
        LYRICS_ARTIFACT_EXIT=$?
        echo "[WARN] Lyrics artifact backfill completed with errors (exit ${LYRICS_ARTIFACT_EXIT}). Continuing to rebuild the catalog, but this harvest will be reported as partial."
    fi
fi

echo "[STEP 5] Rebuilding catalog export..."
if [ -f "${WORK_DIR}/rebuild_catalog.py" ]; then
    echo "  Validating account label alias map before export rebuild..."
    python3 -c "from account_labels import HANDLE_ALIAS_MAP; assert 'nessihenize' in HANDLE_ALIAS_MAP and HANDLE_ALIAS_MAP['nessihenize']=='vanessa_secondary'; print('  account_labels OK:', HANDLE_ALIAS_MAP)"
    run_with_retry "rebuild_catalog" \
        python3 "${WORK_DIR}/rebuild_catalog.py"

    echo "[STEP 5b] Validating the local and published catalog contract..."
    # The fixture protects the Firestore-to-CSV mapping; the published check
    # proves the exact artifact served by the Vault matches this rebuild.
    python3 "${WORK_DIR}/validate_suno_export_contract.py"
    python3 "${WORK_DIR}/validate_published_catalog_export.py"
fi

# ── Step 5c: Conditional reconciliation of known audio gaps ──────────────────
# Runs only after publication validation. Unchanged object generations never
# trigger downloads/decodes; no separate timer or competing harvest is created.
AUDIO_GAP_EXIT=0
if python3 "${WORK_DIR}/post_harvest_audio_gaps.py"; then
    :
else
    AUDIO_GAP_EXIT=$?
    echo "[WARN] Post-harvest audio gap check unavailable; preserving prior gap state."
fi

# Durable local-delivery journal; failure is reported without replaying acquisition.
COMPLETION_EXIT=0
if python3 "${WORK_DIR}/harvest_completion.py" \
    --stage source="${SOURCE_SYNC_PARTIAL}" --stage media="${HARVEST_EXIT}" \
    --stage enrichment="${ENRICH_EXIT}" --stage lyrics="${LYRICS_ARTIFACT_EXIT}" \
    --stage audio_gaps="${AUDIO_GAP_EXIT:-0}"; then
    :
else
    COMPLETION_EXIT=$?
    echo "[ERROR] Catalog published but local delivery receipt failed; repair receipt publication only."
fi

# ── Step 6: Post-harvest monitor ──────────────────────────────────────────────
# Sends a digest email only if something is wrong (stale catalog, queue errors).
# The daily-digest Cloud Run Job sends the full healthy report every morning.
echo "[STEP 6] Running post-harvest monitor..."
_MONITOR_SENT=1   # suppress ERR trap for monitor itself
MONITOR_ARGS=(--mode post-harvest)
if [ "${COMPLETION_EXIT}" -ne 0 ]; then MONITOR_ARGS+=(--partial-harvest-exit "${COMPLETION_EXIT}"); fi
if [ "${HARVEST_EXIT}" -ne 0 ]; then
    MONITOR_ARGS+=(--partial-harvest-exit "${HARVEST_EXIT}")
elif [ "${SOURCE_SYNC_PARTIAL}" -ne 0 ]; then
    MONITOR_ARGS+=(--partial-harvest-exit 3)
elif [ "${ENRICH_EXIT}" -ne 0 ]; then
    MONITOR_ARGS+=(--partial-harvest-exit "${ENRICH_EXIT}")
elif [ "${LYRICS_ARTIFACT_EXIT}" -ne 0 ]; then
    MONITOR_ARGS+=(--partial-harvest-exit "${LYRICS_ARTIFACT_EXIT}")
elif [ "${AUDIO_GAP_EXIT}" -ne 0 ]; then
    MONITOR_ARGS+=(--partial-harvest-exit "${AUDIO_GAP_EXIT}")
fi
python3 "${WORK_DIR}/pipeline_monitor.py" "${MONITOR_ARGS[@]}" 2>&1 || true
if [ -f "${WORK_DIR}/pipeline_monitor_status.json" ]; then
    echo "[STEP 6] Status summary written: ${WORK_DIR}/pipeline_monitor_status.json"
fi

if [ "${HARVEST_EXIT}" -ne 0 ]; then
    echo "[WARN] Harvest finished with partial media failures (exit ${HARVEST_EXIT}). Catalog export was still rebuilt."
    exit "${HARVEST_EXIT}"
fi

if [ "${SOURCE_SYNC_PARTIAL}" -ne 0 ] || [ "${ENRICH_EXIT}" -ne 0 ] || [ "${LYRICS_ARTIFACT_EXIT}" -ne 0 ]; then
    # The catalog-contract gate has passed and the monitor has recorded the
    # degraded state. Returning success prevents Cloud Run from replaying a
    # full all-account harvest solely because an optional/public-only source
    # or metadata endpoint remains unavailable.
    echo "[WARN] Harvest published a verified partial catalog; degraded source and metadata status is recorded without retrying the full job."
    exit 0
fi

echo "=== Harvest complete at $(date -u +"%Y%m%dT%H%M%SZ") ==="
