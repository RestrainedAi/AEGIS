#!/usr/bin/env python3
"""
catalog_sync_firestore_multi.py -- Sprint 1 / Task 1.2 (multi-handle)
Aeonimus Pipeline: Multi-Handle Delta Engine

Uses Firestore REST API (no gRPC) and bulk GCS listing (no per-file stat).
"""

import sys
import csv
import json
import os
import argparse
import subprocess
import time
import io
import urllib.parse
import urllib.request
import urllib.error
from pathlib import Path
from datetime import datetime, timezone
from gcp_access_token import get_access_token

# -- Config -------------------------------------------------------------------
PROJECT  = os.environ.get("GCP_PROJECT", "stable-framing-482501-t9")
DATABASE = "(default)"
BUCKET   = os.environ.get("BUCKET", "gs://aeonimus-suno-media")
WORK_DIR = Path(os.environ.get("WORK_DIR", "/app"))
OUT_CSV    = WORK_DIR / "delta_manifest.csv"
OUT_REPORT = WORK_DIR / "delta_report.json"
STUDIO_API = "https://studio-api.prod.suno.com/api/clip/{clip_id}"
AUTHORITATIVE_INGESTION_MODES = {"owned_library", "official_export"}


def source_snapshot_result(source_errors, partial_sources=0):
    """Return the persisted source-health result for this delta snapshot."""
    return "partial_source" if source_errors or partial_sources else "healthy"


# -- Auth ---------------------------------------------------------------------
def get_token():
    return get_access_token()


def fval(field):
    if not field:
        return ""
    for field_type in ("stringValue", "integerValue", "doubleValue", "booleanValue", "timestampValue"):
        if field_type in field:
            return str(field[field_type])
    return ""


def map_fields(field):
    return field.get("mapValue", {}).get("fields", {}) if field else {}


def pick_first(*values):
    for value in values:
        if value:
            return value
    return ""


def source_authority_from_fields(fields: dict) -> tuple[str, bool]:
    """Return a source's configured ingest mode and removal-update authority."""
    ingestion_mode = fval(fields.get("ingestionMode")).strip().lower() or "public_profile"
    authority_status = fval(fields.get("authorityStatus")).strip().lower()
    allows_removal_updates = (
        ingestion_mode in AUTHORITATIVE_INGESTION_MODES
        and authority_status == "verified"
    )
    return ingestion_mode, allows_removal_updates


def clip_lyrics_text(clip: dict) -> str:
    metadata = clip.get("metadata") if isinstance(clip.get("metadata"), dict) else {}
    return pick_first(
        clip.get("lyrics"),
        metadata.get("lyrics"),
        metadata.get("prompt"),
    )


def list_active_suno_sources(token: str) -> list[tuple[str, str | None, bool, str]]:
    """
    Load source handles from Firestore sources collection so harvest ownership
    can follow workspace/tier metadata instead of a hardcoded handle list.
    Returns [(handle, source_id, allows_removal_updates, ingestion_mode)].
    """
    base = (
        f"https://firestore.googleapis.com/v1/projects/{PROJECT}"
        f"/databases/{DATABASE}/documents/sources?pageSize=200"
    )
    docs = []
    next_page = ""

    while True:
        page_url = base + (f"&pageToken={urllib.parse.quote(next_page, safe='')}" if next_page else "")
        req = urllib.request.Request(page_url, headers={"Authorization": f"Bearer {token}"})
        with urllib.request.urlopen(req, timeout=60) as resp:
            payload = json.loads(resp.read())
        docs.extend(payload.get("documents", []))
        next_page = payload.get("nextPageToken", "")
        if not next_page:
            break

    active_sources = []
    for doc in docs:
        fields = doc.get("fields", {})
        platform = fval(fields.get("platform")).strip().lower()
        handle = fval(fields.get("handle")).strip()
        is_active = fval(fields.get("isActive")).strip().lower()
        harvest_enabled = fval(fields.get("harvestEnabled")).strip().lower()
        status = fval(fields.get("status")).strip().lower()

        if platform != "suno" or not handle:
            continue
        if is_active == "false":
            continue
        if harvest_enabled == "false":
            continue
        if status in {"inactive", "disabled", "archived"}:
            continue

        source_id = doc.get("name", "").split("/")[-1] or f"suno_{handle}"
        ingestion_mode, allows_removal_updates = source_authority_from_fields(fields)
        active_sources.append((handle, source_id, allows_removal_updates, ingestion_mode))

    active_sources.sort(key=lambda item: item[0].lower())
    return active_sources


