#!/usr/bin/env python3
"""
deploy_firestore_rules_rest.py
Deploys firestore.rules via Firebase Rules REST API — no Firebase CLI needed.

Workflow:
  1. Read firestore.rules from ~/yt-ingest/
  2. POST to Firebase Rules API to create a Ruleset
  3. PATCH the cloud.firestore Release to point to the new Ruleset

Run from ~/yt-ingest/ in Cloud Shell:
  python3 deploy_firestore_rules_rest.py
"""

import os
import sys
import json
import urllib.request
import urllib.error
import subprocess

PROJECT = os.environ.get("PROJECT", "stable-framing-482501-t9")
RULES_FILE = os.path.join(os.path.dirname(__file__), "firestore.rules")

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
            return json.loads(resp.read())
    except urllib.error.HTTPError as e:
        err_body = e.read().decode()
        print(f"HTTP {e.code} {method} {url}")
        print(err_body)
        sys.exit(1)

def main():
    if not os.path.exists(RULES_FILE):
        # Try looking in ~/yt-ingest/
        alt = os.path.expanduser("~/yt-ingest/firestore.rules")
        if os.path.exists(alt):
            rules_path = alt
        else:
            print(f"ERROR: firestore.rules not found at {RULES_FILE} or {alt}")
            sys.exit(1)
    else:
        rules_path = RULES_FILE

    with open(rules_path, "r") as f:
        rules_content = f.read()

    print(f"[1/3] Read {len(rules_content)} chars from {rules_path}")

    token = get_token()
    print("[2/3] Got ADC token")

    # Step 1: Create a new Ruleset
    base = f"https://firebaserules.googleapis.com/v1/projects/{PROJECT}"
    ruleset_body = {
        "source": {
            "files": [
                {
                    "name": "firestore.rules",
                    "content": rules_content,
                    "fingerprint": "",
                }
            ]
        }
    }
    print("[3/3] Creating ruleset...")
    result = api_call("POST", f"{base}/rulesets", token, ruleset_body)
    ruleset_name = result.get("name")
    print(f"  Ruleset created: {ruleset_name}")

    # Step 2: Update the cloud.firestore Release to point to this ruleset
    release_name = f"projects/{PROJECT}/releases/cloud.firestore"
    release_body = {
        "name": release_name,
        "rulesetName": ruleset_name,
    }
    print("[4/4] Updating cloud.firestore release...")
    try:
        result2 = api_call(
            "PATCH",
            f"{base}/releases/cloud.firestore",
            token,
            release_body
        )
        print(f"  Release updated: {result2.get('name')}")
        print(f"  Ruleset: {result2.get('rulesetName')}")
        print("\n✅ Firestore Rules deployed successfully!")
    except SystemExit:
        # Release might not exist yet — try creating it
        print("  Release doesn't exist, creating it...")
        result2 = api_call(
            "POST",
            f"{base}/releases",
            token,
            release_body
        )
        print(f"  Release created: {result2.get('name')}")
        print("\n✅ Firestore Rules deployed successfully!")

if __name__ == "__main__":
    main()
