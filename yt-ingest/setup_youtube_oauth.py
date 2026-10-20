#!/usr/bin/env python3
"""
Mint a YouTube OAuth refresh token for the Aeonimus uploader and optionally
store it in Secret Manager.

This script is intended for AEGIS-011 and the Vault -> YouTube publish path.
It uses the Desktop OAuth client stored in Secret Manager and requests both:
- youtube.upload
- youtube.force-ssl

Usage:
  python setup_youtube_oauth.py
  python setup_youtube_oauth.py --print-only
  python setup_youtube_oauth.py --update-secret
  python setup_youtube_oauth.py --update-secret --no-browser
"""

from __future__ import annotations

import argparse
import json
import sys
import urllib.parse
import urllib.request

from google_auth_oauthlib.flow import InstalledAppFlow

from gcp_access_token import get_access_token

PROJECT = "stable-framing-482501-t9"
SECRET_CLIENT = "youtube-oauth-client-secrets"
SECRET_OAUTH = "youtube-oauth-refresh-token"
PUBLISH_CHANNEL_SECRETS = {
    "vanessa_primary": SECRET_OAUTH,
    "vanessa_secondary": "youtube-oauth-refresh-token-vanessa-secondary",
}
SCOPES = [
    "https://www.googleapis.com/auth/youtube.upload",
    "https://www.googleapis.com/auth/youtube.force-ssl",
]
PLAYGROUND_REDIRECT_URI = "https://developers.google.com/oauthplayground"


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


def add_secret_version(gcp_token: str, secret_id: str, value: str) -> None:
    import base64

    url = (
        f"https://secretmanager.googleapis.com/v1/projects/{PROJECT}"
        f"/secrets/{secret_id}:addVersion"
    )
    payload = {
        "payload": {
            "data": base64.b64encode(value.encode("utf-8")).decode("ascii"),
        }
    }
    body = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=body,
        method="POST",
        headers={
            "Authorization": f"Bearer {gcp_token}",
            "Content-Type": "application/json",
        },
    )
    with urllib.request.urlopen(req, timeout=15):
        return


def mint_refresh_token_with_options(client_config: dict, open_browser: bool) -> str:
    flow = InstalledAppFlow.from_client_config(client_config, SCOPES)
    print(
        "\nA local OAuth callback server will start on localhost."
        "\nComplete the Google consent flow in your browser to mint the refresh token.\n"
    )
    creds = flow.run_local_server(
        host="localhost",
        port=0,
        access_type="offline",
        prompt="consent",
        open_browser=open_browser,
        authorization_prompt_message="Open this URL in your browser:\n{url}\n",
        success_message="Authorization complete. You can close this window.",
    )
    if not creds.refresh_token:
        raise RuntimeError(
            "No refresh token was returned. Revoke prior consent for this app and retry."
        )
    return creds.refresh_token


def build_manual_auth_url(client: dict) -> str:
    params = {
        "client_id": client["client_id"],
        "redirect_uri": PLAYGROUND_REDIRECT_URI,
        "response_type": "code",
        "scope": " ".join(SCOPES),
        "access_type": "offline",
        "prompt": "consent",
        "include_granted_scopes": "true",
    }
    return f"{client['auth_uri']}?{urllib.parse.urlencode(params)}"


def exchange_manual_code(client: dict, code: str) -> str:
    body = urllib.parse.urlencode(
        {
            "client_id": client["client_id"],
            "client_secret": client["client_secret"],
            "code": code.strip(),
            "grant_type": "authorization_code",
            "redirect_uri": PLAYGROUND_REDIRECT_URI,
        }
    ).encode("utf-8")
    req = urllib.request.Request(
        client["token_uri"],
        data=body,
        method="POST",
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )
    with urllib.request.urlopen(req, timeout=20) as response:
        payload = json.loads(response.read())
    refresh_token = str(payload.get("refresh_token", "")).strip()
    if not refresh_token:
        raise RuntimeError(
            "No refresh token returned from authorization_code exchange. "
            "Try revoking prior consent for this app and retrying with prompt=consent."
        )
    return refresh_token


def mint_refresh_token(client_config: dict, open_browser: bool) -> str:
    if "installed" in client_config:
        return mint_refresh_token_with_options(client_config, open_browser=open_browser)

    client = client_config.get("web") or {}
    redirect_uris = client.get("redirect_uris", [])
    if PLAYGROUND_REDIRECT_URI not in redirect_uris:
        raise RuntimeError(
            "Stored YouTube OAuth client is a web client without a supported redirect URI for this helper."
        )

    auth_url = build_manual_auth_url(client)
    print(
        "\nStored OAuth client is a web client.\n"
        "Open this URL in an Incognito/InPrivate browser window, sign in as the publishing account,\n"
        "and complete consent. After Google redirects to OAuth Playground, copy the `code=` value\n"
        "from the redirected URL and paste it below.\n"
    )
    print(auth_url)
    print()
    code = input("Paste the authorization code: ").strip()
    if not code:
        raise RuntimeError("No authorization code provided.")
    return exchange_manual_code(client, code)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--print-only",
        action="store_true",
        help="Print the minted refresh token without updating Secret Manager.",
    )
    parser.add_argument(
        "--update-secret",
        action="store_true",
        help="Write the minted refresh token to Secret Manager.",
    )
    parser.add_argument(
        "--no-browser",
        action="store_true",
        help="Do not auto-open the browser; print the consent URL instead.",
    )
    parser.add_argument(
        "--channel",
        choices=sorted(PUBLISH_CHANNEL_SECRETS.keys()),
        default="vanessa_primary",
        help="Publish channel / account label to store OAuth credentials for.",
    )
    args = parser.parse_args()

    gcp_token = get_access_token()
    client_json = get_secret(gcp_token, SECRET_CLIENT)
    client_config = json.loads(client_json)

    print("Minting YouTube refresh token with scopes:")
    for scope in SCOPES:
        print(f"- {scope}")

    refresh_token = mint_refresh_token(client_config, open_browser=not args.no_browser)

    if args.print_only and not args.update_secret:
        print("\nRefresh token:")
        print(refresh_token)
        return 0

    if args.update_secret:
        target_secret = PUBLISH_CHANNEL_SECRETS[args.channel]
        add_secret_version(gcp_token, target_secret, refresh_token)
        print(f"\nUpdated Secret Manager secret: {target_secret} (channel={args.channel})")
        return 0

    print("\nRefresh token minted successfully.")
    print("Re-run with --update-secret to store it in Secret Manager, or --print-only to print it.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
