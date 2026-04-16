#!/usr/bin/env python3
"""
Remove one Suno handle from Firestore-backed Vault state.

Deletes:
- sunoSongs docs for the handle's sourceId
- ytUploadQueue docs whose songKey belongs to those songs
- sources/{sourceId} doc

This intentionally does not delete GCS media or YouTube videos.
"""

from __future__ import annotations

import argparse
import json
import math
import urllib.parse
import urllib.request

from gcp_access_token import get_access_token

PROJECT = "stable-framing-482501-t9"
DATABASE = "(default)"
FS_BASE = f"https://firestore.googleapis.com/v1/projects/{PROJECT}/databases/{DATABASE}"


def fval(field):
    if not field:
        return ""
    for key in ("stringValue", "integerValue", "doubleValue", "timestampValue"):
        if key in field:
            return str(field[key])
    if "booleanValue" in field:
        return str(field["booleanValue"]).lower()
    return ""


def req(token: str, url: str, *, data: bytes | None = None, method: str | None = None) -> dict:
    actual_method = method or ("POST" if data is not None else "GET")
    request = urllib.request.Request(
        url,
        data=data,
        method=actual_method,
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        },
    )
    with urllib.request.urlopen(request, timeout=120) as response:
        body = response.read()
    return json.loads(body) if body else {}


def list_collection(token: str, collection: str, page_size: int = 300) -> list[dict]:
    documents = []
    page_token = None
    while True:
        url = f"{FS_BASE}/documents/{collection}?pageSize={page_size}"
        if page_token:
            url += f"&pageToken={urllib.parse.quote(page_token, safe='')}"
        payload = req(token, url)
        documents.extend(payload.get("documents", []) or [])
        page_token = payload.get("nextPageToken")
        if not page_token:
            break
    return documents


def batch_delete(token: str, doc_names: list[str], *, chunk_size: int = 200) -> int:
    deleted = 0
    for index in range(0, len(doc_names), chunk_size):
        batch = doc_names[index:index + chunk_size]
        body = json.dumps({"writes": [{"delete": name} for name in batch]}).encode()
        req(token, f"{FS_BASE}/documents:batchWrite", data=body)
        deleted += len(batch)
        print(f"  deleted batch {math.floor(index / chunk_size) + 1}: {len(batch)} docs")
    return deleted


def patch_source_inactive(token: str, source_id: str):
    url = (
        f"{FS_BASE}/documents/sources/{source_id}"
        "?updateMask.fieldPaths=isActive"
        "&updateMask.fieldPaths=status"
        "&updateMask.fieldPaths=harvestEnabled"
    )
    body = json.dumps(
        {
            "fields": {
                "isActive": {"booleanValue": False},
                "status": {"stringValue": "disabled"},
                "harvestEnabled": {"booleanValue": False},
            }
        }
    ).encode()
    try:
        req(token, url, data=body, method="PATCH")
        print(f"  patched sources/{source_id} inactive")
    except Exception as exc:
        print(f"  [warn] could not patch sources/{source_id}: {exc}")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--handle", required=True)
    parser.add_argument("--execute", action="store_true")
    args = parser.parse_args()

    handle = args.handle.strip()
    source_id = f"suno_{handle}"
    token = get_access_token()

    print(f"Scanning Firestore for handle={handle} sourceId={source_id}")
    songs = [
        doc for doc in list_collection(token, "sunoSongs")
        if fval(doc.get("fields", {}).get("sourceId")) == source_id
    ]
    song_keys = {doc["name"].split("/")[-1] for doc in songs}

    queue_docs = [
        doc for doc in list_collection(token, "ytUploadQueue")
        if fval(doc.get("fields", {}).get("songKey")) in song_keys
    ]

    print(f"  sunoSongs matches : {len(songs)}")
    print(f"  ytUploadQueue refs: {len(queue_docs)}")
    print(f"  sources doc       : sources/{source_id}")

    if not args.execute:
        print("Dry run only. Re-run with --execute to apply.")
        return

    if queue_docs:
        deleted_queue = batch_delete(token, [doc["name"] for doc in queue_docs])
        print(f"  queue deleted     : {deleted_queue}")
    else:
        print("  queue deleted     : 0")

    if songs:
        deleted_songs = batch_delete(token, [doc["name"] for doc in songs])
        print(f"  songs deleted     : {deleted_songs}")
    else:
        print("  songs deleted     : 0")

    patch_source_inactive(token, source_id)
    try:
        req(token, f"{FS_BASE}/documents/sources/{source_id}", method="DELETE")
        print(f"  deleted source doc: sources/{source_id}")
    except Exception as exc:
        print(f"  [warn] could not delete sources/{source_id}: {exc}")


if __name__ == "__main__":
    main()
