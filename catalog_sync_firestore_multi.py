#!/usr/bin/env python3
"""
catalog_sync_firestore_multi.py -- Sprint 1 / Task 1.2 (multi-handle)
Aeonimus Pipeline: Multi-Handle Delta Engine
 
Runs the full delta check across ALL tracked Suno handles in one pass.
For each handle:
  - Queries Suno Studio API for live clip IDs
  - Compares against Firestore sunoSongs (filtered by sourceId)
  - Scans GCS coverage using canonical paths: suno/handles/{handle}/{clip_id}.{ext}
  - Appends delta rows to a single combined delta_manifest.csv
 
Output: delta_manifest.csv with 'handle' column so download_media_gcs.py
can route each clip to the correct GCS path.
 
Usage:
  python3 catalog_sync_firestore_multi.py
  python3 catalog_sync_firestore_multi.py --dry-run
"""
 
import sys
import csv
import json
import argparse
import subprocess
import time
import urllib.request
from pathlib import Path
from datetime import datetime, timezone
 
# -- Handles to track ---------------------------------------------------------
# Add or remove handles here. Each entry is (handle, source_id_override or None).
TRACKED_HANDLES = [
    ("unshakableechos2341", None),   # Vanessa -- source_id = suno_unshakableechos2341
    # ("genx_handle_here",   None),  # GenX   -- uncomment and fill in when known
]
 
# -- Config -------------------------------------------------------------------
BUCKET     = "gs://aeonimus-suno-media"
WORK_DIR   = Path("/root/yt-ingest")
OUT_CSV    = WORK_DIR / "delta_manifest.csv"
OUT_REPORT = WORK_DIR / "delta_report.json"
STUDIO_API = "https://studio-api.prod.suno.com/api/clip/{clip_id}"
 
 
# -- GCS helpers --------------------------------------------------------------
def gs_exists(gs_uri: str) -> bool:
    r = subprocess.run(["gsutil", "-q", "stat", gs_uri], capture_output=True)
    return r.returncode == 0
 
 
def gcs_paths_for(handle: str, clip_id: str) -> dict:
    """Canonical GCS paths under suno/handles/{handle}/."""
    base = f"{BUCKET}/suno/handles/{handle}/{clip_id}"
    return {
        "mp3":   f"{base}.mp3",
        "m4a":   f"{base}.m4a",
        "mp4":   f"{base}.mp4",
        "thumb": f"{base}.jpg",
    }
 
 
def check_gcs_coverage(handle: str, clip_id: str) -> list:
    """
    Returns list of missing asset types.
    Audio is satisfied by either mp3 or m4a.
    """
    paths = gcs_paths_for(handle, clip_id)
    missing = []
    if not gs_exists(paths["mp3"]) and not gs_exists(paths["m4a"]):
        missing.append("audio")
    if not gs_exists(paths["mp4"]):
        missing.append("mp4")
    if not gs_exists(paths["thumb"]):
        missing.append("thumb")
    return missing
 
 
# -- Firestore helpers --------------------------------------------------------
def get_firestore_docs(db, source_id: str) -> dict:
    """
    Returns {clip_id: doc_data} for all sunoSongs with given sourceId.
    Strips 'suno:' prefix from doc IDs.
    """
    docs = {}
    stream = (
        db.collection("sunoSongs")
          .where("sourceId", "==", source_id)
          .stream()
    )
    for d in stream:
        clean_id = d.id.replace("suno:", "")
        docs[clean_id] = d.to_dict()
    return docs
 
 
# -- Suno API helpers ---------------------------------------------------------
def fetch_clip_details(clip_id: str) -> dict:
    url = STUDIO_API.format(clip_id=clip_id)
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=10) as resp:
            return json.loads(resp.read().decode())
    except Exception as e:
        print(f"  [WARN] Could not fetch clip {clip_id}: {e}", file=sys.stderr)
        return {}
 
 
def pick(d: dict, keys: list, default: str = "") -> str:
    for k in keys:
        v = d.get(k)
        if v:
            return str(v).strip()
    return default
 
 
