#!/usr/bin/env python3
"""
delta_check_firestore.py -- Sprint 1 / Task 1.2
Aeonimus Pipeline: Delta Engine (single-handle)

Compares the live Suno Studio API against Firestore sunoSongs collection.
Identifies two categories of work:
  1. NEW clips    : present in Suno API but absent from Firestore entirely
  2. MISSING GCS  : present in Firestore but one or more GCS media files absent

Writes delta_manifest.csv consumed by daily_suno_job.sh -> download_media_gcs.py
Idempotent: safe to run multiple times; output is deterministic.

GCS canonical path: gs://aeonimus-suno-media/suno/handles/{handle}/{clip_id}.{ext}
"""

import sys
import csv
import json
import re
import subprocess
import time
import urllib.request
from pathlib import Path
from datetime import datetime, timezone

# -- Project constants --------------------------------------------------------
HANDLE     = "genxdreams"
SOURCE_ID  = f"suno_{HANDLE}"
BUCKET     = "gs://aeonimus-suno-media"
import os
WORK_DIR   = Path(os.environ.get("WORK_DIR", "/app"))
OUT_CSV    = WORK_DIR / "delta_manifest.csv"
OUT_REPORT = WORK_DIR / "delta_report.json"
STUDIO_API = "https://studio-api.prod.suno.com/api/clip/{clip_id}"
STYLE_KEYWORDS = [
    "acoustic", "alt-pop", "ambient", "ballad", "cinematic", "country",
    "dark synthpop", "darkwave", "drill", "drum and bass", "dubstep",
    "electronic", "electropop", "emo", "folk", "funk", "glitch",
    "glitch pop", "gospel", "grunge", "hard rock", "hip hop", "house",
    "industrial", "indie", "jazz", "latin", "lo-fi", "metal", "orchestral",
    "phonk", "pop", "punk", "r&b", "rap", "rock", "shoegaze", "soul",
    "synthpop", "synthwave", "techno", "trap",
]

# -- GCS helpers --------------------------------------------------------------
def gs_exists(gs_uri: str) -> bool:
    """Check if a GCS object exists without downloading it."""
    r = subprocess.run(
        ["gsutil", "-q", "stat", gs_uri],
        capture_output=True
    )
    return r.returncode == 0


def gcs_paths_for(clip_id: str, handle: str = HANDLE) -> dict:
    """
    Return canonical GCS paths under suno/handles/{handle}/{clip_id}.{ext}
    Accepts .m4a as audio fallback alongside .mp3.
    """
    base = f"{BUCKET}/suno/handles/{handle}/{clip_id}"
    return {
        "mp3":   f"{base}.mp3",
        "m4a":   f"{base}.m4a",   # fallback audio format
        "mp4":   f"{base}.mp4",
        "thumb": f"{base}.jpg",
    }


def check_gcs_coverage(clip_id: str, handle: str = HANDLE) -> dict:
    """
    Returns dict of {asset_type: bool} for each GCS asset.
    Audio is considered covered if EITHER mp3 OR m4a exists.
    """
    paths = gcs_paths_for(clip_id, handle)
    result = {k: gs_exists(v) for k, v in paths.items()}
    # Treat audio as covered if either format exists
    result["audio_ok"] = result["mp3"] or result["m4a"]
    return result


def has_missing_assets(coverage: dict) -> list:
    """Return list of missing asset type keys (excluding audio_ok meta-key)."""
    missing = []
    # Audio: need at least one of mp3/m4a
    if not coverage.get("audio_ok"):
        missing.append("audio")
    # Video
    if not coverage.get("mp4"):
        missing.append("mp4")
    # Thumbnail
    if not coverage.get("thumb"):
        missing.append("thumb")
    return missing


