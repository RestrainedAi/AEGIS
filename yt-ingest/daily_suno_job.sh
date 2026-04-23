#!/usr/bin/env bash
# ==============================================================================
# daily_suno_job.sh — Sprint 1 / Tasks 1.1 + 1.3
# Aeonimus Pipeline: Delta Engine Orchestrator
#
# Triggered by Cloud Scheduler (or manually).
# Flow:
#   1. Run delta_check_firestore.py  → writes delta_manifest.csv
#   2. If delta rows exist, run download_media_gcs.py --manifest delta_manifest.csv
#   3. Log everything with timestamps to dated log file
#   4. Exit 0 on success, non-zero on failure (Cloud Scheduler will retry)
# ==============================================================================
 
set -euo pipefail
 
# ── Config ────────────────────────────────────────────────────────────────────
WORK_DIR="/home/aegis/yt-ingest"
DELTA_SCRIPT="/home/aegis/delta_check_firestore.py"
DOWNLOAD_SCRIPT="${WORK_DIR}/download_media_gcs.py"
REBUILD_SCRIPT="${WORK_DIR}/rebuild_catalog.py"
DELTA_MANIFEST="${WORK_DIR}/delta_manifest.csv"
DELTA_REPORT="${WORK_DIR}/delta_report.json"
LOG_DIR="${WORK_DIR}/logs"
TIMESTAMP=$(date -u +"%Y%m%dT%H%M%SZ")
LOG_FILE="${LOG_DIR}/daily_suno_job_${TIMESTAMP}.log"
PROJECT="stable-framing-482501-t9"
CATALOG_EXPORT_GCS="gs://aeonimus-workspaces/exports/suno/latest_catalog_wide.csv"
CATALOG_EXPORT_META_GCS="gs://aeonimus-workspaces/exports/suno/latest_catalog_wide.meta.json"
 
# ── Setup ─────────────────────────────────────────────────────────────────────
mkdir -p "${LOG_DIR}"
exec > >(tee -a "${LOG_FILE}") 2>&1   # tee stdout+stderr to log file
 
echo "============================================================"
echo "  Aeonimus Pipeline: daily_suno_job.sh"
echo "  Run timestamp : ${TIMESTAMP}"
echo "  Working dir   : ${WORK_DIR}"
echo "  Project       : ${PROJECT}"
echo "============================================================"
 
# ── Confirm GCP auth ─────────────────────────────────────────────────────────
echo ""
echo "[AUTH] Verifying GCP credentials..."
gcloud config set project "${PROJECT}" --quiet
gcloud auth print-access-token > /dev/null && echo "  Auth OK" || {
    echo "  [ERROR] GCP auth failed. Exiting."
    exit 1
}
 
# ── Step 1: Delta check ───────────────────────────────────────────────────────
echo ""
echo "[STEP 1] Running delta_check_firestore.py..."
cd "${WORK_DIR}"
python3 "${DELTA_SCRIPT}"
DELTA_EXIT=$?
 
if [ "${DELTA_EXIT}" -ne 0 ]; then
    echo "[ERROR] delta_check_firestore.py exited with code ${DELTA_EXIT}"
    exit "${DELTA_EXIT}"
fi
 
# ── Step 2: Check if there's anything to download ────────────────────────────
echo ""
echo "[STEP 2] Evaluating delta manifest..."
 
if [ ! -f "${DELTA_MANIFEST}" ]; then
    echo "  [WARN] No delta_manifest.csv found. Nothing to do."
    exit 0
fi
 
# Count data rows (exclude header)
DELTA_ROWS=$(tail -n +2 "${DELTA_MANIFEST}" | grep -c '[^[:space:]]' || true)
echo "  Delta rows: ${DELTA_ROWS}"
 
if [ "${DELTA_ROWS}" -eq 0 ]; then
    echo "  Pipeline is fully in sync. No downloads needed."
else
    # ── Step 3: Stream delta clips to GCS ────────────────────────────────────────
    echo ""
    echo "[STEP 3] Streaming ${DELTA_ROWS} clip(s) to GCS via download_media_gcs.py..."
    
    # Pass the delta manifest as the source CSV.
    # download_media_gcs.py reads MANIFEST_CSV from its own constant,
    # so we temporarily symlink delta_manifest.csv → suno_manifest.csv,
    # or invoke with env var override if supported.
    # Strategy: write a thin wrapper invocation using MANIFEST override env var,
    # with fallback to direct symlink for compatibility.
    
    MANIFEST_ENV_SUPPORTED=false
    if grep -q "MANIFEST_CSV.*environ" "${DOWNLOAD_SCRIPT}" 2>/dev/null; then
        MANIFEST_ENV_SUPPORTED=true
    fi
    
    if [ "${MANIFEST_ENV_SUPPORTED}" = "true" ]; then
        MANIFEST_CSV="${DELTA_MANIFEST}" python3 "${DOWNLOAD_SCRIPT}"
    else
        # Fallback: backup existing manifest, symlink delta, restore after
        ORIG_MANIFEST="${WORK_DIR}/suno_manifest.csv"
        BACKUP_MANIFEST="${WORK_DIR}/suno_manifest.csv.bak.${TIMESTAMP}"
    
        if [ -f "${ORIG_MANIFEST}" ]; then
            cp "${ORIG_MANIFEST}" "${BACKUP_MANIFEST}"
            echo "  Backed up suno_manifest.csv → $(basename ${BACKUP_MANIFEST})"
        fi
    
        cp "${DELTA_MANIFEST}" "${ORIG_MANIFEST}"
        echo "  Installed delta_manifest.csv as suno_manifest.csv"
    
        python3 "${DOWNLOAD_SCRIPT}"
        DOWNLOAD_EXIT=$?
    
        # Restore original manifest
        if [ -f "${BACKUP_MANIFEST}" ]; then
            mv "${BACKUP_MANIFEST}" "${ORIG_MANIFEST}"
            echo "  Restored original suno_manifest.csv"
        fi
    
        if [ "${DOWNLOAD_EXIT}" -ne 0 ]; then
            echo "[ERROR] download_media_gcs.py exited with code ${DOWNLOAD_EXIT}"
            exit "${DOWNLOAD_EXIT}"
        fi
    fi
