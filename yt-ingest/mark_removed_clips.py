#!/usr/bin/env python3
"""
mark_removed_clips.py
Marks clips removed from Suno profile:
  1. Moves GCS files → suno/handles/{handle}/removed/{clip_id}.{ext}
  2. Sets Firestore status = "removed_from_suno" + updates GCS paths
  3. Idempotent / safe to re-run
"""
import os, sys, json, subprocess, time, urllib.request, urllib.error
from datetime import datetime, timezone

PROJECT  = "stable-framing-482501-t9"
DATABASE = "(default)"
BUCKET   = "aeonimus-suno-media"
DRY_RUN  = os.environ.get("DRY_RUN","").lower() in ("1","true","yes")

TRACKED_HANDLES = [
    ("unshakableechos2341", "suno_unshakableechos2341"),
    ("genxdreams",          "suno_genxdreams"),
]
EXTS = [".mp3", ".m4a", ".mp4", ".jpg"]

def get_token():
    r = subprocess.run(["gcloud","auth","application-default","print-access-token"],
                       capture_output=True, text=True)
    if r.returncode != 0: raise RuntimeError(r.stderr)
    return r.stdout.strip()

def fetch_profile_ids(handle):
    sys.path.insert(0, os.path.expanduser("~/yt-ingest"))
    from build_manifest_from_studio_api import fetch_profile_clip_ids
    return set(fetch_profile_clip_ids(handle))

