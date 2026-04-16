#!/usr/bin/env python3
"""
seed_admins.py  —  Bootstrap the Firestore 'admins' collection via REST API.
Usage:
  DRY_RUN=true python3 seed_admins.py    # preview only
  python3 seed_admins.py                 # write to Firestore
"""
import os, json, urllib.request, urllib.error, subprocess, datetime

PROJECT  = "stable-framing-482501-t9"
DATABASE = "(default)"
DRY_RUN  = os.environ.get("DRY_RUN", "").lower() in ("1", "true", "yes")

ADMINS = [
    {
        "uid":       "8QDYXhgnfYgfzSVRp3OWyoZtRJ22",
        "email":     "aegis@aeonimus.ai",
        "role":      "superadmin",
        "is_active": True,
    },
]

def get_token():
    r = subprocess.run(
        ["gcloud", "auth", "application-default", "print-access-token"],
        capture_output=True, text=True)
    if r.returncode != 0:
        raise RuntimeError(r.stderr)
    return r.stdout.strip()

def fs_value(v):
    if isinstance(v, bool):   return {"booleanValue": v}
    if isinstance(v, str):    return {"stringValue": v}
    if isinstance(v, int):    return {"integerValue": str(v)}
    raise TypeError(f"Unsupported type: {type(v)}")

def make_write(uid, data):
    now = datetime.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")
    fields = {k: fs_value(v) for k, v in data.items()}
    fields["created_at"] = {"timestampValue": now}
    fields["updated_at"] = {"timestampValue": now}
    return {
        "update": {
            "name": f"projects/{PROJECT}/databases/{DATABASE}/documents/admins/{uid}",
            "fields": fields,
        }
    }

def main():
    print(f"{'[DRY RUN] ' if DRY_RUN else ''}Seeding {len(ADMINS)} admin(s)...\n")
    for a in ADMINS:
        print(f"  UID  : {a['uid']}")
        print(f"  Email: {a['email']}")
        print(f"  Role : {a['role']}")
        print(f"  Active: {a['is_active']}")
        print()

    if DRY_RUN:
        print("DRY RUN — no writes performed. Remove DRY_RUN=true to apply.")
        return

    token = get_token()
    writes = [make_write(a["uid"], {k: v for k, v in a.items() if k != "uid"})
              for a in ADMINS]

    url  = (f"https://firestore.googleapis.com/v1/projects/{PROJECT}"
            f"/databases/{DATABASE}/documents:batchWrite")
    body = json.dumps({"writes": writes}).encode()
    req  = urllib.request.Request(url, data=body, method="POST",
           headers={"Authorization": f"Bearer {token}",
                    "Content-Type": "application/json"})

    try:
        with urllib.request.urlopen(req) as resp:
            result = json.loads(resp.read())
        statuses = result.get("writeResults", [])
        print(f"✅ Written: {len(statuses)} admin doc(s)")
        for s in statuses:
            print(f"   updateTime: {s.get('updateTime','?')}")
    except urllib.error.HTTPError as e:
        print(f"✗ HTTP {e.code}: {e.read().decode()}")

if __name__ == "__main__":
    main()
