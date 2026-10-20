#!/usr/bin/env python3
"""Stage a validated SUNO Library snapshot for one customer-owned account."""

from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
import urllib.request
from pathlib import Path

from gcp_access_token import get_access_token
from suno_owned_library_snapshot import GSUTIL_BIN, SunoOwnedLibrarySnapshotError, load_snapshot_file


PROJECT = "stable-framing-482501-t9"
DATABASE = "(default)"
WORKSPACES_BUCKET = "gs://aeonimus-workspaces"


def patch_source(token: str, source_id: str, snapshot_uri: str, generated_at: str, clip_count: int) -> None:
    fields = {
        "ingestionMode": {"stringValue": "official_export"},
        "authorityStatus": {"stringValue": "pending_validation"},
        "snapshotUri": {"stringValue": snapshot_uri},
        "snapshotGeneratedAt": {"stringValue": generated_at},
        "snapshotClipCount": {"integerValue": str(clip_count)},
        "lastSourceError": {"stringValue": ""},
    }
    masks = "&".join(f"updateMask.fieldPaths={field}" for field in fields)
    url = (
        f"https://firestore.googleapis.com/v1/projects/{PROJECT}/databases/{DATABASE}"
        f"/documents/sources/{source_id}?{masks}"
    )
    request = urllib.request.Request(
        url,
        data=json.dumps({"fields": fields}).encode("utf-8"),
        method="PATCH",
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
    )
    with urllib.request.urlopen(request, timeout=60):
        pass


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source-id", required=True, help="Firestore source ID, for example suno_nessihenize")
    parser.add_argument("--handle", required=True, help="SUNO handle without @")
    parser.add_argument("--snapshot", required=True, type=Path, help="Customer-authorized snapshot JSON")
    parser.add_argument("--execute", action="store_true", help="Upload the snapshot and update the source record")
    args = parser.parse_args()

    handle = args.handle.strip().lstrip("@").lower()
    try:
        snapshot = load_snapshot_file(args.snapshot, handle)
    except SunoOwnedLibrarySnapshotError as error:
        print(f"Snapshot rejected: {error}", file=sys.stderr)
        return 2

    object_name = f"source-snapshots/suno/{args.source_id}/latest.json"
    snapshot_uri = f"{WORKSPACES_BUCKET}/{object_name}"
    print(f"Snapshot valid: handle={handle} clips={len(snapshot['clipsById'])} generatedAt={snapshot['generatedAt']}")
    print(f"Target: {snapshot_uri}")
    if not args.execute:
        print("Dry run only. Use --execute after confirming the account and snapshot details.")
        return 0

    result = subprocess.run([GSUTIL_BIN, "cp", str(args.snapshot), snapshot_uri], capture_output=True, text=True, timeout=180)
    if result.returncode != 0:
        print(f"Snapshot upload failed: {(result.stderr or result.stdout).strip()}", file=sys.stderr)
        return 1
    patch_source(get_access_token(), args.source_id, snapshot_uri, snapshot["generatedAt"], len(snapshot["clipsById"]))
    print(f"Staged {args.source_id}. The next harvest validates the snapshot before it marks the source verified.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
