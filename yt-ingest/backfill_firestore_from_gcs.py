#!/usr/bin/env python3
"""Backfill Firestore from GCS using REST API (no gRPC needed)."""
import os, sys, json, subprocess, urllib.request, urllib.error
from datetime import datetime, timezone

PROJECT  = "stable-framing-482501-t9"
BUCKET   = "aeonimus-suno-media"
HANDLES  = ["genxdreams"]
FS_BASE  = f"https://firestore.googleapis.com/v1/projects/{PROJECT}/databases/(default)/documents"

def get_token():
    r = subprocess.run(["gcloud","auth","application-default","print-access-token"],
                       capture_output=True, text=True)
    return r.stdout.strip()

def batch_write(writes, token):
    url  = f"{FS_BASE}:batchWrite"
    body = json.dumps({"writes": writes}).encode()
    req  = urllib.request.Request(url, data=body, method="POST")
    req.add_header("Authorization", f"Bearer {token}")
    req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.loads(r.read()), None
    except urllib.error.HTTPError as e:
        return None, f"HTTP {e.code}: {e.read().decode()[:200]}"
    except Exception as e:
        return None, str(e)

def make_write(clip_id, handle, audio_ext, has_video, has_thumb):
    b = f"gs://{BUCKET}"
    now = datetime.now(timezone.utc).isoformat()
    fields = {
        "songKey":    {"stringValue": clip_id},
        "sourceId":   {"stringValue": f"suno_{handle}"},
        "handle":     {"stringValue": handle},
        "title":      {"stringValue": ""},
        "status":     {"stringValue": "active"},
        "importedAt": {"stringValue": now},
        "media": {"mapValue": {"fields": {
            "audioUrl": {"stringValue": f"{b}/suno/handles/{handle}/{clip_id}.{audio_ext}"},
            "videoUrl": {"stringValue": f"{b}/suno/handles/{handle}/{clip_id}.mp4"} if has_video else {"nullValue": None},
            "thumbUrl": {"stringValue": f"{b}/suno/handles/{handle}/{clip_id}.jpg"} if has_thumb else {"nullValue": None},
            "audioExt": {"stringValue": audio_ext},
        }}},
        "gcs": {"mapValue": {"fields": {
            "audio": {"booleanValue": True},
            "video": {"booleanValue": has_video},
            "thumb": {"booleanValue": has_thumb},
        }}},
    }
    return {"update": {
        "name": f"projects/{PROJECT}/databases/(default)/documents/sunoSongs/{clip_id}",
        "fields": fields
    }}

def main():
    from google.cloud import storage
    token = get_token()
    print(f"Token: {token[:20]}...")

    gcs = storage.Client(project=PROJECT)
    total_ok = total_fail = 0

    for handle in HANDLES:
        print(f"\n{'='*60}\nHandle: {handle}")
        blobs = list(gcs.bucket(BUCKET).list_blobs(prefix=f"suno/handles/{handle}/"))
        print(f"[1/2] {len(blobs)} GCS objects")

        clips = {}
        for blob in blobs:
            fname = blob.name.split("/")[-1]
            if "." not in fname: continue
            clip_id, ext = fname.rsplit(".", 1)
            ext = ext.lower()
            if clip_id not in clips:
                clips[clip_id] = {"audio_ext": None, "has_video": False, "has_thumb": False}
            if ext in ("mp3","m4a"): clips[clip_id]["audio_ext"] = ext
            elif ext == "mp4": clips[clip_id]["has_video"] = True
            elif ext == "jpg": clips[clip_id]["has_thumb"] = True

        audio_clips = {k:v for k,v in clips.items() if v["audio_ext"]}
        print(f"[2/2] Writing {len(audio_clips)} clips in batches of 500...")

        items = list(audio_clips.items())
        for b_start in range(0, len(items), 500):
            batch = items[b_start:b_start+500]
            token = get_token()  # refresh per batch
            writes = [make_write(cid, handle, info["audio_ext"],
                                 info["has_video"], info["has_thumb"])
                      for cid, info in batch]
            result, err = batch_write(writes, token)
            if err:
                print(f"  [FAIL] batch {b_start}-{b_start+len(batch)}: {err}")
                total_fail += len(batch)
            else:
                statuses = result.get("writeResults", [])
                print(f"  [OK] batch {b_start+1}-{b_start+len(batch)} → {len(statuses)} written")
                total_ok += len(statuses)

    print(f"\n{'='*60}\nBACKFILL COMPLETE")
    print(f"  Written : {total_ok}")
    print(f"  Failed  : {total_fail}")

if __name__ == "__main__":
    main()
