#!/usr/bin/env python3
"""
Shared GCP token helper for local scripts and Cloud Run jobs.
"""

from __future__ import annotations

import json
import os
import subprocess
import time
import urllib.request

_TOKEN_CACHE = None
_TOKEN_EXPIRES_AT = 0.0
# Google access tokens live about 60 minutes. Long harvest steps (54-93 min)
# used to reuse the first token and hit HTTP 401 at the end of the run, so the
# cache now refreshes before expiry and can be invalidated after a 401.
_REFRESH_MARGIN_SECONDS = 300
_DEFAULT_LIFETIME_SECONDS = 45 * 60


def _metadata_server_token() -> str:
    req = urllib.request.Request(
        "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token",
        headers={"Metadata-Flavor": "Google"},
    )
    with urllib.request.urlopen(req, timeout=3) as response:
        payload = json.loads(response.read())
    _remember_lifetime(payload.get("expires_in"))
    return payload["access_token"]


def _remember_lifetime(expires_in) -> None:
    global _PENDING_LIFETIME
    try:
        _PENDING_LIFETIME = float(expires_in)
    except (TypeError, ValueError):
        _PENDING_LIFETIME = None


_PENDING_LIFETIME = None


def _adc_token() -> str:
    import google.auth
    from google.auth.transport.requests import Request

    creds, _project = google.auth.default(
        scopes=["https://www.googleapis.com/auth/cloud-platform"]
    )
    creds.refresh(Request())
    expiry = getattr(creds, "expiry", None)
    if expiry is not None:
        from datetime import datetime
        _remember_lifetime((expiry - datetime.utcnow()).total_seconds())
    return creds.token


def _gcloud_token() -> str:
    if os.name == "nt":
        return subprocess.check_output(
            ["cmd", "/c", "gcloud auth print-access-token"],
            text=True,
        ).strip()
    return subprocess.check_output(
        ["gcloud", "auth", "print-access-token"],
        text=True,
    ).strip()


def invalidate_access_token() -> None:
    """Drop the cached token, e.g. after an HTTP 401 from a Google API."""
    global _TOKEN_CACHE, _TOKEN_EXPIRES_AT
    _TOKEN_CACHE = None
    _TOKEN_EXPIRES_AT = 0.0


def get_access_token() -> str:
    global _TOKEN_CACHE, _TOKEN_EXPIRES_AT, _PENDING_LIFETIME
    if _TOKEN_CACHE and time.time() < _TOKEN_EXPIRES_AT - _REFRESH_MARGIN_SECONDS:
        return _TOKEN_CACHE

    explicit = (os.environ.get("ACCESS_TOKEN") or os.environ.get("TOKEN") or "").strip()
    if explicit:
        # An explicit token cannot be refreshed here; use it as given.
        _TOKEN_CACHE = explicit
        _TOKEN_EXPIRES_AT = float("inf")
        return _TOKEN_CACHE

    for resolver in (_metadata_server_token, _adc_token, _gcloud_token):
        try:
            _PENDING_LIFETIME = None
            token = resolver()
            if token:
                lifetime = _PENDING_LIFETIME or _DEFAULT_LIFETIME_SECONDS
                _TOKEN_CACHE = token
                _TOKEN_EXPIRES_AT = time.time() + lifetime
                return _TOKEN_CACHE
        except Exception:
            continue

    raise RuntimeError("Could not obtain GCP access token")
