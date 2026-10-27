#!/usr/bin/env python3
"""
Rebuild the SUNO vault export from Firestore `sunoSongs`.

Contract notes:
1. Nested `media.*` is the canonical item media truth.
2. Nested `gcs.*` is canonical only for harvest-managed storage presence flags.
3. Export aliases such as `gcs_mp3`, `gcs_mp4`, `gcs_thumb`, and `account_*`
   are view-model fields only.
4. Export freshness authority lives in `latest_catalog_wide.meta.json.generatedAt`.
5. Export row `runId` is context only.
"""

import csv
import json
import os
import socket
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from urllib.error import HTTPError, URLError

from gcp_access_token import get_access_token

PROJECT = "stable-framing-482501-t9"
COLLECTION = "sunoSongs"
OUT_CSV = "latest_catalog_wide.csv"
GCS_DEST = "gs://aeonimus-workspaces/exports/suno/latest_catalog_wide.csv"
OUT_META = "latest_catalog_wide.meta.json"
GCS_META_DEST = "gs://aeonimus-workspaces/exports/suno/latest_catalog_wide.meta.json"
FIELDNAMES = [
    "songKey",
    "account_sourceId",
    "account_handle",
    "account_label",
    "title",
    "tags",
    "displayTags",
    "styles",
    "styleText",
    "prompt",
    "lyrics",
    "lyricsStatus",
    "gcsLyricsTxt",
    "gcsLyricsJson",
    "gcsLyricsVtt",
    "modelName",
    "isInstrumental",
    "createdAt",
    "updatedAt",
    "duration",
    "views",
    "likes",
    "commentsCount",
    "remixCount",
    "audio_url",
    "audio_asset_role",
    "audio_provenance_url",
    "audio_original_url",
    "video_url",
    "image_url",
    "gcs_mp3",
    "gcs_mp4",
    "gcs_thumb",
    "gcs_latest_audio",
    "gcs_latest_mp4",
    "gcs_latest_thumb",
    "rawClipJsonGcs",
    "runId",
    "lastSeenAt",
    "status",
    "ytStatus",
    "ytVideoId",
    "ytCanonicalUrl",
    "ytPublishedAt",
    "mediaIssues",
    "titleSource",
]

from title_overrides import (
    TITLE_OVERRIDES_GCS,
    apply_titles,
    load_gcs_overrides,
    load_seed,
    merged_overrides,
)
from account_labels import (
    HANDLE_ALIAS_MAP,
    canonical_account_handle,
    canonical_account_label,
)


def get_token():
    return get_access_token()


def fval(field):
    if not field:
        return ""
    for key, value in field.items():
        if key == "nullValue":
            return ""
        if key == "booleanValue":
            return str(value).lower()
        if key in ("stringValue", "integerValue", "doubleValue"):
            return str(value)
        if key == "timestampValue":
            return str(value)
        if key == "arrayValue":
            return json.dumps([fval(item) for item in value.get("values", [])])
        if key == "mapValue":
            return json.dumps(
                {
                    inner_key: fval(inner_val)
                    for inner_key, inner_val in value.get("fields", {}).items()
                }
            )
    return ""


def map_fields(field):
    return field.get("mapValue", {}).get("fields", {}) if field else {}


def pick_first(*values):
    for value in values:
        if value:
            return value
    return ""


def as_truthy_bool(value):
    return str(value).strip().lower() in {"true", "1", "yes"}


def normalize_tags(raw_tags):
    if raw_tags.startswith("["):
        try:
            tag_list = json.loads(raw_tags)
            return normalize_inline_text(",".join(str(tag) for tag in tag_list if tag))
        except (ValueError, TypeError):
            return normalize_inline_text(raw_tags)
    return normalize_inline_text(raw_tags)


def normalize_maybe_json_list(raw_value):
    text = str(raw_value or "")
    if text.startswith("["):
        try:
            values = json.loads(text)
            if isinstance(values, list):
                return normalize_inline_text(", ".join(str(value) for value in values if value))
        except (ValueError, TypeError):
            pass
    return normalize_inline_text(text)


def normalize_inline_text(raw_text):
    text = str(raw_text or "")
    text = text.replace("\\n", " ").replace("\\r", " ").replace("\\t", " ")
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    text = " ".join(text.splitlines())
    text = text.replace("\t", " ").strip()
    # Strip nulls and other control characters that do not belong in a flat export.
    text = "".join(ch for ch in text if ch >= " " or ch == "\u00a0")
    return " ".join(text.split())


