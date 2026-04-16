import csv
import json
import subprocess
import time
from pathlib import Path

MANIFEST_CSV = "suno_manifest.csv"

BASE = Path("data")
JSONL_PATH = BASE / "manifest" / "manifest.jsonl"
MP3_DIR = BASE / "media" / "raw" / "mp3"
MP4_DIR = BASE / "media" / "raw" / "mp4"
THUMB_DIR = BASE / "media" / "thumbs"

for d in [JSONL_PATH.parent, MP3_DIR, MP4_DIR, THUMB_DIR]:
    d.mkdir(parents=True, exist_ok=True)


def now_utc() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def safe_title(s: str) -> str:
    s = (s or "untitled").strip()
    s = s.replace("/", "_").replace("\\", "_")
    return s[:200]


def sniff_html(path: Path) -> bool:
    try:
        with open(path, "rb") as f:
            head = f.read(512).lower()
        return (b"<!doctype html" in head) or (b"<html" in head)
    except Exception:
        return False


def head_content_type(url: str) -> str:
    """
    Attempt a HEAD request to get Content-Type.
    If HEAD fails (404/403/CDN blocks HEAD/etc), return "".
    Never raise.
    """
    try:
        res = subprocess.run(
            ["curl", "-IL", "--silent", "--show-error", "--fail", url],
            check=True,
            capture_output=True,
            text=True,
        )
    except subprocess.CalledProcessError:
        return ""

    headers = res.stdout.lower().splitlines()
    for line in headers:
        if line.startswith("content-type:"):
            return line.split(":", 1)[1].strip()
    return ""


def infer_ext_from_ct(ct: str) -> str:
    ct = (ct or "").lower()
    if "jpeg" in ct or "jpg" in ct:
        return "jpg"
    if "png" in ct:
        return "png"
    if "webp" in ct:
        return "webp"
    if "gif" in ct:
        return "gif"
    return "jpg"


def curl_download(url: str, out_path: Path, expect: str | None = None) -> dict:
    """
    Returns dict with keys:
      ok(bool), skipped(bool), error(str|None), content_type(str|None), path(str)
    """
    result = {
        "ok": False,
        "skipped": False,
        "error": None,
        "content_type": None,
        "path": str(out_path),
    }

    if not url:
        result["skipped"] = True
        result["error"] = "missing_url"
        return result

    # Already have it and it's not HTML junk
    if out_path.exists() and out_path.stat().st_size > 0 and not sniff_html(out_path):
        result["skipped"] = True
        result["ok"] = True
        return result

    ct = head_content_type(url)
    result["content_type"] = ct

    # Reject HTML only if we actually got a content-type
    if ct and ("text/html" in ct or "application/xhtml" in ct):
        result["error"] = f"refused_html_content_type:{ct}"
        return result

    # Light validation (allow octet-stream; CDNs often do that)
    if expect == "video":
        if ct and ("video/" not in ct and "application/octet-stream" not in ct):
            if "text/" in ct or "image/" in ct or "audio/" in ct:
                result["error"] = f"unexpected_content_type_for_video:{ct}"
                return result

    if expect == "audio":
        if ct and ("audio/" not in ct and "application/octet-stream" not in ct):
            if "text/" in ct or "image/" in ct or "video/" in ct:
                result["error"] = f"unexpected_content_type_for_audio:{ct}"
                return result

    if expect == "image":
        if ct and ("image/" not in ct and "application/octet-stream" not in ct):
            if "text/" in ct:
                result["error"] = f"unexpected_content_type_for_image:{ct}"
                return result

    out_path.parent.mkdir(parents=True, exist_ok=True)

    # Download (GET). If it fails, log and continue.
    try:
        subprocess.run(
            ["curl", "-L", "--fail", "--silent", "--show-error", "-o", str(out_path), url],
            check=True,
        )
    except subprocess.CalledProcessError:
        result["error"] = "curl_failed"
        return result

    # Post-check: if it's HTML anyway, delete and mark error
    if sniff_html(out_path):
        try:
            out_path.unlink(missing_ok=True)
        except Exception:
            pass
        result["error"] = "downloaded_html_payload"
        return result

    result["ok"] = True
    return result


def append_jsonl(rec: dict) -> None:
    with open(JSONL_PATH, "a", encoding="utf-8") as jf:
        jf.write(json.dumps(rec, ensure_ascii=False) + "\n")


def main() -> None:
    downloaded = {"mp3": 0, "mp4": 0, "thumb": 0}
    skipped = 0
    errors = 0
    rows = 0

    with open(MANIFEST_CSV, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            rows += 1
            song_key = (row.get("songKey") or "").strip()
            if not song_key:
                continue

            title = safe_title(row.get("title", ""))
            audio_url = (row.get("audio_url") or "").strip()
            video_url = (row.get("video_url") or "").strip()
            image_url = (row.get("image_url") or "").strip()
            created_at = (row.get("createdAt") or "").strip()

            mp3_path = MP3_DIR / f"{song_key}.mp3"
            mp4_path = MP4_DIR / f"{song_key}.mp4"
            thumb_path = THUMB_DIR / f"{song_key}.jpg"  # may be adjusted by ct

            rec = {
                "songKey": song_key,
                "title": title,
                "createdAt": created_at,
                "audio_url": audio_url,
                "video_url": video_url,
                "image_url": image_url,
                "paths": {"mp3": str(mp3_path), "mp4": str(mp4_path), "thumb": str(thumb_path)},
                "ts": now_utc(),
                "status": {},
            }

            did_any = False

            r = curl_download(audio_url, mp3_path, expect="audio")
            rec["status"]["mp3"] = r
            if r["ok"] and not r["skipped"] and r["error"] is None:
                downloaded["mp3"] += 1
                did_any = True
            elif r["error"] and r["error"] not in ("missing_url",):
                errors += 1

            r = curl_download(video_url, mp4_path, expect="video")
            rec["status"]["mp4"] = r
            if r["ok"] and not r["skipped"] and r["error"] is None:
                downloaded["mp4"] += 1
                did_any = True
            elif r["error"] and r["error"] not in ("missing_url",):
                errors += 1

            if image_url:
                ct = head_content_type(image_url)
                ext = infer_ext_from_ct(ct)
                thumb_path = THUMB_DIR / f"{song_key}.{ext}"
                rec["paths"]["thumb"] = str(thumb_path)

                r = curl_download(image_url, thumb_path, expect="image")
                rec["status"]["thumb"] = r
                if r["ok"] and not r["skipped"] and r["error"] is None:
                    downloaded["thumb"] += 1
                    did_any = True
                elif r.get("error") and r.get("error") not in ("missing_url",):
                    errors += 1
            else:
                rec["status"]["thumb"] = {
                    "ok": False,
                    "skipped": True,
                    "error": "missing_url",
                    "content_type": None,
                    "path": str(thumb_path),
                }

            if not did_any:
                skipped += 1

            append_jsonl(rec)

    print("Download complete.")
    print(f"Rows processed:   {rows}")
    print(f"MP3 downloaded:   {downloaded['mp3']}")
    print(f"MP4 downloaded:   {downloaded['mp4']}")
    print(f"Thumb downloaded: {downloaded['thumb']}")
    print(f"Skipped/no-new:   {skipped}")
    print(f"Errors:           {errors}")
    print(f"Manifest JSONL:   {JSONL_PATH}")


if __name__ == "__main__":
    main()
