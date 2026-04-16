#!/usr/bin/env python3
"""
Enrich SUNO Firestore docs from the public Studio API.

This is a dry-run-first metadata density backfill for `sunoSongs`.
It fills richer item fields only when they are recoverable from the live
Studio clip payload and only when the Firestore document does not already
own a value for that field.

Fields currently enriched when missing:
- title
- createdAt
- modelName
- prompt
- tags
- isInstrumental
- artworkUrl
- caption
- description
- negativePrompt
- modelMajorVersion
- displayTags
- explicit
- lyricsStatus
- transcriptStatus
- rawPayloadRef
- rawMetadataRef

Notes:
- `rawPayloadRef` and `rawMetadataRef` both point at the clip endpoint today,
  because the Studio clip payload contains the metadata sub-object we derive
  from. This keeps provenance explicit without storing large raw blobs.
- Unknown values remain absent. The script never fabricates placeholders.

Usage:
  python enrich_suno_metadata_from_studio_api.py --dry-run --limit 25
  python enrich_suno_metadata_from_studio_api.py --apply
"""

from __future__ import annotations

import argparse
import json
import re
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from typing import Any

from gcp_access_token import get_access_token

PROJECT = "stable-framing-482501-t9"
DATABASE = "(default)"
COLLECTION = "sunoSongs"
CLIP_URL = "https://studio-api.prod.suno.com/api/clip/{clip_id}"
STYLE_KEYWORDS = [
    "acoustic", "alt-pop", "ambient", "ballad", "cinematic", "country",
    "dark synthpop", "darkwave", "drill", "drum and bass", "dubstep",
    "electronic", "electropop", "emo", "folk", "funk", "glitch",
    "glitch pop", "gospel", "grunge", "hard rock", "hip hop", "house",
    "industrial", "indie", "jazz", "latin", "lo-fi", "metal", "orchestral",
    "phonk", "pop", "punk", "r&b", "rap", "rock", "shoegaze", "soul",
    "synthpop", "synthwave", "techno", "trap",
]


def now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def http_json(url: str, headers: dict[str, str] | None = None, timeout: int = 30) -> dict[str, Any]:
    req = urllib.request.Request(url, headers=headers or {})
    with urllib.request.urlopen(req, timeout=timeout) as response:
        return json.loads(response.read())


def fire_headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def fval(field: dict[str, Any] | None) -> Any:
    if not field:
        return None
    if "nullValue" in field:
        return None
    if "stringValue" in field:
        return str(field["stringValue"])
    if "booleanValue" in field:
        return bool(field["booleanValue"])
    if "timestampValue" in field:
        return str(field["timestampValue"])
    if "integerValue" in field:
        return int(field["integerValue"])
    if "doubleValue" in field:
        return float(field["doubleValue"])
    if "arrayValue" in field:
        values = field["arrayValue"].get("values", [])
        return [fval(v) for v in values]
    if "mapValue" in field:
        return field["mapValue"].get("fields", {})
    return None


def fs_string(value: str) -> dict[str, str]:
    return {"stringValue": value}


def fs_bool(value: bool) -> dict[str, bool]:
    return {"booleanValue": value}


def fs_array(values: list[str]) -> dict[str, dict[str, list[dict[str, str]]]]:
    return {"arrayValue": {"values": [{"stringValue": v} for v in values]}}


def fs_null() -> dict[str, None]:
    return {"nullValue": None}


def sanitize_text(value: Any) -> str:
    if not isinstance(value, str):
        return ""
    return value.replace("\r", " ").replace("\n", " ").strip()


def normalize_multiline_text(value: Any) -> str:
    if not isinstance(value, str):
        return ""
    return value.replace("\r\n", "\n").replace("\r", "\n").strip()


def preview_text(value: Any, limit: int = 100) -> str:
    text = sanitize_text(value)
    if len(text) > limit:
        text = text[:limit] + "..."
    return text.encode("ascii", "replace").decode("ascii")


def parse_bool(value: Any) -> bool | None:
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        lowered = value.strip().lower()
        if lowered in {"true", "1", "yes"}:
            return True
        if lowered in {"false", "0", "no"}:
            return False
    return None