fi

# ── Step 4: Rebuild viewer catalog export ─────────────────────────────────────
echo ""
echo "[STEP 4] Rebuilding viewer catalog export via rebuild_catalog.py..."
if [ ! -f "${REBUILD_SCRIPT}" ]; then
    echo "[ERROR] rebuild_catalog.py not found at ${REBUILD_SCRIPT}"
    exit 1
fi
python3 "${REBUILD_SCRIPT}"
REBUILD_EXIT=$?
if [ "${REBUILD_EXIT}" -ne 0 ]; then
    echo "[ERROR] rebuild_catalog.py exited with code ${REBUILD_EXIT}"
    echo "        Recovery: rerun python3 ${REBUILD_SCRIPT} after resolving the export failure."
    exit "${REBUILD_EXIT}"
fi

# ── Step 4b: Verify published freshness contract ─────────────────────────────
echo ""
echo "[STEP 4b] Verifying published catalog freshness..."
LOCAL_META="${WORK_DIR}/latest_catalog_wide.meta.json"
if [ ! -f "${LOCAL_META}" ]; then
    echo "[ERROR] Local export metadata missing after rebuild: ${LOCAL_META}"
    exit 1
fi

GCS_META_JSON="$(gcloud storage cat "${CATALOG_EXPORT_META_GCS}" 2>/dev/null || true)"
if [ -z "${GCS_META_JSON}" ]; then
    echo "[ERROR] Could not read published catalog metadata from ${CATALOG_EXPORT_META_GCS}"
    exit 1
fi

python3 - <<PY
import json
import sys
from pathlib import Path

local_meta = json.loads(Path(r"${LOCAL_META}").read_text(encoding="utf-8"))
gcs_meta = json.loads("""${GCS_META_JSON}""")

errors = []
expected_artifact = "${CATALOG_EXPORT_GCS}"

if local_meta.get("artifact") != expected_artifact:
    errors.append(
        f"Local metadata artifact mismatch: {local_meta.get('artifact')} != {expected_artifact}"
    )
if gcs_meta.get("artifact") != expected_artifact:
    errors.append(
        f"Published metadata artifact mismatch: {gcs_meta.get('artifact')} != {expected_artifact}"
    )
if local_meta.get("generatedAt") != gcs_meta.get("generatedAt"):
    errors.append(
        f"generatedAt mismatch local={local_meta.get('generatedAt')} gcs={gcs_meta.get('generatedAt')}"
    )
if int(local_meta.get("rowCount") or 0) <= 0:
    errors.append(f"Local rowCount is not positive: {local_meta.get('rowCount')}")
if int(gcs_meta.get("rowCount") or 0) <= 0:
    errors.append(f"Published rowCount is not positive: {gcs_meta.get('rowCount')}")
if int(local_meta.get("rowCount") or 0) != int(gcs_meta.get("rowCount") or 0):
    errors.append(
        f"rowCount mismatch local={local_meta.get('rowCount')} gcs={gcs_meta.get('rowCount')}"
    )

if errors:
    print("[ERROR] Catalog freshness verification failed:")
    for item in errors:
        print(f"  - {item}")
    sys.exit(1)

print("  Published catalog metadata matches local rebuild output.")
print(f"  generatedAt: {gcs_meta.get('generatedAt')}")
print(f"  rowCount:    {gcs_meta.get('rowCount')}")
print(f"  artifact:    {gcs_meta.get('artifact')}")
PY
VERIFY_EXIT=$?
if [ "${VERIFY_EXIT}" -ne 0 ]; then
    exit "${VERIFY_EXIT}"
fi

# ── Step 5: Summary ───────────────────────────────────────────────────────────
echo ""
echo "[STEP 5] Job complete."
if [ -f "${DELTA_REPORT}" ]; then
    echo "  Delta report:"
    python3 -c "
import json, sys
r = json.load(open('${DELTA_REPORT}'))
for k, v in r.items():
    print(f'    {k:<22}: {v}')
"
fi
if [ -f "${WORK_DIR}/latest_catalog_wide.meta.json" ]; then
    echo "  Export metadata:"
    python3 -c "
import json
r = json.load(open('${WORK_DIR}/latest_catalog_wide.meta.json'))
for k, v in r.items():
    print(f'    {k:<22}: {v}')
"
fi
 
END_TS=$(date -u +"%Y%m%dT%H%M%SZ")
echo ""
echo "============================================================"
echo "  Completed at: ${END_TS}"
echo "  Log saved to: ${LOG_FILE}"
echo "============================================================"
exit 0
 