def normalize_export_text(raw_text):
    text = str(raw_text or "").replace("\r\n", "\n").replace("\r", "\n").strip()
    text = "".join(ch for ch in text if ch >= " " or ch in {"\n", "\u00a0"})
    return text.replace("\n", "\\n")


def canonical_media_fields(flat, media):
    return {
        "audio_url": pick_first(
            media.get("audioUrl"),
            media.get("audio_url"),
            flat.get("audioUrl"),
            flat.get("audio_url"),
        ),
        "video_url": pick_first(
            media.get("videoUrl"),
            media.get("video_url"),
            flat.get("videoUrl"),
            flat.get("video_url"),
        ),
        "image_url": pick_first(
            media.get("thumbUrl"),
            media.get("cover_url"),
            media.get("coverUrl"),
            flat.get("artworkUrl"),
            flat.get("thumbUrl"),
            flat.get("image_url"),
            flat.get("imageUrl"),
            flat.get("coverUrl"),
        ),
    }


def export_gcs_aliases(flat, canonical_media, gcs):
    gcs_audio = pick_first(
        flat.get("gcs_mp3"),
        flat.get("gcsAudioPath"),
        canonical_media["audio_url"],
    )
    gcs_video = pick_first(
        flat.get("gcs_mp4"),
        flat.get("gcsVideoPath"),
        canonical_media["video_url"],
    )
    gcs_thumb = pick_first(
        flat.get("gcs_thumb"),
        flat.get("gcsThumbPath"),
        canonical_media["image_url"],
    )
    return {
        "gcs_mp3": gcs_audio,
        "gcs_mp4": gcs_video,
        "gcs_thumb": gcs_thumb,
        "gcs_latest_audio": pick_first(
            flat.get("gcs_latest_audio"),
            gcs_audio if as_truthy_bool(gcs.get("audio")) else "",
        ),
        "gcs_latest_mp4": pick_first(
            flat.get("gcs_latest_mp4"),
            gcs_video if as_truthy_bool(gcs.get("video")) else "",
        ),
        "gcs_latest_thumb": pick_first(
            flat.get("gcs_latest_thumb"),
            gcs_thumb if as_truthy_bool(gcs.get("thumb")) else "",
        ),
    }


