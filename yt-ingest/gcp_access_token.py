#!/usr/bin/env python3
"""
Shared GCP token helper for local scripts and Cloud Run jobs.
"""

from __future__ import annotations

import json
import os
import subprocess
import urllib.request

_TOKEN_CACHE = None


def _metadata_server_token() -> str:
    req = urllib.request.Request(
        "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token",
        headers={"Metadata-Flavor": "Google"},
    )
    with urllib.request.urlopen(req, timeout=3) as response:
        return json.loads(response.read())["access_token"]


def _adc_token() -> str:
    import google.auth
    from google.auth.transport.requests import Request

    creds, _project = google.auth.default(
        scopes=["https://www.googleapis.com/auth/cloud-platform"]
    )
    creds.refresh(Request())
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


def get_access_token() -> str:
    global _TOKEN_CACHE
    if _TOKEN_CACHE:
        return _TOKEN_CACHE

    explicit = (os.environ.get("ACCESS_TOKEN") or os.environ.get("TOKEN") or "").strip()
    if explicit:
        _TOKEN_CACHE = explicit
        return _TOKEN_CACHE

    for resolver in (_metadata_server_token, _adc_token, _gcloud_token):
        try:
            token = resolver()
            if token:
                _TOKEN_CACHE = token
                return _TOKEN_CACHE
        except Exception:
            continue

    raise RuntimeError("Could not obtain GCP access token")
