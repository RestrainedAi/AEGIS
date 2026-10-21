#!/usr/bin/env python3
"""
firestore_upsert.py — Aeonimus Pipeline: GCS Truth Protocol
Phase 2 / Task 2.5

Writes a new song document to Firestore sunoSongs ONLY after
its media assets have been successfully uploaded to GCS.

"GCS is truth" — Firestore is a derived index.
Never write to Firestore before GCS succeeds.

Schema written to sunoSongs/{clip_id}:
  songKey        : clip_id (UUID string)
  sourceId       : "suno_{handle}"
  sourcePlatform : "suno"
  handle         : Suno username
  title          : normalized song title
  rawTitle       : optional raw/source title when distinct
  createdAt      : ISO 8601 string (from Suno API)
  firstSeenAt    : first time this clip was indexed
  lastSeenAt     : latest successful harvest sighting
  harvestedAt    : harvest event timestamp
  indexedAt      : Firestore upsert timestamp
  importedAt     : compatibility timestamp mirrored from indexedAt
  status         : "active"
  media          : {
      audioUrl   : gs:// URI of audio (mp3 or m4a)
      videoUrl   : gs:// URI of video (mp4, may be null)
      thumbUrl   : gs:// URI of thumbnail (jpg, may be null)
      audioExt   : "mp3" | "m4a"
  }
  gcs            : {
      audio  : bool
      video  : bool
      thumb  : bool
  }
  rawMetadataRef : optional provenance-explicit reference
  rawPayloadRef  : optional provenance-explicit reference
  artworkUrl     : optional source artwork URL if distinct from stored thumb

Versioning:
  If the document already exists, we MERGE the media/gcs fields
  so existing metadata (title, tags, etc.) is preserved.
  Use merge=True always.

Usage (standalone):
  python3 firestore_upsert.py --clip-id <uuid> --handle <handle> \
          --title "Song Title" --audio-ext mp3

Usage (imported by download_media_gcs.py):
  from firestore_upsert import upsert_song_after_download
  upsert_song_after_download(clip_id, handle, title, audio_ext,
                              has_video=True, has_thumb=True,
                              created_at="2024-01-01T00:00:00Z")
"""

import os
import sys
import argparse
import re
from datetime import datetime, timezone
from typing import Any

from account_labels import canonical_account_handle, canonical_account_label

# ── GCS path helper (mirrors download_media_gcs.py) ──────────────────────────
BUCKET = os.environ.get("SUNO_MEDIA_BUCKET", "gs://aeonimus-suno-media")
STYLE_KEYWORDS = [
    "acoustic", "alt-pop", "ambient", "ballad", "cinematic", "country",
    "dark synthpop", "darkwave", "drill", "drum and bass", "dubstep",
    "electronic", "electropop", "emo", "folk", "funk", "glitch",
    "glitch pop", "gospel", "grunge", "hard rock", "hip hop", "house",
    "industrial", "indie", "jazz", "latin", "lo-fi", "metal", "orchestral",
    "phonk", "pop", "punk", "r&b", "rap", "rock", "shoegaze", "soul",
    "synthpop", "synthwave", "techno", "trap",
]

def _gcs_path(handle: str, clip_id: str, ext: str) -> str:
    return f"{BUCKET}/suno/handles/{handle}/{clip_id}.{ext}"

def _gcs_audio_uri(handle: str, clip_id: str, audio_ext: str) -> str:
    return _gcs_path(handle, clip_id, audio_ext)

def _gcs_video_uri(handle: str, clip_id: str) -> str:
    return _gcs_path(handle, clip_id, "mp4")

def _gcs_thumb_uri(handle: str, clip_id: str) -> str:
    return _gcs_path(handle, clip_id, "jpg")


def _split_csvish(value: str) -> list[str]:
    if not value:
        return []
    text = str(value).replace("|", ",")
    return [part.strip() for part in text.split(",") if part.strip()]


