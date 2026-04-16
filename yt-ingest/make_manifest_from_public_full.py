import csv
import json
from pathlib import Path

HANDLE = "unshakableechos2341"
IN_JSON = Path("data/suno") / f"{HANDLE}.public.full.json"
OUT_CSV = Path("data/suno") / f"{HANDLE}.public.full.filtered.csv"

data = json.load(open(IN_JSON, encoding="utf-8"))
items = data["items"]

# Keep only "real media items"
filtered = [it for it in items if (it.get("audio_url") or it.get("video_url"))]

fields = ["songKey", "title", "audio_url", "video_url", "image_url", "createdAt"]
OUT_CSV.parent.mkdir(parents=True, exist_ok=True)

with open(OUT_CSV, "w", newline="", encoding="utf-8") as f:
    w = csv.DictWriter(f, fieldnames=fields)
    w.writeheader()
    for it in filtered:
        w.writerow({
            "songKey": it.get("songKey",""),
            "title": (it.get("title","") or "").replace("\n", " | ").strip(),
            "audio_url": it.get("audio_url",""),
            "video_url": it.get("video_url",""),
            "image_url": it.get("image_url",""),
            "createdAt": "",  # not reliably available from public scrape
        })

print(f"Total items in json: {len(items)}")
print(f"Filtered media items: {len(filtered)}")
print(f"Wrote: {OUT_CSV}")
