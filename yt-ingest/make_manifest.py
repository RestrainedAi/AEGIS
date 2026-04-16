import json
import csv

INPUT = "songs.extracted.json"
OUTPUT = "suno_manifest.csv"

with open(INPUT, "r", encoding="utf-8") as f:
    songs = json.load(f)

with open(OUTPUT, "w", newline="", encoding="utf-8") as f:
    writer = csv.writer(f)
    writer.writerow([
        "songKey",
        "title",
        "audio_url",
        "video_url",
        "image_url",
        "createdAt"
    ])

    for s in songs:
        raw = s.get("raw", {})
        writer.writerow([
            s.get("songKey"),
            s.get("title"),
            raw.get("audio_url"),
            raw.get("video_url"),
            raw.get("image_url"),
            s.get("createdAt")
        ])

print(f"Wrote {len(songs)} rows to {OUTPUT}")

