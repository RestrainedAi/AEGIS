"""Resolve the YouTube channel (and its OAuth token secret) for a publish.

Nothing is hardcoded and everything is per user (multi-tenant). In Firestore:
  users/{uid}/youtubeChannels/{channelKey}  -> name, youtubeChannelId, tokenSecret, enabled
  users/{uid}/publishChannelMap/{account}   -> channel  (that user's default per Suno account)
tokenSecret is a Secret Manager secret ID; tokens never leave the server.
Every queue row carries ownerUid. The job only uses a channel that belongs to
that user. The row's ytPublishChannel (picked in the Publish form) wins;
otherwise the user's account default. With neither, or with no ownerUid, the
publish is blocked with UnmappedPublishChannel; there is no fallback channel.
"""

from __future__ import annotations

from account_labels import canonical_account_label

USERS_COLLECTION = "users"
PUBLISH_CHANNEL_MAP_COLLECTION = "publishChannelMap"   # users/{uid}/publishChannelMap
PUBLISH_CHANNELS_COLLECTION = "youtubeChannels"        # users/{uid}/youtubeChannels


def user_channel_path(uid: str, channel: str) -> str:
    return f"{USERS_COLLECTION}/{uid}/{PUBLISH_CHANNELS_COLLECTION}/{channel}"


def user_map_path(uid: str, account: str) -> str:
    return f"{USERS_COLLECTION}/{uid}/{PUBLISH_CHANNEL_MAP_COLLECTION}/{account}"


class UnmappedPublishChannel(RuntimeError):
    """No usable YouTube channel for this publish; it is blocked."""


def unmapped_message(account: str) -> str:
    who = account or "this song's account"
    return (
        f"No YouTube channel is set for Suno account '{who}'. Publishing is blocked until a channel "
        "is chosen in Vault > Publish settings > Channels."
    )


def _candidates(account_label: str, account_handle: str, source_id: str) -> list[str]:
    label = canonical_account_label(account_handle, account_label)
    handle = str(account_handle or "").strip()
    source = str(source_id or "").strip()
    source_handle = source[len("suno_"):] if source.lower().startswith("suno_") else ""
    out: list[str] = []
    for c in (label, handle, canonical_account_label(source_handle), source_handle):
        if c and c not in out:
            out.append(c)
    return out


def account_key(*, account_label: str = "", account_handle: str = "", source_id: str = "") -> str:
    c = _candidates(account_label, account_handle, source_id)
    return c[0] if c else ""


def resolve_publish_channel(
    *,
    account_label: str = "",
    account_handle: str = "",
    source_id: str = "",
    channel_map: dict | None = None,
) -> str:
    """Return the account's default channel key from the map, or "" when none is set."""
    channel_map = channel_map or {}
    for key in _candidates(account_label, account_handle, source_id):
        mapped = str(channel_map.get(key) or "").strip()
        if mapped:
            return mapped
    return ""


def oauth_secret_for_channel(channel: str, registry: dict | None = None) -> str:
    """Token secret ID for a linked channel from the publishChannels registry."""
    key = str(channel or "").strip()
    entry = (registry or {}).get(key) or {}
    if not key or not entry:
        raise UnmappedPublishChannel(f"YouTube channel '{key or '(none)'}' is not linked to this user.")
    if entry.get("enabled") is False:
        raise UnmappedPublishChannel(f"YouTube channel '{key}' is disabled.")
    secret = str(entry.get("tokenSecret") or "").strip()
    if not secret:
        raise UnmappedPublishChannel(f"YouTube channel '{key}' has no linked token.")
    return secret