def split_display_tags(value: Any) -> list[str]:
    text = sanitize_text(value)
    if not text:
        return []
    tags = [chunk.strip() for chunk in text.split(",")]
    return [tag for tag in tags if tag]


def split_metadata_tags(value: Any) -> list[str]:
    text = sanitize_text(value)
    if not text:
        return []
    text = text.replace(";", ",")
    tags = [chunk.strip() for chunk in text.split(",")]
    return [tag for tag in tags if tag]


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


def derive_styles(tags: list[str] | None = None, display_tags: list[str] | None = None, prompt: str = "") -> tuple[list[str], str]:
    styles: list[str] = []
    styles.extend(tags or [])
    styles.extend(display_tags or [])
    prompt_lower = str(prompt or "").lower()
    for keyword in STYLE_KEYWORDS:
        if re.search(rf"(?<!\w){re.escape(keyword)}(?!\w)", prompt_lower):
            styles.append(keyword)
    normalized = dedupe_keep_order(styles)
    return normalized, ", ".join(normalized)


def fetch_all_docs(token: str) -> list[dict[str, Any]]:
    base = (
        f"https://firestore.googleapis.com/v1/projects/{PROJECT}"
        f"/databases/{DATABASE}/documents/{COLLECTION}"
    )
    docs: list[dict[str, Any]] = []
    page_token: str | None = None
    page = 0

    while True:
        url = base + "?pageSize=300"
        if page_token:
            url += f"&pageToken={urllib.parse.quote(page_token)}"
        data = http_json(url, headers=fire_headers(token), timeout=60)
        batch = data.get("documents", []) or []
        docs.extend(batch)
        page += 1
        print(f"  Firestore page {page}: +{len(batch)} (total {len(docs)})")
        page_token = data.get("nextPageToken")
        if not page_token:
            return docs


def fetch_clip(song_key: str) -> dict[str, Any]:
    try:
        return http_json(
            CLIP_URL.format(clip_id=song_key),
            headers={"Accept": "application/json"},
            timeout=30,
        )
    except urllib.error.HTTPError as exc:
        if exc.code == 404:
            return {}
        raise


