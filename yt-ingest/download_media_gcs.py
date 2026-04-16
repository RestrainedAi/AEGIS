#!/usr/bin/env python3
"""
download_media_gcs.py -- Sprint 1 / Task 1.3
Aeonimus Pipeline: Media Harvester (Playwright edition)
 
Reads delta_manifest.csv and for each row:
  1. Opens the Suno song page in headless Playwright
  2. Triggers playback and intercepts the real media stream URLs
     (bypasses CDN 403 errors that block static audio_url / video_url)
  3. Accepts .m4a as audio fallback if .mp3 stream is unavailable
  4. Streams intercepted bytes directly into GCS via gsutil cp
  5. Uses gsutil cp -n (no-clobber) for full idempotency
     (GCS versioning is enabled; -n stacks new version, never overwrites)
 
GCS canonical path: gs://aeonimus-suno-media/suno/handles/{handle}/{clip_id}.{ext}
 
Usage:
  python3 download_media_gcs.py                        # reads MANIFEST_CSV constant
  MANIFEST_CSV=/path/to/delta_manifest.csv python3 ...  # env override
"""
 
import os
import sys
import csv
import json
import asyncio
import subprocess
import tempfile
import time
import shutil
from firestore_upsert import upsert_song_after_download
import urllib.request
from pathlib import Path
from datetime import datetime, timezone
 
# -- Config -------------------------------------------------------------------
WORK_DIR     = Path("/home/aegis/yt-ingest")
BUCKET       = "gs://aeonimus-suno-media"
MANIFEST_CSV = os.environ.get("MANIFEST_CSV", str(WORK_DIR / "delta_manifest.csv"))
LOG_DIR      = WORK_DIR / "logs"
SUNO_SONG_URL = "https://suno.com/song/{clip_id}"
GSUTIL_BIN   = shutil.which("gsutil") or shutil.which("gsutil.cmd") or "gsutil"
CURL_BIN     = shutil.which("curl") or shutil.which("curl.exe") or "curl"
 
# Playwright timeout (ms) waiting for media stream to be intercepted
INTERCEPT_TIMEOUT_MS = 30_000
# Retry attempts per clip before giving up
MAX_RETRIES = 3
 
 
# -- GCS helpers --------------------------------------------------------------
def gs_exists(gs_uri: str) -> bool:
    """
    Return True only if the GCS object exists AND has size > 0.
    `gsutil stat` returns exit 0 even for 0-byte objects, so we check
    the Content-Length in its output to exclude empty placeholder files.
    """
    r = subprocess.run([GSUTIL_BIN, "stat", gs_uri], capture_output=True, text=True)
    if r.returncode != 0:
        return False
    # Parse "Content-Length: N" from stat output
    for line in r.stdout.splitlines():
        if "Content-Length:" in line:
            try:
                size = int(line.split(":")[-1].strip())
                if size == 0:
                    print(f"    [WARN] 0-byte file in GCS, will re-download: {gs_uri.split('/')[-1]}")
                return size > 0
            except ValueError:
                pass
    # If we can't parse size, assume it's OK to skip re-download (fail safe)
    return True
 
 
def gcs_path(handle: str, clip_id: str, ext: str) -> str:
    return f"{BUCKET}/suno/handles/{handle}/{clip_id}.{ext}"


def gs_is_zero_byte(gs_uri: str) -> bool:
    r = subprocess.run([GSUTIL_BIN, "stat", gs_uri], capture_output=True, text=True)
    if r.returncode != 0:
        return False
    for line in r.stdout.splitlines():
        if "Content-Length:" in line:
            try:
                return int(line.split(":")[-1].strip()) == 0
            except ValueError:
                return False
    return False
 
 