def _dedupe_keep_order(values: list[str]) -> list[str]:
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
    styles.extend(_split_csvish(tags))
    styles.extend(_split_csvish(display_tags))

    prompt_lower = str(prompt or "").lower()
    for keyword in STYLE_KEYWORDS:
        if re.search(rf"(?<!\w){re.escape(keyword)}(?!\w)", prompt_lower):
            styles.append(keyword)

    normalized = _dedupe_keep_order(styles)
    return normalized, ", ".join(normalized)


def preserve_audio_recovery(existing, incoming):
    """Keep an explicitly verified derived selection during routine harvests.

    A routine download result cannot authorize native supersession. Malformed
    recovery records fail closed so their selected audio is never silently reset.
    Called inside the read/write transaction, including transaction retries.
    """
    media = existing.get("media") or {}
    if "audioRecovery" not in media:
        return
    recovery = media["audioRecovery"]
    # Suno later served the native file and it was recorded as a new version:
    # the native selection stands; the recovery record stays as history.
    if (isinstance(recovery, dict) and recovery.get("nativeSupersededAt")
            and recovery.get("nativeAudioUrl")
            and media.get("audioUrl") == recovery["nativeAudioUrl"]):
        incoming["media"]["audioUrl"] = recovery["nativeAudioUrl"]
        incoming["media"]["audioExt"] = media.get("audioExt") or incoming["media"].get("audioExt")
        incoming["gcs"]["audio"] = True
        return
    # originalMissing=True: Suno never served a native MP3, so there is no original
    # generation/hash to pin. It must be explicit, and those two fields must be empty.
    original_missing = isinstance(recovery, dict) and recovery.get("originalMissing") is True
    original_keys = () if original_missing else ("originalGeneration", "originalSha256")
    required = ("derivedAudioUrl", "derivedSha256", "originalAudioUrl",
                *original_keys, "sourceVideoUrl",
                "sourceVideoGeneration", "sourceVideoSha256", "provenanceUrl",
                "verifiedAt")
    if (not isinstance(recovery, dict)
            or recovery.get("kind") != "derived-from-video"
            or recovery.get("nativeOriginal") is not False
            or recovery.get("originalMissing") not in (None, True, False)
            or (original_missing and (recovery.get("originalGeneration") or recovery.get("originalSha256")))
            or any(not recovery.get(key) for key in required)):
        raise ValueError("Existing audioRecovery is incomplete; explicit reconciliation required")
    if (media.get("audioUrl") != recovery["derivedAudioUrl"]
            or not str(recovery["derivedAudioUrl"]).startswith("gs://")
            or not str(recovery["derivedAudioUrl"]).lower().endswith(".mp3")
            or any(not re.fullmatch(r"[0-9a-f]{64}", str(recovery[key]))
                   for key in ("derivedSha256", *original_keys[1:], "sourceVideoSha256"))):
        raise ValueError("Existing audioRecovery selection is inconsistent; explicit reconciliation required")
    incoming["media"]["audioUrl"] = recovery["derivedAudioUrl"]
    incoming["media"]["audioExt"] = "mp3"
    incoming["media"]["audioRecovery"] = recovery
    incoming["gcs"]["audio"] = True


