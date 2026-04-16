#!/usr/bin/env python3
"""
Backfill missing SUNO metadata in Firestore from the Studio API.

This is a safe repair utility for song documents that have media in GCS but
are missing top-level metadata like title and createdAt.
"""

import argparse
import csv
import json
import os
import time
import urllib.error
import urllib.request
from gcp_access_token import get_access_token


PROJECT = "stable-framing-482501-t9"
DATABASE = "(default)"
BASE_DOCS = f"https://firestore.googleapis.com/v1/projects/{PROJECT}/databases/{DATABASE}/documents/sunoSongs"
TRACKED_HANDLES = ("unshakableechos2341", "genxdreams")
MANIFEST_PATHS = [
    os.path.join(os.path.dirname(__file__), "delta_manifest.csv"),
    os.path.join(os.path.dirname(__file__), "suno_manifest.csv"),
]
def token():
    return get_access_token()


def fetch_json(url, headers=None):
    req = urllib.request.Request(url, headers=headers or {})
    with urllib.request.urlopen(req, timeout=60) as response:
        return json.loads(response.read())


def fire_headers():
    return {"Authorization": f"Bearer {token()}"}


def fval(field):
    if not field:
        return ""
    for key in ("stringValue", "integerValue", "doubleValue", "timestampValue"):
        if key in field:
            return str(field[key])
    if "booleanValue" in field:
        return str(field["booleanValue"]).lower()
    return ""


def fetch_all_docs():
    docs = []
    page_token = None
    while True:
        url = f"{BASE_DOCS}?pageSize=300"
        if page_token:
            url += f"&pageToken={page_token}"
        data = fetch_json(url, headers=fire_headers())
        docs.extend(data.get("documents", []))
        page_token = data.get("nextPageToken")
        if not page_token:
            return docs


def fetch_profile_clip_ids(handle):
    base = f"https://studio-api.prod.suno.com/api/profiles/{handle}"
    page = 1
    ids = []
    seen = set()
    while True:
        url = f"{base}?page={page}&playlists_sort_by=created_at&clips_sort_by=created_at"
        try:
            data = fetch_json(url, headers={"Accept": "application/json"})
        except Exception:
            break
        clips = data.get("clips", []) if isinstance(data, dict) else []
        found = []
        for clip in clips:
            if isinstance(clip, dict):
                clip_id = clip.get("id") or clip.get("clip_id") or clip.get("clipId") or clip.get("songKey")
                if isinstance(clip_id, str) and clip_id not in seen:
                    seen.add(clip_id)
                    found.append(clip_id)
        if not found:
            break
        ids.extend(found)
        page += 1
        time.sleep(0.1)
    return ids


def fetch_clip_detail(clip_id):
    try:
        return fetch_json(
            f"https://studio-api.prod.suno.com/api/clip/{clip_id}",
            headers={"Accept": "application/json"},
        )
    except urllib.error.HTTPError as exc:
        if exc.code == 404:
            return {}
        raise


def merge_manifest_row(existing, candidate):
    if not existing:
        return candidate
    merged = dict(existing)
    for key in ("title", "createdAt", "audio_url", "video_url", "image_url", "handle", "reason"):
        if not (merged.get(key) or "").strip() and (candidate.get(key) or "").strip():
            merged[key] = candidate[key]
    return merged


def load_manifest_rows():
    rows = {}
    for manifest_path in MANIFEST_PATHS:
        if not os.path.exists(manifest_path):
            continue
        with open(manifest_path, newline="", encoding="utf-8") as fh:
            for row in csv.DictReader(fh):
                song_key = (row.get("songKey") or "").strip()
                if song_key:
                    rows[song_key] = merge_manifest_row(rows.get(song_key), row)
    return rows


def pick(data, keys):
    for key in keys:
        value = data.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return ""


def preview_text(value, limit=60):
    text = (value or "").replace("\r", " ").replace("\n", " ").strip()
    if len(text) > limit:
        text = text[:limit]
    return text.encode("ascii", "replace").decode("ascii")


def patch_doc(song_key, fields):
    mask = "&".join(f"updateMask.fieldPaths={field}" for field in fields)
    url = f"{BASE_DOCS}/{song_key}?{mask}"
    body = json.dumps({"fields": fields}).encode()
    req = urllib.request.Request(
        url,
        data=body,
        method="PATCH",
        headers={
            **fire_headers(),
            "Content-Type": "application/json",
        },
    )
    with urllib.request.urlopen(req, timeout=60):
        return


def should_patch(doc):
    fields = doc.get("fields", {})
    source_id = fval(fields.get("sourceId"))
    handle = fval(fields.get("handle"))
    title = fval(fields.get("title")).strip()
    created_at = fval(fields.get("createdAt")).strip()
    song_key = doc["name"].split("/")[-1]
    tracked = handle in TRACKED_HANDLES or source_id in {f"suno_{h}" for h in TRACKED_HANDLES}
    return tracked and (not title or not created_at), song_key, handle


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int, default=0, help="Optional cap on documents to patch")
    parser.add_argument("--title-only", action="store_true",
                        help="Only patch rows when a non-empty title can be recovered.")
    args = parser.parse_args()

    docs = fetch_all_docs()
    manifest_rows = load_manifest_rows()
    pending = []
    for doc in docs:
        needs_patch, song_key, handle = should_patch(doc)
        if needs_patch:
            if args.title_only:
                manifest_row = manifest_rows.get(song_key, {})
                if not (manifest_row.get("title") or "").strip():
                    continue
            pending.append((song_key, handle))

    print(f"Missing metadata docs queued for repair: {len(pending)}")
    print(f"Manifest rows available for repair: {len(manifest_rows)}")
    patched = 0
    for index, (song_key, handle) in enumerate(pending, start=1):
        manifest = manifest_rows.get(song_key, {})
        title = (manifest.get("title") or "").strip()
        created_at = (manifest.get("createdAt") or "").strip()
        if not title or not created_at:
            detail = fetch_clip_detail(song_key)
            if not title:
                title = pick(detail, ["title", "name"])
            if not created_at:
                created_at = pick(detail, ["created_at", "createdAt", "created"])
        patch = {}
        if title:
            patch["title"] = {"stringValue": title}
        if created_at:
            patch["createdAt"] = {"stringValue": created_at}
        if args.title_only and "title" not in patch:
            print(f"[SKIP] {song_key} no recoverable title found")
            continue
        if not patch:
            print(f"[SKIP] {song_key} no repairable metadata found")
            continue
        patch_doc(song_key, patch)
        patched += 1
        print(
            f"[{index}/{len(pending)}] patched {song_key} "
            f"-> title={preview_text(title)!r} createdAt={preview_text(created_at, 24)!r}"
        )
        if args.limit and patched >= args.limit:
            break
        time.sleep(0.05)

    print(f"Patched {patched} documents.")


if __name__ == "__main__":
    main()
