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
     (existing objects are skipped; -n does not create a new version)
 
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
from firestore_upsert import (upsert_song_after_download, update_song_metadata_only,
                              record_native_retry, record_native_audio_version)
import derived_audio
from audio_integrity import InvalidAudio, expected_duration, validate_audio, validate_video
from harvest_resilience import ChronicFailureLedger, is_placeholder_audio_url
import suno_wav
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
# Chromium launch attempts inside one interception (Cloud Run sometimes kills
# the first browser with "Target page, context or browser has been closed").
BROWSER_LAUNCH_ATTEMPTS = 2
# Ledger of clips that keep failing; repeat failures become warnings.
CHRONIC_LEDGER = os.environ.get(
    "CHRONIC_FAILURE_LEDGER",
    "gs://aeonimus-workspaces/exports/suno/state/chronic_media_failures.json")
# Historic video-only repairs are optional work. Keep the daily catalog path
# responsive by deferring those rows to the dedicated repair run unless an
# operator explicitly enables them.
REPAIR_OPTIONAL_VIDEO = os.environ.get("REPAIR_OPTIONAL_VIDEO", "false").strip().lower() in {
    "1", "true", "yes", "on"
}
 
 
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


def should_defer_optional_video_repair(reason: str, need_audio: bool, need_thumb: bool) -> bool:
    """Keep a legacy MP4-only repair from delaying the catalog publication path."""
    normalized_reason = str(reason or "").strip().lower()
    return (
        not REPAIR_OPTIONAL_VIDEO
        and normalized_reason.startswith("missing_gcs:")
        and normalized_reason.split(":", 1)[1].split(",") == ["mp4"]
        and not need_audio
        and not need_thumb
    )


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
 
 
def is_audio_uri(gs_uri: str) -> bool:
    return Path(gs_uri).suffix.lower() in {".mp3", ".m4a", ".wav", ".aac", ".ogg", ".flac"}


def gs_audio_valid(gs_uri: str, expected_seconds=None) -> bool:
    return gs_media_valid(gs_uri, expected_seconds, validate_audio)


def gs_video_valid(gs_uri: str, expected_seconds=None) -> bool:
    return gs_media_valid(gs_uri, expected_seconds, validate_video)


def gs_media_valid(gs_uri: str, expected_seconds, validator) -> bool:
    """Verify stored bytes, not mere existence. Suspect originals stay untouched."""
    from media_validation_receipts import ReceiptStore
    try:
        return ReceiptStore().validate(gs_uri, expected_seconds,
            "video" if validator is validate_video else "audio", validator)
    except Exception as exc:
        # Denied/failed reads remain unverified, never represented as absent.
        print(f"    [MEDIA_UNVERIFIED] {gs_uri}: {type(exc).__name__}; original preserved", file=sys.stderr)
        return False


def upload_validated_file(tmp_path, gs_uri, expected_seconds=None):
    audio = is_audio_uri(gs_uri)
    video = Path(gs_uri).suffix.lower() in {".mp4", ".webm", ".mov"}
    media = audio or video
    validator = validate_audio if audio else validate_video
    stored_validator = gs_audio_valid if audio else gs_video_valid
    if media:
        validator(tmp_path, expected_seconds)
        existing = subprocess.run([GSUTIL_BIN, "stat", gs_uri], capture_output=True, timeout=60)
        if existing.returncode == 0:
            # No silent no-clobber success over an invalid original. Explicit
            # preservation-aware recovery owns replacement, not this harvester.
            return stored_validator(gs_uri, expected_seconds)
    command = [GSUTIL_BIN, "-q", "cp"]
    if media or not gs_is_zero_byte(gs_uri):
        command.append("-n")
    proc = subprocess.run(command + [tmp_path, gs_uri], capture_output=True, timeout=180)
    if proc.returncode:
        print(f"    [gsutil error] {proc.stderr.decode().strip()}", file=sys.stderr)
        return False
    # A concurrent writer may have won the no-clobber race; check actual bytes.
    return stored_validator(gs_uri, expected_seconds) if media else True