def stream_to_gcs(url: str, gs_uri: str, extra_headers: dict = None) -> bool:
    """
    Stream a URL directly into GCS using:
      curl -L -f [headers] URL | gsutil cp -n - gs_uri
    -n flag: no-clobber -- skip if object already exists (idempotent with versioning).
    Returns True on success.
    """
    overwrite_zero_byte = gs_is_zero_byte(gs_uri)
    gsutil_cmd = [GSUTIL_BIN, "-q", "cp"]
    if overwrite_zero_byte:
        print(f"    [REPAIR] overwriting zero-byte object: {gs_uri.split('/')[-1]}")
    else:
        gsutil_cmd.append("-n")

    suffix = Path(gs_uri).suffix or ".bin"
    tmp_path = None
    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
            tmp_path = tmp.name

        if str(url).startswith("gs://"):
            copy_proc = subprocess.run(
                [GSUTIL_BIN, "-q", "cp", url, tmp_path],
                capture_output=True,
                timeout=180,
            )
            if copy_proc.returncode != 0:
                print(f"    [gsutil download error] {copy_proc.stderr.decode().strip()}", file=sys.stderr)
                return False
        else:
            curl_cmd = [
                CURL_BIN,
                "-L",
                "-f",
                "--silent",
                "--show-error",
                "--max-time",
                "120",
                "--retry",
                "3",
                "-o",
                tmp_path,
            ]
            if extra_headers:
                for k, v in extra_headers.items():
                    curl_cmd += ["-H", f"{k}: {v}"]
            curl_cmd.append(url)

            curl_proc = subprocess.run(curl_cmd, capture_output=True, timeout=180)
            if curl_proc.returncode != 0:
                print(f"    [curl error] {curl_proc.stderr.decode().strip()}", file=sys.stderr)
                return False
        if not os.path.exists(tmp_path) or os.path.getsize(tmp_path) == 0:
            print(f"    [ERROR] Downloaded temp file is empty for {gs_uri}", file=sys.stderr)
            return False

        proc = subprocess.run(
            gsutil_cmd + [tmp_path, gs_uri],
            capture_output=True,
            timeout=180,
        )
        if proc.returncode == 0:
            return True
        print(f"    [gsutil error] {proc.stderr.decode().strip()}", file=sys.stderr)
        return False
    except subprocess.TimeoutExpired:
        print(f"    [TIMEOUT] stream_to_gcs timed out for {gs_uri}", file=sys.stderr)
        return False
    except Exception as exc:
        print(f"    [ERROR] stream_to_gcs temp-file path failed for {gs_uri}: {exc}", file=sys.stderr)
        return False
    finally:
        if tmp_path and os.path.exists(tmp_path):
            try:
                os.unlink(tmp_path)
            except OSError:
                pass
 
 
def stream_bytes_to_gcs(data: bytes, gs_uri: str) -> bool:
    """Write intercepted bytes directly to GCS using -n (no-clobber)."""
    gsutil_cmd = [GSUTIL_BIN, "-q", "cp"]
    if gs_is_zero_byte(gs_uri):
        print(f"    [REPAIR] overwriting zero-byte object: {gs_uri.split('/')[-1]}")
    else:
        gsutil_cmd.append("-n")
    if os.name == "nt":
        suffix = Path(gs_uri).suffix or ".bin"
        tmp_path = None
        try:
            with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
                tmp_path = tmp.name
                tmp.write(data)
            proc = subprocess.run(
                gsutil_cmd + [tmp_path, gs_uri],
                capture_output=True,
                timeout=120,
            )
            if proc.returncode == 0:
                return True
            print(f"    [gsutil error] {proc.stderr.decode().strip()}", file=sys.stderr)
            return False
        finally:
            if tmp_path and os.path.exists(tmp_path):
                try:
                    os.unlink(tmp_path)
                except OSError:
                    pass

    gsutil_cmd += ["-", gs_uri]
    try:
        proc = subprocess.run(gsutil_cmd, input=data, capture_output=True, timeout=120)
        if proc.returncode == 0:
            return True
        print(f"    [gsutil error] {proc.stderr.decode().strip()}", file=sys.stderr)
        return False
    except subprocess.TimeoutExpired:
        print(f"    [TIMEOUT] stream_bytes_to_gcs for {gs_uri}", file=sys.stderr)
        return False
 
 
