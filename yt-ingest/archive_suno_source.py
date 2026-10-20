#!/usr/bin/env python3
"""Archive a SUNO source without deleting its Vault history or media.

This is deliberately separate from remove_suno_handle.py. Archiving stops new
harvests only; existing Firestore song records, download packages, GCS media,
and publishing history remain available to the customer.
"""

from __future__ import annotations

import argparse
import json
import sys
import urllib.error
import urllib.request

from gcp_access_token import get_access_token

PROJECT = "stable-framing-482501-t9"
DATABASE = "(default)"
FS_BASE = f"https://firestore.googleapis.com/v1/projects/{PROJECT}/databases/{DATABASE}"


def request(token: str, url: str, *, data: bytes | None = None, method: str | None = None) -> dict:
    req = urllib.request.Request(
        url,
        data=data,
        method=method or ("POST" if data else "GET"),
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=60) as response:
        payload = response.read()
    return json.loads(payload) if payload else {}


def main() -> int:
    parser = argparse.ArgumentParser(description="Archive a SUNO source without deleting customer data.")
    parser.add_argument("--handle", required=True, help="SUNO handle, without @")
    parser.add_argument("--execute", action="store_true", help="Apply the archive change")
    args = parser.parse_args()

    handle = args.handle.strip().lstrip("@").lower()
    source_id = f"suno_{handle}"
    document_url = f"{FS_BASE}/documents/sources/{source_id}"

    if not args.execute:
        print(f"Dry run: would archive sources/{source_id}; no customer records or media would be deleted.")
        return 0

    body = json.dumps(
        {
            "fields": {
                "isActive": {"booleanValue": False},
                "harvestEnabled": {"booleanValue": False},
                "status": {"stringValue": "archived"},
                "archiveReason": {"stringValue": "service_inactive"},
            }
        }
    ).encode("utf-8")
    masks = "&".join(
        f"updateMask.fieldPaths={field}"
        for field in ("isActive", "harvestEnabled", "status", "archiveReason")
    )

    try:
        result = request(get_access_token(), f"{document_url}?{masks}", data=body, method="PATCH")
    except urllib.error.HTTPError as error:
        print(f"Could not archive sources/{source_id}: HTTP {error.code} {error.read().decode('utf-8', 'replace')}", file=sys.stderr)
        return 1

    fields = result.get("fields", {})
    print(
        f"Archived sources/{source_id}: "
        f"isActive={fields.get('isActive', {}).get('booleanValue')} "
        f"harvestEnabled={fields.get('harvestEnabled', {}).get('booleanValue')} "
        f"status={fields.get('status', {}).get('stringValue')}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