# ── Core upsert function ──────────────────────────────────────────────────────
def upsert_song_after_download(
    clip_id:        str,
    handle:         str,
    title:          str  = "",
    raw_title:      str  = "",
    audio_ext:      str  = "mp3",
    has_audio:      bool = True,
    has_video:      bool = False,
    has_thumb:      bool = False,
    created_at:     str  = "",
    tags:           str  = "",   # comma-separated tag string
    prompt:         str  = "",   # Suno generation prompt
    lyrics:         str  = "",   # Suno lyrics/prompt text when available
    model_name:     str  = "",   # e.g. "chirp-v3-5"
    is_instrumental: str = "",   # "true" / "false" / ""
    description:    str  = "",
    caption:        str  = "",
    negative_prompt: str = "",
    display_tags:   str  = "",
    styles:         str  = "",
    style_text:     str  = "",
    explicit:       Any  = None,
    model_major_version: str = "",
    raw_metadata_ref: Any = None,
    raw_payload_ref: Any = None,
    artwork_url:    str  = "",
    last_seen_at:   str  = "",
    harvested_at:   str  = "",
    indexed_at:     str  = "",
    first_seen_at:  str  = "",
    source_platform: str = "suno",
    db=None,                     # pass existing client to avoid re-init overhead
    project:        str  = "",
    audio_recovery: dict = None,  # derived-from-video listening copy (originalMissing)
) -> bool:
    """
    Write (or merge-update) a sunoSongs document after successful GCS upload.

    Returns True on success, False on failure (logs error, does not raise).
    """
    try:
        from google.cloud import firestore

        if db is None:
            kwargs = {}
            if project:
                kwargs["project"] = project
            db = firestore.Client(**kwargs)

        now = datetime.now(timezone.utc)
        now_iso = now.isoformat()
        source_id = f"suno_{handle}"
        effective_last_seen = last_seen_at or now_iso
        effective_harvested = harvested_at or now_iso
        effective_indexed = indexed_at or now_iso

        # Build GCS URIs only for assets that were actually uploaded
        audio_uri = _gcs_audio_uri(handle, clip_id, audio_ext) if has_audio else None
        video_uri = _gcs_video_uri(handle, clip_id)             if has_video else None
        thumb_uri = _gcs_thumb_uri(handle, clip_id)             if has_thumb else None

        doc_ref = db.collection("sunoSongs").document(clip_id)

        doc_data = {
            "songKey":    clip_id,
            "sourceId":   source_id,
            "account_sourceId": source_id,
            "account_handle": canonical_account_handle(handle),
            "account_label": canonical_account_label(handle),
            "sourcePlatform": source_platform,
            "handle":     handle,
            "isRemoved":  False,
            "status":     "active",
            "importedAt": effective_indexed,
            "indexedAt": effective_indexed,
            "harvestedAt": effective_harvested,
            "lastSeenAt": effective_last_seen,
            "media": {
                "audioUrl":  audio_uri,
                "videoUrl":  video_uri,
                "thumbUrl":  thumb_uri,
                "audioExt":  audio_ext,
            },
            "gcs": {
                "audio": has_audio,
                "video": has_video,
                "thumb": has_thumb,
            },
        }

        if audio_recovery:
            rec = dict(audio_recovery)
            if (rec.get("kind") != "derived-from-video" or rec.get("nativeOriginal") is not False
                    or not str(rec.get("derivedAudioUrl", "")).startswith("gs://")):
                raise ValueError("audio_recovery must be a verified derived-from-video record")
            rec.pop("reused", None)
            doc_data["media"]["audioUrl"] = rec["derivedAudioUrl"]
            doc_data["media"]["audioExt"] = "mp3"
            doc_data["media"]["audioRecovery"] = rec
            doc_data["gcs"]["audio"] = True

        # Preserve any existing non-empty title instead of overwriting it with a blank.
        if title:
            doc_data["title"] = title
        if raw_title:
            doc_data["rawTitle"] = raw_title

        # createdAt is source-derived and should be stable across re-downloads.
        if created_at:
            doc_data["createdAt"] = created_at
        if first_seen_at:
            doc_data["firstSeenAt"] = first_seen_at

        # Write Suno metadata fields only when non-empty so we never
        # overwrite existing values with blank strings on a re-download.
        if tags:
            # Store as a Firestore array for easy querying, alongside
            # a comma-string copy for CSV export compatibility.
            tag_list = [t.strip() for t in tags.split(",") if t.strip()]
            doc_data["tags"] = tag_list
        if prompt:
            doc_data["prompt"] = prompt
        if lyrics:
            doc_data["lyrics"] = lyrics
            doc_data["lyricsStatus"] = "OK"
            doc_data["textRetrievedAt"] = effective_indexed
            doc_data["lyricsRetrievedAt"] = effective_indexed
            doc_data["lyricsSource"] = "SUNO_STUDIO_API"
        elif "lyricsStatus" not in doc_data:
            doc_data["lyricsStatus"] = "MISSING"
        if model_name:
            doc_data["modelName"] = model_name
        if is_instrumental != "":
            # Normalize to boolean
            doc_data["isInstrumental"] = (
                is_instrumental.lower() in ("true", "1", "yes")
                if isinstance(is_instrumental, str)
                else bool(is_instrumental)
            )
        if description:
            doc_data["description"] = description
        if caption:
            doc_data["caption"] = caption
        if negative_prompt:
            doc_data["negativePrompt"] = negative_prompt
        if display_tags:
            display_tag_list = [t.strip() for t in display_tags.split(",") if t.strip()]
            doc_data["displayTags"] = display_tag_list
        derived_styles, derived_style_text = derive_styles(
            tags=tags,
            display_tags=display_tags,
            prompt=prompt,
        )
        if styles:
            style_list = [t.strip() for t in styles.split(",") if t.strip()]
            if style_list:
                doc_data["styles"] = style_list
                doc_data["styleText"] = style_text or ", ".join(style_list)
        elif derived_styles:
            doc_data["styles"] = derived_styles
            doc_data["styleText"] = derived_style_text
        if explicit is not None and explicit != "":
            doc_data["explicit"] = (
                explicit.lower() in ("true", "1", "yes")
                if isinstance(explicit, str)
                else bool(explicit)
            )
        if model_major_version:
            doc_data["modelMajorVersion"] = model_major_version
        if raw_metadata_ref is not None:
            doc_data["rawMetadataRef"] = raw_metadata_ref
        if raw_payload_ref is not None:
            doc_data["rawPayloadRef"] = raw_payload_ref
        if artwork_url:
            doc_data["artworkUrl"] = artwork_url

        # Read and merge atomically: a repair installed concurrently must not be
        # replaced by the fixed native URI generated by a normal harvest.
        @firestore.transactional
        def write_preserving_recovery(transaction):
            snapshot = doc_ref.get(transaction=transaction)
            existing = snapshot.to_dict() if snapshot.exists else {}
            # A retry must use a fresh payload, not the previous attempt's map.
            import copy
            payload = copy.deepcopy(doc_data)
            preserve_audio_recovery(existing or {}, payload)
            transaction.set(doc_ref, payload, merge=True)

        write_preserving_recovery(db.transaction())

        print(f"  [FIRESTORE] OK upserted sunoSongs/{clip_id} "
              f"(audio={has_audio}, video={has_video}, thumb={has_thumb})")
        return True

    except Exception as e:
        print(f"  [FIRESTORE] FAILED to upsert {clip_id}: {type(e).__name__}: {e}",
              file=sys.stderr)
        return False


