#!/usr/bin/env python3
"""Versioned song model (plan step 4): never overwrite, never delete.

Pure functions only; callers do the Firestore/GCS I/O. A song head document
(sunoSongs/{id}) points at immutable versions (sunoSongs/{id}/versions/{n}).
Any change to audio, video, art, title, lyrics or tracked metadata yields a
new version number. Volatile counters (plays, likes) never create versions.
"""
from __future__ import annotations

import hashlib
import json
from typing import Any

# Metadata fields whose change creates a new version.
TRACKED_FIELDS = (
    "title", "lyrics", "prompt", "tags", "displayTags", "styles", "duration",
    "createdAt", "model", "persona", "isInstrumental", "caption", "description",
)
# Media assets; a change in source URL or content fingerprint creates a version.
ASSETS = ("audio", "video", "cover", "coverLarge")
# Volatile values that go to the stats series, never into a version.
VOLATILE_FIELDS = ("playCount", "upvoteCount", "likes", "views", "commentCount")
UNPUBLISH_AFTER_ABSENCES = 2


def canonical_metadata(meta: dict[str, Any]) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for key in TRACKED_FIELDS:
        value = meta.get(key)
        if value in (None, "", []):
            continue
        if isinstance(value, str):
            value = value.replace("\r\n", "\n").strip()
        if isinstance(value, float) and key == "duration":
            value = round(value, 1)  # sub-0.1 s jitter is not a change
        out[key] = value
    return out


def metadata_hash(meta: dict[str, Any]) -> str:
    blob = json.dumps(canonical_metadata(meta), sort_keys=True, ensure_ascii=False)
    return hashlib.sha256(blob.encode("utf-8")).hexdigest()


def asset_fingerprint(src: dict[str, Any] | None) -> tuple:
    """(url, etag, length, sha256) – sha256 wins when known."""
    src = src or {}
    if src.get("sha256"):
        return ("sha256", src["sha256"])
    return ("src", src.get("url") or "", src.get("etag") or "", str(src.get("length") or ""))


def diff(latest: dict[str, Any] | None, observed: dict[str, Any]) -> list[str]:
    """Return changed field/asset names between the latest version and what Suno shows now.

    `observed` = {"metadata": {...}, "source": {asset: {url, etag, length, sha256?}}}.
    A missing observation (asset absent from Suno response) is not a change.
    """
    if not latest:
        return ["initial"]
    changed: list[str] = []
    old_meta = canonical_metadata(latest.get("metadata") or {})
    new_meta = canonical_metadata(observed.get("metadata") or {})
    for key in TRACKED_FIELDS:
        if key in new_meta and new_meta.get(key) != old_meta.get(key):
            changed.append(key)
    old_src = latest.get("source") or {}
    for asset in ASSETS:
        new = (observed.get("source") or {}).get(asset)
        if not new:
            continue
        old = old_src.get(asset)
        if not old:
            changed.append(asset)
            continue
        if new.get("sha256") and old.get("sha256"):
            if new["sha256"] != old["sha256"]:
                changed.append(asset)
        elif asset_fingerprint(new) != asset_fingerprint({k: v for k, v in old.items() if k != "sha256"}):
            changed.append(asset)
    return changed


def build_version(n: int, observed: dict[str, Any], latest: dict[str, Any] | None,
                  run_id: str, captured_at: str, changed: list[str]) -> dict[str, Any]:
    """New immutable version: carries forward unchanged values from `latest`."""
    meta = dict(canonical_metadata((latest or {}).get("metadata") or {}))
    meta.update(canonical_metadata(observed.get("metadata") or {}))
    source = dict((latest or {}).get("source") or {})
    source.update({k: v for k, v in (observed.get("source") or {}).items() if v})
    assets = {}
    for asset, old in ((latest or {}).get("assets") or {}).items():
        assets[asset] = dict(old) if asset not in changed else {"status": "retry"}
    for asset in ASSETS:
        if asset in changed or (asset in source and asset not in assets):
            assets[asset] = {"status": "retry"}  # repair loop fills gcs/sha256
    return {
        "n": n, "capturedAt": captured_at, "runId": run_id, "changedFields": changed,
        "metadata": meta, "metadataSha256": metadata_hash(meta),
        "source": source, "assets": assets,
    }


def versioned_object(handle: str, song_id: str, n: int, asset: str) -> str:
    names = {"audio": "audio.mp3", "video": "video.mp4", "cover": "cover.jpg",
             "coverLarge": "cover_large.jpg", "lyrics": "lyrics.txt", "clip": "clip.json"}
    return f"suno/{handle}/{song_id}/v{n}/{names[asset]}"


def publish_transition(head: dict[str, Any], seen: bool, at: str, run_id: str) -> dict[str, Any]:
    """Apply one harvest observation to publish state. Never deletes anything."""
    head = dict(head)
    history = list(head.get("publishHistory") or [])
    state = head.get("publishState") or "published"
    if seen:
        head["absenceCount"] = 0
        head["lastSeenAt"] = at
        if state == "unpublished":
            head["publishState"] = "published"
            head["republishedAt"] = at
            history.append({"state": "published", "at": at, "runId": run_id})
    else:
        head["absenceCount"] = int(head.get("absenceCount") or 0) + 1
        if state == "published" and head["absenceCount"] >= UNPUBLISH_AFTER_ABSENCES:
            head["publishState"] = "unpublished"
            head["unpublishedAt"] = at
            history.append({"state": "unpublished", "at": at, "runId": run_id})
    head["publishHistory"] = history
    return head


def apply_observation(head: dict[str, Any] | None, latest: dict[str, Any] | None,
                      observed: dict[str, Any], run_id: str, at: str):
    """Returns (new_head, new_version_or_None). new_version must be created, never updated."""
    head = dict(head or {"publishState": "published", "firstSeenAt": at, "currentVersion": 0})
    head = publish_transition(head, True, at, run_id)
    changed = diff(latest, observed)
    if not changed:
        return head, None
    n = int(head.get("currentVersion") or 0) + 1
    version = build_version(n, observed, latest, run_id, at, changed)
    head["currentVersion"] = n
    head["current"] = {"title": version["metadata"].get("title", ""),
                       "duration": version["metadata"].get("duration"), "n": n}
    return head, version
