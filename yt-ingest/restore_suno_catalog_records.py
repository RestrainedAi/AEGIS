#!/usr/bin/env python3
"""Restore Vault visibility for records incorrectly marked removed_from_suno.

Only clears the removal markers. It does not create, alter, or delete media,
lyrics, catalog metadata, exports, or source ownership.
"""

from __future__ import annotations

import argparse
import json
import sys
import urllib.error
import urllib.parse
import urllib.request

from gcp_access_token import get_access_token

PROJECT = "stable-framing-482501-t9"
DATABASE = "(default)"
FS_BASE = f"https://firestore.googleapis.com/v1/projects/{PROJECT}/databases/{DATABASE}"


def field_text(field: dict | None) -> str:
    if not field:
        return ""
    return str(field.get("stringValue", ""))


def request(token: str, url: str, *, data: bytes | None = None, method: str | None = None) -> dict:
    req = urllib.request.Request(
        url,
        data=data,
        method=method or ("POST" if data else "GET"),
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=60) as response:
        body = response.read()
    return json.loads(body) if body else {}


def removed_docs_for_source(token: str, source_id: str) -> list[dict]:
    url = f"{FS_BASE}/documents:runQuery"
    body = json.dumps(
        {
            "structuredQuery": {
                "from": [{"collectionId": "sunoSongs"}],
                "where": {
                    "compositeFilter": {
                        "op": "AND",
                        "filters": [
                            {
                                "fieldFilter": {
                                    "field": {"fieldPath": "sourceId"},
                                    "op": "EQUAL",
                                    "value": {"stringValue": source_id},
                                }
                            },
                            {
                                "fieldFilter": {
                                    "field": {"fieldPath": "status"},
                                    "op": "EQUAL",
                                    "value": {"stringValue": "removed_from_suno"},
                                }
                            },
                        ],
                    }
                },
            }
        }
    ).encode("utf-8")
    results = request(token, url, data=body)
    return [item["document"] for item in results if item.get("document")]


def restore_batch(token: str, documents: list[dict]) -> int:
    """Clear only the removal fields with one Firestore batch write."""
    writes = [
        {
            "update": {"name": doc["name"], "fields": {}},
            "updateMask": {"fieldPaths": ["status", "removedAt"]},
        }
        for doc in documents
    ]
    response = request(
        token,
        f"{FS_BASE}/documents:batchWrite",
        data=json.dumps({"writes": writes}).encode("utf-8"),
    )
    statuses = response.get("writeResults", [])
    if len(statuses) != len(documents):
        raise RuntimeError(f"Firestore acknowledged {len(statuses)}/{len(documents)} record(s)")
    return len(statuses)


def main() -> int:
    parser = argparse.ArgumentParser(description="Restore incorrectly removed SUNO records.")
    parser.add_argument("--source-id", required=True)
    parser.add_argument("--clip-id", action="append", default=[], help="Limit restoration to a specific clip ID; repeat as needed.")
    parser.add_argument("--execute", action="store_true")
    args = parser.parse_args()

    requested = {clip.strip().lower() for clip in args.clip_id if clip.strip()}
    token = get_access_token()
    candidates = removed_docs_for_source(token, args.source_id)
    selected = [
        doc for doc in candidates
        if not requested or doc["name"].split("/")[-1].replace("suno:", "").lower() in requested
    ]
    print(f"Removal-marked records for {args.source_id}: {len(candidates)}")
    print(f"Records selected for restoration: {len(selected)}")

    if not args.execute:
        print("Dry run only. Re-run with --execute to clear removal markers.")
        return 0

    restored = 0
    for start in range(0, len(selected), 200):
        batch = selected[start:start + 200]
        try:
            restored += restore_batch(token, batch)
            print(f"Restored batch {start // 200 + 1}: {len(batch)} record(s).")
        except (urllib.error.HTTPError, RuntimeError) as error:
            print(f"Could not restore batch {start // 200 + 1}: {error}", file=sys.stderr)
    print(f"Restored catalog visibility for {restored}/{len(selected)} record(s).")
    return 0 if restored == len(selected) else 1


if __name__ == "__main__":
    raise SystemExit(main())
