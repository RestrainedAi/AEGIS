#!/usr/bin/env python3
"""Verify a Firestore SUNO source doc exists and is harvest-ready."""

from __future__ import annotations

import json
import sys
import urllib.error
import urllib.request

from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "yt-ingest"))

from gcp_access_token import get_access_token  # noqa: E402

PROJECT = "stable-framing-482501-t9"
DATABASE = "(default)"


def fval(field):
    if not field:
        return ""
    for key in ("stringValue", "booleanValue", "integerValue"):
        if key in field:
            return str(field[key])
    return ""


def main() -> int:
    if len(sys.argv) < 2:
        print("Usage: verify_firestore_source.py <source_doc_id>", file=sys.stderr)
        return 2

    source_id = sys.argv[1]
    token = get_access_token()
    url = (
        f"https://firestore.googleapis.com/v1/projects/{PROJECT}"
        f"/databases/{DATABASE}/documents/sources/{source_id}"
    )
    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {token}"})
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            doc = json.loads(resp.read())
    except urllib.error.HTTPError as exc:
        print(f"ERROR: sources/{source_id} not readable: {exc}", file=sys.stderr)
        return 1

    fields = doc.get("fields", {})
    handle = fval(fields.get("handle"))
    harvest_enabled = fval(fields.get("harvestEnabled")).lower()
    status = fval(fields.get("status")).lower()

    errors = []
    if not handle:
        errors.append("missing handle")
    if harvest_enabled not in ("true", ""):
        if harvest_enabled == "false":
            errors.append("harvestEnabled=false")
    if status and status not in ("active", "assigned", "reserved"):
        errors.append(f"unexpected status={status}")

    if errors:
        print(f"ERROR: sources/{source_id} failed checks: {', '.join(errors)}", file=sys.stderr)
        return 1

    print(f"OK sources/{source_id} handle={handle} harvestEnabled={harvest_enabled or 'true'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
