#!/usr/bin/env python3
"""
Generate portable lyrics artifacts for existing sunoSongs documents.

Creates:
1. lyrics.txt
2. lyrics.json
3. lyrics.vtt

Writes artifact URLs back to Firestore so the Vault can open saved lyrics files.
VTT uses clearly labeled synthesized pacing so downstream tools that prefer
WebVTT can consume a portable subtitle-shaped artifact without treating it as
authoritative timing truth from SUNO.
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import json
import uuid
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from typing import Any

from gcp_access_token import get_access_token


PROJECT = "stable-framing-482501-t9"
DATABASE = "(default)"
COLLECTION = "sunoSongs"
BASE_DOCS = (
    f"https://firestore.googleapis.com/v1/projects/{PROJECT}"
    f"/databases/{DATABASE}/documents/{COLLECTION}"
)
BUCKET = "aeonimus-workspaces"
GCS_PREFIX = "exports/suno/lyrics"
PUBLIC_BASE = f"https://storage.googleapis.com/{BUCKET}"


def now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def token() -> str:
    return get_access_token()


def headers() -> dict[str, str]:
    return {"Authorization": f"Bearer {token()}"}


def fetch_json(url: str) -> dict:
    req = urllib.request.Request(url, headers=headers())
    with urllib.request.urlopen(req, timeout=60) as response:
        return json.loads(response.read())


def fval(field):
    if not field:
        return ""
    if "nullValue" in field:
        return ""
    for key in ("stringValue", "integerValue", "doubleValue", "timestampValue"):
        if key in field:
            return str(field[key])
    if "booleanValue" in field:
        return "true" if field["booleanValue"] else "false"
    if "arrayValue" in field:
        values = field["arrayValue"].get("values", [])
        return [fval(item) for item in values]
    return ""


def fetch_all_docs(limit: int = 0) -> list[dict]:
    docs = []
    page_token = None
    while True:
        page_size = 300 if not limit else min(300, max(limit - len(docs), 1))
        url = f"{BASE_DOCS}?pageSize={page_size}"
        if page_token:
            url += f"&pageToken={urllib.parse.quote(page_token, safe='')}"
        data = fetch_json(url)
        docs.extend(data.get("documents", []))
        if limit and len(docs) >= limit:
            return docs[:limit]
        page_token = data.get("nextPageToken")
        if not page_token:
            return docs


def upload_bytes(content: bytes, object_name: str, content_type: str) -> str:
    url = (
        f"https://storage.googleapis.com/upload/storage/v1/b/{BUCKET}/o"
        f"?uploadType=media&ifGenerationMatch=0&name={urllib.parse.quote(object_name, safe='')}"
    )
    req = urllib.request.Request(
        url,
        data=content,
        method="POST",
        headers={
            **headers(),
            "Content-Type": content_type,
        },
    )
    with urllib.request.urlopen(req, timeout=60) as response:
        stored = json.loads(response.read())
    if int(stored.get("size", -1)) != len(content) or stored.get("md5Hash") != base64.b64encode(hashlib.md5(content).digest()).decode():
        raise ValueError("Lyrics artifact upload failed checksum verification")
    return f"{PUBLIC_BASE}/{object_name}"


def artifact_inventory() -> dict[str, dict]:
    objects = {}
    page = ""
    while True:
        url = (f"https://storage.googleapis.com/storage/v1/b/{BUCKET}/o"
               "?prefix=exports/suno/&maxResults=1000&fields=items(name,size,md5Hash),nextPageToken")
        if page:
            url += "&pageToken=" + urllib.parse.quote(page, safe="")
        req = urllib.request.Request(url, headers=headers())
        with urllib.request.urlopen(req, timeout=60) as response:
            data = json.load(response)
        for item in data.get("items", []):
            objects[f"{PUBLIC_BASE}/{item['name']}"] = item
        page = data.get("nextPageToken")
        if not page:
            return objects


def artifacts_current(fields: dict, text: str, objects: dict) -> bool:
    urls = [normalize_text(fval(fields.get(key))) for key in ("gcsLyricsTxt", "gcsLyricsJson", "gcsLyricsVtt")]
    urls = [url.replace(f"gs://{BUCKET}/", f"{PUBLIC_BASE}/") for url in urls]
    if not all(int(objects.get(url, {}).get("size", 0)) > 0 for url in urls):
        return False
    return objects[urls[0]].get("md5Hash") == base64.b64encode(hashlib.md5(text.encode("utf-8")).digest()).decode()


def patch_doc(doc_name: str, patch_fields: dict[str, dict]) -> None:
    mask = "&".join(
        f"updateMask.fieldPaths={urllib.parse.quote(field)}"
        for field in patch_fields.keys()
    )
    url = f"https://firestore.googleapis.com/v1/{doc_name}?{mask}"
    body = json.dumps({"fields": patch_fields}).encode()
    req = urllib.request.Request(
        url,
        data=body,
        method="PATCH",
        headers={
            **headers(),
            "Content-Type": "application/json",
        },
    )
    with urllib.request.urlopen(req, timeout=60) as response:
        response.read()


def normalize_text(value: str) -> str:
    return str(value or "").replace("\r\n", "\n").replace("\r", "\n").strip()


def build_json_payload(song_key: str, fields: dict) -> bytes:
    title = fval(fields.get("title"))
    lyrics = normalize_text(fval(fields.get("lyrics")))
    payload = {
        "songKey": song_key,
        "title": title,
        "lyricsStatus": fval(fields.get("lyricsStatus")) or ("OK" if lyrics else "MISSING"),
        "lyricsSource": fval(fields.get("lyricsSource")) or "SUNO_STUDIO_API",
        "retrievedAt": fval(fields.get("lyricsRetrievedAt")) or now_iso(),
        "text": lyrics,
        "hasTiming": False,
        "segments": [],
        "version": 1,
    }
    return json.dumps(payload, indent=2, ensure_ascii=False).encode("utf-8")


def format_vtt_timestamp(seconds: float) -> str:
    total_ms = max(0, int(round(seconds * 1000)))
    hours = total_ms // 3_600_000
    remainder = total_ms % 3_600_000
    minutes = remainder // 60_000
    remainder %= 60_000
    secs = remainder // 1000
    millis = remainder % 1000
    return f"{hours:02d}:{minutes:02d}:{secs:02d}.{millis:03d}"


def lyrics_blocks(lyrics: str) -> list[list[str]]:
    normalized = normalize_text(lyrics)
    if not normalized:
        return []

    blocks: list[list[str]] = []
    current: list[str] = []
    for raw_line in normalized.split("\n"):
        line = raw_line.strip()
        if not line:
            if current:
                blocks.append(current)
                current = []
            continue
        current.append(line)
    if current:
        blocks.append(current)
    return blocks


def cue_duration_seconds(lines: list[str]) -> float:
    text = " ".join(lines).strip()
    word_count = len(text.split())
    estimated = max(2.0, min(8.0, 1.2 + (word_count / 2.6)))
    return estimated


def build_vtt_payload(fields: dict) -> bytes:
    lyrics = normalize_text(fval(fields.get("lyrics")))
    blocks = lyrics_blocks(lyrics)
    notes = [
        "WEBVTT",
        "",
        "NOTE Synthetic pacing artifact generated from SUNO lyrics text.",
        "NOTE Timing is approximate and exists for portability only.",
        "",
    ]
    if not blocks:
        return "\n".join(notes).encode("utf-8")

    cursor = 0.0
    cues: list[str] = []
    for index, block in enumerate(blocks, start=1):
        duration = cue_duration_seconds(block)
        start = format_vtt_timestamp(cursor)
        end = format_vtt_timestamp(cursor + duration)
        cursor += duration + 0.35
        cues.extend([
            str(index),
            f"{start} --> {end}",
            "\n".join(block),
            "",
        ])
    return ("\n".join(notes + cues)).encode("utf-8")


def matches_filters(fields: dict[str, Any], source_id_filter: str = "", handle_filter: str = "") -> bool:
    source_id = fval(fields.get("sourceId")) or ""
    handle = fval(fields.get("handle")) or ""
    if source_id_filter and source_id != source_id_filter:
        return False
    if handle_filter and handle != handle_filter:
        return False
    return True


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int, default=0, help="Optional cap on documents to inspect")
    parser.add_argument("--dry-run", action="store_true", help="Preview changes without writing")
    parser.add_argument("--source-id", default="", help="Only process docs with this Firestore sourceId.")
    parser.add_argument("--handle", default="", help="Only process docs with this Firestore handle.")
    parser.add_argument(
        "--missing-only",
        action="store_true",
        help="Only write artifacts for docs missing one or more lyrics artifact URLs.",
    )
    args = parser.parse_args()

    docs = fetch_all_docs(limit=args.limit)
    objects = artifact_inventory() if args.missing_only else {}
    run_id = uuid.uuid4().hex
    touched = 0
    skipped = 0
    failed = []

    for doc in docs:
        doc_name = doc.get("name", "")
        song_key = doc_name.split("/")[-1]
        fields = doc.get("fields", {}) or {}
        if not matches_filters(fields, source_id_filter=args.source_id, handle_filter=args.handle):
            skipped += 1
            continue
        lyrics = normalize_text(fval(fields.get("lyrics")))
        if not lyrics:
            skipped += 1
            continue

        existing_txt = normalize_text(fval(fields.get("gcsLyricsTxt")))
        existing_json = normalize_text(fval(fields.get("gcsLyricsJson")))
        existing_vtt = normalize_text(fval(fields.get("gcsLyricsVtt")))
        if args.missing_only and artifacts_current(fields, lyrics, objects):
            skipped += 1
            continue

        title = fval(fields.get("title"))
        # New versions preserve the old artifacts until all replacements verify.
        txt_object = f"{GCS_PREFIX}/{song_key}/versions/{run_id}/lyrics.txt"
        json_object = f"{GCS_PREFIX}/{song_key}/versions/{run_id}/lyrics.json"
        vtt_object = f"{GCS_PREFIX}/{song_key}/versions/{run_id}/lyrics.vtt"
        txt_url = f"{PUBLIC_BASE}/{txt_object}"
        json_url = f"{PUBLIC_BASE}/{json_object}"
        vtt_url = f"{PUBLIC_BASE}/{vtt_object}"

        patch_fields = {
            "gcsLyricsTxt": {"stringValue": txt_url},
            "gcsLyricsJson": {"stringValue": json_url},
            "gcsLyricsVtt": {"stringValue": vtt_url},
            "lyricsArtifactsUpdatedAt": {"stringValue": now_iso()},
        }

        if args.dry_run:
            print(f"[DRY] {song_key} -> txt={txt_url} json={json_url} vtt={vtt_url} title={title!r}")
        else:
            try:
                upload_bytes(lyrics.encode("utf-8"), txt_object, "text/plain; charset=utf-8")
                upload_bytes(build_json_payload(song_key, fields), json_object, "application/json; charset=utf-8")
                upload_bytes(build_vtt_payload(fields), vtt_object, "text/vtt; charset=utf-8")
                patch_doc(doc_name, patch_fields)
                print(f"[OK] {song_key} -> lyrics artifacts written and verified")
            except Exception as exc:
                failed.append({"songKey": song_key, "error": str(exc)})
                print(f"[WARN] {song_key}: {exc}; continuing other songs")
                continue
        touched += 1

    print("\n=== Summary ===")
    print(f"  scanned  : {len(docs)}")
    print(f"  touched  : {touched}")
    print(f"  skipped  : {skipped}")
    print(f"  failed   : {len(failed)}")
    if not args.dry_run:
        report = {"generatedAt": now_iso(), "scanned": len(docs), "touched": touched, "skipped": skipped, "failures": failed}
        upload_bytes(json.dumps(report, indent=2).encode(), f"exports/suno/recovery/lyrics/{run_id}.json", "application/json")
    return 2 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