def build_patch(doc: dict[str, Any], clip: dict[str, Any]) -> dict[str, Any]:
    fields = doc.get("fields", {}) or {}
    metadata = clip.get("metadata", {}) if isinstance(clip.get("metadata"), dict) else {}
    song_key = doc.get("name", "").split("/")[-1]
    clip_ref = CLIP_URL.format(clip_id=song_key)
    patch: dict[str, Any] = {}

    existing_title = sanitize_text(fval(fields.get("title")))
    clip_title = sanitize_text(clip.get("title") or clip.get("name"))
    if not existing_title and clip_title:
        patch["title"] = fs_string(clip_title)

    existing_created = sanitize_text(fval(fields.get("createdAt")))
    clip_created = sanitize_text(clip.get("created_at") or clip.get("createdAt") or clip.get("created"))
    if not existing_created and clip_created:
        patch["createdAt"] = fs_string(clip_created)

    existing_model = sanitize_text(fval(fields.get("modelName")))
    clip_model = sanitize_text(clip.get("model_name") or clip.get("modelName"))
    if not existing_model and clip_model:
        patch["modelName"] = fs_string(clip_model)

    existing_model_major = sanitize_text(fval(fields.get("modelMajorVersion")))
    clip_model_major = sanitize_text(clip.get("major_model_version"))
    if not existing_model_major and clip_model_major:
        patch["modelMajorVersion"] = fs_string(clip_model_major)

    existing_prompt = sanitize_text(fval(fields.get("prompt")))
    clip_prompt_raw = normalize_multiline_text(metadata.get("prompt"))
    clip_prompt = sanitize_text(metadata.get("prompt"))
    if not existing_prompt and clip_prompt:
        patch["prompt"] = fs_string(clip_prompt)

    existing_lyrics_raw = normalize_multiline_text(fval(fields.get("lyrics")))
    existing_lyrics = sanitize_text(fval(fields.get("lyrics")))
    should_upgrade_lyrics_format = (
        bool(clip_prompt_raw)
        and bool(existing_lyrics_raw)
        and "\n" in clip_prompt_raw
        and "\n" not in existing_lyrics_raw
    )
    if (not existing_lyrics and clip_prompt_raw) or should_upgrade_lyrics_format:
        patch["lyrics"] = fs_string(clip_prompt_raw)

    existing_lyrics_source = sanitize_text(fval(fields.get("lyricsSource")))
    if not existing_lyrics_source and clip_prompt_raw:
        patch["lyricsSource"] = fs_string("SUNO_STUDIO_API")

    existing_lyrics_retrieved_at = sanitize_text(fval(fields.get("lyricsRetrievedAt")))
    if not existing_lyrics_retrieved_at and clip_prompt_raw:
        patch["lyricsRetrievedAt"] = fs_string(now_iso())

    existing_caption = sanitize_text(fval(fields.get("caption")))
    clip_caption = sanitize_text(clip.get("caption"))
    if not existing_caption and clip_caption:
        patch["caption"] = fs_string(clip_caption)

    existing_description = sanitize_text(fval(fields.get("description")))
    clip_description = sanitize_text(clip.get("description"))
    if not existing_description and clip_description:
        patch["description"] = fs_string(clip_description)

    existing_negative_prompt = sanitize_text(fval(fields.get("negativePrompt")))
    clip_negative_prompt = sanitize_text(metadata.get("negative_tags"))
    if not existing_negative_prompt and clip_negative_prompt:
        patch["negativePrompt"] = fs_string(clip_negative_prompt)

    existing_tags = fval(fields.get("tags"))
    clip_tags = split_display_tags(clip.get("display_tags"))
    metadata_tags = split_metadata_tags(metadata.get("tags"))
    normalized_clip_tags = clip_tags or metadata_tags
    if not existing_tags and normalized_clip_tags:
        patch["tags"] = fs_array(normalized_clip_tags)

    existing_display_tags = fval(fields.get("displayTags"))
    if not existing_display_tags and normalized_clip_tags:
        patch["displayTags"] = fs_array(normalized_clip_tags)

    existing_styles = fval(fields.get("styles"))
    existing_style_text = sanitize_text(fval(fields.get("styleText")))
    current_tags = existing_tags if isinstance(existing_tags, list) else []
    current_display_tags = existing_display_tags if isinstance(existing_display_tags, list) else []
    style_tags = current_tags or normalized_clip_tags
    style_display_tags = current_display_tags or normalized_clip_tags
    derived_styles, derived_style_text = derive_styles(
        tags=style_tags,
        display_tags=style_display_tags,
        prompt=clip_prompt,
    )
    if not existing_styles and derived_styles:
        patch["styles"] = fs_array(derived_styles)
    if not existing_style_text and derived_style_text:
        patch["styleText"] = fs_string(derived_style_text)

    existing_instrumental = fval(fields.get("isInstrumental"))
    clip_instrumental = parse_bool(metadata.get("make_instrumental"))
    if existing_instrumental is None and clip_instrumental is not None:
        patch["isInstrumental"] = fs_bool(clip_instrumental)

    existing_explicit = fval(fields.get("explicit"))
    clip_explicit = clip.get("explicit")
    if existing_explicit is None and isinstance(clip_explicit, bool):
        patch["explicit"] = fs_bool(clip_explicit)

    existing_artwork = sanitize_text(fval(fields.get("artworkUrl")))
    clip_artwork = sanitize_text(clip.get("image_large_url") or clip.get("image_url"))
    if not existing_artwork and clip_artwork:
        patch["artworkUrl"] = fs_string(clip_artwork)

    existing_lyrics_status = sanitize_text(fval(fields.get("lyricsStatus")))
    existing_transcript_status = sanitize_text(fval(fields.get("transcriptStatus")))
    existing_transcript = sanitize_text(fval(fields.get("transcript")))

    should_mark_lyrics_ok = bool(existing_lyrics or clip_prompt_raw)
    if should_mark_lyrics_ok and existing_lyrics_status != "OK":
        patch["lyricsStatus"] = fs_string("OK")
    elif not existing_lyrics_status:
        patch["lyricsStatus"] = fs_string("MISSING")

    if not existing_transcript_status:
        if existing_transcript:
            patch["transcriptStatus"] = fs_string("OK")
        else:
            patch["transcriptStatus"] = fs_string("MISSING")

    existing_text_retrieved_at = sanitize_text(fval(fields.get("textRetrievedAt")))
    if not existing_text_retrieved_at:
        patch["textRetrievedAt"] = fs_string(now_iso())

    existing_payload_ref = sanitize_text(fval(fields.get("rawPayloadRef")))
    if not existing_payload_ref and clip:
        patch["rawPayloadRef"] = fs_string(clip_ref)

    existing_metadata_ref = sanitize_text(fval(fields.get("rawMetadataRef")))
    if not existing_metadata_ref and metadata:
        patch["rawMetadataRef"] = fs_string(clip_ref)

    return patch


