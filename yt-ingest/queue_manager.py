#!/usr/bin/env python3
"""
queue_manager.py — Aeonimus Vault  (Task 4.2)
Manages the Firestore `ytUploadQueue` upload queue.

Schema  ytUploadQueue/{id}:
  songKey        string   — sunoSongs document ID
  status         string   — queued | uploading | done | error
  createdAt      string   — ISO-8601
  queuedAt       string
  startedAt      string
  uploadedAt     string
  ytVideoId      string
  errorMsg       string
  retryCount     integer

Workflow:
  1. Migrate any legacy `new` items to `queued`
  2. For each queued item call youtube_uploader.upload_clip()
  3. Mark done / queued-for-retry / error accordingly

Usage:
  python queue_manager.py [--limit N] [--dry-run]
"""

import argparse
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone

import youtube_uploader as uploader   # sibling script

PROJECT  = os.environ.get("PROJECT", "stable-framing-482501-t9")
DATABASE = "(default)"
FS_BASE  = f"https://firestore.googleapis.com/v1/projects/{PROJECT}/databases/{DATABASE}"
MAX_RETRY_COUNT = 3
QUEUE_COLLECTION = os.environ.get("QUEUE_COLLECTION", "ytUploadQueue")


# ── Firestore helpers ──────────────────────────────────────────────────────────

def _req(token: str, url: str, data: bytes | None = None, method: str | None = None) -> dict:
    m = method or ("POST" if data is not None else "GET")
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    req = urllib.request.Request(url, data=data, method=m, headers=headers)
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read())


def fs_query_status(token: str, status: str, limit: int) -> list[dict]:
    """Return queue documents with matching status field."""
    url = f"{FS_BASE}/documents:runQuery"
    body = json.dumps({
        "structuredQuery": {
            "from": [{"collectionId": QUEUE_COLLECTION}],
            "where": {
                "fieldFilter": {
                    "field": {"fieldPath": "status"},
                    "op": "EQUAL",
                    "value": {"stringValue": status},
                }
            },
            "limit": limit,
        }
    }).encode()
    results = _req(token, url, data=body)
    return [r["document"] for r in results if "document" in r]


def fs_list_collection(token: str, limit: int = 5) -> list[dict]:
    """List first N docs in the queue collection (debug helper)."""
    url = f"{FS_BASE}/documents/{QUEUE_COLLECTION}?pageSize={limit}"
    return (_req(token, url) or {}).get("documents", []) or []


def fs_patch_item(token: str, doc_name: str, fields: dict):
    """PATCH specific fields on a queue document by full resource name."""
    mask = "&".join(f"updateMask.fieldPaths={k}" for k in fields)
    url = f"https://firestore.googleapis.com/v1/{doc_name}?{mask}"
    body = json.dumps({"fields": fields}).encode()
    _req(token, url, data=body, method="PATCH")


class ClaimLost(Exception):
    """Another run changed the queue row first (update-time precondition failed)."""


def fs_patch_if_unchanged(token: str, doc: dict, fields: dict) -> dict:
    """PATCH fields only if the row is unchanged since we read it.

    Uses Firestore's currentDocument.updateTime precondition, so when two job
    runs read the same row, only the first write wins; the other gets
    FAILED_PRECONDITION and raises ClaimLost.
    """
    update_time = doc.get("updateTime", "")
    if not update_time:
        raise ClaimLost(f"row {doc.get('name', '')} has no updateTime; refusing unconditional claim")
    params = [f"updateMask.fieldPaths={k}" for k in fields]
    params.append("currentDocument.updateTime=" + urllib.parse.quote(update_time, safe=""))
    url = f"https://firestore.googleapis.com/v1/{doc['name']}?{'&'.join(params)}"
    body = json.dumps({"fields": fields}).encode()
    try:
        return _req(token, url, data=body, method="PATCH")
    except urllib.error.HTTPError as e:
        if e.code in (400, 409, 412):
            raise ClaimLost(f"row {doc['name'].split('/')[-1]} changed by another run (HTTP {e.code})") from e
        raise


def claim_item(token: str, doc: dict) -> dict | None:
    """Atomically move one row from queued to uploading. Returns the claimed doc or None."""
    if _fval(doc, "status") != "queued":
        return None
    try:
        claimed = fs_patch_if_unchanged(token, doc, {
            "status":    {"stringValue": "uploading"},
            "startedAt": {"stringValue": _now()},
        })
    except ClaimLost as e:
        print(f"  [SKIP] {e}")
        return None
    merged = dict(doc)
    merged["fields"] = {**doc.get("fields", {}), **(claimed or {}).get("fields", {})}
    if claimed and claimed.get("updateTime"):
        merged["updateTime"] = claimed["updateTime"]
    return merged


