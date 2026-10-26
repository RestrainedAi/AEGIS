"""Small, dependency-free helpers that keep the nightly harvest honest.

* Suno "not ready" placeholders (``sil-100.mp3`` and friends) are recognised so
  they are never uploaded and the song is simply retried next night.
* Rate-limit replies ("Too many requests") are recognised for backoff.
* A chronic-failure ledger turns clips that keep failing night after night
  into warnings, so the job exit code only reflects *new* problems.
"""
from __future__ import annotations

import json
import os
import re
import subprocess
import shutil
from datetime import datetime, timezone
from pathlib import Path

# Suno serves a short silent file (cdn-o.suno.com/sil-100.mp3) when it will not
# hand out the real audio yet. Any sil-<n>.mp3 is treated the same way.
_PLACEHOLDER_RE = re.compile(r"/sil-\d+\.(mp3|m4a|wav)(\?|$)", re.IGNORECASE)
_FORBIDDEN_RE = re.compile(r"/api/forbidden/?(\?|$)", re.IGNORECASE)


def is_placeholder_audio_url(url) -> bool:
    """True for Suno's silent stand-in or 'forbidden' audio URLs."""
    text = str(url or "").strip()
    if not text:
        return False
    return bool(_PLACEHOLDER_RE.search(text) or _FORBIDDEN_RE.search(text))


def is_rate_limited(payload) -> bool:
    """True when a Suno API payload is a throttle reply rather than data."""
    if not isinstance(payload, dict):
        return False
    detail = " ".join(str(payload.get(k) or "") for k in ("detail", "message", "error", "error_type"))
    detail = detail.lower()
    return "too many requests" in detail or "rate limit" in detail or str(payload.get("status_code")) == "429"


def backoff_seconds(attempt: int, base: float = 15.0, cap: float = 240.0) -> float:
    """Exponential backoff: 15s, 30s, 60s, 120s, 240s (capped)."""
    return min(cap, base * (2 ** max(0, attempt - 1)))


# -- Chronic failure ledger ----------------------------------------------------
CHRONIC_THRESHOLD = int(os.environ.get("CHRONIC_FAILURE_THRESHOLD", "3") or 3)


class ChronicFailureLedger:
    """Tracks consecutive nightly failures per clip.

    A clip that has already failed ``threshold`` nights in a row is *chronic*:
    its failure is still logged (and retried) but no longer fails the job.
    Storage is a JSON document either on local disk or in GCS (gs://...).
    """

    def __init__(self, location: str | None, threshold: int = CHRONIC_THRESHOLD, now=None):
        self.location = location or ""
        self.threshold = max(1, int(threshold))
        self.now = now or (lambda: datetime.now(timezone.utc).isoformat())
        self.entries: dict = {}
        self.loaded = False

    # storage -------------------------------------------------------------
    def _read_text(self) -> str | None:
        if not self.location:
            return None
        if self.location.startswith("gs://"):
            gsutil = shutil.which("gsutil") or shutil.which("gsutil.cmd") or "gsutil"
            proc = subprocess.run([gsutil, "-q", "cat", self.location], capture_output=True, timeout=60)
            return proc.stdout.decode("utf-8") if proc.returncode == 0 else None
        path = Path(self.location)
        return path.read_text(encoding="utf-8") if path.exists() else None

    def _write_text(self, text: str) -> bool:
        if not self.location:
            return False
        if self.location.startswith("gs://"):
            gsutil = shutil.which("gsutil") or shutil.which("gsutil.cmd") or "gsutil"
            proc = subprocess.run([gsutil, "-q", "-h", "Content-Type:application/json", "cp", "-", self.location],
                                  input=text.encode("utf-8"), capture_output=True, timeout=60)
            return proc.returncode == 0
        path = Path(self.location)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding="utf-8")
        return True

    def load(self) -> "ChronicFailureLedger":
        try:
            text = self._read_text()
            data = json.loads(text) if text else {}
            self.entries = dict(data.get("clips") or {}) if isinstance(data, dict) else {}
        except Exception as exc:  # unreadable ledger must never break the harvest
            print(f"  [CHRONIC] ledger unreadable ({type(exc).__name__}); starting fresh")
            self.entries = {}
        self.loaded = True
        return self

    def save(self) -> bool:
        doc = {"updatedAt": self.now(), "threshold": self.threshold, "clips": self.entries}
        try:
            return self._write_text(json.dumps(doc, indent=2, sort_keys=True))
        except Exception as exc:
            print(f"  [CHRONIC] ledger not saved ({type(exc).__name__})")
            return False

    # policy --------------------------------------------------------------
    def is_chronic(self, clip_id: str) -> bool:
        entry = self.entries.get(clip_id) or {}
        return int(entry.get("consecutive", 0)) >= self.threshold

    def record(self, clip_id: str, errors: list) -> None:
        if errors:
            entry = dict(self.entries.get(clip_id) or {})
            entry["consecutive"] = int(entry.get("consecutive", 0)) + 1
            entry.setdefault("firstFailedAt", self.now())
            entry["lastFailedAt"] = self.now()
            entry["lastErrors"] = [str(e)[:200] for e in errors][:5]
            self.entries[clip_id] = entry
        else:
            self.entries.pop(clip_id, None)

    def classify(self, results: list) -> tuple[list, list]:
        """Split failing results into (hard, warnings) using the ledger state
        from *before* this run, then record this run's outcome."""
        hard, warn = [], []
        for r in results:
            clip = r.get("clip_id", "")
            errs = list(r.get("errors") or [])
            if errs:
                if r.get("not_ready_only") or self.is_chronic(clip):
                    warn.append(r)
                else:
                    hard.append(r)
            self.record(clip, errs)
        return hard, warn
