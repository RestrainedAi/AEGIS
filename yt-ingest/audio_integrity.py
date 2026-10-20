"""Fail-closed validation of native audio and song videos before harvest acceptance."""
import json
import math
import shutil
import subprocess


class InvalidAudio(ValueError):
    pass


def expected_duration(row):
    for key in ("duration", "durationSeconds", "duration_seconds"):
        try:
            value = float(row.get(key, 0))
            if math.isfinite(value) and value > 0:
                return value
        except (TypeError, ValueError):
            pass
    return None


def validate_audio(path, expected_seconds=None):
    """Require an audio stream, full decode, and plausible decoded duration.

    Unknown-duration clips must exceed one second. With provider duration, allow
    at most 2 seconds difference for encoder padding/metadata rounding.
    This verifies decodability/completeness, not audible content or attribution.
    """
    probe = shutil.which("ffprobe")
    decoder = shutil.which("ffmpeg")
    if not probe or not decoder:
        raise InvalidAudio("audio validation requires ffprobe and ffmpeg")
    try:
        result = subprocess.run(
            [probe, "-v", "error", "-select_streams", "a:0", "-show_entries",
             "stream=codec_type", "-of", "json", str(path)],
            capture_output=True, text=True, timeout=30,
        )
        if result.returncode or not json.loads(result.stdout).get("streams"):
            raise InvalidAudio("no readable audio stream")
        decoded = subprocess.run(
            [decoder, "-v", "error", "-xerror", "-nostdin", "-i", str(path),
             "-map", "0:a:0", "-progress", "pipe:1", "-f", "null", "-"],
            capture_output=True, text=True, timeout=180,
        )
        if decoded.returncode:
            raise InvalidAudio("audio failed full decode")
        times = [int(line.split("=", 1)[1]) / 1_000_000
                 for line in decoded.stdout.splitlines()
                 if line.startswith("out_time_us=") and line.split("=", 1)[1].lstrip("-").isdigit()]
        duration = max(times, default=0)
        if not math.isfinite(duration) or duration < 1:
            raise InvalidAudio(f"audio is a stub or too short: {duration:.3f}s")
        if expected_seconds is not None:
            tolerance = 2.0
            if abs(duration - expected_seconds) > tolerance:
                raise InvalidAudio(f"audio duration {duration:.3f}s differs from expected {expected_seconds:.3f}s")
        return duration
    except (subprocess.TimeoutExpired, OSError, ValueError) as exc:
        if isinstance(exc, InvalidAudio):
            raise
        raise InvalidAudio(f"audio validation failed: {type(exc).__name__}") from exc


def validate_video(path, expected_seconds=None):
    """Require full-length decodable video AND audio for a song video.

    A renamed image, audio-only payload, silent video, or truncated video track
    must not qualify as an acquired song MP4. Original bytes are never altered.
    """
    audio_duration = validate_audio(path, expected_seconds)
    probe, decoder = shutil.which("ffprobe"), shutil.which("ffmpeg")
    try:
        result = subprocess.run(
            [probe, "-v", "error", "-select_streams", "v:0", "-show_entries",
             "stream=codec_type,width,height:stream_disposition=attached_pic", "-of", "json", str(path)],
            capture_output=True, text=True, timeout=30,
        )
        streams = json.loads(result.stdout).get("streams", []) if result.returncode == 0 else []
        if not streams or streams[0].get("disposition", {}).get("attached_pic") or not streams[0].get("width") or not streams[0].get("height"):
            raise InvalidAudio("no readable motion-video stream")
        decoded = subprocess.run(
            [decoder, "-v", "error", "-xerror", "-nostdin", "-i", str(path),
             "-map", "0:v:0", "-progress", "pipe:1", "-f", "null", "-"],
            capture_output=True, text=True, timeout=180,
        )
        if decoded.returncode:
            raise InvalidAudio("video failed full decode")
        times = [int(line.split("=", 1)[1]) / 1_000_000
                 for line in decoded.stdout.splitlines()
                 if line.startswith("out_time_us=") and line.split("=", 1)[1].lstrip("-").isdigit()]
        duration = max(times, default=0)
        if duration < 1:
            raise InvalidAudio(f"video is a stub or too short: {duration:.3f}s")
        reference = expected_seconds if expected_seconds is not None else audio_duration
        if abs(duration - reference) > 2.0:
            raise InvalidAudio(f"video duration {duration:.3f}s differs from expected/audio {reference:.3f}s")
        return {"audio_seconds": audio_duration, "video_seconds": duration}
    except (subprocess.TimeoutExpired, OSError, ValueError) as exc:
        if isinstance(exc, InvalidAudio):
            raise
        raise InvalidAudio(f"video validation failed: {type(exc).__name__}") from exc