def fs_create_item(token: str, song_key: str) -> str:
    """Create a new queue item for a song_key; returns doc name."""
    url = f"{FS_BASE}/documents/{QUEUE_COLLECTION}"
    now = _now()
    body = json.dumps({
        "fields": {
            "songKey":     {"stringValue": song_key},
            "status":      {"stringValue": "queued"},
            "createdAt":   {"stringValue": now},
            "queuedAt":    {"stringValue": now},
            # Firestore REST expects integerValue as a string.
            "retryCount":  {"integerValue": "0"},
        }
    }).encode()
    doc = _req(token, url, data=body)
    return doc["name"]


def _now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _fval(doc: dict, field: str, kind: str = "stringValue"):
    return doc.get("fields", {}).get(field, {}).get(kind, "")


def _terminal_error_message(doc: dict, retries: int) -> str:
    existing = _fval(doc, "errorMsg")
    if existing:
        return existing[:500]
    return f"exceeded max retries ({retries})"


# ── Queue operations ───────────────────────────────────────────────────────────

def enqueue_new(token: str, limit: int) -> list[dict]:
    """Move 'new' items → 'queued'. Returns updated docs."""
    docs = fs_query_status(token, "new", limit)
    for doc in docs:
        fs_patch_item(token, doc["name"], {
            "status":   {"stringValue": "queued"},
            "queuedAt": {"stringValue": _now()},
        })
        print(f"  queued: {doc['name'].split('/')[-1]}  key={_fval(doc,'songKey')}")
    return docs


MAX_DRAIN_PASSES = int(os.environ.get("QUEUE_MAX_DRAIN_PASSES", "5"))


def process_queue(token: str, limit: int, dry_run: bool) -> int:
    """Claim and upload queued rows.

    Re-queries after each pass so rows queued while this run was working (for
    example a second batch of publish clicks that reused this run instead of
    starting a new one) are still picked up. Returns rows uploaded.
    """
    processed = 0
    attempted: set[str] = set()   # failed rows go back to queued; retry them next run, not this one
    for _pass in range(max(1, MAX_DRAIN_PASSES)):
        docs = [d for d in fs_query_status(token, "queued", limit) if d["name"] not in attempted]
        if not docs:
            if processed == 0:
                print("  No queued items.")
            return processed
        print(f"  Processing {len(docs)} queued item(s)...")
        handled = 0
        for doc in docs:
            attempted.add(doc["name"])
            if _process_one(token, doc, dry_run):
                handled += 1
        processed += handled
        if handled == 0 or dry_run:
            # Nothing claimable (another run owns them) or a dry run, which never
            # changes status, so re-querying would loop on the same rows.
            return processed
    return processed


def _process_one(token: str, doc: dict, dry_run: bool) -> bool:
    doc_name  = doc["name"]
    item_id   = doc_name.split("/")[-1]
    song_key  = _fval(doc, "songKey")
    retries   = int(doc.get("fields", {}).get("retryCount", {}).get("integerValue", 0))

    if dry_run:
        print(f"\n  [DRY RUN] item={item_id} song_key={song_key} retry={retries} (no claim, no writes)")
        if song_key:
            uploader.upload_clip(token, song_key, dry_run=True, queue_doc=doc)
        return True

    if not song_key:
        print(f"  [WARN] {item_id} missing songKey; marking error", file=sys.stderr)
        try:
            fs_patch_if_unchanged(token, doc, {
                "status":   {"stringValue": "error"},
                "errorMsg": {"stringValue": "missing songKey"},
            })
        except ClaimLost as e:
            print(f"  [SKIP] {e}")
        return False

    if retries >= MAX_RETRY_COUNT:
        print(f"  [SKIP] {item_id}: exceeded max retries ({retries})")
        try:
            fs_patch_if_unchanged(token, doc, {
                "status":   {"stringValue": "error"},
                "errorMsg": {"stringValue": _terminal_error_message(doc, retries)},
            })
        except ClaimLost as e:
            print(f"  [SKIP] {e}")
        return False

    claimed = claim_item(token, doc)
    if claimed is None:
        return False

    print(f"\n  -> item={item_id} song_key={song_key} retry={retries}")
    try:
        video_id = uploader.upload_clip(token, song_key, dry_run=False, queue_doc=claimed)
        fs_patch_item(token, doc_name, {
            "status":     {"stringValue": "done"},
            "ytVideoId":  {"stringValue": video_id or ""},
            "uploadedAt": {"stringValue": _now()},
            "errorMsg":   {"stringValue": ""},
        })
        print(f"  done: {item_id} -> {video_id}")
    except Exception as e:
        next_retry_count = retries + 1
        terminal = next_retry_count >= MAX_RETRY_COUNT
        err_text = str(e)[:500]
        fs_patch_item(token, doc_name, {
            "status":      {"stringValue": "error" if terminal else "queued"},
            # Firestore REST expects integerValue as a string.
            "retryCount":  {"integerValue": str(next_retry_count)},
            "errorMsg":    {"stringValue": err_text if not terminal else f"{err_text} [terminal after retry {next_retry_count}]"},
        })
        if terminal:
            print(f"  [WARN] {item_id} failed and is now terminal after retry {next_retry_count}: {e}", file=sys.stderr)
        else:
            print(f"  [WARN] {item_id} failed (retry {next_retry_count}): {e}", file=sys.stderr)
    return True


