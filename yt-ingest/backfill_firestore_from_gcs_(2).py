#!/usr/bin/env python3
"""
backfill_firestore_from_gcs.py — Aeonimus Pipeline
One-time backfill: scan GCS bucket and create Firestore sunoSongs docs
for all clips that exist in GCS but are missing from Firestore.

Run from Cloud Shell inside ~/yt-ingest/:
    python3 backfill_firestore_from_gcs.py

Safe to re-run: uses merge=True, skips clips already in Firestore.
"""

import sys
import subprocess
from collections import defaultdict

# ── Config ────────────────────────────────────────────────────────────────────
PROJECT      = "stable-framing-482501-t9"
BUCKET       = "gs://aeonimus-suno-media"
HANDLES      = ["genxdreams"]
BATCH_SIZE   = 100

# ── Helpers ───────────────────────────────────────────────────────────────────
def list_gcs_files(handle: str) -> list[str]:
    """Return list of GCS URIs under suno/handles/{handle}/"""
    prefix = f"{BUCKET}/suno/handles/{handle}/"
    result = subprocess.run(
        ["gsutil", "ls", prefix],
        capture_output=True, text=True
    )
    if result.returncode != 0:
        print(f"  [WARN] gsutil ls failed for {handle}: {result.stderr.strip()}")
        return []
    return [line.strip() for line in result.stdout.splitlines() if line.strip()]


def parse_clip_files(uris: list[str], handle: str) -> dict:
    """
    Group URIs by clip_id.
    Returns: {clip_id: {"mp3": bool, "mp4": bool, "jpg": bool}}
    """
    clips = defaultdict(lambda: {"mp3": False, "mp4": False, "jpg": False})
    prefix = f"{BUCKET}/suno/handles/{handle}/"
    for uri in uris:
        if not uri.startswith(prefix):
            continue
        filename = uri[len(prefix):]  # e.g. "abc123.mp3"
        if "." not in filename:
            continue
        clip_id, ext = filename.rsplit(".", 1)
        if ext in ("mp3", "m4a", "mp4", "jpg"):
            actual_ext = ext if ext in ("mp3", "m4a") else ext
            if ext in ("mp3", "m4a"):
                clips[clip_id]["mp3"] = True  # flag: has audio
                clips[clip_id]["audio_ext"] = ext
            elif ext == "mp4":
                clips[clip_id]["mp4"] = True
            elif ext == "jpg":
                clips[clip_id]["jpg"] = True
    return dict(clips)


def get_existing_firestore_ids(db, handle: str) -> set:
    """Return set of clip_ids already in Firestore for this handle."""
    source_id = f"suno_{handle}"
    print(f"  Querying Firestore for existing {source_id} docs...")
    try:
        docs = db.collection("sunoSongs").where("sourceId", "==", source_id).stream()
        ids = {doc.id for doc in docs}
        print(f"  Found {len(ids)} existing Firestore docs for {handle}")
        return ids
    except Exception as e:
        print(f"  [WARN] Firestore query failed: {e}")
        return set()


# ── Main ──────────────────────────────────────────────────────────────────────
def main():
    # Import firestore_upsert from same directory
    sys.path.insert(0, "/home/aegis/yt-ingest")
    try:
        from firestore_upsert import bulk_upsert
    except ImportError as e:
        print(f"[ERROR] Cannot import firestore_upsert: {e}")
        print("  Make sure you are running from ~/yt-ingest/ or that it is on the path.")
        sys.exit(1)

    from google.cloud import firestore
    db = firestore.Client(project=PROJECT)

    total_upserted = 0
    total_skipped  = 0
    total_failed   = 0

    for handle in HANDLES:
        print(f"\n{'='*60}")
        print(f"Handle: {handle}")
        print(f"{'='*60}")

        # Step 1: List GCS files
        print(f"[1/3] Listing GCS files for {handle}...")
        uris = list_gcs_files(handle)
        print(f"  Found {len(uris)} total files in GCS")
        if not uris:
            print(f"  No files found, skipping {handle}")
            continue

        # Step 2: Parse into clip groups
        print(f"[2/3] Parsing clip IDs...")
        clips = parse_clip_files(uris, handle)
        print(f"  Found {len(clips)} unique clip IDs")

        # Step 3: Get existing Firestore docs to skip
        print(f"[3/3] Checking Firestore for existing docs...")
        existing_ids = get_existing_firestore_ids(db, handle)
        missing_clips = {cid: data for cid, data in clips.items()
                         if cid not in existing_ids}
        print(f"  {len(existing_ids)} already in Firestore")
        print(f"  {len(missing_clips)} clips need backfill")

        if not missing_clips:
            print(f"  Nothing to do for {handle} — Firestore already up to date")
            total_skipped += len(existing_ids)
            continue

        # Step 4: Batch upsert missing clips
        rows = []
        for clip_id, data in missing_clips.items():
            rows.append({
                "clip_id":   clip_id,
                "handle":    handle,
                "title":     "",           # no title available from GCS filenames
                "audio_ext": data.get("audio_ext", "mp3"),
                "has_audio": data.get("mp3", False),
                "has_video": data.get("mp4", False),
                "has_thumb": data.get("jpg", False),
                "created_at": "",
            })

        print(f"\nUpserting {len(rows)} clips in batches of {BATCH_SIZE}...")
        handle_success = 0
        handle_failed  = 0

        for i in range(0, len(rows), BATCH_SIZE):
            batch = rows[i:i+BATCH_SIZE]
            result = bulk_upsert(batch, db=db, project=PROJECT)
            handle_success += result["success"]
            handle_failed  += result["failed"]
            pct = min(i + BATCH_SIZE, len(rows))
            print(f"  Progress: {pct}/{len(rows)} "
                  f"(+{result['success']} OK, +{result['failed']} failed)")
            if result["failed_ids"]:
                print(f"    Failed IDs: {result['failed_ids'][:5]}")

        print(f"\nHandle {handle} summary:")
        print(f"  Upserted : {handle_success}")
        print(f"  Failed   : {handle_failed}")
        print(f"  Skipped  : {len(existing_ids)} (already existed)")

        total_upserted += handle_success
        total_skipped  += len(existing_ids)
        total_failed   += handle_failed

    print(f"\n{'='*60}")
    print(f"BACKFILL COMPLETE")
    print(f"  Total upserted : {total_upserted}")
    print(f"  Total skipped  : {total_skipped}")
    print(f"  Total failed   : {total_failed}")
    print(f"{'='*60}")

    if total_failed > 0:
        sys.exit(1)


if __name__ == "__main__":
    main()
