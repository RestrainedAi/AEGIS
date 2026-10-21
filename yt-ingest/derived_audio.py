#!/usr/bin/env python3
"""Derive a listening-copy MP3 from a stored, verified MP4 when Suno refuses the native MP3.

Never overwrites: every object is written with no-clobber (`gsutil cp -n`) under a
content-addressed path, and an existing derived copy made from the same source
video bytes is reused instead of re-encoding. Uses the LGPL ffmpeg build only.

Layout (same as the 17 recovered Oct 20, 2026):
  gs://<bucket>/suno/handles/<handle>/derived/<id>/<derivedSha256>/listening-copy.mp3
  gs://<bucket>/suno/handles/<handle>/derived/<id>/<derivedSha256>/provenance.json
"""
from __future__ import annotations

import hashlib
import json
import os
import shutil
import subprocess
import tempfile
from datetime import datetime, timedelta, timezone
from pathlib import Path

BUCKET = os.environ.get("SUNO_MEDIA_BUCKET", "gs://aeonimus-suno-media").rstrip("/")
GSUTIL = shutil.which("gsutil") or shutil.which("gsutil.cmd") or "gsutil"
FFMPEG = os.environ.get("FFMPEG_BIN") or shutil.which("ffmpeg") or "ffmpeg"
NATIVE_RETRY_INTERVAL = timedelta(days=7)
DERIVE_KIND = "derived-from-video"


class DeriveError(RuntimeError):
    pass


def _run(cmd, run=subprocess.run, **kw):
    return run(cmd, capture_output=True, text=True, **kw)


def ffmpeg_license_ok(run=subprocess.run) -> tuple[bool, str]:
    """Only an LGPL build (no --enable-gpl / --enable-nonfree) with libmp3lame is allowed."""
    try:
        version = _run([FFMPEG, "-hide_banner", "-version"], run, timeout=30)
        encoders = _run([FFMPEG, "-hide_banner", "-encoders"], run, timeout=30)
    except (OSError, subprocess.SubprocessError) as exc:
        return False, f"ffmpeg unavailable: {type(exc).__name__}"
    text = version.stdout or ""
    if version.returncode or not text.startswith("ffmpeg version"):
        return False, "ffmpeg unavailable"
    if "--enable-gpl" in text or "--enable-nonfree" in text:
        return False, "ffmpeg is a GPL/nonfree build; refusing (LGPL build required)"
    if "libmp3lame" not in (encoders.stdout or ""):
        return False, "ffmpeg build lacks libmp3lame"
    return True, text.splitlines()[0].strip()


def derived_prefix(handle: str, clip_id: str) -> str:
    return f"{BUCKET}/suno/handles/{handle}/derived/{clip_id}"