def stream_to_gcs(url: str, gs_uri: str, extra_headers: dict = None, expected_seconds=None,
                  rejects: list = None) -> bool:
    """
    Download to a temporary file, validate media, and upload without clobbering.
    Audio/video success requires validation of the actual stored object as well.
    """
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

        return upload_validated_file(tmp_path, gs_uri, expected_seconds)
    except subprocess.TimeoutExpired:
        print(f"    [TIMEOUT] stream_to_gcs timed out for {gs_uri}", file=sys.stderr)
        return False
    except InvalidAudio as exc:
        # A stub/silent file is Suno saying "not ready": never uploaded, retried next night.
        print(f"    [NOT_READY] {gs_uri.split('/')[-1]}: {exc} (not uploaded)", file=sys.stderr)
        if rejects is not None:
            rejects.append(str(exc))
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
 
 
def stream_bytes_to_gcs(data: bytes, gs_uri: str, expected_seconds=None, rejects: list = None) -> bool:
    """Validate intercepted audio/video bytes before upload on every platform."""
    tmp_path = None
    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix=Path(gs_uri).suffix) as tmp:
            tmp_path = tmp.name
            tmp.write(data)
        if not data:
            return False
        return upload_validated_file(tmp_path, gs_uri, expected_seconds)
    except (InvalidAudio, OSError, subprocess.TimeoutExpired) as exc:
        print(f"    [MEDIA_INVALID_OR_UPLOAD_FAILED] {gs_uri}: {exc}", file=sys.stderr)
        if isinstance(exc, InvalidAudio) and rejects is not None:
            rejects.append(str(exc))
        return False
    finally:
        if tmp_path and os.path.exists(tmp_path):
            os.unlink(tmp_path)


# -- Playwright media interception --------------------------------------------
BROWSER_ARGS = [
    "--no-sandbox",
    "--disable-setuid-sandbox",
    "--disable-dev-shm-usage",
    "--disable-gpu",
]