# -- Playwright media interception --------------------------------------------
async def intercept_clip_media(clip_id: str, handle: str) -> dict:
    """
    Launch headless Chromium via Playwright, navigate to the Suno song page,
    trigger playback, and intercept the actual streaming media URLs.
 
    Returns dict with keys: audio_url, audio_ext, video_url, thumb_url
    (any may be None if not intercepted within timeout).
    """
    from playwright.async_api import async_playwright, TimeoutError as PWTimeout
 
    result = {
        "audio_url": None,
        "audio_ext": None,
        "video_url": None,
        "video_bytes": None,
        "thumb_url": None,
        "request_headers": {},
    }
    song_url = SUNO_SONG_URL.format(clip_id=clip_id)
 
    async with async_playwright() as pw:
        browser = await pw.chromium.launch(
            headless=True,
            args=[
                "--no-sandbox",
                "--disable-setuid-sandbox",
                "--disable-dev-shm-usage",
                "--disable-gpu",
            ]
        )
        context = await browser.new_context(
            user_agent=(
                "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
                "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
            ),
            viewport={"width": 1280, "height": 720},
        )
        page = await context.new_page()
 
        # Intercept network requests to capture media stream URLs
        intercepted_audio = asyncio.Event()
        intercepted_video = asyncio.Event()
 
        async def handle_request(request):
            url = request.url
            hdrs = dict(request.headers)
 
            # Audio: Suno streams mp3 or m4a from cdn.suno.com or similar
            if result["audio_url"] is None:
                if ".mp3" in url and ("cdn" in url or "suno" in url):
                    result["audio_url"] = url
                    result["audio_ext"] = "mp3"
                    result["request_headers"] = hdrs
                    intercepted_audio.set()
                elif ".m4a" in url and ("cdn" in url or "suno" in url):
                    result["audio_url"] = url
                    result["audio_ext"] = "m4a"
                    result["request_headers"] = hdrs
                    intercepted_audio.set()
                elif "audio" in url.lower() and ("cdn" in url or "suno" in url):
                    # Generic audio stream fallback
                    result["audio_url"] = url
                    result["audio_ext"] = "m4a"
                    result["request_headers"] = hdrs
                    intercepted_audio.set()
 
            # Video: Suno mp4
            if result["video_url"] is None:
                if ".mp4" in url and ("cdn" in url or "suno" in url):
                    result["video_url"] = url
                    intercepted_video.set()

        async def handle_response(response):
            url = response.url
            if result["video_bytes"] is None and ".mp4" in url and ("cdn" in url or "suno" in url):
                try:
                    body = await response.body()
                    if body:
                        result["video_url"] = url
                        result["video_bytes"] = body
                        intercepted_video.set()
                except Exception:
                    pass

        page.on("request", handle_request)
        page.on("response", handle_response)
 
        try:
            await page.goto(song_url, wait_until="domcontentloaded", timeout=20_000)
 
            # Try to click the play button to trigger media load
            try:
                play_btn = page.locator(
                    "button[aria-label*='play' i], "
                    "button[aria-label*='Play' i], "
                    "[data-testid*='play'], "
                    ".play-button, "
                    "button.play"
                ).first
                await play_btn.click(timeout=5_000)
            except PWTimeout:
                pass  # No play button found; media may auto-load
 
            # Wait for audio stream to be intercepted
            try:
                await asyncio.wait_for(
                    asyncio.shield(asyncio.ensure_future(intercepted_audio.wait())),
                    timeout=INTERCEPT_TIMEOUT_MS / 1000
                )
            except asyncio.TimeoutError:
                print(f"    [WARN] Audio stream not intercepted within timeout for {clip_id}")
 
            # Brief wait for video stream too
            try:
                await asyncio.wait_for(
                    asyncio.shield(asyncio.ensure_future(intercepted_video.wait())),
                    timeout=5.0
                )
            except asyncio.TimeoutError:
                pass  # Video optional; continue without it
 
            # Also try to get thumbnail from og:image meta tag
            try:
                og_image = await page.evaluate(
                    "() => document.querySelector('meta[property=\"og:image\"]')?.content"
                )
                if og_image:
                    result["thumb_url"] = og_image
            except Exception:
                pass
 
        except Exception as e:
            print(f"    [WARN] Playwright navigation error for {clip_id}: {e}", file=sys.stderr)
        finally:
            await context.close()
            await browser.close()
 
    return result
 
 
# -- Thumbnail download -------------------------------------------------------
def download_thumb(url: str, clip_id: str, handle: str) -> bool:
    """Download thumbnail via direct HTTP (thumbnails rarely 403)."""
    if not url:
        return False
    gs_uri = gcs_path(handle, clip_id, "jpg")
    if gs_exists(gs_uri):
        print(f"    [SKIP] thumb already in GCS")
        return True
    return stream_to_gcs(url, gs_uri)
 
 