def doc_to_row(doc, run_ts):
    fields = doc.get("fields", {})
    flat = {key: fval(value) for key, value in fields.items()}
    media = {key: fval(value) for key, value in map_fields(fields.get("media")).items()}
    gcs = {key: fval(value) for key, value in map_fields(fields.get("gcs")).items()}
    text = {key: fval(value) for key, value in map_fields(fields.get("text")).items()}
    canonical_media = canonical_media_fields(flat, media)
    gcs_aliases = export_gcs_aliases(flat, canonical_media, gcs)
    recovery = {key: fval(value) for key, value in map_fields(map_fields(fields.get("media")).get("audioRecovery")).items()}
    recovery_selected = (
        isinstance(recovery, dict)
        and recovery.get("kind") == "derived-from-video"
        and recovery.get("nativeOriginal") == "false"
        and bool(recovery.get("derivedAudioUrl"))
        and canonical_media["audio_url"] == recovery.get("derivedAudioUrl")
    )
    if recovery_selected:
        # Preserve the native asset alias while exporting the explicitly selected
        # listening copy for playback and current-audio consumers.
        gcs_aliases["gcs_mp3"] = recovery.get("originalAudioUrl", "")
        gcs_aliases["gcs_latest_audio"] = canonical_media["audio_url"]

    song_key = doc["name"].split("/")[-1]
    account_source_id = pick_first(flat.get("account_sourceId"), flat.get("sourceId"))
    raw_account_handle = pick_first(flat.get("account_handle"), flat.get("handle"))
    account_handle = canonical_account_handle(raw_account_handle)
    raw_account_label = pick_first(flat.get("account_label"), raw_account_handle)
    account_label = canonical_account_label(raw_account_handle, raw_account_label)
    created_at = pick_first(flat.get("createdAt"), flat.get("created_at"))
    updated_at = pick_first(flat.get("updatedAt"), flat.get("indexedAt"), flat.get("importedAt"))

    return {
        "songKey": flat.get("songKey", song_key),
        "account_sourceId": normalize_inline_text(account_source_id),
        "account_handle": normalize_inline_text(account_handle),
        "account_label": normalize_inline_text(pick_first(account_label, account_handle)),
        "title": normalize_inline_text(pick_first(flat.get("title"), flat.get("rawTitle"), flat.get("name"))),
        "tags": normalize_tags(flat.get("tags", "")),
        "displayTags": normalize_maybe_json_list(flat.get("displayTags", "")),
        "styles": normalize_maybe_json_list(flat.get("styles", "")),
        "styleText": normalize_inline_text(pick_first(flat.get("styleText"), "")),
        "prompt": normalize_export_text(pick_first(flat.get("prompt"), flat.get("metaPrompt"), "")),
        "lyrics": normalize_export_text(pick_first(flat.get("lyrics"), text.get("lyrics"), "")),
        "lyricsStatus": normalize_inline_text(pick_first(flat.get("lyricsStatus"), "")),
        "gcsLyricsTxt": normalize_inline_text(pick_first(flat.get("gcsLyricsTxt"), "")),
        "gcsLyricsJson": normalize_inline_text(pick_first(flat.get("gcsLyricsJson"), "")),
        "gcsLyricsVtt": normalize_inline_text(pick_first(flat.get("gcsLyricsVtt"), "")),
        "modelName": normalize_inline_text(pick_first(
            flat.get("modelName"),
            flat.get("model_name"),
            flat.get("modelVersion"),
            "",
        )),
        "isInstrumental": normalize_inline_text(pick_first(flat.get("isInstrumental"), flat.get("is_instrumental"), "")),
        "createdAt": normalize_inline_text(created_at),
        "updatedAt": normalize_inline_text(updated_at),
        "duration": normalize_inline_text(flat.get("duration", "")),
        "views": normalize_inline_text(pick_first(flat.get("views"), flat.get("playCount"), "0")),
        "likes": normalize_inline_text(pick_first(flat.get("likes"), flat.get("upvoteCount"), "0")),
        "commentsCount": normalize_inline_text(pick_first(flat.get("commentsCount"), "0")),
        "remixCount": normalize_inline_text(pick_first(flat.get("remixCount"), "0")),
        "audio_url": normalize_inline_text(canonical_media["audio_url"]),
        "audio_asset_role": "derived-from-video" if recovery_selected else "",
        "audio_provenance_url": normalize_inline_text(recovery.get("provenanceUrl", "")) if recovery_selected else "",
        "audio_original_url": normalize_inline_text(recovery.get("originalAudioUrl", "")) if recovery_selected else "",
        "video_url": normalize_inline_text(canonical_media["video_url"]),
        "image_url": normalize_inline_text(canonical_media["image_url"]),
        "gcs_mp3": normalize_inline_text(gcs_aliases["gcs_mp3"]),
        "gcs_mp4": normalize_inline_text(gcs_aliases["gcs_mp4"]),
        "gcs_thumb": normalize_inline_text(gcs_aliases["gcs_thumb"]),
        "gcs_latest_audio": normalize_inline_text(gcs_aliases["gcs_latest_audio"]),
        "gcs_latest_mp4": normalize_inline_text(gcs_aliases["gcs_latest_mp4"]),
        "gcs_latest_thumb": normalize_inline_text(gcs_aliases["gcs_latest_thumb"]),
        "rawClipJsonGcs": normalize_inline_text(pick_first(
            flat.get("rawClipJsonGcs"),
            flat.get("rawPayloadRef"),
            flat.get("rawMetadataRef"),
        )),
        "runId": normalize_inline_text(run_ts),
        "lastSeenAt": normalize_inline_text(pick_first(flat.get("lastSeenAt"), updated_at, created_at)),
        "status": normalize_inline_text(flat.get("status", "")),
        "ytStatus": normalize_inline_text(flat.get("ytStatus", "")),
        "ytVideoId": normalize_inline_text(flat.get("ytVideoId", "")),
        "ytCanonicalUrl": normalize_inline_text(flat.get("ytCanonicalUrl", "")),
        "ytPublishedAt": normalize_inline_text(flat.get("ytPublishedAt", "")),
        "mediaIssues": normalize_inline_text(flat.get("mediaIssues", "")),
        "titleSource": "",
    }


def fetch_all(token):
    base = f"https://firestore.googleapis.com/v1/projects/{PROJECT}/databases/(default)/documents/{COLLECTION}"
    headers = {"Authorization": f"Bearer {token}"}
    docs = []
    page_token = None
    page = 0
    while True:
        url = base + "?pageSize=300"
        if page_token:
            url += f"&pageToken={urllib.parse.quote(page_token, safe='')}"
        req = urllib.request.Request(url, headers=headers)
        data = json.loads(urllib.request.urlopen(req).read())
        batch = data.get("documents", [])
        docs.extend(batch)
        page += 1
        print(f"  Page {page}: +{len(batch)} (total {len(docs)})")
        page_token = data.get("nextPageToken")
        if not page_token:
            break
    return docs