async def launch_browser(pw, attempts: int = None, pause: float = 3.0):
    """Launch Chromium, retrying once more if the first launch dies."""
    attempts = attempts or BROWSER_LAUNCH_ATTEMPTS
    last = None
    for attempt in range(1, attempts + 1):
        try:
            return await pw.chromium.launch(headless=True, args=BROWSER_ARGS)
        except Exception as exc:
            last = exc
            print(f"    [WARN] Chromium launch {attempt}/{attempts} failed: {exc}", file=sys.stderr)
            if attempt < attempts:
                await asyncio.sleep(pause)
    raise last

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
        "audio_bytes": None,
        "video_url": None,
        "video_bytes": None,
        "thumb_url": None,
        "thumb_bytes": None,
        "request_headers": {},
        "placeholder_seen": False,
    }
    song_url = SUNO_SONG_URL.format(clip_id=clip_id)
 
    async with async_playwright() as pw:
        browser = await launch_browser(pw)
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
            if is_placeholder_audio_url(url):
                result["placeholder_seen"] = True
                return
 
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
            lower_url = url.lower()
            if is_placeholder_audio_url(url):
                result["placeholder_seen"] = True
                return
            is_suno_media = "cdn" in lower_url or "suno" in lower_url

            if result["audio_bytes"] is None and is_suno_media and (
                ".mp3" in lower_url or ".m4a" in lower_url or "audio" in lower_url
            ):
                try:
                    body = await response.body()
                    if body:
                        result["audio_url"] = url
                        result["audio_ext"] = "m4a" if ".m4a" in lower_url or ".mp3" not in lower_url else "mp3"
                        result["audio_bytes"] = body
                        intercepted_audio.set()
                except Exception:
                    pass

            if result["video_bytes"] is None and ".mp4" in url and ("cdn" in url or "suno" in url):
                try:
                    body = await response.body()
                    if body:
                        result["video_url"] = url
                        result["video_bytes"] = body
                        intercepted_video.set()
                except Exception:
                    pass

            if result["thumb_bytes"] is None and is_suno_media and (
                ".jpg" in lower_url or ".jpeg" in lower_url or ".png" in lower_url
            ):
                try:
                    body = await response.body()
                    if body:
                        result["thumb_url"] = url
                        result["thumb_bytes"] = body
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
                await asyncio.wait_for(intercepted_audio.wait(), timeout=INTERCEPT_TIMEOUT_MS / 1000)
            except asyncio.TimeoutError:
                print(f"    [WARN] Audio stream not intercepted within timeout for {clip_id}")
 
            # Brief wait for video stream too
            try:
                await asyncio.wait_for(intercepted_video.wait(), timeout=5.0)
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
        "audio_ext": None,
        "video":   False,
        "thumb":   False,
        "errors":  [],
    }
 
    # Metadata enrichment has no media permit: do not inspect, decode, discover,
    # transfer or reclassify any native asset from this path.
    if reason.startswith("metadata_repair:"):
        result["metadata_only"] = True
        if not update_song_metadata_only(row):
            result["errors"].append(f"metadata update failed for {clip_id}")
        return result
    retained = reason.startswith("retained:")
    # Songs already playing a derived listening copy: the native MP3 is retried weekly.
    has_recovery = row.get("audioRecoveryKind") == derived_audio.DERIVE_KIND
    recovery_schedule = {"kind": row.get("audioRecoveryKind"),
                         "nativeRetry": {"nextAttemptAt": row.get("nativeRetryNextAt", ""),
                                         "attempts": row.get("nativeRetryAttempts") or 0}}

    # Determine which assets are needed based on reason
    need_audio = "audio" in reason or reason == "new"
    need_video = "mp4" in reason or "video" in reason or reason == "new"
    need_thumb = "thumb" in reason or reason == "new"

    # Check what's already in GCS (idempotency: skip if already present)
    audio_gs_mp3 = gcs_path(handle, clip_id, "mp3")
    audio_gs_m4a = gcs_path(handle, clip_id, "m4a")
    video_gs     = gcs_path(handle, clip_id, "mp4")
    thumb_gs     = gcs_path(handle, clip_id, "jpg")
 
    duration = expected_duration(row)
    audio_ext = None
    audio_gs_wav = gcs_path(handle, clip_id, "wav")
    for ext, uri in (("mp3", audio_gs_mp3), ("m4a", audio_gs_m4a), ("wav", audio_gs_wav)):
        if gs_exists(uri) and gs_audio_valid(uri, duration):
            audio_ext = ext
            break
    audio_exists = audio_ext is not None
    result["audio_ext"] = audio_ext
    if not audio_exists and not retained:
        need_audio = True
    video_exists = gs_exists(video_gs) and gs_video_valid(video_gs, duration)
    thumb_exists = gs_exists(thumb_gs)

    # Preserve existing asset truth even for metadata-only repair rows.
    result["audio"] = audio_exists
    result["video"] = video_exists
    result["thumb"] = thumb_exists

    if need_audio and audio_exists:
        print(f"    [SKIP] audio already in GCS")
        need_audio = False
    if need_video and video_exists:
        print(f"    [SKIP] video already in GCS")
        need_video = False
    if need_thumb and thumb_exists:
        print(f"    [SKIP] thumb already in GCS")
        need_thumb = False

    if need_audio and has_recovery and not derived_audio.native_retry_due(recovery_schedule):
        print(f"    [SKIP] native audio retry not due (derived copy in place; weekly retry)")
        need_audio = False
        result["audio_deferred"] = True

    if not need_audio and not need_video and not need_thumb:
        print(f"    [OK] Assets already in GCS -- metadata refresh eligible")
        return result
 
    # Strategy 1: Try static URLs from manifest first (fast path, sometimes works)
    static_audio = row.get("audio_url", "")
    static_video = row.get("video_url", "")
    static_thumb = row.get("image_url", "")
 
    static_ok = False
    not_ready = []  # evidence Suno served a placeholder/stub instead of the song
    if need_audio and is_placeholder_audio_url(static_audio):
        print(f"    [NOT_READY] manifest audio is a Suno placeholder; skipping static fetch")
        not_ready.append("placeholder audio_url")
        static_audio = ""
    if need_audio and static_audio:
        ext = "m4a" if static_audio.endswith(".m4a") else "mp3"
        target_gs = gcs_path(handle, clip_id, ext)
        print(f"    [TRY] Static audio ({ext}): {static_audio[:80]}...")
        if stream_to_gcs(static_audio, target_gs, expected_seconds=duration, rejects=not_ready):
            print(f"    [OK] audio -> {target_gs}")
            result["audio"] = True
            need_audio = False
            static_ok = True
            result["audio_ext"] = ext
 
    if need_video and static_video:
        print(f"    [TRY] Static video: {static_video[:80]}...")
        if stream_to_gcs(static_video, video_gs, expected_seconds=duration):
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
    if not retained and (need_audio or need_video or need_thumb):
        print(f"    [PLAYWRIGHT] Intercepting streams for {clip_id}...")
        for attempt in range(1, MAX_RETRIES + 1):
            try:
                intercepted = await intercept_clip_media(clip_id, handle)
                if intercepted.get("placeholder_seen"):
                    not_ready.append("placeholder stream")
 
                if need_audio and intercepted.get("audio_bytes"):
                    ext = intercepted.get("audio_ext", "m4a")
                    target_gs = gcs_path(handle, clip_id, ext)
                    print(f"    [TRY] Browser-captured audio ({ext})")
                    if stream_bytes_to_gcs(intercepted["audio_bytes"], target_gs, expected_seconds=duration,
                                           rejects=not_ready):
                        print(f"    [OK] audio bytes -> {target_gs}")
                        result["audio"] = True
                        result["audio_ext"] = ext
                        need_audio = False

                if need_audio and intercepted.get("audio_url"):
                    ext = intercepted.get("audio_ext", "m4a")
                    target_gs = gcs_path(handle, clip_id, ext)
                    headers = intercepted.get("request_headers", {})
                    safe_headers = {
                        k: v for k, v in headers.items()
                        if k.lower() in ("referer", "accept", "user-agent", "origin")
                    }
                    print(f"    [TRY] Playwright audio URL ({ext}): {intercepted['audio_url'][:80]}...")
                    if stream_to_gcs(intercepted["audio_url"], target_gs, safe_headers, expected_seconds=duration,
                                     rejects=not_ready):
                        print(f"    [OK] audio -> {target_gs}")
                        result["audio"] = True
                        result["audio_ext"] = ext
                        need_audio = False
 
                if need_video and intercepted.get("video_url"):
                    print(f"    [TRY] Playwright video: {intercepted['video_url'][:80]}...")
                    if intercepted.get("video_bytes"):
                        if stream_bytes_to_gcs(intercepted["video_bytes"], video_gs, expected_seconds=duration):
                            print(f"    [OK] video bytes -> {video_gs}")
                            result["video"] = True
                            need_video = False
                    if need_video and stream_to_gcs(intercepted["video_url"], video_gs, expected_seconds=duration):
                        print(f"    [OK] video -> {video_gs}")
                        result["video"] = True
                        need_video = False
 
                if need_thumb and intercepted.get("thumb_bytes"):
                    print(f"    [TRY] Browser-captured thumb")
                    if stream_bytes_to_gcs(intercepted["thumb_bytes"], thumb_gs):
                        print(f"    [OK] thumb bytes -> {thumb_gs}")
                        result["thumb"] = True
                        need_thumb = False

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
 
    if need_audio and not retained and suno_wav.wav_enabled_for(handle):
        # Owned songs: ask Suno to render the WAV with the account cookie.
        wav_gs = gcs_path(handle, clip_id, "wav")
        try:
            wav_url = suno_wav.wav_url_for_clip(clip_id)
            print(f"    [TRY] Suno WAV render (owned account)")
            if stream_to_gcs(wav_url, wav_gs, expected_seconds=duration, rejects=not_ready):
                print(f"    [OK] audio -> {wav_gs}")
                result["audio"] = True
                result["audio_ext"] = "wav"
                need_audio = False
        except suno_wav.WavUnavailable as exc:
            print(f"    [INFO] WAV fallback unavailable: {exc}")
        except Exception as exc:
            print(f"    [WARN] WAV fallback error: {type(exc).__name__}", file=sys.stderr)

    if has_recovery and result["audio"] and result.get("audio_ext"):
        # Suno served the native file after a derived copy was in place: new version.
        result["native_after_recovery"] = True

    now_iso = datetime.now(timezone.utc).isoformat()
    if need_audio and has_recovery:
        # Derived copy keeps playing; schedule the next weekly native attempt.
        print(f"    [INFO] native audio still refused; derived copy stays, retry in 7 days")
        result["native_retry"] = derived_audio.next_native_retry(
            recovery_schedule["nativeRetry"], now_iso, "audio not captured")
        need_audio = False
    elif need_audio and not retained:
        # Native MP3 refused (CDN 403 or other error). Fall back to the stored, verified MP4.
        if gs_exists(video_gs) and gs_video_valid(video_gs, duration):
            try:
                rec = derived_audio.derive_listening_copy(
                    handle, clip_id, video_gs, duration, native_error="audio not captured")
                print(f"    [OK] derived listening copy -> {rec['derivedAudioUrl']}"
                      f"{' (reused)' if rec.get('reused') else ''}")
                result["audio"] = True
                result["audio_ext"] = "mp3"
                result["audio_recovery"] = rec
                need_audio = False
            except Exception as exc:
                print(f"    [FAIL] derive from video failed for {clip_id}: {exc}", file=sys.stderr)
        else:
            print(f"    [FAIL] no verified stored video to derive audio from", file=sys.stderr)

    # Log remaining failures
    if need_audio and not_ready:
        msg = f"audio not ready on Suno for {clip_id} (placeholder/stub; retry next night)"
        print(f"    [NOT_READY] {msg}")
        result["errors"].append(msg)
        result["not_ready"] = True
    elif need_audio:
        msg = f"audio not captured for {clip_id}"
        print(f"    [FAIL] {msg}", file=sys.stderr)
        result["errors"].append(msg)
    if need_video:
        msg = f"video not captured for {clip_id}"
        print(f"    [WARN] {msg}")  # video is optional
        result["video"] = False
        result["errors"].append(msg)
    if need_thumb:
        msg = f"thumb not captured for {clip_id}"
        print(f"    [WARN] {msg}")
        result["thumb"] = False
        result["errors"].append(msg)
 
    # Only "not ready" audio (nothing else wrong) is a warning, never a job failure.
    result["not_ready_only"] = bool(result.get("not_ready")) and not need_video and not need_thumb
    return result
 
 