def sha256_file(path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def gs_generation(uri: str, run=subprocess.run) -> str:
    r = _run([GSUTIL, "stat", uri], run, timeout=60)
    if r.returncode:
        return ""
    for line in r.stdout.splitlines():
        if line.strip().startswith("Generation:"):
            return line.split(":", 1)[1].strip()
    return ""


def gs_sha256_and_generation(uri: str, run=subprocess.run) -> tuple[str, str]:
    """Pin a stored object by generation and content hash (downloads that exact generation)."""
    gen = gs_generation(uri, run)
    if not gen:
        return "", ""
    with tempfile.TemporaryDirectory(prefix="suno-pin-") as tmp:
        path = Path(tmp) / "obj"
        r = _run([GSUTIL, "-q", "cp", f"{uri}#{gen}", str(path)], run, timeout=600)
        if r.returncode or not path.exists():
            return "", gen
        return sha256_file(path), gen


def find_existing_derived(handle, clip_id, source_video_sha256, run=subprocess.run):
    """Return the provenance of an existing derived copy made from these exact video bytes."""
    r = _run([GSUTIL, "ls", f"{derived_prefix(handle, clip_id)}/*/provenance.json"], run, timeout=60)
    if r.returncode:
        return None
    for uri in sorted(x.strip() for x in r.stdout.splitlines() if x.strip()):
        cat = _run([GSUTIL, "cat", uri], run, timeout=60)
        if cat.returncode:
            continue
        try:
            prov = json.loads(cat.stdout)
        except ValueError:
            continue
        rec = prov.get("audioRecovery") or {}
        if (rec.get("kind") == DERIVE_KIND and rec.get("sourceVideoSha256") == source_video_sha256
                and rec.get("derivedAudioUrl")):
            return prov
    return None


def _cp_no_clobber(src, dst, run):
    r = _run([GSUTIL, "-q", "cp", "-n", str(src), dst], run, timeout=300)
    if r.returncode:
        raise DeriveError(f"upload failed for {dst.rsplit('/', 1)[-1]}")


def build_recovery(handle, clip_id, video_uri, video_gen, video_sha, derived_uri, derived_sha,
                   provenance_uri, verified_at, native_error="") -> dict:
    return {
        "kind": DERIVE_KIND,
        "nativeOriginal": False,
        "originalMissing": True,
        "originalAudioUrl": f"{BUCKET}/suno/handles/{handle}/{clip_id}.mp3",
        "originalGeneration": "",
        "originalSha256": "",
        "sourceVideoUrl": video_uri,
        "sourceVideoGeneration": video_gen,
        "sourceVideoSha256": video_sha,
        "derivedAudioUrl": derived_uri,
        "derivedSha256": derived_sha,
        "provenanceUrl": provenance_uri,
        "verifiedAt": verified_at,
        "nativeRetry": next_native_retry({}, verified_at, native_error),
    }


def next_native_retry(previous: dict, at_iso: str, last_result: str = "") -> dict:
    at = datetime.fromisoformat(at_iso.replace("Z", "+00:00"))
    return {
        "lastAttemptAt": at_iso,
        "nextAttemptAt": (at + NATIVE_RETRY_INTERVAL).isoformat(),
        "attempts": int((previous or {}).get("attempts") or 0) + 1,
        "lastResult": (last_result or "native audio not served")[:200],
    }


def native_retry_due(recovery: dict | None, now: datetime | None = None) -> bool:
    """True when the weekly native-MP3 retry is due (or no schedule exists yet)."""
    if not isinstance(recovery, dict) or recovery.get("kind") != DERIVE_KIND:
        return True
    nxt = (recovery.get("nativeRetry") or {}).get("nextAttemptAt")
    if not nxt:
        return True
    now = now or datetime.now(timezone.utc)
    try:
        return now >= datetime.fromisoformat(str(nxt).replace("Z", "+00:00"))
    except ValueError:
        return True


def derive_listening_copy(handle, clip_id, video_uri, expected_seconds=None, *, native_error="",
                          run=subprocess.run, validate=None, now=None) -> dict:
    """Returns the media.audioRecovery dict. Raises DeriveError when it cannot be done safely."""
    ok, encoder = ffmpeg_license_ok(run)
    if not ok:
        raise DeriveError(encoder)
    if validate is None:
        from audio_integrity import validate_audio as validate
    at = (now or datetime.now(timezone.utc)).isoformat()
    with tempfile.TemporaryDirectory(prefix="suno-derive-") as tmp:
        mp4 = Path(tmp) / "source.mp4"
        gen = gs_generation(video_uri, run)
        if not gen:
            raise DeriveError("source video generation unknown")
        r = _run([GSUTIL, "-q", "cp", f"{video_uri}#{gen}", str(mp4)], run, timeout=600)
        if r.returncode or not mp4.exists() or mp4.stat().st_size == 0:
            raise DeriveError("source video download failed")
        video_sha = sha256_file(mp4)

        existing = find_existing_derived(handle, clip_id, video_sha, run)
        if existing:
            rec = dict(existing["audioRecovery"])
            rec.setdefault("originalMissing", True)
            rec["nativeRetry"] = next_native_retry(rec.get("nativeRetry") or {}, at, native_error)
            rec["reused"] = True
            return rec

        mp3 = Path(tmp) / "listening-copy.mp3"
        enc = _run([FFMPEG, "-nostdin", "-hide_banner", "-v", "error", "-i", str(mp4), "-map", "0:a:0",
                    "-vn", "-c:a", "libmp3lame", "-q:a", "0", str(mp3)], run, timeout=900)
        if enc.returncode or not mp3.exists() or mp3.stat().st_size == 0:
            raise DeriveError("ffmpeg could not extract audio from the stored video")
        validate(str(mp3), expected_seconds)
        derived_sha = sha256_file(mp3)
        base = f"{derived_prefix(handle, clip_id)}/{derived_sha}"
        derived_uri, prov_uri = f"{base}/listening-copy.mp3", f"{base}/provenance.json"
        rec = build_recovery(handle, clip_id, video_uri, gen, video_sha, derived_uri, derived_sha,
                             prov_uri, at, native_error)
        prov = {
            "uuid": clip_id,
            "account_sourceId": f"suno_{handle}",
            "audioRecovery": {k: v for k, v in rec.items() if k != "nativeRetry"},
            "encoder": f"{encoder} (LGPL build) libmp3lame VBR q0",
            "label": "Derived listening copy from preserved source video; native MP3 remains incomplete",
            "limitations": "Derived listening copy; Suno provided no native MP3 (empty audio_url / CDN 403).",
            "createdBy": "download_media_gcs.py derive fallback",
        }
        if expected_seconds:
            prov["duration_seconds"] = expected_seconds
        prov_path = Path(tmp) / "provenance.json"
        prov_path.write_text(json.dumps(prov, indent=2, sort_keys=True), encoding="utf-8")
        _cp_no_clobber(mp3, derived_uri, run)       # content-addressed: same bytes, same path
        _cp_no_clobber(prov_path, prov_uri, run)
        return rec
