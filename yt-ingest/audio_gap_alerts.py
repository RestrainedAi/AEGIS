#!/usr/bin/env python3
"""Nightly audit flag: songs whose audio has been missing (gcs.audio == false) for more than 24 hours.

Read-only against Firestore. Writes audio_gap_alerts.json in WORK_DIR for the
post-harvest monitor (which puts it in the nightly report) and, inside the Cloud
Run job, a new timestamped copy under the workspaces bucket (never overwrites).
"""
from __future__ import annotations

import json
import os
import sys
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

PROJECT = os.environ.get("PROJECT", "stable-framing-482501-t9")
WORK_DIR = Path(os.environ.get("WORK_DIR", "/app"))
OUT = WORK_DIR / "audio_gap_alerts.json"
THRESHOLD = timedelta(hours=int(os.environ.get("AUDIO_GAP_ALERT_HOURS", "24")))
SINCE_FIELDS = ("firstSeenAt", "importedAt", "indexedAt", "createdAt")


def _fval(f):
    if not isinstance(f, dict):
        return None
    for k in ("stringValue", "timestampValue", "booleanValue", "integerValue", "doubleValue"):
        if k in f:
            return f[k]
    if "mapValue" in f:
        return {k: _fval(v) for k, v in f["mapValue"].get("fields", {}).items()}
    return None


def parse_ts(value):
    if not value:
        return None
    try:
        dt = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def flag_audio_gaps(songs: list[dict], now: datetime, threshold: timedelta = THRESHOLD) -> list[dict]:
    """songs: plain dicts. Returns flagged songs, oldest gap first.

    Gap start = the earliest of firstSeenAt/importedAt/indexedAt/createdAt. Songs that are
    Un-Published are still flagged (they are kept), but marked so the report can separate them.
    """
    flagged = []
    for s in songs:
        gcs = s.get("gcs") or {}
        media = s.get("media") or {}
        if gcs.get("audio") is not False and media.get("audioUrl"):
            continue
        starts = [t for t in (parse_ts(s.get(k)) for k in SINCE_FIELDS) if t]
        if not starts:
            flagged.append({"songKey": s.get("songKey"), "handle": s.get("handle"), "title": s.get("title", ""),
                            "missingSince": None, "hoursMissing": None, "reason": "no timestamp"})
            continue
        since = min(starts)
        age = now - since
        if age <= threshold:
            continue
        acq = s.get("lastMediaAcquisition") or {}
        flagged.append({
            "songKey": s.get("songKey"), "handle": s.get("handle"), "title": s.get("title", ""),
            "missingSince": since.isoformat(), "hoursMissing": round(age.total_seconds() / 3600, 1),
            "videoStored": bool(gcs.get("video")),
            "unpublished": s.get("publishState") == "unpublished" or bool(s.get("isRemoved")),
            "lastError": (acq.get("error") if isinstance(acq, dict) else "") or "",
        })
    flagged.sort(key=lambda x: -(x["hoursMissing"] or 1e9))
    return flagged


def fetch_songs_without_audio(token: str) -> list[dict]:
    url = f"https://firestore.googleapis.com/v1/projects/{PROJECT}/databases/(default)/documents:runQuery"
    body = {"structuredQuery": {
        "from": [{"collectionId": "sunoSongs"}],
        "where": {"fieldFilter": {"field": {"fieldPath": "gcs.audio"}, "op": "EQUAL",
                                  "value": {"booleanValue": False}}},
        "select": {"fields": [{"fieldPath": p} for p in (
            "songKey", "handle", "title", "gcs", "media.audioUrl", "publishState", "isRemoved",
            "lastMediaAcquisition", *SINCE_FIELDS)]}}}
    req = urllib.request.Request(url, data=json.dumps(body).encode(), method="POST",
                                 headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"})
    rows = json.loads(urllib.request.urlopen(req, timeout=120).read())
    out = []
    for r in rows:
        doc = r.get("document")
        if not doc:
            continue
        d = {k: _fval(v) for k, v in doc.get("fields", {}).items()}
        d.setdefault("songKey", doc["name"].rsplit("/", 1)[-1])
        out.append(d)
    return out


def main() -> int:
    from gcp_access_token import get_access_token
    now = datetime.now(timezone.utc)
    flagged = flag_audio_gaps(fetch_songs_without_audio(get_access_token()), now)
    report = {"checkedAt": now.isoformat(), "thresholdHours": THRESHOLD.total_seconds() / 3600,
              "count": len(flagged), "songs": flagged}
    OUT.write_text(json.dumps(report, indent=2), encoding="utf-8")
    for f in flagged:
        print(f"[AUDIO_GAP>24h] {f['songKey']} {f['handle']} {f['hoursMissing']}h video={f.get('videoStored')}")
    print(json.dumps({"audio_gaps_over_24h": len(flagged)}))
    bucket = os.environ.get("WORKSPACES_BUCKET", "")
    if os.environ.get("CLOUD_RUN_JOB") and bucket:
        try:
            from google.cloud import storage
            name = f"exports/suno/recovery/audio-gap-alerts/{now.strftime('%Y%m%dT%H%M%SZ')}.json"
            storage.Client(project=PROJECT).bucket(bucket.removeprefix("gs://")).blob(name).upload_from_string(
                json.dumps(report, indent=2), content_type="application/json", if_generation_match=0)
        except Exception as exc:  # the local file still feeds the monitor
            print(f"[WARN] audio gap report upload failed: {type(exc).__name__}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
