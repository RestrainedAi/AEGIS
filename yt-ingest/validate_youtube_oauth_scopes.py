#!/usr/bin/env python3
"""
Validate the production YouTube OAuth refresh-token path and report active scopes.

This is an operator-facing preflight for AEGIS-011 so we can verify whether the
stored refresh token is authorized for:
- video upload
- caption insertion

Usage:
  python validate_youtube_oauth_scopes.py
  python validate_youtube_oauth_scopes.py --json
"""

from __future__ import annotations

import argparse
import json
import sys
import urllib.parse
import urllib.request

from gcp_access_token import get_access_token

PROJECT = "stable-framing-482501-t9"
SECRET_OAUTH = "youtube-oauth-refresh-token"
SECRET_CLIENT = "youtube-oauth-client-secrets"
YT_TOKEN_URL = "https://oauth2.googleapis.com/token"
YT_TOKENINFO_URL = "https://oauth2.googleapis.com/tokeninfo"
YT_SCOPE_UPLOAD = "https://www.googleapis.com/auth/youtube.upload"
YT_SCOPE_CAPTIONS = "https://www.googleapis.com/auth/youtube.force-ssl"
REQUIRED_SCOPES = [YT_SCOPE_UPLOAD, YT_SCOPE_CAPTIONS]


def get_secret(gcp_token: str, secret_id: str) -> str:
    url = (
        f"https://secretmanager.googleapis.com/v1/projects/{PROJECT}"
        f"/secrets/{secret_id}/versions/latest:access"
    )
    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {gcp_token}"})
    with urllib.request.urlopen(req, timeout=15) as response:
        data = json.loads(response.read())
    import base64

    return base64.b64decode(data["payload"]["data"]).decode("utf-8")


def exchange_refresh_token(gcp_token: str) -> str:
    client_secrets = json.loads(get_secret(gcp_token, SECRET_CLIENT))
    installed = client_secrets.get("installed") or client_secrets.get("web") or {}
    refresh_token = get_secret(gcp_token, SECRET_OAUTH).strip()
    body = urllib.parse.urlencode(
        {
            "client_id": installed["client_id"],
            "client_secret": installed["client_secret"],
            "refresh_token": refresh_token,
            "grant_type": "refresh_token",
        }
    ).encode()
    req = urllib.request.Request(
        YT_TOKEN_URL,
        data=body,
        method="POST",
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )
    with urllib.request.urlopen(req, timeout=15) as response:
        payload = json.loads(response.read())
    return payload["access_token"]


def get_token_scopes(access_token: str) -> list[str]:
    query = urllib.parse.urlencode({"access_token": access_token})
    req = urllib.request.Request(f"{YT_TOKENINFO_URL}?{query}")
    with urllib.request.urlopen(req, timeout=15) as response:
        payload = json.loads(response.read())
    raw_scope = str(payload.get("scope", "")).strip()
    if not raw_scope:
        return []
    return sorted({part.strip() for part in raw_scope.split() if part.strip()})


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--json", action="store_true", help="Emit machine-readable JSON")
    args = parser.parse_args()

    gcp_token = get_access_token()
    access_token = exchange_refresh_token(gcp_token)
    scopes = get_token_scopes(access_token)
    scope_set = set(scopes)
    missing = [scope for scope in REQUIRED_SCOPES if scope not in scope_set]

    result = {
        "project": PROJECT,
        "requiredScopes": REQUIRED_SCOPES,
        "activeScopes": scopes,
        "missingScopes": missing,
        "ok": not missing,
    }

    if args.json:
        print(json.dumps(result, indent=2))
    else:
        print("YouTube OAuth scope validation")
        print(f"Project: {PROJECT}")
        print("Required scopes:")
        for scope in REQUIRED_SCOPES:
            print(f"- {scope}")
        print("Active scopes:")
        if scopes:
            for scope in scopes:
                print(f"- {scope}")
        else:
            print("- <none returned>")
        if missing:
            print("Missing scopes:")
            for scope in missing:
                print(f"- {scope}")
        else:
            print("Missing scopes: none")

    return 0 if not missing else 2


if __name__ == "__main__":
    sys.exit(main())