def record_native_retry(clip_id: str, retry: dict, db=None) -> bool:
    """Store the weekly native-MP3 retry schedule on an existing derived recovery."""
    try:
        if db is None:
            from google.cloud import firestore
            db = firestore.Client()
        ref = db.collection("sunoSongs").document(clip_id)
        snap = ref.get()
        rec = ((snap.to_dict() or {}).get("media") or {}).get("audioRecovery") if snap.exists else None
        if not isinstance(rec, dict) or rec.get("kind") != "derived-from-video":
            return False
        ref.update({"media.audioRecovery.nativeRetry": retry})
        return True
    except Exception as e:
        print(f"  [FIRESTORE] FAILED to record native retry for {clip_id}: {type(e).__name__}", file=sys.stderr)
        return False


def native_version_payload(existing: dict, latest_version: dict, native_uri: str, audio_ext: str,
                           native_sha256: str, native_generation: str, at: str, run_id: str):
    """Pure: (version_docs, head_updates) for a native MP3 that replaces a derived copy as a NEW version.

    A song that was never versioned first gets versions/1 describing the derived state,
    so the derived copy stays visible as its own version.
    """
    media = existing.get("media") or {}
    rec = media.get("audioRecovery") or {}
    if rec.get("kind") != "derived-from-video" or rec.get("nativeSupersededAt"):
        raise ValueError("no open derived recovery to supersede")
    if not re.fullmatch(r"[0-9a-f]{64}", str(native_sha256)) or not native_generation:
        raise ValueError("native audio must be pinned by sha256 and generation")
    versions = []
    latest = latest_version or {}
    if not existing.get("currentVersion"):
        latest = {"n": 1, "capturedAt": at, "runId": run_id, "changedFields": ["initial"],
                  "metadata": {}, "source": {}, "migratedFrom": "derived-recovery",
                  "assets": {"audio": {"gcs": rec.get("derivedAudioUrl"), "status": "ok", "derived": True,
                                       "sha256": rec.get("derivedSha256"), "recovery": rec}}}
        versions.append(latest)
    n = int(existing.get("currentVersion") or 1) + 1
    assets = dict(latest.get("assets") or {})
    assets["audio"] = {"gcs": native_uri, "status": "ok", "sha256": native_sha256,
                       "generation": str(native_generation), "native": True}
    version = {
        "n": n, "capturedAt": at, "runId": run_id, "changedFields": ["audio"],
        "metadata": latest.get("metadata") or {}, "metadataSha256": latest.get("metadataSha256", ""),
        "source": latest.get("source") or {}, "assets": assets,
        "supersedes": {"version": n - 1, "derivedAudioUrl": rec.get("derivedAudioUrl"),
                       "derivedSha256": rec.get("derivedSha256")},
    }
    head = {
        "currentVersion": n,
        "media.audioUrl": native_uri,
        "media.audioExt": audio_ext,
        "media.audioRecovery.nativeSupersededAt": at,
        "media.audioRecovery.nativeAudioUrl": native_uri,
        "media.audioRecovery.nativeSha256": native_sha256,
        "media.audioRecovery.nativeGeneration": str(native_generation),
        "media.audioRecovery.supersededInVersion": n,
        "gcs.audio": True,
    }
    versions.append(version)
    return versions, head


