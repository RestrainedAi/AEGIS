#!/usr/bin/env python3
"""
backfill_titles_from_studio_api.py

One-time repair tool to populate missing/garbled titles in Firestore `sunoSongs`
using the Suno Studio API clip endpoint.

Why this exists:
- The viewer CSV export is built from Firestore `sunoSongs` (see rebuild_catalog.py).
- A large portion of historical `sunoSongs` docs may have empty `title`, causing the Vault
  UI to show "Untitled" for most of the catalog.

Behavior:
1. Fetch all docs from Firestore collection `sunoSongs` via Firestore REST.
2. For docs where title is missing/empty or starts with "Title:", fetch clip JSON:
     https://studio-api.prod.suno.com/api/clip/<songKey>
3. PATCH Firestore doc field(s) with the discovered title (and createdAt if missing).

Auth:
- Uses `gcloud auth print-access-token` (active account must have Firestore write perms).

Usage:
  python3 backfill_titles_from_studio_api.py --dry-run
  python3 backfill_titles_from_studio_api.py --limit 200
  python3 backfill_titles_from_studio_api.py
"""

from __future__ import annotations

import argparse
import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from gcp_access_token import get_access_token

PROJECT = "stable-framing-482501-t9"
DATABASE = "(default)"
COLLECTION = "sunoSongs"

STUDIO_CLIP_URL = "https://studio-api.prod.suno.com/api/clip/{clip_id}"


def now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def gcloud_token() -> str:
    return get_access_token()


def http_json(url: str, headers: dict[str, str] | None = None, timeout: int = 30) -> dict:
    req = urllib.request.Request(url, headers=headers or {})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read())


def fval(field: dict | None) -> str:
    if not field:
        return ""
    if "nullValue" in field:
        return ""
    if "stringValue" in field:
        return str(field["stringValue"])
    if "integerValue" in field:
        return str(field["integerValue"])
    if "doubleValue" in field:
        return str(field["doubleValue"])
    if "timestampValue" in field:
        return str(field["timestampValue"])
    # For nested/arrays we don't need full fidelity here.
    return ""


def fetch_all_suno_docs(token: str) -> list[dict]:
    base = (
        f"https://firestore.googleapis.com/v1/projects/{PROJECT}"
        f"/databases/{DATABASE}/documents/{COLLECTION}"
    )
    hdrs = {"Authorization": f"Bearer {token}"}
    docs: list[dict] = []
    page_token: str | None = None
    page = 0

    while True:
        url = base + "?pageSize=300" + (f"&pageToken={urllib.parse.quote(page_token)}" if page_token else "")
        data = http_json(url, headers=hdrs, timeout=60)
        batch = data.get("documents", []) or []
        docs.extend(batch)
        page += 1
        print(f"  Page {page}: +{len(batch)} (total {len(docs)})")
        page_token = data.get("nextPageToken")
        if not page_token:
            break

    return docs


def pick_title(clip: dict) -> str:
    for k in ("title", "name"):
        v = clip.get(k)
        if isinstance(v, str) and v.strip():
            return v.strip()
    # Some variants nest fields; do a light scan.
    for k, v in clip.items():
        if isinstance(v, str) and k.lower() in ("title", "name") and v.strip():
            return v.strip()
    return ""


def pick_created_at(clip: dict) -> str:
    for k in ("created_at", "createdAt", "created"):
        v = clip.get(k)
        if isinstance(v, str) and v.strip():
            return v.strip()
    return ""


def sanitize_title(title: str) -> str:
    t = (title or "").replace("\r", " ").replace("\n", " ").strip()
    if t.lower().startswith("title:"):
        t = t.split(":", 1)[1].strip()
    return t


def fs_patch_doc(token: str, doc_name: str, fields: dict[str, dict]) -> None:
    mask = "&".join(f"updateMask.fieldPaths={urllib.parse.quote(k)}" for k in fields.keys())
    url = f"https://firestore.googleapis.com/v1/{doc_name}?{mask}"
    body = json.dumps({"fields": fields}).encode()
    req = urllib.request.Request(
        url,
        data=body,
        method="PATCH",
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=30) as r:
        r.read()


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=0, help="Stop after patching N docs (0 = no limit).")
    ap.add_argument("--sleep", type=float, default=0.15, help="Sleep seconds between Studio API calls.")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    print("=== Backfill SUNO titles from Studio API ===")
    token = gcloud_token()
    print("Fetching Firestore sunoSongs...")
    docs = fetch_all_suno_docs(token)
    print(f"Total docs: {len(docs)}")

    patched = 0
    skipped = 0
    failed = 0

    for d in docs:
        doc_name = d.get("name", "")
        song_key = doc_name.split("/")[-1]
        fields = d.get("fields", {}) or {}

        cur_title = sanitize_title(fval(fields.get("title")))
        created_at = fval(fields.get("createdAt"))

        needs = (not cur_title) or cur_title.lower().startswith("title:")
        if not needs:
            skipped += 1
            continue

        try:
            clip_url = STUDIO_CLIP_URL.format(clip_id=song_key)
            clip = http_json(clip_url, headers={"Accept": "application/json"}, timeout=30)
            if not isinstance(clip, dict):
                raise RuntimeError("clip response not a JSON object")

            new_title = sanitize_title(pick_title(clip))
            new_created = pick_created_at(clip)

            if not new_title:
                # Nothing we can do; keep doc as-is.
                failed += 1
                print(f"  [WARN] {song_key}: Studio API returned no title")
                continue

            patch_fields: dict[str, dict] = {"title": {"stringValue": new_title}}
            if (not created_at) and new_created:
                patch_fields["createdAt"] = {"stringValue": new_created}
            patch_fields["updatedAt"] = {"stringValue": now_iso()}

            if args.dry_run:
                print(f"  [DRY] {song_key}: title={new_title!r} createdAt={patch_fields.get('createdAt', {}).get('stringValue','')!r}")
            else:
                fs_patch_doc(token, doc_name, patch_fields)
                print(f"  [OK] {song_key}: title={new_title!r}")

            patched += 1
            if args.limit and patched >= args.limit:
                break

        except urllib.error.HTTPError as e:
            failed += 1
            print(f"  [WARN] {song_key}: HTTP {e.code} from Studio API/Firestore")
        except Exception as e:
            failed += 1
            print(f"  [WARN] {song_key}: {type(e).__name__}: {e}")
        finally:
            if args.sleep:
                time.sleep(args.sleep)

    print("\n=== Summary ===")
    print(f"  patched : {patched}")
    print(f"  skipped : {skipped}")
    print(f"  failed  : {failed}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