def filter_tracked_handles(
    tracked_handles: list[tuple[str, str | None, bool, str]],
    handle_filter: list[str] | None,
) -> list[tuple[str, str | None]]:
    """Restrict harvest to an explicit handle list when provided."""
    if not handle_filter:
        return tracked_handles

    wanted = {
        str(handle or "").strip().lower().lstrip("@")
        for handle in handle_filter
        if str(handle or "").strip()
    }
    if not wanted:
        return tracked_handles

    filtered = [
        source
        for source in tracked_handles
        for handle in [source[0]]
        if str(handle or "").strip().lower() in wanted
    ]
    missing = sorted(wanted - {source[0] for source in filtered})
    if missing:
        print(
            "  [WARN] Requested handle filter did not match any tracked source(s): "
            + ", ".join(missing),
            file=sys.stderr,
        )
    return filtered


def parse_handle_filter(raw: str | None) -> list[str]:
    if not raw:
        return []
    return [
        part.strip().lstrip("@")
        for part in str(raw).split(",")
        if part.strip()
    ]


# -- Firestore REST helpers ---------------------------------------------------
def get_firestore_docs_rest(token: str, source_id: str) -> dict:
    """
    Query sunoSongs by sourceId via REST API. Returns {clip_id: doc_data}.
    Paginates using nextPageToken until all docs are fetched.
    """
    url = (f"https://firestore.googleapis.com/v1/projects/{PROJECT}"
           f"/databases/{DATABASE}/documents:runQuery")
    body = json.dumps({
        "structuredQuery": {
            "from": [{"collectionId": "sunoSongs"}],
            "where": {
                "fieldFilter": {
                    "field": {"fieldPath": "sourceId"},
                    "op":    "EQUAL",
                    "value": {"stringValue": source_id},
                }
            },
            "select": {"fields": [
                {"fieldPath": "__name__"},
                {"fieldPath": "title"},
                {"fieldPath": "rawTitle"},
                {"fieldPath": "createdAt"},
                {"fieldPath": "duration"},
                {"fieldPath": "durationSeconds"},
                {"fieldPath": "lastSeenAt"},
                {"fieldPath": "sourcePlatform"},
                {"fieldPath": "audioUrl"},
                {"fieldPath": "videoUrl"},
                {"fieldPath": "thumbUrl"},
                {"fieldPath": "media"},
                {"fieldPath": "tags"},
                {"fieldPath": "prompt"},
                {"fieldPath": "lyrics"},
                {"fieldPath": "lyricsStatus"},
                {"fieldPath": "modelName"},
                {"fieldPath": "isInstrumental"},
                {"fieldPath": "ytPublishedAt"},
            ]},
        }
    }).encode()

    req = urllib.request.Request(url, data=body, method="POST",
          headers={"Authorization": f"Bearer {token}",
                   "Content-Type": "application/json"})

    docs = {}
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            results = json.loads(resp.read())
    except Exception as e:
        print(f"  [ERROR] Firestore query failed: {e}", file=sys.stderr)
        return docs

    for item in results:
        doc = item.get("document")
        if not doc:
            continue
        name = doc.get("name", "")
        clip_id = name.split("/")[-1].replace("suno:", "")
        fields = doc.get("fields", {})
        media = map_fields(fields.get("media"))

        # Extract tags array (stored as arrayValue in Firestore)
        tags_field = fields.get("tags", {})
        tags_list  = [v.get("stringValue","")
                      for v in tags_field.get("arrayValue",{}).get("values",[])]
        tags_str   = ",".join(t for t in tags_list if t)

        recovery = map_fields(media.get("audioRecovery"))
        native_retry = map_fields(recovery.get("nativeRetry"))
        docs[clip_id] = {
            "audioRecoveryKind":  fval(recovery.get("kind")),
            "nativeRetryNextAt":  fval(native_retry.get("nextAttemptAt")),
            "nativeRetryAttempts": fval(native_retry.get("attempts")),
            "title":          pick_first(fval(fields.get("title")), fval(fields.get("rawTitle"))),
            "createdAt":      fval(fields.get("createdAt")),
            "duration":       pick_first(fval(fields.get("duration")), fval(fields.get("durationSeconds"))),
            "lastSeenAt":     fval(fields.get("lastSeenAt")),
            "sourcePlatform": fval(fields.get("sourcePlatform")),
            "audioUrl":       pick_first(
                                fval(media.get("audioUrl")),
                                fval(media.get("audio_url")),
                                fval(fields.get("audioUrl")),
                                fval(fields.get("audio_url")),
                              ),
            "videoUrl":       pick_first(
                                fval(media.get("videoUrl")),
                                fval(media.get("video_url")),
                                fval(fields.get("videoUrl")),
                                fval(fields.get("video_url")),
                              ),
            "thumbUrl":       pick_first(
                                fval(media.get("thumbUrl")),
                                fval(media.get("cover_url")),
                                fval(media.get("coverUrl")),
                                fval(fields.get("thumbUrl")),
                                fval(fields.get("image_url")),
                                fval(fields.get("imageUrl")),
                                fval(fields.get("coverUrl")),
                              ),
            "tags":           tags_str,
            "prompt":         fval(fields.get("prompt")),
            "lyrics":         fval(fields.get("lyrics")),
            "lyricsStatus":   fval(fields.get("lyricsStatus")),
            "modelName":      fval(fields.get("modelName")),
            "isInstrumental": fval(fields.get("isInstrumental")),
            "ytPublishedAt":  fval(fields.get("ytPublishedAt")),
        }

    return docs


