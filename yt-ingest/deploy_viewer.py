#!/usr/bin/env python3
import json, subprocess, urllib.request, urllib.error

PROJECT = "stable-framing-482501-t9"
IMAGE   = f"us-central1-docker.pkg.dev/{PROJECT}/aeonimus-repo/suno-viewer:latest"
SVC_URL = f"https://run.googleapis.com/v2/projects/{PROJECT}/locations/us-central1/services/suno-viewer"

def get_token():
    r = subprocess.run(["gcloud","auth","application-default","print-access-token"],
                       capture_output=True, text=True)
    return r.stdout.strip()

def api(method, url, token, body=None):
    data = json.dumps(body).encode() if body else None
    req  = urllib.request.Request(url, data=data, method=method,
           headers={"Authorization": f"Bearer {token}",
                    "Content-Type": "application/json"})
    with urllib.request.urlopen(req) as r:
        return json.loads(r.read())

token = get_token()
print("Auth OK")

svc = api("GET", SVC_URL, token)
svc["template"]["containers"][0]["image"] = IMAGE
result = api("PATCH", SVC_URL, token, svc)
print("Update:", result.get("name","ERROR")[:70])
print("Done — suno-viewer is deploying new image.")