def parse_gs_uri(gs_uri):
    rest = gs_uri[len("gs://"):]
    bucket, object_name = rest.split("/", 1)
    return bucket, object_name


def upload_file(local_path, gs_uri, token, content_type):
    bucket, object_name = parse_gs_uri(gs_uri)
    url = (
        f"https://storage.googleapis.com/upload/storage/v1/b/{bucket}/o"
        f"?uploadType=media&name={urllib.parse.quote(object_name, safe='')}"
    )
    with open(local_path, "rb") as fh:
        body = fh.read()
    attempts = 4
    backoff_seconds = 2
    last_error = None
    for attempt in range(1, attempts + 1):
        req = urllib.request.Request(
            url,
            data=body,
            method="POST",
            headers={
                "Authorization": f"Bearer {token}",
                "Content-Type": content_type,
            },
        )
        try:
            with urllib.request.urlopen(req, timeout=60) as response:
                response.read()
            return
        except HTTPError as error:
            if error.code < 500 or attempt == attempts:
                raise
            last_error = error
        except (URLError, ConnectionResetError, TimeoutError, socket.timeout) as error:
            if attempt == attempts:
                raise
            last_error = error

        wait_seconds = backoff_seconds * attempt
        print(
            f"[WARN] Upload attempt {attempt}/{attempts} failed for {gs_uri}: {last_error}. "
            f"Retrying in {wait_seconds}s..."
        )
        time.sleep(wait_seconds)

    if last_error:
        raise last_error


def safe_preview_text(value, limit=50):
    text = str(value or "")
    if not text:
        return ""
    text = text[:limit]
    return text.encode("ascii", "replace").decode("ascii")


MEDIA_PATH_COLUMNS = (
    ("gcs_mp3", "gcs_latest_audio"),
    ("gcs_mp4", "gcs_latest_mp4"),
    ("gcs_thumb", "gcs_latest_thumb"),
)


STUB_AUDIO_BYTES = 20_000  # Suno's silent stand-in is ~4.8 KB; real songs are MBs
KNOWN_REMOVED_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fixtures", "suno_removed_clips.json")


def load_known_removed(path=KNOWN_REMOVED_FILE):
    """Song IDs verified as gone from Suno (404) that stay listed in the Vault."""
    try:
        with open(path, encoding="utf-8") as fh:
            return {str(item.get("songKey") or "") for item in json.load(fh).get("clips", [])} - {""}
    except (OSError, ValueError):
        return set()


def media_issues_for_row(row, sizes, known_removed=frozenset()):
    """Plain issue ids the Vault shows as tags: removed_from_suno, audio_from_video,
    silent_placeholder, no_audio, no_video, no_thumb."""
    issues = []
    if row.get("status") == "removed_from_suno" or row.get("songKey") in known_removed:
        issues.append("removed_from_suno")
    if row.get("audio_asset_role") == "derived-from-video":
        issues.append("audio_from_video")
    else:
        audio = str(row.get("gcs_mp3") or "")
        if audio.startswith("gs://") and audio in sizes and int(sizes[audio] or 0) < STUB_AUDIO_BYTES:
            issues.append("silent_placeholder")
        elif not (row.get("gcs_latest_audio") or row.get("gcs_mp3")):
            issues.append("no_audio")
    if not (row.get("gcs_mp4") or row.get("gcs_latest_mp4")):
        issues.append("no_video")
    if not (row.get("gcs_thumb") or row.get("gcs_latest_thumb") or row.get("image_url")):
        issues.append("no_thumb")
    return ";".join(issues)


def list_media_objects(token, bucket, prefix="suno/"):
    """Return {gs:// URI: size} for non-empty objects under the prefix.
    (A dict, so `uri in result` still works as an existence check.)"""
    found = {}
    page_token = None
    while True:
        url = (f"https://storage.googleapis.com/storage/v1/b/{bucket}/o"
               f"?prefix={urllib.parse.quote(prefix, safe='')}&fields=items(name,size),nextPageToken&maxResults=1000")
        if page_token:
            url += f"&pageToken={urllib.parse.quote(page_token, safe='')}"
        req = urllib.request.Request(url, headers={"Authorization": f"Bearer {token}"})
        data = json.loads(urllib.request.urlopen(req, timeout=60).read())
        for item in data.get("items", []):
            if int(item.get("size") or 0) > 0:
                found[f"gs://{bucket}/{item['name']}"] = int(item.get("size") or 0)
        page_token = data.get("nextPageToken")
        if not page_token:
            return found


