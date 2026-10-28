#!/usr/bin/env python3
"""One-time: move the existing YouTube channel setup into one user's own record.

Writes (only with --apply; default is a dry run that prints the plan):
  users/{uid}/youtubeChannels/{key}      name, youtubeChannelId, tokenSecret, enabled
  users/{uid}/publishChannelMap/{acct}   channel
Existing docs are never overwritten (create-only precondition). Tokens are not
read or copied; tokenSecret only names the Secret Manager secret that already
holds the refresh token. Gravitys Truth is intentionally NOT added: it stays
blocked until its own channel is connected.

Usage:
  python migrate_channels_to_user.py --uid <thomasUid>            # dry run
  python migrate_channels_to_user.py --uid <thomasUid> --apply
"""
import argparse
import json
import sys
import urllib.error
import urllib.request
from datetime import datetime, timezone

import youtube_uploader as up
from youtube_publish_channels import user_channel_path, user_map_path

CHANNELS = {
    "sundrop_cloud": {
        "name": "sundrop cloud",
        "youtubeChannelId": "UCcFXR8PM5Hfwcy7WyaL7v8Q",
        "tokenSecret": "youtube-oauth-refresh-token",
    },
    "vanessa_secondary": {
        "name": "Vanessa secondary",
        "youtubeChannelId": "",
        "tokenSecret": "youtube-oauth-refresh-token-vanessa-secondary",
    },
}
# Same routing production used before this change, made explicit per account.
ACCOUNT_DEFAULTS = {
    "vanessa_primary": "sundrop_cloud",
    "genxdreams": "sundrop_cloud",
    "vanessa_secondary": "vanessa_secondary",
}


def plan(uid: str) -> list[tuple[str, dict]]:
    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    out = []
    for key, ch in CHANNELS.items():
        out.append((user_channel_path(uid, key), {
            "name": {"stringValue": ch["name"]},
            "youtubeChannelId": {"stringValue": ch["youtubeChannelId"]},
            "tokenSecret": {"stringValue": ch["tokenSecret"]},
            "enabled": {"booleanValue": True},
            "linkedVia": {"stringValue": "migration"},
            "createdAt": {"stringValue": now},
        }))
    for acct, key in ACCOUNT_DEFAULTS.items():
        out.append((user_map_path(uid, acct), {"channel": {"stringValue": key}, "updatedAt": {"stringValue": now}}))
    return out


def create_only(token: str, path: str, fields: dict) -> str:
    url = (f"https://firestore.googleapis.com/v1/projects/{up.PROJECT}/databases/{up.DATABASE}"
           f"/documents/{path}?currentDocument.exists=false")
    req = urllib.request.Request(url, data=json.dumps({"fields": fields}).encode(), method="PATCH",
                                 headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"})
    try:
        urllib.request.urlopen(req, timeout=15).read()
        return "created"
    except urllib.error.HTTPError as e:
        if e.code in (400, 409):
            return "exists (left unchanged)"
        raise


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--uid", required=True)
    ap.add_argument("--apply", action="store_true")
    args = ap.parse_args()
    steps = plan(args.uid)
    token = up.get_gcp_token() if args.apply else ""
    for path, fields in steps:
        summary = {k: list(v.values())[0] for k, v in fields.items()}
        if args.apply:
            print(f"{create_only(token, path, fields):28s} {path}")
        else:
            print(f"[dry-run] would create {path} {summary}")
    if not args.apply:
        print("Dry run only. Re-run with --apply to write.", file=sys.stderr)


if __name__ == "__main__":
    main()
