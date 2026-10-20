#!/usr/bin/env python3
"""Validate and load a customer-authorized SUNO Library snapshot."""

from __future__ import annotations

import json
import re
import shutil
import subprocess
import tempfile
from datetime import datetime
from pathlib import Path
from typing import Any


UUID_RE = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", re.I)
GSUTIL_BIN = shutil.which("gsutil") or shutil.which("gsutil.cmd") or "gsutil"


class SunoOwnedLibrarySnapshotError(RuntimeError):
    """Raised when an owned-library snapshot cannot safely be used."""


def _text(value: Any) -> str:
    return str(value or "").strip()


def _iso_timestamp(value: Any) -> str:
    text = _text(value)
    if not text:
        return ""
    try:
        datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError as error:
        raise SunoOwnedLibrarySnapshotError(f"invalid ISO timestamp: {text}") from error
    return text


def _clip_value(clip: dict, *keys: str) -> str:
    for key in keys:
        value = clip.get(key)
        if value:
            return _text(value)
    return ""


def _media_url(clip: dict, *keys: str) -> str:
    direct = _clip_value(clip, *keys)
    if direct:
        return direct
    for item in clip.get("media_urls", []) or []:
        if not isinstance(item, dict):
            continue
        value = _text(item.get("url"))
        content_type = _text(item.get("content_type")).lower()
        if value and content_type in {"mp3", "m4a", "m4a-opus"}:
            return value
    return ""


def normalize_snapshot(payload: dict, expected_handle: str) -> dict:
    """Return a verified source snapshot ready for a delta run."""
    if not isinstance(payload, dict):
        raise SunoOwnedLibrarySnapshotError("snapshot must be a JSON object")
    if int(payload.get("schemaVersion") or 0) != 1:
        raise SunoOwnedLibrarySnapshotError("snapshot schemaVersion must be 1")

    expected = _text(expected_handle).lstrip("@").lower()
    source_handle = _text(payload.get("sourceHandle") or payload.get("handle")).lstrip("@").lower()
    if not expected or source_handle != expected:
        raise SunoOwnedLibrarySnapshotError(
            f"snapshot handle {source_handle or '(missing)'} does not match {expected}"
        )

    generated_at = _iso_timestamp(payload.get("generatedAt"))
    clips = payload.get("clips")
    if not isinstance(clips, list) or not clips:
        raise SunoOwnedLibrarySnapshotError("snapshot must contain a non-empty clips array")

    normalized: dict[str, dict] = {}
    for raw_clip in clips:
        if not isinstance(raw_clip, dict):
            raise SunoOwnedLibrarySnapshotError("every snapshot clip must be an object")
        clip_id = _clip_value(raw_clip, "id", "clipId", "clip_id", "songKey").lower()
        if not UUID_RE.fullmatch(clip_id):
            raise SunoOwnedLibrarySnapshotError(f"invalid SUNO clip id: {clip_id or '(missing)'}")
        if clip_id in normalized:
            raise SunoOwnedLibrarySnapshotError(f"duplicate SUNO clip id: {clip_id}")
        created_at = _iso_timestamp(_clip_value(raw_clip, "createdAt", "created_at", "created"))
        if not created_at:
            raise SunoOwnedLibrarySnapshotError(f"clip {clip_id} is missing createdAt")
        audio_url = _media_url(raw_clip, "audioUrl", "audio_url", "audio")
        if not audio_url:
            raise SunoOwnedLibrarySnapshotError(f"clip {clip_id} is missing audioUrl")
        normalized[clip_id] = {
            "id": clip_id,
            "title": _clip_value(raw_clip, "title", "name"),
            "createdAt": created_at,
            "audio_url": audio_url,
            "video_url": _media_url(raw_clip, "videoUrl", "video_url", "video"),
            "image_url": _clip_value(raw_clip, "imageUrl", "image_url", "coverUrl", "cover_url", "image"),
            "tags": raw_clip.get("tags") or raw_clip.get("display_tags") or "",
            "prompt": _clip_value(raw_clip, "prompt", "metadata_prompt"),
            "lyrics": _clip_value(raw_clip, "lyrics"),
            "modelName": _clip_value(raw_clip, "modelName", "model_name", "model"),
            "isInstrumental": _text(raw_clip.get("isInstrumental", raw_clip.get("is_instrumental", ""))),
        }

    return {
        "schemaVersion": 1,
        "sourceHandle": expected,
        "generatedAt": generated_at,
        "clipsById": normalized,
    }


def load_snapshot_file(path: str | Path, expected_handle: str) -> dict:
    try:
        payload = json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise SunoOwnedLibrarySnapshotError(f"could not read snapshot: {error}") from error
    return normalize_snapshot(payload, expected_handle)


def load_snapshot_gcs(snapshot_uri: str, expected_handle: str) -> dict:
    uri = _text(snapshot_uri)
    if not uri.startswith("gs://"):
        raise SunoOwnedLibrarySnapshotError("owned-library snapshotUri must be a gs:// path")
    with tempfile.TemporaryDirectory(prefix="suno-owned-library-") as temp_dir:
        local_path = Path(temp_dir) / "snapshot.json"
        result = subprocess.run(
            [GSUTIL_BIN, "-q", "cp", uri, str(local_path)],
            capture_output=True,
            text=True,
            timeout=120,
        )
        if result.returncode != 0:
            detail = (result.stderr or result.stdout or "unknown gsutil error").strip()
            raise SunoOwnedLibrarySnapshotError(f"could not load snapshot {uri}: {detail}")
        return load_snapshot_file(local_path, expected_handle)
