import csv
import json
from pathlib import Path
from datetime import datetime

JSONL = Path("data/manifest/manifest.jsonl")
OUT_CSV = Path("data/items.csv")

def parse_ts(ts: str):
    # ts format: 2026-01-30T21:27:28Z
    try:
        return datetime.strptime(ts, "%Y-%m-%dT%H:%M:%SZ")
    except Exception:
        return datetime.min

latest = {}  # songKey -> record

with open(JSONL, "r", encoding="utf-8") as f:
    for line in f:
        line = line.strip()
        if not line:
            continue
        try:
            rec = json.loads(line)
        except json.JSONDecodeError:
            continue

        key = (rec.get("songKey") or "").strip()
        if not key:
            continue

        ts = rec.get("ts") or ""
        if key not in latest or parse_ts(ts) >= parse_ts(latest[key].get("ts") or ""):
            latest[key] = rec

# Build rows
fields = [
    "songKey",
    "title",
    "createdAt",
    "audio_url",
    "video_url",
    "image_url",
    "mp3_path",
    "mp4_path",
    "thumb_path",
    "has_mp3",
    "has_mp4",
    "has_thumb",
    "last_ts",
    "mp3_error",
    "mp4_error",
    "thumb_error",
]

OUT_CSV.parent.mkdir(parents=True, exist_ok=True)

with open(OUT_CSV, "w", newline="", encoding="utf-8") as out:
    w = csv.DictWriter(out, fieldnames=fields)
    w.writeheader()

    for key, rec in sorted(latest.items()):
        paths = rec.get("paths") or {}
        mp3 = Path(paths.get("mp3") or "")
        mp4 = Path(paths.get("mp4") or "")
        thb = Path(paths.get("thumb") or "")

        st = rec.get("status") or {}
        mp3_err = (st.get("mp3") or {}).get("error")
        mp4_err = (st.get("mp4") or {}).get("error")
        thb_err = (st.get("thumb") or {}).get("error")

        row = {
            "songKey": key,
            "title": (rec.get("title") or "").replace("\n", " | ").strip(),
            "createdAt": rec.get("createdAt") or "",
            "audio_url": rec.get("audio_url") or "",
            "video_url": rec.get("video_url") or "",
            "image_url": rec.get("image_url") or "",
            "mp3_path": str(mp3) if str(mp3) else "",
            "mp4_path": str(mp4) if str(mp4) else "",
            "thumb_path": str(thb) if str(thb) else "",
            "has_mp3": mp3.exists() and mp3.is_file() and mp3.stat().st_size > 0 if str(mp3) else False,
            "has_mp4": mp4.exists() and mp4.is_file() and mp4.stat().st_size > 0 if str(mp4) else False,
            "has_thumb": thb.exists() and thb.is_file() and thb.stat().st_size > 0 if str(thb) else False,
            "last_ts": rec.get("ts") or "",
            "mp3_error": mp3_err or "",
            "mp4_error": mp4_err or "",
            "thumb_error": thb_err or "",
        }
        w.writerow(row)

print(f"Wrote {OUT_CSV} with {len(latest)} unique songKeys (reduced from log).")
