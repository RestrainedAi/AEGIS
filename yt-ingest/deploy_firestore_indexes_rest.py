#!/usr/bin/env python3
"""
deploy_firestore_indexes_rest.py
Deploys firestore.indexes.json via Firestore Admin REST API — no Firebase CLI needed.

Idempotent: skips indexes that already exist (409 ALREADY_EXISTS is ignored).

Run from ~/yt-ingest/ in Cloud Shell:
  python3 deploy_firestore_indexes_rest.py
"""

import os
import sys
import json
import urllib.request
import urllib.error
import subprocess

PROJECT  = os.environ.get("PROJECT", "stable-framing-482501-t9")
DB       = "(default)"
IDX_FILE = os.path.join(os.path.dirname(__file__), "firestore.indexes.json")

def get_token():
    result = subprocess.run(
        ["gcloud", "auth", "application-default", "print-access-token"],
        capture_output=True, text=True
    )
    if result.returncode != 0:
        print("ERROR getting token:", result.stderr)
        sys.exit(1)
    return result.stdout.strip()

def api_call(method, url, token, body=None):
    data = json.dumps(body).encode() if body else None
    req = urllib.request.Request(
        url, data=data, method=method,
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        }
    )
    try:
        with urllib.request.urlopen(req) as resp:
            return json.loads(resp.read()), None
    except urllib.error.HTTPError as e:
        err_body = e.read().decode()
        return None, (e.code, err_body)

def main():
    if not os.path.exists(IDX_FILE):
        alt = os.path.expanduser("~/yt-ingest/firestore.indexes.json")
        if os.path.exists(alt):
            idx_path = alt
        else:
            print(f"ERROR: firestore.indexes.json not found at {IDX_FILE} or {alt}")
            sys.exit(1)
    else:
        idx_path = IDX_FILE

    with open(idx_path, "r") as f:
        idx_config = json.load(f)

    indexes = idx_config.get("indexes", [])
    print(f"[1/2] Loaded {len(indexes)} composite indexes from {idx_path}")

    token = get_token()
    print("[2/2] Got ADC token\n")

    base = (
        f"https://firestore.googleapis.com/v1/"
        f"projects/{PROJECT}/databases/{DB}/collectionGroups"
    )

    success = 0
    skipped = 0
    failed  = 0

    for idx in indexes:
        collection = idx.get("collectionGroup")
        fields     = idx.get("fields", [])
        query_scope = idx.get("queryScope", "COLLECTION")

        # Convert Firebase CLI format → REST API format
        rest_fields = []
        for f in fields:
            order = f.get("order", "")
            array = f.get("arrayConfig", "")
            field_entry = {"fieldPath": f["fieldPath"]}
            if order:
                field_entry["order"] = order
            if array:
                field_entry["arrayConfig"] = array
            rest_fields.append(field_entry)

        body = {
            "queryScope": query_scope,
            "fields": rest_fields,
        }

        url = f"{base}/{collection}/indexes"
        resp, err = api_call("POST", url, token, body)

        field_desc = " + ".join(
            f["fieldPath"] + ("↑" if f.get("order") == "ASCENDING" else "↓")
            for f in rest_fields
        )

        if resp:
            print(f"  ✅ {collection} [{field_desc}] — operation: {resp.get('name','')[:60]}...")
            success += 1
        elif err:
            code, body_str = err
            if code == 409 or "ALREADY_EXISTS" in body_str:
                print(f"  ⏭  {collection} [{field_desc}] — already exists, skipped")
                skipped += 1
            else:
                print(f"  ✗  {collection} [{field_desc}] — HTTP {code}: {body_str[:120]}")
                failed += 1

    print(f"\n{'='*60}")
    print(f"INDEX DEPLOY COMPLETE")
    print(f"  Created : {success}")
    print(f"  Skipped : {skipped}  (already exist)")
    print(f"  Failed  : {failed}")
    print(f"{'='*60}")

    if failed:
        sys.exit(1)

if __name__ == "__main__":
    main()
