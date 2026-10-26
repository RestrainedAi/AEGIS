"""WAV fallback for songs owned by the account behind SUNO_CLIENT_COOKIE.

Verified 2026-10-26: with a Suno ``__client`` cookie, Suno's
``/api/gen/{id}/convert_wav/`` + ``/api/gen/{id}/wav_file/`` endpoints return a
real WAV for songs that account owns (gravitystruth). For songs owned by other
accounts (e.g. nessihenize) both endpoints answer 403 "Not allowed", so the
fallback is only attempted for handles listed in SUNO_WAV_HANDLES.

The cookie is read from the environment only and is never logged.
"""
from __future__ import annotations

import json
import os
import time
import urllib.error
import urllib.request

CLERK_BASE = "https://clerk.suno.com/v1"
CLERK_JS = "5.0.0"
STUDIO = "https://studio-api.prod.suno.com/api"
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36"


class WavUnavailable(Exception):
    """Raised when no WAV can be produced (not owned, no cookie, timeout...)."""


def wav_handles() -> set:
    raw = os.environ.get("SUNO_WAV_HANDLES", "gravitystruth")
    return {h.strip().lower() for h in raw.split(",") if h.strip()}


def wav_enabled_for(handle: str) -> bool:
    return bool(os.environ.get("SUNO_CLIENT_COOKIE")) and str(handle or "").lower() in wav_handles()


def _http(url, method="GET", headers=None, data=None, timeout=30):
    h = {"User-Agent": UA}
    h.update(headers or {})
    req = urllib.request.Request(url, method=method, headers=h, data=data)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.status, resp.read()
    except urllib.error.HTTPError as exc:
        return exc.code, exc.read()


def _cookie_header() -> str:
    raw = os.environ.get("SUNO_CLIENT_COOKIE", "").strip()
    if not raw:
        raise WavUnavailable("SUNO_CLIENT_COOKIE not set")
    return raw if "__client=" in raw else f"__client={raw}"


def session_jwt(http=_http) -> str:
    cookie = _cookie_header()
    base_headers = {"Cookie": cookie, "Origin": "https://suno.com"}
    status, body = http(f"{CLERK_BASE}/client?_clerk_js_version={CLERK_JS}", headers=base_headers)
    if status != 200:
        raise WavUnavailable(f"clerk client lookup failed ({status})")
    sid = ((json.loads(body) or {}).get("response") or {}).get("last_active_session_id")
    if not sid:
        raise WavUnavailable("cookie has no active Suno session")
    status, body = http(f"{CLERK_BASE}/client/sessions/{sid}/tokens?_clerk_js_version={CLERK_JS}",
                        method="POST", headers=dict(base_headers, **{"Content-Type": "application/x-www-form-urlencoded"}),
                        data=b"")
    jwt = (json.loads(body) or {}).get("jwt") if status == 200 else None
    if not jwt:
        raise WavUnavailable(f"session token request failed ({status})")
    return jwt


def wav_url_for_clip(clip_id: str, http=_http, sleep=time.sleep, polls: int = 12, interval: float = 5.0) -> str:
    """Ask Suno to render the WAV and return its download URL."""
    auth = {"Authorization": f"Bearer {session_jwt(http)}", "Origin": "https://suno.com",
            "Referer": "https://suno.com/"}
    status, body = http(f"{STUDIO}/gen/{clip_id}/convert_wav/", method="POST", headers=auth)
    if status in (401, 403, 404):
        raise WavUnavailable(f"convert_wav refused ({status})")
    for _ in range(max(1, polls)):
        status, body = http(f"{STUDIO}/gen/{clip_id}/wav_file/", headers=auth)
        if status in (401, 403, 404):
            raise WavUnavailable(f"wav_file refused ({status})")
        if status == 200:
            try:
                url = (json.loads(body) or {}).get("wav_file_url")
            except ValueError:
                url = None
            if url:
                return url
        sleep(interval)
    raise WavUnavailable("WAV not ready before timeout")