# -- GCS bulk listing ---------------------------------------------------------
def list_gcs_files(handle: str) -> set:
    """
    List all non-empty files for a handle with one gsutil ls -l call.
    Returns set of basenames e.g. {'abc123.mp3', 'abc123.mp4', ...}

    Uses `gsutil ls -l` instead of `gsutil ls` so we can read the file size
    and exclude 0-byte objects. A 0-byte GCS file causes YouTube upload 400
    errors and must be treated as missing so it gets re-downloaded.

    Output format of `gsutil ls -l`:
        <size>  <date>  gs://bucket/path/file.ext
        TOTAL: <n>
    """
    prefix = f"{BUCKET}/suno/handles/{handle}/"
    r = subprocess.run(["gsutil", "ls", "-l", prefix],
                       capture_output=True, text=True)
    if r.returncode != 0:
        print(f"  [WARN] gsutil ls -l failed for {handle}: {r.stderr.strip()}")
        raise RuntimeError(f"Storage listing unavailable for {handle}; coverage is unverified")
    files = set()
    for line in r.stdout.splitlines():
        parts = line.strip().split()
        # ls -l lines: "  <size>  <date>  gs://..." (3+ parts, last is URI)
        # TOTAL: line has only 2 parts â€” skip it
        if len(parts) < 3:
            continue
        try:
            size = int(parts[0])
        except ValueError:
            continue  # skip TOTAL: and any other non-data lines
        if size == 0:
            basename = parts[-1].split("/")[-1]
            print(f"  [WARN] 0-byte file detected, treating as missing: {basename}")
            continue  # exclude 0-byte files â€” they will be re-downloaded
        basename = parts[-1].split("/")[-1]
        if basename:
            files.add(basename)
    return files


def check_gcs_coverage_bulk(clip_id: str, gcs_files: set) -> list:
    """Check what's missing for a clip given the pre-fetched file set."""
    missing = []
    has_audio = (f"{clip_id}.mp3" in gcs_files or f"{clip_id}.m4a" in gcs_files)
    if not has_audio:       missing.append("audio")
    if f"{clip_id}.mp4" not in gcs_files: missing.append("mp4")
    if f"{clip_id}.jpg" not in gcs_files: missing.append("thumb")
    return missing


# -- Suno API helpers ---------------------------------------------------------
_studio_api_forbidden = False


def fetch_clip_details(clip_id: str) -> dict:
    """Fetch optional enrichment data without retrying a known auth failure."""
    global _studio_api_forbidden
    if _studio_api_forbidden:
        return {}
    url = STUDIO_API.format(clip_id=clip_id)
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=10) as resp:
            return json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        if e.code == 403:
            _studio_api_forbidden = True
            print("  [WARN] Suno metadata API returned 403; skipping remaining optional enrichments", file=sys.stderr)
            return {}
        print(f"  [WARN] Could not fetch clip {clip_id}: {e}", file=sys.stderr)
        return {}
    except Exception as e:
        print(f"  [WARN] Could not fetch clip {clip_id}: {e}", file=sys.stderr)
        return {}