def record_native_audio_version(clip_id: str, native_uri: str, audio_ext: str, native_sha256: str,
                                native_generation: str, db=None, run_id: str = "") -> bool:
    """Suno finally served the native file: create versions/{n+1} (create-only) and point the head at it.

    The derived copy, its provenance and the earlier version are never touched.
    """
    try:
        from google.cloud import firestore
        if db is None:
            db = firestore.Client()
        at = datetime.now(timezone.utc).isoformat()
        ref = db.collection("sunoSongs").document(clip_id)

        @firestore.transactional
        def write(transaction):
            snap = ref.get(transaction=transaction)
            existing = snap.to_dict() if snap.exists else {}
            n_prev = int(existing.get("currentVersion") or 1)
            prev = ref.collection("versions").document(str(n_prev)).get(transaction=transaction)
            versions, head = native_version_payload(existing, prev.to_dict() if prev.exists else {},
                                                   native_uri, audio_ext, native_sha256,
                                                   native_generation, at, run_id or f"native-{at[:19]}")
            for version in versions:  # create-only: fails if the version already exists
                transaction.create(ref.collection("versions").document(str(version["n"])), version)
            transaction.update(ref, head)

        write(db.transaction())
        print(f"  [FIRESTORE] native audio recorded as new version for {clip_id}")
        return True
    except Exception as e:
        print(f"  [FIRESTORE] FAILED to record native version for {clip_id}: {type(e).__name__}: {e}",
              file=sys.stderr)
        return False


def update_song_metadata_only(row, db=None):
    """Update captured metadata on an existing authorized record, never media/status."""
    try:
        if db is None:
            from google.cloud import firestore
            from google.auth import compute_engine
            if not os.environ.get("CLOUD_RUN_JOB"):
                raise RuntimeError("Metadata updates require harvest machine identity")
            db = firestore.Client(project=os.environ.get("GCP_PROJECT", os.environ.get("PROJECT", "stable-framing-482501-t9")),
                                  credentials=compute_engine.Credentials())
        ref = db.collection("sunoSongs").document(row["songKey"])
        snapshot = ref.get()
        if not snapshot.exists:
            return False
        existing = snapshot.to_dict()
        if existing.get("sourceId") != "suno_" + row["handle"]:
            return False
        changes = {key: row[key] for key in ("title", "prompt", "lyrics", "modelName")
                   if isinstance(row.get(key), str) and row[key].strip()}
        if changes.get("lyrics"):
            changes["lyricsStatus"] = "OK"
        if changes:
            changes["metadataUpdatedAt"] = datetime.now(timezone.utc).isoformat()
            ref.update(changes)
        return True
    except Exception as exc:
        print(f"[METADATA_UPDATE_FAILED] {row.get('songKey')}: {type(exc).__name__}", file=sys.stderr)
        return False