# -- Per-clip processing ------------------------------------------------------
async def process_clip(row: dict) -> dict:
    """
    Process a single delta row. Returns result dict with success flags.
    """
    clip_id = row["songKey"]
    handle  = row.get("handle", "unshakableechos2341")
    reason  = row.get("reason", "new")
    title   = row.get("title", "")
 
    print(f"\n  [{reason.upper()}] {clip_id} - {title[:60]}")
 
    result = {
        "clip_id": clip_id,
        "audio":   False,
        "video":   False,
        "thumb":   False,
        "errors":  [],
    }
 
    # Determine which assets are needed based on reason
    need_audio = "audio" in reason or reason == "new"
    need_video = "mp4" in reason or "video" in reason or reason == "new"
    need_thumb = "thumb" in reason or reason == "new"
 
    # Check what's already in GCS (idempotency: skip if already present)
    audio_gs_mp3 = gcs_path(handle, clip_id, "mp3")
    audio_gs_m4a = gcs_path(handle, clip_id, "m4a")
    video_gs     = gcs_path(handle, clip_id, "mp4")
    thumb_gs     = gcs_path(handle, clip_id, "jpg")
 
    audio_exists = gs_exists(audio_gs_mp3) or gs_exists(audio_gs_m4a)
    video_exists = gs_exists(video_gs)
    thumb_exists = gs_exists(thumb_gs)
 
    if need_audio and audio_exists:
        print(f"    [SKIP] audio already in GCS")
        result["audio"] = True
        need_audio = False
    if need_video and video_exists:
        print(f"    [SKIP] video already in GCS")
        result["video"] = True
        need_video = False
    if need_thumb and thumb_exists:
        print(f"    [SKIP] thumb already in GCS")
        result["thumb"] = True
        need_thumb = False
 
    if not need_audio and not need_video and not need_thumb:
        print(f"    [OK] All assets already in GCS -- fully synced")
        return result
 
    # Strategy 1: Try static URLs from manifest first (fast path, sometimes works)
    static_audio = row.get("audio_url", "")
    static_video = row.get("video_url", "")
    static_thumb = row.get("image_url", "")
 
    static_ok = False
    if need_audio and static_audio:
        ext = "m4a" if static_audio.endswith(".m4a") else "mp3"
        target_gs = gcs_path(handle, clip_id, ext)
        print(f"    [TRY] Static audio ({ext}): {static_audio[:80]}...")
        if stream_to_gcs(static_audio, target_gs):
            print(f"    [OK] audio -> {target_gs}")
            result["audio"] = True
            need_audio = False
            static_ok = True
 
    if need_video and static_video:
        print(f"    [TRY] Static video: {static_video[:80]}...")
        if stream_to_gcs(static_video, video_gs):
            print(f"    [OK] video -> {video_gs}")
            result["video"] = True
            need_video = False
 
    if need_thumb and static_thumb:
        print(f"    [TRY] Static thumb: {static_thumb[:80]}...")
        if stream_to_gcs(static_thumb, thumb_gs):
            print(f"    [OK] thumb -> {thumb_gs}")
            result["thumb"] = True
            need_thumb = False
 
    # Strategy 2: Playwright interception for anything still missing
    if need_audio or need_video or need_thumb:
        print(f"    [PLAYWRIGHT] Intercepting streams for {clip_id}...")
        for attempt in range(1, MAX_RETRIES + 1):
            try:
                intercepted = await intercept_clip_media(clip_id, handle)
 
                if need_audio and intercepted.get("audio_url"):
                    ext = intercepted.get("audio_ext", "m4a")
                    target_gs = gcs_path(handle, clip_id, ext)
                    headers = intercepted.get("request_headers", {})
                    # Filter to safe headers (avoid signing issues)
                    safe_headers = {
                        k: v for k, v in headers.items()
                        if k.lower() in ("range", "referer", "accept")
                    }
                    print(f"    [TRY] Playwright audio ({ext}): {intercepted['audio_url'][:80]}...")
                    if stream_to_gcs(intercepted["audio_url"], target_gs, safe_headers):
                        print(f"    [OK] audio -> {target_gs}")
                        result["audio"] = True
                        need_audio = False
 
                if need_video and intercepted.get("video_url"):
                    print(f"    [TRY] Playwright video: {intercepted['video_url'][:80]}...")
                    if intercepted.get("video_bytes"):
                        if stream_bytes_to_gcs(intercepted["video_bytes"], video_gs):
                            print(f"    [OK] video bytes -> {video_gs}")
                            result["video"] = True
                            need_video = False
                    elif stream_to_gcs(intercepted["video_url"], video_gs):
                        print(f"    [OK] video -> {video_gs}")
                        result["video"] = True
                        need_video = False
 
                if need_thumb and intercepted.get("thumb_url"):
                    print(f"    [TRY] Playwright thumb: {intercepted['thumb_url'][:80]}...")
                    if stream_to_gcs(intercepted["thumb_url"], thumb_gs):
                        print(f"    [OK] thumb -> {thumb_gs}")
                        result["thumb"] = True
                        need_thumb = False
 
                if not need_audio and not need_video and not need_thumb:
                    break
 
            except Exception as e:
                print(f"    [ERROR] Playwright attempt {attempt}/{MAX_RETRIES}: {e}", file=sys.stderr)
                if attempt < MAX_RETRIES:
                    time.sleep(2 ** attempt)
 
    # Log remaining failures
    if need_audio:
        msg = f"audio not captured for {clip_id}"
        print(f"    [FAIL] {msg}", file=sys.stderr)
        result["errors"].append(msg)
    if need_video:
        msg = f"video not captured for {clip_id}"
        print(f"    [WARN] {msg}")  # video is optional
        result["video"] = True     # don't block on video
    if need_thumb:
        msg = f"thumb not captured for {clip_id}"
        print(f"    [WARN] {msg}")
        result["thumb"] = True     # don't block on thumb
 
    return result
 
 