# ── Enqueue helper (called from harvest pipeline) ─────────────────────────────

def enqueue_song_keys(token: str, song_keys: list[str]):
    """Create new queue items for a list of song_keys (idempotent by checking existing)."""
    # Prevent duplicate queue docs across active, completed, and error states.
    # Error items should be retried via explicit operator action, not by creating
    # a second queue record for the same song.
    existing_new       = {_fval(d, "songKey") for d in fs_query_status(token, "new",      1000)}
    existing_queued    = {_fval(d, "songKey") for d in fs_query_status(token, "queued",   1000)}
    existing_uploading = {_fval(d, "songKey") for d in fs_query_status(token, "uploading",1000)}
    existing_done      = {_fval(d, "songKey") for d in fs_query_status(token, "done",     1000)}
    existing_error     = {_fval(d, "songKey") for d in fs_query_status(token, "error",    1000)}
    skip = existing_new | existing_queued | existing_uploading | existing_done | existing_error

    added = 0
    for sk in song_keys:
        if sk in skip:
            continue
        fs_create_item(token, sk)
        added += 1
        print(f"  enqueued: {sk}")
    print(f"  {added} item(s) added, {len(song_keys)-added} already represented in queue state")
    return added


# ── CLI ───────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="Aeonimus Vault upload queue manager")
    sub = parser.add_subparsers(dest="cmd", required=True)

    p_run = sub.add_parser("run", help="Enqueue new items then upload queued items")
    p_run.add_argument("--limit", type=int, default=10, help="Max items per run")
    p_run.add_argument("--dry-run", action="store_true")

    p_enq = sub.add_parser("enqueue", help="Add song keys to the queue")
    p_enq.add_argument("song_keys", nargs="+")

    p_status = sub.add_parser("status", help="Show queue counts")

    args = parser.parse_args()
    token = uploader.get_gcp_token()

    if args.cmd == "run":
        print("=== Aeonimus Upload Queue ===")
        print(f"  project={PROJECT} collection={QUEUE_COLLECTION}")
        try:
            sample = fs_list_collection(token, 3)
            print(f"  debug: list {QUEUE_COLLECTION} -> {len(sample)} doc(s)")
        except Exception as e:
            print(f"  [WARN] debug list failed: {e}", file=sys.stderr)

        try:
            for st in ("new", "queued", "uploading", "done", "error"):
                docs = fs_query_status(token, st, 50)
                print(f"  debug: status={st:<10s} count={len(docs)}")
        except Exception as e:
            print(f"  [WARN] debug status query failed: {e}", file=sys.stderr)

        print("-- Enqueuing new items --")
        enqueue_new(token, args.limit)
        print("-- Processing queue --")
        process_queue(token, args.limit, dry_run=args.dry_run)

    elif args.cmd == "enqueue":
        enqueue_song_keys(token, args.song_keys)

    elif args.cmd == "status":
        for st in ("new", "queued", "uploading", "done", "error"):
            docs = fs_query_status(token, st, 1000)
            print(f"  {st:12s}: {len(docs)}")


if __name__ == "__main__":
    main()