def pick(d: dict, keys: list, default: str = "") -> str:
    for k in keys:
        v = d.get(k)
        if v: return str(v).strip()
    return default


def metadata_field(clip: dict, key: str, default: str = "") -> str:
    metadata = clip.get("metadata") if isinstance(clip.get("metadata"), dict) else {}
    value = metadata.get(key, default)
    if value is None:
        return default
    return str(value).strip()


# -- Per-handle delta ---------------------------------------------------------

def update_source_health(
    token: str,
    source_id: str,
    *,
    authority_status: str,
    ingestion_mode: str,
    last_error: str = "",
) -> None:
    """Persist operational source health without changing song or media truth."""
    now = datetime.now(timezone.utc).isoformat()
    fields = {
        "authorityStatus": {"stringValue": authority_status},
        "ingestionMode": {"stringValue": ingestion_mode},
        "lastSourceSnapshotAt": {"stringValue": now},
        "lastSourceError": {"stringValue": last_error},
    }
    if authority_status == "verified":
        fields["lastAuthoritativeSnapshotAt"] = {"stringValue": now}

    masks = "&".join(f"updateMask.fieldPaths={name}" for name in fields)
    url = (
        f"https://firestore.googleapis.com/v1/projects/{PROJECT}"
        f"/databases/{DATABASE}/documents/sources/{source_id}?{masks}"
    )
    request = urllib.request.Request(
        url,
        data=json.dumps({"fields": fields}).encode("utf-8"),
        method="PATCH",
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
    )
    with urllib.request.urlopen(request, timeout=30):
        pass

