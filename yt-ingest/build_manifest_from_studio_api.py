import csv
import json
import os
import re
import subprocess
import time
from pathlib import Path
from typing import Any, Dict, List, Optional, Set

HANDLE = "genxdreams"
OUT_DIR = Path("data/suno")
OUT_DIR.mkdir(parents=True, exist_ok=True)

OUT_JSON = OUT_DIR / f"{HANDLE}.studio_api.clips.json"
OUT_CSV = OUT_DIR / f"{HANDLE}.studio_api.manifest.csv"

UUID_RE = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", re.I)
STYLE_KEYWORDS = [
    "acoustic", "alt-pop", "ambient", "ballad", "cinematic", "country",
    "dark synthpop", "darkwave", "drill", "drum and bass", "dubstep",
    "electronic", "electropop", "emo", "folk", "funk", "glitch",
    "glitch pop", "gospel", "grunge", "hard rock", "hip hop", "house",
    "industrial", "indie", "jazz", "latin", "lo-fi", "metal", "orchestral",
    "phonk", "pop", "punk", "r&b", "rap", "rock", "shoegaze", "soul",
    "synthpop", "synthwave", "techno", "trap",
]


class SunoProfileFetchError(RuntimeError):
    """The public profile endpoint did not provide a usable source snapshot."""

def curl_json(url: str) -> Optional[dict]:
    # Use curl so we don't add python deps
    try:
        res = subprocess.run(
            ["curl", "-sS", "-L", "-H", "Accept: application/json", url],
            check=True,
            capture_output=True,
            text=True,
        )
    except subprocess.CalledProcessError:
        return None
    try:
        return json.loads(res.stdout)
    except json.JSONDecodeError:
        return None

def extract_clip_ids(profile_json: dict) -> List[str]:
    ids: List[str] = []

    # Common shape: {"clips":[{id:...}, ...], ...}
    if isinstance(profile_json, dict):
        clips = profile_json.get("clips")
        if isinstance(clips, list):
            for c in clips:
                if isinstance(c, dict):
                    for k in ("id", "clip_id", "clipId", "songKey"):
                        v = c.get(k)
                        if isinstance(v, str) and UUID_RE.match(v):
                            ids.append(v.lower())
                            break

    # An explicit clips array is authoritative even when empty. Other profile
    # sections contain playlist/user UUIDs that must never become song IDs.
    if isinstance(profile_json, dict) and "clips" in profile_json:
        if not isinstance(profile_json["clips"], list):
            raise SunoProfileFetchError("profile clips field was not an array")
        return ids

    # Legacy non-profile payloads may nest their clip records.
    if not ids:
        def walk(x: Any):
            if isinstance(x, dict):
                for k, v in x.items():
                    if k in ("id", "clip_id", "clipId", "songKey") and isinstance(v, str) and UUID_RE.match(v):
                        ids.append(v.lower())
                    walk(v)
            elif isinstance(x, list):
                for i in x:
                    walk(i)
        walk(profile_json)

    return ids

def pick(d: dict, keys: List[str]) -> str:
    for k in keys:
        v = d.get(k)
        if isinstance(v, str) and v.strip():
            return v.strip()
    return ""


def meta_pick(clip: dict, keys: List[str]) -> str:
    metadata = clip.get("metadata") if isinstance(clip.get("metadata"), dict) else {}
    for k in keys:
        v = metadata.get(k)
        if isinstance(v, str) and v.strip():
            return v.strip()
        if isinstance(v, bool):
            return "true" if v else "false"
    return ""


def clip_lyrics_text(clip: dict) -> str:
    metadata = clip.get("metadata") if isinstance(clip.get("metadata"), dict) else {}
    return pick(clip, ["lyrics"]) or meta_pick(clip, ["lyrics", "prompt"])


def split_csvish(value: str) -> List[str]:
    if not value:
        return []
    text = str(value).replace("|", ",")
    return [part.strip() for part in text.split(",") if part.strip()]