def should_consider(doc: dict[str, Any]) -> bool:
    fields = doc.get("fields", {}) or {}
    source_id = sanitize_text(fval(fields.get("sourceId")))
    source_platform = sanitize_text(fval(fields.get("sourcePlatform")))
    handle = sanitize_text(fval(fields.get("handle")))
    if source_id.startswith("suno_"):
        return True
    if source_platform == "suno":
        return True
    return bool(handle)


def patch_doc(token: str, doc_name: str, patch_fields: dict[str, Any]) -> None:
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
            **fire_headers(token),
            "Content-Type": "application/json",
        },
    )
    with urllib.request.urlopen(req, timeout=30) as response:
        response.read()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int, default=0, help="Stop after patching N docs (0 = no limit).")
    parser.add_argument("--sleep", type=float, default=0.15, help="Sleep seconds between Studio API calls.")
    parser.add_argument("--dry-run", action="store_true", help="Preview patches without writing.")
    parser.add_argument("--apply", action="store_true", help="Write patches to Firestore.")
    args = parser.parse_args()

    apply_changes = args.apply and not args.dry_run

    print("=== Enrich SUNO metadata from Studio API ===")
    print(f"Mode: {'APPLY' if apply_changes else 'DRY RUN'}")
    token = get_access_token()
    docs = fetch_all_docs(token)
    print(f"Total docs fetched: {len(docs)}")

    candidates = 0
    patched = 0
    skipped = 0
    failed = 0

    for doc in docs:
        if not should_consider(doc):
            continue

        doc_name = doc.get("name", "")
        song_key = doc_name.split("/")[-1]
        try:
            clip = fetch_clip(song_key)
            if not clip:
                skipped += 1
                continue
            patch_fields = build_patch(doc, clip)
            if not patch_fields:
                skipped += 1
                continue

            candidates += 1
            field_list = ", ".join(patch_fields.keys())
            print(f"[{candidates}] {song_key} -> {field_list}")
            if "title" in patch_fields:
                print(f"     title: {preview_text(patch_fields['title']['stringValue'])}")
            if "prompt" in patch_fields:
                print(f"     prompt: {preview_text(patch_fields['prompt']['stringValue'], 140)}")
            if "tags" in patch_fields:
                tag_values = [item["stringValue"] for item in patch_fields["tags"]["arrayValue"]["values"]]
                print(f"     tags: {preview_text(', '.join(tag_values), 140)}")
            if "caption" in patch_fields:
                print(f"     caption: {preview_text(patch_fields['caption']['stringValue'], 140)}")
            if "description" in patch_fields:
                print(f"     description: {preview_text(patch_fields['description']['stringValue'], 140)}")

            if apply_changes:
                patch_doc(token, doc_name, patch_fields)
            patched += 1

            if args.limit and patched >= args.limit:
                break
            if args.sleep:
                time.sleep(args.sleep)
        except Exception as exc:
            failed += 1
            print(f"  [WARN] {song_key}: {type(exc).__name__}: {exc}")
            if args.sleep:
                time.sleep(args.sleep)

    print("\n=== Summary ===")
    print(f"  candidates : {candidates}")
    print(f"  touched    : {patched}")
    print(f"  skipped    : {skipped}")
    print(f"  failed     : {failed}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