def get_firestore_ids(token, source_id):
    url = (f"https://firestore.googleapis.com/v1/projects/{PROJECT}"
           f"/databases/{DATABASE}/documents:runQuery")
    body = json.dumps({"structuredQuery": {
        "from": [{"collectionId": "sunoSongs"}],
        "where": {"fieldFilter": {
            "field": {"fieldPath": "sourceId"}, "op": "EQUAL",
            "value": {"stringValue": source_id}
        }},
        "select": {"fields": [{"fieldPath": "__name__"},
                               {"fieldPath": "status"}]},
    }}).encode()
    req = urllib.request.Request(url, data=body, method="POST",
          headers={"Authorization": f"Bearer {token}",
                   "Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=60) as resp:
        results = json.loads(resp.read())
    docs = {}
    for item in results:
        doc = item.get("document")
        if not doc: continue
        name = doc.get("name","")
        clip_id = name.split("/")[-1].replace("suno:","")
        status = (doc.get("fields",{}).get("status",{})
                     .get("stringValue",""))
        docs[clip_id] = {"name": name, "status": status}
    return docs

def gcs_move(token, handle, clip_id):
    """
    Copy each asset to removed/ subfolder, delete original.
    Returns dict of new GCS URIs that actually exist.
    """
    moved = {}
    import urllib.parse
    for ext in EXTS:
        src_obj = f"suno/handles/{handle}/{clip_id}{ext}"
        dst_obj = f"suno/handles/{handle}/removed/{clip_id}{ext}"
        src_enc = urllib.parse.quote(src_obj, safe="")
        dst_enc = urllib.parse.quote(dst_obj, safe="")

        # Check if source exists
        chk = urllib.request.Request(
            f"https://storage.googleapis.com/storage/v1/b/{BUCKET}/o/{src_enc}",
            headers={"Authorization": f"Bearer {token}"})
        try:
            with urllib.request.urlopen(chk, timeout=10): pass
        except urllib.error.HTTPError as e:
            if e.code == 404: continue
            raise

        if DRY_RUN:
            moved[ext.lstrip(".")] = f"gs://{BUCKET}/{dst_obj}"
            continue

        # Copy
        copy_req = urllib.request.Request(
            f"https://storage.googleapis.com/storage/v1/b/{BUCKET}/o/"
            f"{src_enc}/copyTo/b/{BUCKET}/o/{dst_enc}",
            data=b"", method="POST",
            headers={"Authorization": f"Bearer {token}",
                     "Content-Type": "application/json"})
        with urllib.request.urlopen(copy_req, timeout=30): pass

        # Delete original
        del_req = urllib.request.Request(
            f"https://storage.googleapis.com/storage/v1/b/{BUCKET}/o/{src_enc}",
            method="DELETE",
            headers={"Authorization": f"Bearer {token}"})
        try:
            with urllib.request.urlopen(del_req, timeout=10): pass
        except urllib.error.HTTPError as e:
            if e.code != 204: raise

        moved[ext.lstrip(".")] = f"gs://{BUCKET}/{dst_obj}"

    return moved

def batch_mark_firestore(token, updates, batch_size=500):
    """updates = list of (doc_name, moved_uris_dict)"""
    url = (f"https://firestore.googleapis.com/v1/projects/{PROJECT}"
           f"/databases/{DATABASE}/documents:batchWrite")
    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    total, failed = 0, 0

    for i in range(0, len(updates), batch_size):
        batch = updates[i:i+batch_size]
        writes = []
        for doc_name, moved in batch:
            fields = {
                "status":     {"stringValue": "removed_from_suno"},
                "removedAt":  {"timestampValue": now},
                "updated_at": {"timestampValue": now},
            }
            # Update GCS paths if files were moved
            ext_map = {"mp3":"audioUrl","m4a":"audioUrl",
                       "mp4":"videoUrl","jpg":"thumbUrl"}
            for ext, field in ext_map.items():
                if ext in moved:
                    fields[field] = {"stringValue": moved[ext]}

            mask_fields = list(fields.keys())
            writes.append({
                "update": {"name": doc_name, "fields": fields},
                "updateMask": {"fieldPaths": mask_fields}
            })

        body = json.dumps({"writes": writes}).encode()
        req = urllib.request.Request(url, data=body, method="POST",
              headers={"Authorization": f"Bearer {token}",
                       "Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=60) as resp:
                result = json.loads(resp.read())
            total += len(result.get("writeResults",[]))
        except urllib.error.HTTPError as e:
            print(f"  Batch error: {e.read().decode()[:200]}")
            failed += len(batch)
    return total, failed

def main():
    print(f"{'[DRY RUN] ' if DRY_RUN else ''}mark_removed_clips.py starting\n")
    token = get_token()
    print("Auth OK\n")

    grand_marked = 0
    for handle, source_id in TRACKED_HANDLES:
        print(f"Handle: {handle}")
        print(f"  [1/3] Fetching live Suno IDs...")
        live_ids = fetch_profile_ids(handle)
        print(f"    Live: {len(live_ids)}")

        print(f"  [2/3] Fetching Firestore docs...")
        fs_docs  = get_firestore_ids(token, source_id)
        fs_ids   = set(fs_docs.keys())
        print(f"    Firestore: {len(fs_ids)}")

        removed_ids = fs_ids - live_ids
        to_process  = [cid for cid in removed_ids
                       if fs_docs[cid]["status"] != "removed_from_suno"]
        already     = len(removed_ids) - len(to_process)
        print(f"    Removed: {len(removed_ids)}  "
              f"(already done: {already}, to process: {len(to_process)})")

        if not to_process:
            print(f"    Nothing to do.\n")
            continue

        print(f"  [3/3] Moving GCS files + marking Firestore...")
        updates = []
        for idx, clip_id in enumerate(sorted(to_process), 1):
            moved = gcs_move(token, handle, clip_id)
            updates.append((fs_docs[clip_id]["name"], moved))
            if DRY_RUN:
                print(f"    [DRY] {clip_id} → moved: {list(moved.keys())}")
            else:
                print(f"    [{idx}/{len(to_process)}] {clip_id} "
                      f"moved: {list(moved.keys())}")

        if not DRY_RUN:
            written, failed = batch_mark_firestore(token, updates)
            print(f"    ✅ Firestore marked: {written}  Failed: {failed}")
            grand_marked += written
        print()

    if DRY_RUN:
        print("DRY RUN complete — no changes made.")
    else:
        print(f"Total docs marked + moved: {grand_marked}")

if __name__ == "__main__":
    main()