# -- Per-handle delta computation ---------------------------------------------
def compute_handle_delta(db, handle: str, source_id: str, dry_run: bool = False) -> list:
    """
    Compute delta rows for a single handle. Returns list of manifest dicts.
    """
    sys.path.insert(0, str(WORK_DIR))
    from build_manifest_from_studio_api import fetch_profile_clip_ids
 
    print(f"\n{'='*60}")
    print(f"  Handle   : {handle}")
    print(f"  SourceID : {source_id}")
    print(f"{'='*60}")
 
    # Get live IDs from Suno
    print("  [1/3] Fetching live clip IDs from Suno API...")
    current_ids = set(fetch_profile_clip_ids(handle))
    print(f"    Suno live count : {len(current_ids)}")
 
    # Get Firestore snapshot
    print("  [2/3] Fetching Firestore records...")
    fs_docs = get_firestore_docs(db, source_id)
    fs_ids  = set(fs_docs.keys())
    print(f"    Firestore count : {len(fs_ids)}")
 
    new_ids     = current_ids - fs_ids
    removed_ids = fs_ids - current_ids
    common_ids  = current_ids & fs_ids
    print(f"    New: {len(new_ids)}  |  Removed: {len(removed_ids)}  |  Common: {len(common_ids)}")
 
    # GCS coverage scan
    print(f"  [3/3] Scanning GCS coverage for {len(common_ids)} known clips...")
    missing_gcs = []
    for i, clip_id in enumerate(sorted(common_ids)):
        if not dry_run:
            missing = check_gcs_coverage(handle, clip_id)
            if missing:
                missing_gcs.append((clip_id, missing))
        if i > 0 and i % 50 == 0:
            print(f"    Checked {i}/{len(common_ids)}...")
    print(f"    GCS gaps : {len(missing_gcs)}")
 
    # Build delta rows
    delta_rows = []
 
    for clip_id in sorted(new_ids):
        if dry_run:
            print(f"    [DRY-RUN] NEW {clip_id}")
            delta_rows.append({
                "songKey": clip_id, "handle": handle, "reason": "new",
                "title": "", "audio_url": "", "video_url": "",
                "image_url": "", "createdAt": "",
            })
            continue
 
        print(f"    [NEW] {clip_id}")
        clip = fetch_clip_details(clip_id)
        delta_rows.append({
            "songKey":   clip_id,
            "handle":    handle,
            "reason":    "new",
            "title":     pick(clip, ["title", "name"]),
            "audio_url": pick(clip, ["audio_url", "audioUrl"]),
            "video_url": pick(clip, ["video_url", "videoUrl"]),
            "image_url": pick(clip, ["image_url", "imageUrl", "cover_url", "coverUrl"]),
            "createdAt": pick(clip, ["created_at", "createdAt"]),
        })
        time.sleep(0.15)
 
    for clip_id, missing_assets in missing_gcs:
        doc   = fs_docs.get(clip_id, {})
        media = doc.get("media", doc)
        print(f"    [GCS_MISSING:{','.join(missing_assets)}] {clip_id}")
        delta_rows.append({
            "songKey":   clip_id,
            "handle":    handle,
            "reason":    f"missing_gcs:{','.join(missing_assets)}",
            "title":     doc.get("title", ""),
            "audio_url": media.get("audioUrl", media.get("audio_url", "")),
            "video_url": media.get("videoUrl", media.get("video_url", "")),
            "image_url": media.get("imageUrl", media.get("image_url",
                         media.get("coverUrl", media.get("cover_url", "")))),
            "createdAt": doc.get("createdAt", ""),
        })
 
    print(f"  Delta rows for {handle}: {len(delta_rows)}")
    return delta_rows, {
        "handle":          handle,
        "suno_live":       len(current_ids),
        "firestore_count": len(fs_ids),
        "new_clips":       len(new_ids),
        "removed_clips":   len(removed_ids),
        "missing_gcs":     len(missing_gcs),
        "delta_rows":      len(delta_rows),
    }
 
 
# -- Main ---------------------------------------------------------------------
def main():
    parser = argparse.ArgumentParser(description="Multi-handle Suno delta check")
    parser.add_argument("--dry-run", action="store_true",
                        help="Skip GCS checks and Suno API fetches; report counts only")
    args = parser.parse_args()
 
    from google.cloud import firestore
    sys.path.insert(0, str(WORK_DIR))
 
    run_ts = datetime.now(timezone.utc).isoformat()
    print(f"[{run_ts}] catalog_sync_firestore_multi.py starting")
    print(f"  Handles to process: {len(TRACKED_HANDLES)}")
    if args.dry_run:
        print("  *** DRY RUN MODE -- no GCS checks, no API fetches ***")
 
    db = firestore.Client()
 
    all_delta_rows = []
    per_handle_stats = []
 
    for handle, source_id_override in TRACKED_HANDLES:
        source_id = source_id_override or f"suno_{handle}"
        try:
            rows, stats = compute_handle_delta(db, handle, source_id, dry_run=args.dry_run)
            all_delta_rows.extend(rows)
            per_handle_stats.append(stats)
        except Exception as e:
            print(f"\n[ERROR] Failed to process handle '{handle}': {e}", file=sys.stderr)
            per_handle_stats.append({
                "handle": handle, "error": str(e)
            })
 
    # Write combined manifest
    FIELDNAMES = ["songKey", "handle", "reason", "title",
                  "audio_url", "video_url", "image_url", "createdAt"]
    with open(OUT_CSV, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=FIELDNAMES)
        w.writeheader()
        w.writerows(all_delta_rows)
 
    # Write report
    report = {
        "run_ts":            run_ts,
        "dry_run":           args.dry_run,
        "handles_processed": len(TRACKED_HANDLES),
        "total_delta_rows":  len(all_delta_rows),
        "per_handle":        per_handle_stats,
        "delta_manifest":    str(OUT_CSV),
    }
    OUT_REPORT.write_text(json.dumps(report, indent=2), encoding="utf-8")
 
    # Print summary
    print(f"""
===== MULTI-HANDLE DELTA REPORT [{run_ts}] =====
  Handles processed : {len(TRACKED_HANDLES)}
  Total delta rows  : {len(all_delta_rows)}
  Manifest written  : {OUT_CSV}
  Report written    : {OUT_REPORT}
""")
    for s in per_handle_stats:
        if "error" in s:
            print(f"  {s['handle']}: ERROR -- {s['error']}")
        else:
            print(f"  {s['handle']}: {s['delta_rows']} delta rows "
                  f"(new={s['new_clips']}, missing_gcs={s['missing_gcs']})")
 
    print("==========================================")
 
    if len(all_delta_rows) == 0:
        print("\nAll handles fully in sync. Nothing to download.")
        sys.exit(0)
    else:
        print(f"\n{len(all_delta_rows)} clip(s) need attention. Run daily_suno_job.sh to process.")
        sys.exit(0)
 
 
if __name__ == "__main__":
    main()
 