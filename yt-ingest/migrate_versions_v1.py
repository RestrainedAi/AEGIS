#!/usr/bin/env python3
"""One-time backfill: create sunoSongs/{id}/versions/1 from each song as it is today.

DRY RUN by default (reads only, writes a local report). --apply creates
version docs with create-only semantics (Firestore precondition exists=false)
and adds head fields; it never changes or removes existing fields or objects.
Needs Thomas's final yes before --apply. Take an on-demand backup first:
  gcloud firestore backups schedules list --database="(default)"   (daily 14d exists)
  gcloud firestore export gs://aeonimus-workspaces/backups/firestore/pre-versioning-$(date +%Y%m%d)
"""
from __future__ import annotations

import argparse
import json
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from gcp_access_token import get_access_token
import song_versions as sv

PROJECT = "stable-framing-482501-t9"
BASE = f"https://firestore.googleapis.com/v1/projects/{PROJECT}/databases/(default)/documents"


def fval(f: dict[str, Any] | None) -> Any:
    if not f:
        return None
    for k in ("stringValue", "booleanValue", "doubleValue", "timestampValue"):
        if k in f:
            return f[k]
    if "integerValue" in f:
        return int(f["integerValue"])
    if "arrayValue" in f:
        return [fval(x) for x in f["arrayValue"].get("values", [])]
    if "mapValue" in f:
        return {k: fval(v) for k, v in f["mapValue"].get("fields", {}).items()}
    return None


def to_fs(v: Any) -> dict[str, Any]:
    if v is None:
        return {"nullValue": None}
    if isinstance(v, bool):
        return {"booleanValue": v}
    if isinstance(v, int):
        return {"integerValue": str(v)}
    if isinstance(v, float):
        return {"doubleValue": v}
    if isinstance(v, list):
        return {"arrayValue": {"values": [to_fs(x) for x in v]}}
    if isinstance(v, dict):
        return {"mapValue": {"fields": {k: to_fs(x) for k, x in v.items()}}}
    return {"stringValue": str(v)}


def doc_to_v1(doc: dict[str, Any], run_id: str, at: str) -> tuple[dict, dict]:
    f = {k: fval(v) for k, v in (doc.get("fields") or {}).items()}
    gcs = f.get("gcs") or {}       # booleans: {audio: true, ...}
    media = f.get("media") or {}   # gs:// paths: audioUrl/videoUrl/thumbUrl/largeArtUrl
    meta = {k: f.get(k) for k in sv.TRACKED_FIELDS}
    source = {
        "audio": {"url": f.get("audio_url") or f.get("audioUrl") or ""},
        "video": {"url": f.get("video_url") or f.get("videoUrl") or ""},
        "cover": {"url": f.get("image_url") or f.get("imageUrl") or ""},
        "coverLarge": {"url": f.get("image_large_url") or f.get("imageLargeUrl") or ""},
    }
    source = {k: v for k, v in source.items() if v["url"] and not v["url"].startswith("gs://")}
    assets = {}
    for asset, flag, key in (("audio", "audio", "audioUrl"), ("video", "video", "videoUrl"),
                             ("cover", "thumb", "thumbUrl"), ("coverLarge", "largeArt", "largeArtUrl")):
        path = media.get(key)
        ok = bool(path) and gcs.get(flag) is not False
        assets[asset] = {"gcs": path, "status": "ok"} if ok else {"status": "missing"}
        if ok and isinstance(media.get(asset + "Recovery"), dict):
            assets[asset]["derived"] = True
    version = {"n": 1, "capturedAt": at, "runId": run_id, "changedFields": ["initial"],
               "metadata": sv.canonical_metadata(meta), "source": source, "assets": assets,
               "migratedFrom": "flat-doc"}
    version["metadataSha256"] = sv.metadata_hash(version["metadata"])
    removed = bool(f.get("isRemoved")) or f.get("status") == "removed_from_suno"
    head = {"currentVersion": 1, "publishState": "unpublished" if removed else "published",
            "absenceCount": 0}
    if removed:
        head["unpublishedAt"] = f.get("removedAt") or at
    return head, version


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--sample", type=int, default=0, help="write N sample records to the report")
    args = ap.parse_args()
    at = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    run_id = "migrate-v1-" + at[:19].replace(":", "")
    token = get_access_token()
    docs, page = [], None
    while True:
        url = f"{BASE}/sunoSongs?pageSize=300" + (f"&pageToken={urllib.parse.quote(page)}" if page else "")
        req = urllib.request.Request(url, headers={"Authorization": f"Bearer {get_access_token()}"})
        data = json.loads(urllib.request.urlopen(req, timeout=60).read())
        docs += data.get("documents", [])
        page = data.get("nextPageToken")
        if not page or (args.limit and len(docs) >= args.limit):
            break
    if args.limit:
        docs = docs[: args.limit]
    stats = {"songs": len(docs), "alreadyVersioned": 0, "unpublished": 0, "missingAssets": {},
             "wouldCreateVersionDocs": 0, "wouldAddHeadFields": [], "samples": []}
    for doc in docs:
        if "currentVersion" in (doc.get("fields") or {}):
            stats["alreadyVersioned"] += 1
            continue
        head, v1 = doc_to_v1(doc, run_id, at)
        stats["unpublished"] += head["publishState"] == "unpublished"
        stats["wouldCreateVersionDocs"] += 1
        stats["wouldAddHeadFields"] = sorted(set(stats["wouldAddHeadFields"]) | set(head))
        if len(stats["samples"]) < args.sample:
            stats["samples"].append({"doc": doc["name"].split("/documents/")[-1], "head": head, "version1": v1})
        for a, s in v1["assets"].items():
            if s["status"] == "missing":
                stats["missingAssets"][a] = stats["missingAssets"].get(a, 0) + 1
        if args.apply:
            name = doc["name"]
            vreq = urllib.request.Request(
                f"https://firestore.googleapis.com/v1/{name}/versions?documentId=1",
                data=json.dumps({"fields": {k: to_fs(v) for k, v in v1.items()}}).encode(),
                method="POST", headers={"Authorization": f"Bearer {get_access_token()}",
                                        "Content-Type": "application/json"})
            urllib.request.urlopen(vreq, timeout=30).read()  # createDocument fails if it exists
            mask = "&".join(f"updateMask.fieldPaths={k}" for k in head)
            hreq = urllib.request.Request(
                f"https://firestore.googleapis.com/v1/{name}?{mask}",
                data=json.dumps({"fields": {k: to_fs(v) for k, v in head.items()}}).encode(),
                method="PATCH", headers={"Authorization": f"Bearer {get_access_token()}",
                                         "Content-Type": "application/json"})
            urllib.request.urlopen(hreq, timeout=30).read()
    stats["mode"] = "apply" if args.apply else "dry_run"
    Path("migrate_versions_v1_report.json").write_text(json.dumps(stats, indent=2))
    print(json.dumps(stats, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
