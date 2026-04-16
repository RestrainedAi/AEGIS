#!/usr/bin/env python3
import csv
import json
import os
import subprocess
import urllib.parse
import urllib.request
from datetime import datetime, timezone

PROJECT = "stable-framing-482501-t9"
COLLECTION = "sunoSongs"
OUT_CSV = "latest_catalog_wide.csv"
GCS_DEST = "gs://aeonimus-workspaces/exports/suno/latest_catalog_wide.csv"
OUT_META = "latest_catalog_wide.meta.json"
GCS_META_DEST = "gs://aeonimus-workspaces/exports/suno/latest_catalog_wide.meta.json"
_TOKEN_CACHE = None
FIELDNAMES = [
    "songKey",
    "account_sourceId",
    "account_handle",
    "account_label",
    "title",
    "tags",
    "prompt",
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
]


def get_token():
    global _TOKEN_CACHE
    if _TOKEN_CACHE:
        return _TOKEN_CACHE
    if os.environ.get("ACCESS_TOKEN"):
        _TOKEN_CACHE = os.environ["ACCESS_TOKEN"].strip()
        return _TOKEN_CACHE
    if os.environ.get("TOKEN"):
        _TOKEN_CACHE = os.environ["TOKEN"].strip()
        return _TOKEN_CACHE
    if os.name == "nt":
        _TOKEN_CACHE = subprocess.check_output(["cmd", "/c", "gcloud auth print-access-token"], text=True).strip()
        return _TOKEN_CACHE
    _TOKEN_CACHE = subprocess.check_output(["gcloud", "auth", "print-access-token"], text=True).strip()
    return _TOKEN_CACHE


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
            return json.dumps({inner_key: fval(inner_val) for inner_key, inner_val in value.get("fields", {}).items()})
    return ""


def map_fields(field):
    return field.get("mapValue", {}).get("fields", {}) if field else {}


def pick_first(*values):
    for value in values:
        if value:
            return value
    return ""


def doc_to_row(doc, run_ts):
    fields = doc.get("fields", {})
    flat = {key: fval(value) for key, value in fields.items()}
    media = {key: fval(value) for key, value in map_fields(fields.get("media")).items()}
    gcs = {key: fval(value) for key, value in map_fields(fields.get("gcs")).items()}

    song_key = doc["name"].split("/")[-1]
    account_source_id = pick_first(flat.get("account_sourceId"), flat.get("sourceId"))
    account_handle = pick_first(flat.get("account_handle"), flat.get("handle"))
    title = pick_first(flat.get("title"), flat.get("name"))
    created_at = pick_first(flat.get("createdAt"), flat.get("created_at"))
    updated_at = pick_first(flat.get("updatedAt"), flat.get("importedAt"))
    image_url = pick_first(flat.get("image_url"), flat.get("imageUrl"), flat.get("thumbUrl"), flat.get("coverUrl"))

    gcs_audio = pick_first(flat.get("gcs_mp3"), flat.get("gcsAudioPath"), media.get("audioUrl"))
    gcs_video = pick_first(flat.get("gcs_mp4"), flat.get("gcsVideoPath"), media.get("videoUrl"))
    gcs_thumb = pick_first(flat.get("gcs_thumb"), flat.get("gcsThumbPath"), media.get("thumbUrl"))

    # Tags are stored as a Firestore arrayValue; fval() encodes them as JSON.
    # Normalize to a plain comma-separated string for spreadsheet/CSV friendliness.
    raw_tags = flat.get("tags", "")
    if raw_tags.startswith("["):
        try:
            tag_list = json.loads(raw_tags)
            tags_str = ",".join(str(t) for t in tag_list if t)
        except (ValueError, TypeError):
            tags_str = raw_tags
    else:
        tags_str = raw_tags

    return {
        "songKey": flat.get("songKey", song_key),
        "account_sourceId": account_source_id,
        "account_handle": account_handle,
        "account_label": pick_first(flat.get("account_label"), account_handle),
        "title": title,
        "tags": tags_str,
        "prompt": pick_first(flat.get("prompt"), flat.get("metaPrompt"), ""),
        "modelName": pick_first(flat.get("modelName"), flat.get("model_name"), flat.get("modelVersion"), ""),
        "isInstrumental": pick_first(flat.get("isInstrumental"), flat.get("is_instrumental"), ""),
        "createdAt": created_at,
        "updatedAt": updated_at,
        "duration": flat.get("duration", ""),
        "views": pick_first(flat.get("views"), flat.get("playCount"), "0"),
        "likes": pick_first(flat.get("likes"), flat.get("upvoteCount"), "0"),
        "commentsCount": pick_first(flat.get("commentsCount"), "0"),
        "remixCount": pick_first(flat.get("remixCount"), "0"),
        "audio_url": pick_first(flat.get("audio_url"), flat.get("audioUrl")),
        "video_url": pick_first(flat.get("video_url"), flat.get("videoUrl")),
        "image_url": image_url,
        "gcs_mp3": gcs_audio,
        "gcs_mp4": gcs_video,
        "gcs_thumb": gcs_thumb,
        "gcs_latest_audio": pick_first(flat.get("gcs_latest_audio"), gcs_audio if gcs.get("audio") == "true" else ""),
        "gcs_latest_mp4": pick_first(flat.get("gcs_latest_mp4"), gcs_video if gcs.get("video") == "true" else ""),
        "gcs_latest_thumb": pick_first(flat.get("gcs_latest_thumb"), gcs_thumb if gcs.get("thumb") == "true" else ""),
        "rawClipJsonGcs": flat.get("rawClipJsonGcs", ""),
        "runId": run_ts,
        "lastSeenAt": pick_first(flat.get("lastSeenAt"), updated_at, created_at),
        "status": flat.get("status", ""),
        "ytStatus": flat.get("ytStatus", ""),
        "ytVideoId": flat.get("ytVideoId", ""),
        "ytCanonicalUrl": flat.get("ytCanonicalUrl", ""),
        "ytPublishedAt": flat.get("ytPublishedAt", ""),
    }