def drop_missing_media_paths(rows, existing):
    """Blank gs:// media paths whose object does not exist, so the catalog
    never advertises an mp3/mp4/thumb that is not in the bucket."""
    dropped = {column: 0 for column, _ in MEDIA_PATH_COLUMNS}
    for row in rows:
        for column, latest in MEDIA_PATH_COLUMNS:
            for key in (column, latest):
                value = str(row.get(key) or "")
                if value.startswith("gs://") and value not in existing:
                    row[key] = ""
                    if key == column:
                        dropped[column] += 1
        audio = str(row.get("audio_url") or "")
        if audio.startswith("gs://") and audio not in existing:
            row["audio_url"] = row.get("gcs_latest_audio") or row.get("gcs_mp3") or ""
    return dropped


def build_rows(docs, run_ts, overrides=None):
    rows = [doc_to_row(doc, run_ts) for doc in docs]
    apply_titles(rows, overrides or {})
    return sorted(rows, key=lambda row: row.get("createdAt", ""), reverse=True)


def build_meta(run_ts, row_count):
    return {
        "generatedAt": run_ts,
        "rowCount": row_count,
        "generator": "yt-ingest/rebuild_catalog.py",
        "artifact": GCS_DEST,
    }


def main():
    print("=== rebuild_catalog.py ===")
    token = get_token()
    print("Fetching Firestore docs...")
    docs = fetch_all(token)
    print(f"Total docs: {len(docs)}")
    run_ts = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    seed = load_seed()
    try:
        gcs_overrides = load_gcs_overrides(token)
    except Exception as exc:
        # Never block the catalog on the overrides file; the viewer applies it at serve time too.
        print(f"[WARN] Title overrides unavailable ({TITLE_OVERRIDES_GCS}): {type(exc).__name__}: {exc}", file=sys.stderr)
        gcs_overrides = {}
    overrides = merged_overrides(gcs_overrides, seed)
    rows = build_rows(docs, run_ts, overrides)
    sources = {}
    for row in rows:
        key = row.get("titleSource") or "blank"
        sources[key] = sources.get(key, 0) + 1
    print(f"  Titles: {len(overrides)} overrides ({len(gcs_overrides)} from GCS); sources {sources}")
    if os.environ.get("CATALOG_VERIFY_MEDIA", "true").strip().lower() not in {"0", "false", "no", "off"}:
        media_bucket = os.environ.get("SUNO_MEDIA_BUCKET", "gs://aeonimus-suno-media").replace("gs://", "").strip("/")
        try:
            existing = list_media_objects(token, media_bucket)
            dropped = drop_missing_media_paths(rows, existing)
            known_removed = load_known_removed()
            for row in rows:
                row["mediaIssues"] = media_issues_for_row(row, existing, known_removed)
            print(f"  Media check: {len(existing)} objects; blanked missing paths {dropped}")
        except Exception as exc:
            # Never block the catalog on the check itself; say so loudly.
            print(f"[WARN] Media existence check skipped: {type(exc).__name__}: {exc}", file=sys.stderr)
    raw_label_rows = [
        row for row in rows
        if row.get("account_label") in HANDLE_ALIAS_MAP
        or row.get("account_handle") in HANDLE_ALIAS_MAP
    ]
    if raw_label_rows:
        print(
            f"[WARN] {len(raw_label_rows)} export rows still use raw handle labels; "
            "re-run harvest upserts to normalize Firestore account_label fields.",
            file=sys.stderr,
        )

    with open(OUT_CSV, "w", newline="", encoding="utf-8") as fh:
        writer = csv.DictWriter(fh, fieldnames=FIELDNAMES)
        writer.writeheader()
        writer.writerows(rows)
    print(f"Written {len(rows)} rows -> {OUT_CSV}")
    if rows:
        print(f"  Newest: {rows[0]['createdAt'][:10]}  {safe_preview_text(rows[0]['title'])}")
        print(f"  Oldest: {rows[-1]['createdAt'][:10]}  {safe_preview_text(rows[-1]['title'])}")

    meta = build_meta(run_ts, len(rows))
    with open(OUT_META, "w", encoding="utf-8") as fh:
        json.dump(meta, fh, indent=2)

    print(f"Uploading to {GCS_DEST}...")
    upload_file(OUT_CSV, GCS_DEST, token, "text/csv")
    print(f"Uploading to {GCS_META_DEST}...")
    upload_file(OUT_META, GCS_META_DEST, token, "application/json")
    print("Done. Next: cp ~/yt-ingest/latest_catalog_wide.csv ~/suno-viewer/public/catalog.csv")


if __name__ == "__main__":
    main()