# -- Firestore helpers --------------------------------------------------------
def get_firestore_docs(db, source_id: str = SOURCE_ID) -> dict:
    """
    Returns dict {clip_id: doc_data} for all sunoSongs with this sourceId.
    Strips 'suno:' prefix from document IDs.
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
    """Fetch full clip metadata from Suno Studio API."""
    url = STUDIO_API.format(clip_id=clip_id)
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=10) as resp:
            return json.loads(resp.read().decode())
    except Exception as e:
        print(f"  [WARN] Could not fetch clip {clip_id}: {e}", file=sys.stderr)
        return {}


def pick(d: dict, keys: list, default: str = "") -> str:
    """Pick first non-empty value from a dict using multiple key fallbacks."""
    for k in keys:
        v = d.get(k)
        if v:
            return str(v).strip()
    return default


def metadata_field(clip: dict, key: str, default: str = "") -> str:
    metadata = clip.get("metadata") if isinstance(clip.get("metadata"), dict) else {}
    value = metadata.get(key, default)
    if value is None:
        return default
    return str(value).strip()


def normalize_multiline(value: str) -> str:
    return (value or "").replace("\r", "\n").replace("\n", " | ").strip()


def split_csvish(value: str) -> list[str]:
    if not value:
        return []
    text = str(value).replace("|", ",")
    return [part.strip() for part in text.split(",") if part.strip()]


def dedupe_keep_order(values: list[str]) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for value in values:
        key = value.strip().lower()
        if not key or key in seen:
            continue
        seen.add(key)
        out.append(value.strip())
    return out


def derive_styles(tags: str = "", display_tags: str = "", prompt: str = "") -> tuple[list[str], str]:
    styles: list[str] = []
    styles.extend(split_csvish(tags))
    styles.extend(split_csvish(display_tags))
    prompt_lower = str(prompt or "").lower()
    for keyword in STYLE_KEYWORDS:
        if re.search(rf"(?<!\w){re.escape(keyword)}(?!\w)", prompt_lower):
            styles.append(keyword)
    normalized = dedupe_keep_order(styles)
    return normalized, ", ".join(normalized)


# -- Main ---------------------------------------------------------------------
def main():
    from google.cloud import firestore
    # Pull in fetch_profile_clip_ids from the yt-ingest workspace
    sys.path.insert(0, str(WORK_DIR))
    from build_manifest_from_studio_api import fetch_profile_clip_ids

    run_ts = datetime.now(timezone.utc).isoformat()
    print(f"[{run_ts}] delta_check_firestore.py starting")
    print(f"  Handle   : {HANDLE}")
    print(f"  SourceID : {SOURCE_ID}")
    print(f"  Bucket   : {BUCKET}")

    # Step 1: Get live Suno clip IDs
    print("\n[1/4] Fetching live clip IDs from Suno Studio API...")
    current_ids = set(fetch_profile_clip_ids(HANDLE))
    print(f"  Suno live count : {len(current_ids)}")

    # Step 2: Get Firestore snapshot
    print("\n[2/4] Fetching existing records from Firestore sunoSongs...")
    db = firestore.Client()
    fs_docs = get_firestore_docs(db)
    fs_ids  = set(fs_docs.keys())
    print(f"  Firestore count : {len(fs_ids)}")

    # Step 3: Compute ID-level deltas
    new_ids     = current_ids - fs_ids
    removed_ids = fs_ids - current_ids
    common_ids  = current_ids & fs_ids

    # Step 4: GCS coverage scan for known clips
    print(f"\n[3/4] Scanning GCS coverage for {len(common_ids)} known clips...")
    missing_gcs = []
    checked = 0
    for clip_id in sorted(common_ids):
        coverage = check_gcs_coverage(clip_id)
        missing = has_missing_assets(coverage)
        if missing:
            missing_gcs.append((clip_id, missing))
        checked += 1
        if checked % 50 == 0:
            print(f"  Checked {checked}/{len(common_ids)}...")

    print(f"  GCS gaps found  : {len(missing_gcs)}")

    # Step 5: Build delta manifest CSV
    print(f"\n[4/4] Building delta manifest...")
    delta_rows = []

    # 5a: Brand new clips -- fetch full details from Studio API
    for clip_id in sorted(new_ids):
        print(f"  [NEW] {clip_id}")
        clip = fetch_clip_details(clip_id)
        tags = metadata_field(clip, "tags")
        prompt = metadata_field(clip, "prompt")
        display_tags = pick(clip, ["display_tags"])
        _, style_text = derive_styles(tags=tags, display_tags=display_tags, prompt=prompt)
        delta_rows.append({
            "songKey":   clip_id,
            "handle":    HANDLE,
            "reason":    "new",
            "title":     normalize_multiline(pick(clip, ["title", "name"])),
            "audio_url": pick(clip, ["audio_url", "audioUrl"]),
            "video_url": pick(clip, ["video_url", "videoUrl"]),
            "image_url": pick(clip, ["image_url", "imageUrl", "cover_url", "coverUrl", "image_large_url"]),
            "createdAt": pick(clip, ["created_at", "createdAt"]),
            "tags":      tags,
            "prompt":    prompt,
            "lyrics":    prompt,
            "modelName": pick(clip, ["model_name", "modelName"]),
            "isInstrumental": metadata_field(clip, "make_instrumental"),
            "description": pick(clip, ["description"]),
            "caption": pick(clip, ["caption"]),
            "negativePrompt": metadata_field(clip, "negative_tags"),
            "displayTags": display_tags,
            "styles": style_text,
            "styleText": style_text,
            "explicit": pick(clip, ["explicit"]),
            "modelMajorVersion": pick(clip, ["major_model_version"]),
            "artworkUrl": pick(clip, ["image_large_url", "image_url", "imageUrl"]),
        })
        time.sleep(0.15)  # gentle rate limiting

    # 5b: Missing GCS -- pull CDN URLs from Firestore doc
    for clip_id, missing_assets in missing_gcs:
        doc   = fs_docs.get(clip_id, {})
        media = doc.get("media", doc)   # support both flat and nested schemas
        tags = ", ".join(doc.get("tags", [])) if isinstance(doc.get("tags"), list) else str(doc.get("tags", "") or "")
        prompt = doc.get("prompt", "")
        display_tags = ", ".join(doc.get("displayTags", [])) if isinstance(doc.get("displayTags"), list) else str(doc.get("displayTags", "") or "")
        _, style_text = derive_styles(tags=tags, display_tags=display_tags, prompt=prompt)
        print(f"  [GCS_MISSING:{','.join(missing_assets)}] {clip_id}")
        delta_rows.append({
            "songKey":   clip_id,
            "handle":    HANDLE,
            "reason":    f"missing_gcs:{','.join(missing_assets)}",
            "title":     normalize_multiline(doc.get("title", "")),
            "audio_url": media.get("audioUrl", media.get("audio_url", "")),
            "video_url": media.get("videoUrl", media.get("video_url", "")),
            "image_url": media.get("imageUrl", media.get("image_url",
                         media.get("coverUrl", media.get("cover_url", "")))),
            "createdAt": doc.get("createdAt", ""),
            "tags":      tags,
            "prompt":    prompt,
            "lyrics":    doc.get("lyrics", ""),
            "modelName": doc.get("modelName", ""),
            "isInstrumental": doc.get("isInstrumental", ""),
            "description": doc.get("description", ""),
            "caption": doc.get("caption", ""),
            "negativePrompt": doc.get("negativePrompt", ""),
            "displayTags": display_tags,
            "styles": style_text,
            "styleText": style_text,
            "explicit": doc.get("explicit", ""),
            "modelMajorVersion": doc.get("modelMajorVersion", ""),
            "artworkUrl": doc.get("artworkUrl", ""),
        })

    # Write outputs
    FIELDNAMES = [
        "songKey", "handle", "reason", "title",
        "audio_url", "video_url", "image_url", "createdAt",
        "tags", "prompt", "lyrics", "modelName", "isInstrumental",
        "description", "caption", "negativePrompt", "displayTags", "styles", "styleText",
        "explicit", "modelMajorVersion", "artworkUrl"
    ]
    with open(OUT_CSV, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=FIELDNAMES)
        w.writeheader()
        w.writerows(delta_rows)

    report = {
        "run_ts":           run_ts,
        "handle":           HANDLE,
        "suno_live":        len(current_ids),
        "firestore_count":  len(fs_ids),
        "new_clips":        len(new_ids),
        "removed_clips":    len(removed_ids),
        "missing_gcs":      len(missing_gcs),
        "total_delta_rows": len(delta_rows),
        "delta_manifest":   str(OUT_CSV),
    }
    OUT_REPORT.write_text(json.dumps(report, indent=2), encoding="utf-8")

    print(f"""
===== DELTA REPORT [{run_ts}] =====
  Suno live         : {len(current_ids)}
  Firestore         : {len(fs_ids)}
  New clips         : {len(new_ids)}
  Removed clips     : {len(removed_ids)}
  Missing GCS       : {len(missing_gcs)}
  ------------------------------------
  Total delta rows  : {len(delta_rows)}
  Manifest written  : {OUT_CSV}
  Report written    : {OUT_REPORT}
==========================================
""")

    if len(delta_rows) == 0:
        print("Pipeline is fully in sync. Nothing to download.")
        sys.exit(0)
    else:
        print(f"{len(delta_rows)} clip(s) need attention. Run daily_suno_job.sh to process.")
        sys.exit(0)


if __name__ == "__main__":
    main()