def fetch_all(token):
    base = f"https://firestore.googleapis.com/v1/projects/{PROJECT}/databases/(default)/documents/{COLLECTION}"
    headers = {"Authorization": f"Bearer {token}"}
    docs = []
    page_token = None
    page = 0
    while True:
        url = base + "?pageSize=300" + (f"&pageToken={page_token}" if page_token else "")
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
    req = urllib.request.Request(
        url,
        data=body,
        method="POST",
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": content_type,
        },
    )
    with urllib.request.urlopen(req, timeout=60) as response:
        response.read()


print("=== rebuild_catalog.py ===")
token = get_token()
print("Fetching Firestore docs...")
docs = fetch_all(token)
print(f"Total docs: {len(docs)}")
run_ts = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
rows = sorted([doc_to_row(doc, run_ts) for doc in docs], key=lambda row: row.get("createdAt", ""), reverse=True)
with open(OUT_CSV, "w", newline="", encoding="utf-8") as fh:
    writer = csv.DictWriter(fh, fieldnames=FIELDNAMES)
    writer.writeheader()
    writer.writerows(rows)
print(f"Written {len(rows)} rows -> {OUT_CSV}")
print(f"  Newest: {rows[0]['createdAt'][:10]}  {rows[0]['title'][:50]}")
print(f"  Oldest: {rows[-1]['createdAt'][:10]}  {rows[-1]['title'][:50]}")
meta = {
    "generatedAt": run_ts,
    "rowCount": len(rows),
    "generator": "yt-ingest/rebuild_catalog.py",
    "artifact": GCS_DEST,
}
with open(OUT_META, "w", encoding="utf-8") as fh:
    json.dump(meta, fh, indent=2)
print(f"Uploading to {GCS_DEST}...")
upload_file(OUT_CSV, GCS_DEST, token, "text/csv")
print(f"Uploading to {GCS_META_DEST}...")
upload_file(OUT_META, GCS_META_DEST, token, "application/json")
print("Done. Next: cp ~/yt-ingest/latest_catalog_wide.csv ~/suno-viewer/public/catalog.csv")