def mark_removed_in_firestore(token: str, clip_ids: set) -> int:
    """PATCH each removed clip in sunoSongs: status=removed_from_suno + removedAt."""
    if not clip_ids:
        return 0
    now = datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")
    marked = 0
    for clip_id in clip_ids:
        url = (f"https://firestore.googleapis.com/v1/projects/{PROJECT}"
               f"/databases/{DATABASE}/documents/sunoSongs/{clip_id}"
               "?updateMask.fieldPaths=status&updateMask.fieldPaths=removedAt")
        body = json.dumps({"fields": {
            "status":    {"stringValue": "removed_from_suno"},
            "removedAt": {"stringValue": now},
        }}).encode()
        req = urllib.request.Request(url, data=body, method="PATCH",
            headers={"Authorization": f"Bearer {token}",
                     "Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=30):
                marked += 1
        except Exception as e:
            print(f"  [WARN] mark_removed failed for {clip_id}: {e}", file=sys.stderr)
    return marked


def update_catalog_csv_status(token: str, removed_ids: set):
    """Download catalog CSV from GCS, mark removed clips, re-upload."""
    if not removed_ids:
        return
    CAT_BUCKET = "aeonimus-workspaces"
    CAT_OBJECT = "exports/suno/latest_catalog_wide.csv"
    dl_url = (f"https://storage.googleapis.com/storage/v1/b/{CAT_BUCKET}"
              f"/o/{urllib.parse.quote(CAT_OBJECT, safe='')}?alt=media")
    req = urllib.request.Request(dl_url, headers={"Authorization": f"Bearer {token}"})
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            content = resp.read().decode("utf-8")
    except Exception as e:
        print(f"  [WARN] catalog download failed: {e}", file=sys.stderr)
        return
    reader = csv.DictReader(io.StringIO(content))
    fieldnames = list(reader.fieldnames or [])
    if "status" not in fieldnames:
        fieldnames.append("status")
    rows = []
    for row in reader:
        if row.get("songKey") in removed_ids:
            row["status"] = "removed_from_suno"
        rows.append(row)
    out = io.StringIO()
    writer = csv.DictWriter(out, fieldnames=fieldnames, extrasaction="ignore")
    writer.writeheader()
    writer.writerows(rows)
    csv_bytes = out.getvalue().encode("utf-8")
    ul_url = (f"https://storage.googleapis.com/upload/storage/v1/b/{CAT_BUCKET}"
              f"/o?uploadType=media&name={urllib.parse.quote(CAT_OBJECT)}")
    req2 = urllib.request.Request(ul_url, data=csv_bytes, method="POST",
        headers={"Authorization": f"Bearer {token}", "Content-Type": "text/csv"})
    try:
        with urllib.request.urlopen(req2, timeout=60) as resp:
            d = json.loads(resp.read())
            print(f"  Catalog updated: {d.get('name','?')} size={d.get('size','?')}")
    except Exception as e:
        print(f"  [WARN] catalog upload failed: {e}", file=sys.stderr)

def compute_handle_delta(token: str, handle: str, source_id: str,
                         dry_run: bool = False) -> tuple:
    sys.path.insert(0, str(WORK_DIR))
    from build_manifest_from_studio_api import fetch_profile_clip_ids

    print(f"\n{'='*60}")
    print(f"  Handle   : {handle}")
    print(f"  SourceID : {source_id}")
    print(f"{'='*60}")

    print("  [1/3] Fetching live clip IDs from Suno API...")
    current_ids = set(fetch_profile_clip_ids(handle))
    print(f"    Suno live count : {len(current_ids)}")

    print("  [2/3] Fetching Firestore records via REST...")
    fs_docs = get_firestore_docs_rest(token, source_id)
    fs_ids  = set(fs_docs.keys())
    print(f"    Firestore count : {len(fs_ids)}")

    new_ids     = current_ids - fs_ids
    removed_ids = fs_ids - current_ids
    common_ids  = current_ids & fs_ids
    print(f"    New: {len(new_ids)}  |  Removed: {len(removed_ids)}  |  Common: {len(common_ids)}")

    print(f"  [3/3] Bulk GCS listing for {handle}...")
    missing_gcs = []
    metadata_repair = []
    validation_backlog = []
    retained_without_reference = []
    repair_budget = max(1, int(os.environ.get("MEDIA_REPAIR_BUDGET_PER_HANDLE", "25")))
    if not dry_run:
        gcs_files = list_gcs_files(handle)
        print(f"    GCS objects found: {len(gcs_files)}")
        from media_validation_receipts import ReceiptStore
        from audio_integrity import expected_duration
        receipts = ReceiptStore()
        # Only active registry accounts reach this function; archived accounts stay excluded.
        # Rotate the bounded backlog so a persistently invalid original cannot starve later UUIDs.
        ordered_ids = sorted(fs_ids)
        offset = (datetime.now(timezone.utc).date().toordinal() * repair_budget) % max(1, len(ordered_ids))
        for clip_id in ordered_ids[offset:] + ordered_ids[:offset]:
            doc = fs_docs.get(clip_id, {})
            missing = check_gcs_coverage_bulk(clip_id, gcs_files)
            duration = expected_duration(doc)
            prefix = f"{BUCKET}/suno/handles/{handle}/{clip_id}"
            # Filename presence is not proof of complete media. Unknown receipt joins
            # the bounded queue; storage denial raises to the source error report.
            if "audio" not in missing:
                extensions = [ext for ext in ("mp3", "m4a") if f"{clip_id}.{ext}" in gcs_files]
                if not any(receipts.verified(f"{prefix}.{ext}", duration, "audio") for ext in extensions):
                    missing.append("audio")
            if "mp4" not in missing and not receipts.verified(f"{prefix}.mp4", duration, "video"):
                missing.append("mp4")
            if clip_id in removed_ids:
                # Retain historical records; retry only previously captured exact URLs.
                references = {"audio": doc.get("audioUrl"), "mp4": doc.get("videoUrl"), "thumb": doc.get("thumbUrl")}
                unavailable = [kind for kind in missing if not references.get(kind)]
                if unavailable:
                    retained_without_reference.append({"songKey": clip_id, "assets": unavailable})
                missing = [kind for kind in missing if references.get(kind)]
            if missing:
                if len(missing_gcs) < repair_budget:
                    missing_gcs.append((clip_id, missing))
                else:
                    validation_backlog.append({"songKey": clip_id, "assets": missing})
            prompt = str(doc.get("prompt", "") or "").strip()
            lyrics = str(doc.get("lyrics", "") or "").strip()
            lyrics_status = str(doc.get("lyricsStatus", "") or "").strip().upper()
            if clip_id in common_ids and (not lyrics or (not prompt and lyrics_status == "MISSING") or lyrics_status == "MISSING"):
                metadata_repair.append(clip_id)
    print(f"    GCS gaps : {len(missing_gcs)}")
    print(f"    Metadata repairs : {len(metadata_repair)}")

    delta_rows = []

    for clip_id in sorted(new_ids):
        if dry_run:
            print(f"    [DRY-RUN] NEW {clip_id}")
            delta_rows.append({"songKey": clip_id, "handle": handle,
                "reason": "new", "title": "", "audio_url": "",
                "video_url": "", "image_url": "", "createdAt": ""})
            continue
        print(f"    [NEW] {clip_id}")
        clip = fetch_clip_details(clip_id)
        # Normalize tags list â†’ comma-separated string
        raw_tags = clip.get("tags") or clip.get("tag_list") or []
        if isinstance(raw_tags, list):
            tags_str = ",".join(str(t) for t in raw_tags if t)
        else:
            tags_str = str(raw_tags)
        prompt = pick(clip, ["prompt","metadata_prompt","meta_prompt"]) or metadata_field(clip, "prompt")
        lyrics = clip_lyrics_text(clip) or prompt
        delta_rows.append({
            "songKey":       clip_id, "handle": handle, "reason": "new",
            "title":         pick(clip, ["title","name"]),
            "audio_url":     pick(clip, ["audio_url","audioUrl"]),
            "video_url":     pick(clip, ["video_url","videoUrl"]),
            "image_url":     pick(clip, ["image_url","imageUrl","cover_url","coverUrl"]),
            "createdAt":     pick(clip, ["created_at","createdAt"]),
            "duration":      clip.get("duration") or metadata_field(clip, "duration"),
            "tags":          tags_str,
            "prompt":        prompt,
            "lyrics":        lyrics,
            "modelName":     pick(clip, ["model_name","modelName","model","model_version"]),
            "isInstrumental": str(clip.get("is_instrumental", clip.get("isInstrumental",""))),
        })
        time.sleep(0.15)

    for clip_id, missing_assets in missing_gcs:
        doc = fs_docs.get(clip_id, {})
        print(f"    [GCS_MISSING:{','.join(missing_assets)}] {clip_id}")
        delta_rows.append({
            "songKey":       clip_id, "handle": handle,
            "reason":        ("retained:" if clip_id in removed_ids else "") + f"missing_gcs:{','.join(missing_assets)}",
            "title":         doc.get("title",""),
            # A gs:// path is our own copy (e.g. a derived listening copy), never a Suno source.
            "audio_url":     "" if str(doc.get("audioUrl", "")).startswith("gs://")
                             else doc.get("audioUrl", doc.get("audio_url","")),
            "video_url":     doc.get("videoUrl", doc.get("video_url","")),
            "audioRecoveryKind": doc.get("audioRecoveryKind", ""),
            "nativeRetryNextAt": doc.get("nativeRetryNextAt", ""),
            "nativeRetryAttempts": doc.get("nativeRetryAttempts", ""),
            "image_url":     doc.get("thumbUrl",  doc.get("image_url",
                             doc.get("coverUrl",""))),
            "createdAt":     doc.get("createdAt",""),
            "duration":      doc.get("duration", doc.get("durationSeconds", "")),
            "tags":          doc.get("tags",""),
            "prompt":        doc.get("prompt",""),
            "lyrics":        doc.get("lyrics",""),
            "modelName":     doc.get("modelName",""),
            "isInstrumental":doc.get("isInstrumental",""),
        })

    for clip_id in metadata_repair:
        doc = fs_docs.get(clip_id, {})
        print(f"    [METADATA_REPAIR] {clip_id}")
        clip = fetch_clip_details(clip_id)
        if not clip:
            # The Studio clip endpoint is not an authoritative repair source
            # when it denies access or has removed a clip. Do not enqueue an
            # empty media job that can only fail later; enrichment reports this
            # condition as a visible degraded harvest instead.
            continue
        prompt = (
            pick(clip, ["prompt", "metadata_prompt", "meta_prompt"])
            or metadata_field(clip, "prompt")
            or doc.get("prompt", "")
        )
        lyrics = clip_lyrics_text(clip) or prompt or doc.get("lyrics", "")
        raw_tags = clip.get("tags") or clip.get("tag_list") or doc.get("tags", "")
        if isinstance(raw_tags, list):
            tags_str = ",".join(str(t) for t in raw_tags if t)
        else:
            tags_str = str(raw_tags or "")
        delta_rows.append({
            "songKey":        clip_id,
            "handle":         handle,
            "reason":         "metadata_repair:lyrics",
            "title":          pick(clip, ["title", "name"]) or doc.get("title", ""),
            "audio_url":      pick(clip, ["audio_url", "audioUrl"]) or doc.get("audioUrl", doc.get("audio_url", "")),
            "video_url":      pick(clip, ["video_url", "videoUrl"]) or doc.get("videoUrl", doc.get("video_url", "")),
            "image_url":      pick(clip, ["image_url", "imageUrl", "cover_url", "coverUrl"]) or doc.get("thumbUrl", doc.get("image_url", doc.get("coverUrl", ""))),
            "createdAt":      pick(clip, ["created_at", "createdAt"]) or doc.get("createdAt", ""),
            "duration":       clip.get("duration") or metadata_field(clip, "duration") or doc.get("duration", doc.get("durationSeconds", "")),
            "tags":           tags_str,
            "prompt":         prompt,
            "lyrics":         lyrics,
            "modelName":      pick(clip, ["model_name", "modelName", "model", "model_version"]) or doc.get("modelName", ""),
            "isInstrumental": str(clip.get("is_instrumental", clip.get("isInstrumental", doc.get("isInstrumental", "")))),
        })
        time.sleep(0.15)

    print(f"  Delta rows for {handle}: {len(delta_rows)}")
    return delta_rows, {
        "handle": handle, "suno_live": len(current_ids),
        "firestore_count": len(fs_ids), "new_clips": len(new_ids),
        "removed_clips":    len(removed_ids), "removed_ids_set": list(removed_ids), "missing_gcs": len(missing_gcs),
        "validation_backlog": validation_backlog,
        "retained_without_reference": retained_without_reference,
        "validation_pending": len(missing_gcs) + len(validation_backlog) + len(retained_without_reference),
        "metadata_repairs": len(metadata_repair),
        "delta_rows": len(delta_rows),
    }


# -- Main ---------------------------------------------------------------------
def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument(
        "--handles",
        default=os.environ.get("HARVEST_HANDLES", ""),
        help="Comma-separated SUNO handles to harvest (default: all active sources)",
    )
    args = parser.parse_args()
    handle_filter = parse_handle_filter(args.handles)

    run_ts = datetime.now(timezone.utc).isoformat()
    print(f"[{run_ts}] catalog_sync_firestore_multi.py starting")
    if args.dry_run:
        print("  *** DRY RUN ***")

    token = get_token()
    print(f"  Auth    : OK")

    try:
        tracked_handles = list_active_suno_sources(token)
    except Exception as e:
        print(
            f"[ERROR] Could not load the active SUNO source registry: {e}. "
            "Refusing to harvest an inferred account list.",
            file=sys.stderr,
        )
        sys.exit(2)

    if not tracked_handles:
        print(
            "[ERROR] The active SUNO source registry is empty. "
            "Refusing to harvest an inferred account list.",
            file=sys.stderr,
        )
        sys.exit(2)

    print(f"  Source registry: {len(tracked_handles)} active SUNO source(s)")

    if handle_filter:
        tracked_handles = filter_tracked_handles(tracked_handles, handle_filter)
        print(f"  Handle filter: {', '.join(handle_filter)}")
        if not tracked_handles:
            print("[ERROR] No tracked handles matched the requested filter.", file=sys.stderr)
            sys.exit(2)

    print(f"  Handles : {len(tracked_handles)}")

    all_delta_rows  = []
    per_handle_stats = []

    for handle, source_id_override, allows_removal_updates, ingestion_mode in tracked_handles:
        source_id = source_id_override or f"suno_{handle}"
        try:
            rows, stats = compute_handle_delta(
                token, handle, source_id, dry_run=args.dry_run)
            stats["source_id"] = source_id
            stats["ingestion_mode"] = ingestion_mode
            stats["removal_updates_allowed"] = allows_removal_updates
            stats["authority_status"] = "verified" if allows_removal_updates else "partial_source"
            try:
                update_source_health(
                    token,
                    source_id,
                    authority_status=stats["authority_status"],
                    ingestion_mode=ingestion_mode,
                    last_error=(
                        "Public profile snapshot only; removal detection remains disabled "
                        "until an owned-library or official-export connection is verified."
                        if not allows_removal_updates else ""
                    ),
                )
            except Exception as health_error:
                stats["source_health_error"] = str(health_error)
                print(f"  [WARN] Could not persist source health for {handle}: {health_error}", file=sys.stderr)
            all_delta_rows.extend(rows)
            per_handle_stats.append(stats)
        except Exception as e:
            print(f"\n[ERROR] {handle}: {e}", file=sys.stderr)
            error_stat = {
                "handle": handle,
                "source_id": source_id,
                "ingestion_mode": ingestion_mode,
                "removal_updates_allowed": False,
                "authority_status": "blocked_source",
                "error": str(e),
            }
            try:
                update_source_health(
                    token,
                    source_id,
                    authority_status="blocked_source",
                    ingestion_mode=ingestion_mode,
                    last_error=str(e),
                )
            except Exception as health_error:
                error_stat["source_health_error"] = str(health_error)
                print(f"  [WARN] Could not persist source health for {handle}: {health_error}", file=sys.stderr)
            per_handle_stats.append(error_stat)

    source_errors = [stat for stat in per_handle_stats if "error" in stat]

    # Task 2.10: collect all removed IDs and update GCS catalog CSV. A source
    # read failure must block *all* removal mutations for this run: an API error
    # does not prove that a song was removed from SUNO.
    all_removed_ids = set()
    for _s in per_handle_stats:
        if _s.get("removal_updates_allowed"):
            all_removed_ids.update(_s.get("removed_ids_set", set()))
    if source_errors and all_removed_ids:
        print(
            f"  [WARN] Skipping {len(all_removed_ids)} removal update(s) because "
            "at least one tracked source could not be read.",
            file=sys.stderr,
        )
    elif not args.dry_run and all_removed_ids:
        print(f"\n  Marking {len(all_removed_ids)} authoritatively removed clip(s) in Firestore...")
        marked = mark_removed_in_firestore(token, all_removed_ids)
        print(f"  Marked {marked}/{len(all_removed_ids)} as removed_from_suno")
        print(f"  Updating catalog CSV for {len(all_removed_ids)} removed clip(s)...")
        update_catalog_csv_status(token, all_removed_ids)

    FIELDNAMES = ["songKey","handle","reason","title",
                  "audio_url","video_url","image_url","createdAt","duration",
                  "tags","prompt","lyrics","modelName","isInstrumental",
                  "audioRecoveryKind","nativeRetryNextAt","nativeRetryAttempts"]
    with open(OUT_CSV, "w", newline="", encoding="utf-8") as f:
        csv.DictWriter(f, fieldnames=FIELDNAMES).writeheader()
        csv.DictWriter(f, fieldnames=FIELDNAMES).writerows(all_delta_rows)

    partial_source_count = sum(
        1 for stat in per_handle_stats
        if stat.get("authority_status") != "verified"
    )
    validation_pending = sum(stat.get("validation_pending", 0) for stat in per_handle_stats)
    result = source_snapshot_result(source_errors, partial_source_count + bool(validation_pending))
    report = {
        "run_ts": run_ts, "dry_run": args.dry_run,
        "handles_processed": len(tracked_handles),
        "total_delta_rows": len(all_delta_rows),
        "registry_authoritative": True,
        "result": result,
        "source_error_count": len(source_errors),
        "partial_source_count": partial_source_count,
        "validation_pending": validation_pending,
        "per_handle": per_handle_stats,
    }
    OUT_REPORT.write_text(json.dumps(report, indent=2))

    print(f"\n===== MULTI-HANDLE DELTA REPORT =====")
    for s in per_handle_stats:
        if "error" in s:
            print(f"  {s['handle']}: ERROR â€” {s['error']}")
        else:
            print(f"  {s['handle']}: {s['delta_rows']} delta rows "
                  f"(new={s['new_clips']}, missing_gcs={s['missing_gcs']}, metadata_repairs={s.get('metadata_repairs', 0)}, "
                  f"authority={s['authority_status']})")
    print(f"  Total delta rows : {len(all_delta_rows)}")
    print(f"  Manifest         : {OUT_CSV}")
    print(f"  Result           : {result}")
    print("=====================================")
    if source_errors:
        # The entrypoint reads the persisted partial result, rebuilds the
        # catalog from the verified source slices, then reports the overall
        # Cloud Run execution as partial. A registry failure above still exits
        # immediately because there is no authoritative account scope.
        print(
            f"[WARN] Source snapshot failed for {len(source_errors)} tracked account(s). "
            "Publishing only the verified account slices.",
            file=sys.stderr,
        )
    sys.exit(0)


if __name__ == "__main__":
    main()