def bulk_upsert(rows: list, db=None, project: str = "") -> dict:
    """
    Upsert multiple songs from a list of result dicts.
    Each dict should have: clip_id, handle, title, audio_ext,
                           has_audio, has_video, has_thumb, created_at

    Returns: {"success": N, "failed": N, "failed_ids": [...]}
    """
    from google.cloud import firestore

    if db is None:
        kwargs = {}
        if project:
            kwargs["project"] = project
        db = firestore.Client(**kwargs)

    success = 0
    failed  = 0
    failed_ids = []

    for row in rows:
        ok = upsert_song_after_download(
            clip_id    = row.get("clip_id", row.get("songKey", "")),
            handle     = row.get("handle", ""),
            title      = row.get("title", ""),
            raw_title  = row.get("raw_title", row.get("rawTitle", "")),
            audio_ext  = row.get("audio_ext", "mp3"),
            has_audio  = row.get("has_audio", row.get("audio", False)),
            has_video  = row.get("has_video", row.get("video", False)),
            has_thumb  = row.get("has_thumb", row.get("thumb", False)),
            created_at = row.get("created_at", row.get("createdAt", "")),
            tags       = row.get("tags", ""),
            prompt     = row.get("prompt", ""),
            lyrics     = row.get("lyrics", ""),
            model_name = row.get("model_name", row.get("modelName", "")),
            is_instrumental = row.get("is_instrumental", row.get("isInstrumental", "")),
            description = row.get("description", ""),
            caption = row.get("caption", ""),
            negative_prompt = row.get("negative_prompt", row.get("negativePrompt", "")),
            display_tags = row.get("display_tags", row.get("displayTags", "")),
            styles = row.get("styles", ""),
            style_text = row.get("styleText", ""),
            explicit = row.get("explicit"),
            model_major_version = row.get("model_major_version", row.get("modelMajorVersion", "")),
            raw_metadata_ref = row.get("raw_metadata_ref", row.get("rawMetadataRef")),
            raw_payload_ref = row.get("raw_payload_ref", row.get("rawPayloadRef")),
            artwork_url = row.get("artwork_url", row.get("artworkUrl", "")),
            last_seen_at = row.get("last_seen_at", row.get("lastSeenAt", "")),
            harvested_at = row.get("harvested_at", row.get("harvestedAt", "")),
            indexed_at = row.get("indexed_at", row.get("indexedAt", "")),
            first_seen_at = row.get("first_seen_at", row.get("firstSeenAt", "")),
            source_platform = row.get("source_platform", row.get("sourcePlatform", "suno")),
            db         = db,
        )
        if ok:
            success += 1
        else:
            failed += 1
            failed_ids.append(row.get("clip_id", "?"))

    return {"success": success, "failed": failed, "failed_ids": failed_ids}


# ── CLI ───────────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Upsert a song to Firestore after GCS upload")
    parser.add_argument("--clip-id",    required=True, help="Clip UUID")
    parser.add_argument("--handle",     required=True, help="Suno handle")
    parser.add_argument("--title",      default="",    help="Song title")
    parser.add_argument("--audio-ext",  default="mp3", choices=["mp3", "m4a"],
                        help="Audio file extension (default: mp3)")
    parser.add_argument("--has-video",  action="store_true", help="Video was uploaded to GCS")
    parser.add_argument("--has-thumb",  action="store_true", help="Thumbnail was uploaded to GCS")
    parser.add_argument("--created-at", default="", help="ISO 8601 creation timestamp from Suno")
    parser.add_argument("--project",    default="stable-framing-482501-t9", help="GCP project ID")
    args = parser.parse_args()

    ok = upsert_song_after_download(
        clip_id    = args.clip_id,
        handle     = args.handle,
        title      = args.title,
        audio_ext  = args.audio_ext,
        has_audio  = True,
        has_video  = args.has_video,
        has_thumb  = args.has_thumb,
        created_at = args.created_at,
        project    = args.project,
    )
    sys.exit(0 if ok else 1)
