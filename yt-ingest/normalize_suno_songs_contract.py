#!/usr/bin/env python3
"""
Deterministic normalization for existing Firestore `sunoSongs` records.

This script is intentionally limited to fields that can be backfilled from
already-stored item data without hitting SUNO, Cloud Run harvest, or other
runtime-heavy systems.

Default mode is dry-run. Use --apply to write changes.
"""

import argparse
import json
import urllib.parse
import urllib.request
from collections import Counter

from gcp_access_token import get_access_token


PROJECT = "stable-framing-482501-t9"
DATABASE = "(default)"
COLLECTION = "sunoSongs"
BASE_DOCS = (
    f"https://firestore.googleapis.com/v1/projects/{PROJECT}"
    f"/databases/{DATABASE}/documents/{COLLECTION}"
)


def token():
    return get_access_token()


def headers():
    return {"Authorization": f"Bearer {token()}"}


def fetch_json(url):
    req = urllib.request.Request(url, headers=headers())
    with urllib.request.urlopen(req, timeout=60) as response:
        return json.loads(response.read())


def fval(field):
    if not field:
        return ""
    for key in ("stringValue", "integerValue", "doubleValue", "timestampValue"):
        if key in field:
            return str(field[key])
    if "booleanValue" in field:
        return bool(field["booleanValue"])
    if "nullValue" in field:
        return ""
    return ""


def fetch_all_docs(limit=0):
    docs = []
    page_token = None
    while True:
        page_size = 300
        if limit:
            page_size = min(page_size, max(limit - len(docs), 1))
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


def pick_first(*values):
    for value in values:
        if value not in ("", None):
            return value
    return ""


def as_timestamp_field(value):
    return {"stringValue": value}


def as_bool_field(value):
    return {"booleanValue": bool(value)}


def derive_patch(doc):
    fields = doc.get("fields", {})
    status = fval(fields.get("status")) or "active"
    imported_at = fval(fields.get("importedAt"))
    created_at = fval(fields.get("createdAt"))
    updated_at = fval(fields.get("updatedAt"))
    removed_at = fval(fields.get("removedAt"))
    create_time = doc.get("createTime", "")

    indexed_at = pick_first(fval(fields.get("indexedAt")), imported_at, updated_at, create_time, created_at)
    harvested_at = pick_first(fval(fields.get("harvestedAt")), indexed_at, imported_at, create_time, created_at)
    first_seen_at = pick_first(fval(fields.get("firstSeenAt")), imported_at, create_time, created_at)
    last_seen_at = pick_first(fval(fields.get("lastSeenAt")), imported_at, indexed_at, create_time, created_at)
    source_platform = fval(fields.get("sourcePlatform")) or "suno"

    patch = {}
    if "sourcePlatform" not in fields:
        patch["sourcePlatform"] = {"stringValue": source_platform}
    if "indexedAt" not in fields and indexed_at:
        patch["indexedAt"] = as_timestamp_field(indexed_at)
    if "harvestedAt" not in fields and harvested_at:
        patch["harvestedAt"] = as_timestamp_field(harvested_at)
    if "firstSeenAt" not in fields and first_seen_at:
        patch["firstSeenAt"] = as_timestamp_field(first_seen_at)
    if "lastSeenAt" not in fields and last_seen_at:
        patch["lastSeenAt"] = as_timestamp_field(last_seen_at)
    if "isRemoved" not in fields:
        patch["isRemoved"] = as_bool_field(status == "removed_from_suno" or bool(removed_at))

    # No deterministic inference for provenance / artwork refs here.
    # We intentionally leave rawMetadataRef/rawPayloadRef/artworkUrl untouched.
    # Nested media.* is already normalized per the audit baseline.
    return patch


def patch_doc(doc_name, patch_fields):
    mask = "&".join(f"updateMask.fieldPaths={field}" for field in patch_fields)
    url = f"https://firestore.googleapis.com/v1/{doc_name}?{mask}"
    body = json.dumps({"fields": patch_fields}).encode()
    req = urllib.request.Request(
        url,
        data=body,
        method="PATCH",
        headers={**headers(), "Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=60):
        return


def main():
    parser = argparse.ArgumentParser(description="Normalize existing sunoSongs docs to the locked contract")
    parser.add_argument("--apply", action="store_true", help="Write patches to Firestore")
    parser.add_argument("--limit", type=int, default=0, help="Optional cap on docs to inspect")
    args = parser.parse_args()

    docs = fetch_all_docs(limit=args.limit)
    counts = Counter()
    examples = []

    for doc in docs:
        patch = derive_patch(doc)
        if patch:
            counts["docs_with_patch"] += 1
            for field in patch:
                counts[f"field::{field}"] += 1
            if len(examples) < 10:
                examples.append(
                    {
                        "songKey": doc["name"].split("/")[-1],
                        "patchFields": sorted(patch.keys()),
                    }
                )
            if args.apply:
                patch_doc(doc["name"], patch)
                counts["docs_patched"] += 1

    counts["docs_scanned"] = len(docs)

    print(
        json.dumps(
            {
                "mode": "apply" if args.apply else "dry-run",
                "counts": counts,
                "examples": examples,
            },
            indent=2,
            default=lambda obj: dict(obj) if isinstance(obj, Counter) else obj,
        )
    )


if __name__ == "__main__":
    main()