def dedupe_keep_order(values: List[str]) -> List[str]:
    seen: Set[str] = set()
    out: List[str] = []
    for value in values:
        key = value.strip().lower()
        if not key or key in seen:
            continue
        seen.add(key)
        out.append(value.strip())
    return out


def derive_styles(tags: str = "", display_tags: str = "", prompt: str = "") -> tuple[List[str], str]:
    styles: List[str] = []
    styles.extend(split_csvish(tags))
    styles.extend(split_csvish(display_tags))
    prompt_lower = str(prompt or "").lower()
    for keyword in STYLE_KEYWORDS:
        if re.search(rf"(?<!\w){re.escape(keyword)}(?!\w)", prompt_lower):
            styles.append(keyword)
    normalized = dedupe_keep_order(styles)
    return normalized, ", ".join(normalized)

def main():
    base = f"https://studio-api.prod.suno.com/api/profiles/{HANDLE}"
    page = 1
    all_ids: List[str] = []
    seen: Set[str] = set()

    while True:
        url = f"{base}?page={page}&playlists_sort_by=created_at&clips_sort_by=created_at"
        data = curl_json(url)
        if not data:
            print(f"Stopped: failed to fetch page {page}")
            break

        ids = extract_clip_ids(data)
        # de-dupe + detect exhaustion
        new = [i for i in ids if i not in seen]
        for i in new:
            seen.add(i)
            all_ids.append(i)

        print(f"Page {page}: got {len(ids)} ids, new {len(new)}, total {len(all_ids)}")

        # Stop when page yields no new ids
        if len(new) == 0:
            break

        page += 1
        if page > 5000:
            print("Safety stop: too many pages")
            break

        time.sleep(0.25)

    # Fetch clip details (this is where audio/video/image urls live)
    items: List[Dict[str, str]] = []
    for idx, clip_id in enumerate(all_ids, start=1):
        clip_url = f"https://studio-api.prod.suno.com/api/clip/{clip_id}"
        clip = curl_json(clip_url) or {}
        if not isinstance(clip, dict):
            clip = {}

        title = pick(clip, ["title", "name"])
        createdAt = pick(clip, ["created_at", "createdAt", "created"])
        audio_url = pick(clip, ["audio_url", "audioUrl", "audio"])
        video_url = pick(clip, ["video_url", "videoUrl", "video"])
        image_url = pick(clip, ["image_url", "imageUrl", "image", "cover_url", "coverUrl"])

        # Some responses nest fields; light fallback scan
        if not (audio_url or video_url or image_url):
            def scan_for_urls(x: Any):
                nonlocal audio_url, video_url, image_url
                if isinstance(x, dict):
                    for k, v in x.items():
                        if isinstance(v, str):
                            if (not audio_url) and v.endswith(".mp3") and "suno" in v:
                                audio_url = v
                            if (not video_url) and v.endswith(".mp4") and "suno" in v:
                                video_url = v
                            if (not image_url) and ("cdn2.suno.ai" in v) and any(v.lower().endswith(ext) for ext in (".jpg",".jpeg",".png",".webp")):
                                image_url = v
                        scan_for_urls(v)
                elif isinstance(x, list):
                    for i in x:
                        scan_for_urls(i)
            scan_for_urls(clip)

        tags = meta_pick(clip, ["tags"])
        prompt = meta_pick(clip, ["prompt"])
        lyrics = clip_lyrics_text(clip) or prompt
        display_tags = pick(clip, ["display_tags"])
        styles, style_text = derive_styles(tags=tags, display_tags=display_tags, prompt=prompt)

        items.append({
            "songKey": clip_id,
            "title": title or "untitled",
            "audio_url": audio_url,
            "video_url": video_url,
            "image_url": image_url,
            "createdAt": createdAt,
            "tags": tags,
            "prompt": prompt,
            "lyrics": lyrics,
            "modelName": pick(clip, ["model_name", "modelName"]),
            "isInstrumental": meta_pick(clip, ["make_instrumental"]),
            "description": pick(clip, ["description"]),
            "caption": pick(clip, ["caption"]),
            "negativePrompt": meta_pick(clip, ["negative_tags"]),
            "displayTags": display_tags,
            "styles": style_text,
            "styleText": style_text,
            "explicit": "true" if clip.get("explicit") is True else "false" if clip.get("explicit") is False else "",
            "modelMajorVersion": pick(clip, ["major_model_version"]),
            "artworkUrl": pick(clip, ["image_large_url", "image_url", "imageUrl"]),
        })

        if idx % 50 == 0:
            print(f"Fetched clip details: {idx}/{len(all_ids)}")

        time.sleep(0.1)

    OUT_JSON.write_text(json.dumps({"handle": HANDLE, "count": len(items), "items": items}, indent=2), encoding="utf-8")
    with open(OUT_CSV, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(
            f,
            fieldnames=[
                "songKey","title","audio_url","video_url","image_url","createdAt",
                "tags","prompt","lyrics","modelName","isInstrumental","description",
                "caption","negativePrompt","displayTags","styles","styleText","explicit","modelMajorVersion","artworkUrl"
            ],
        )
        w.writeheader()
        for it in items:
            # normalize newlines
            it["title"] = (it.get("title") or "").replace("\n", " | ").strip()
            w.writerow(it)

    print(f"\nSaved JSON: {OUT_JSON}")
    print(f"Saved CSV : {OUT_CSV}")
    print(f"Total items: {len(items)}")

if __name__ == "__main__":
    main()


PROFILE_RATE_LIMIT_RETRIES = int(os.environ.get("PROFILE_RATE_LIMIT_RETRIES", "5") or 5)
PROFILE_PAGE_PAUSE_SECONDS = float(os.environ.get("PROFILE_PAGE_PAUSE_SECONDS", "1.5") or 1.5)


def fetch_profile_clip_ids(handle: str, sleep=None) -> list:
    """Fetch all clip IDs for a Suno handle without mistaking an API error for no songs.

    Suno throttles long profiles ("Too many requests"); pages are paced and a
    throttled page is retried with exponential backoff before giving up.
    """
    from harvest_resilience import backoff_seconds, is_rate_limited
    sleep = sleep or time.sleep
    base = f"https://studio-api.prod.suno.com/api/profiles/{handle}"
    page = 1
    all_ids = []
    seen = set()
    while True:
        url = f"{base}?page={page}&playlists_sort_by=created_at&clips_sort_by=created_at"
        if page > 1 and PROFILE_PAGE_PAUSE_SECONDS > 0:
            sleep(PROFILE_PAGE_PAUSE_SECONDS)
        data = curl_json(url)
        attempt = 0
        while is_rate_limited(data) and attempt < PROFILE_RATE_LIMIT_RETRIES:
            attempt += 1
            wait = backoff_seconds(attempt)
            print(f"  [BACKOFF] {handle}: Suno said too many requests on page {page}; "
                  f"waiting {wait:.0f}s (retry {attempt}/{PROFILE_RATE_LIMIT_RETRIES})")
            sleep(wait)
            data = curl_json(url)
        if not data:
            raise SunoProfileFetchError(f"{handle}: profile request failed on page {page}")
        if not isinstance(data, dict):
            raise SunoProfileFetchError(f"{handle}: profile response was not an object on page {page}")
        # A real empty profile still carries the clips field. Error payloads and
        # bot/challenge responses must never be interpreted as an empty account,
        # because that would mark every existing Firestore song as removed.
        if "clips" not in data:
            detail = str(data.get("detail") or data.get("message") or data.get("error") or "missing clips field")
            raise SunoProfileFetchError(f"{handle}: unusable profile response on page {page}: {detail}")
        ids = extract_clip_ids(data)
        new_ids = [i for i in ids if i not in seen]
        if not new_ids:
            break
        all_ids.extend(new_ids)
        seen.update(new_ids)
        page += 1
    return all_ids