# -- Main ---------------------------------------------------------------------
def main():
    run_ts = datetime.now(timezone.utc).isoformat()
    LOG_DIR.mkdir(parents=True, exist_ok=True)
 
    print(f"[{run_ts}] download_media_gcs.py starting")
    print(f"  Manifest : {MANIFEST_CSV}")
    print(f"  Bucket   : {BUCKET}")
 
    # Verify Playwright is installed
    try:
        from playwright.async_api import async_playwright
        print("  Playwright : OK")
    except ImportError:
        print("[ERROR] playwright not installed. Run: pip install playwright && playwright install chromium",
              file=sys.stderr)
        sys.exit(1)
 
    # Read manifest
    manifest_path = Path(MANIFEST_CSV)
    if not manifest_path.exists():
        print(f"[ERROR] Manifest not found: {manifest_path}", file=sys.stderr)
        sys.exit(1)
 
    with open(manifest_path, newline="", encoding="utf-8") as f:
        rows = list(csv.DictReader(f))
 
    if not rows:
        print("No rows in manifest. Nothing to do.")
        sys.exit(0)
 
    print(f"  Rows to process: {len(rows)}")
 
    # Process all clips
    results = asyncio.run(_process_all(rows))
 
    # Summary
    ok_audio  = sum(1 for r in results if r.get("audio"))
    ok_video  = sum(1 for r in results if r.get("video"))
    ok_thumb  = sum(1 for r in results if r.get("thumb"))
    errors    = [r for r in results if r.get("errors")]
 
    end_ts = datetime.now(timezone.utc).isoformat()
    print(f"""
===== DOWNLOAD REPORT [{end_ts}] =====
  Total clips  : {len(rows)}
  Audio OK     : {ok_audio}/{len(rows)}
  Video OK     : {ok_video}/{len(rows)}
  Thumb OK     : {ok_thumb}/{len(rows)}
  Hard errors  : {len(errors)}
==========================================
""")
 
    if errors:
        print("Clips with hard errors:")
        for r in errors:
            print(f"  {r['clip_id']}: {'; '.join(r['errors'])}")
        sys.exit(1)
    else:
        sys.exit(0)
 
 
async def _process_all(rows: list) -> list:
    """Process all rows sequentially (Playwright has per-page resource cost)."""
    results = []
    for i, row in enumerate(rows, 1):
        print(f"\n[{i}/{len(rows)}] Processing {row['songKey']}")
        result = await process_clip(row)
        if result.get("audio"):
            upsert_song_after_download(
                clip_id        = row.get("songKey", ""),
                handle         = row.get("handle", ""),
                title          = row.get("title", ""),
                audio_ext      = result.get("audio_ext", "mp3"),
                has_audio      = True,
                has_video      = result.get("video", False),
                has_thumb      = result.get("thumb", False),
                created_at     = row.get("createdAt", ""),
                tags           = row.get("tags", ""),
                prompt         = row.get("prompt", ""),
                lyrics         = row.get("lyrics", ""),
                model_name     = row.get("modelName", ""),
                is_instrumental= row.get("isInstrumental", ""),
                description    = row.get("description", ""),
                caption        = row.get("caption", ""),
                negative_prompt= row.get("negativePrompt", ""),
                display_tags   = row.get("displayTags", ""),
                styles         = row.get("styles", ""),
                style_text     = row.get("styleText", ""),
                explicit       = row.get("explicit", ""),
                model_major_version = row.get("modelMajorVersion", ""),
                artwork_url    = row.get("artworkUrl", ""),
            )
        results.append(result)
        time.sleep(0.5)  # brief pause between clips
    return results
 
 
if __name__ == "__main__":
    main()
 