def summarize_failures(results: list, ledger) -> tuple:
    """Return (hard, warnings). Chronic and not-ready failures are warnings."""
    if ledger is None:
        hard = [r for r in results if r.get("errors") and not r.get("not_ready_only")]
        warn = [r for r in results if r.get("errors") and r.get("not_ready_only")]
        return hard, warn
    return ledger.classify(results)


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
    ledger = ChronicFailureLedger(CHRONIC_LEDGER).load() if CHRONIC_LEDGER else None
    hard, warnings = summarize_failures(results, ledger)
    if ledger is not None:
        ledger.save()
 
    end_ts = datetime.now(timezone.utc).isoformat()
    print(f"""
===== DOWNLOAD REPORT [{end_ts}] =====
  Total clips  : {len(rows)}
  Audio OK     : {ok_audio}/{len(rows)}
  Video OK     : {ok_video}/{len(rows)}
  Thumb OK     : {ok_thumb}/{len(rows)}
  Clips w/ errs: {len(errors)}
  Hard errors  : {len(hard)}
  Warnings     : {len(warnings)} (not ready on Suno, or chronic repeat failures)
==========================================
""")
 
    if warnings:
        print("Clips with warnings (retried next night, do not fail the job):")
        for r in warnings:
            print(f"  {r['clip_id']}: {'; '.join(r['errors'])}")
    if hard:
        print("Clips with hard errors:")
        for r in hard:
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
        clip = row.get("songKey", "")
        if result.get("native_retry"):
            record_native_retry(clip, result["native_retry"])
        if result.get("native_after_recovery"):
            native_uri = gcs_path(row.get("handle", ""), clip, result.get("audio_ext") or "mp3")
            sha, gen = derived_audio.gs_sha256_and_generation(native_uri)
            if not (sha and gen and record_native_audio_version(
                    clip, native_uri, result.get("audio_ext") or "mp3", sha, gen)):
                result["errors"].append(f"native audio stored but version not recorded for {clip}")
        if result.get("audio") and not row.get("reason", "").startswith("retained:"):
            upsert_song_after_download(
                audio_recovery = result.get("audio_recovery"),
                clip_id        = row.get("songKey", ""),
                handle         = row.get("handle", ""),
                title          = row.get("title", ""),
                audio_ext      = result.get("audio_ext") or "mp3",
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
 
