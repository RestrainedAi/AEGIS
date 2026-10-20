"""Map Vault account labels to YouTube OAuth refresh-token secrets."""

from __future__ import annotations

from account_labels import HANDLE_ALIAS_MAP, canonical_account_label

DEFAULT_PUBLISH_CHANNEL = "vanessa_primary"

# Secret Manager secret IDs (refresh tokens).
PUBLISH_CHANNEL_SECRETS = {
    "vanessa_primary": "youtube-oauth-refresh-token",
    "vanessa_secondary": "youtube-oauth-refresh-token-vanessa-secondary",
}


def resolve_publish_channel(
    *,
    account_label: str = "",
    account_handle: str = "",
    source_id: str = "",
) -> str:
    label = canonical_account_label(account_handle, account_label)
    if label in PUBLISH_CHANNEL_SECRETS:
        return label

    handle = str(account_handle or "").strip()
    if handle in PUBLISH_CHANNEL_SECRETS:
        return handle

    source = str(source_id or "").strip().lower()
    if source.endswith("_nessihenize") or "nessihenize" in source:
        return "vanessa_secondary"
    if source.endswith("_unshakableechos2341") or "unshakableechos2341" in source:
        return "vanessa_primary"

    for raw, canonical in HANDLE_ALIAS_MAP.items():
        if raw in source or canonical in source:
            if canonical in PUBLISH_CHANNEL_SECRETS:
                return canonical

    return DEFAULT_PUBLISH_CHANNEL


def oauth_secret_for_channel(channel: str) -> str:
    key = str(channel or "").strip() or DEFAULT_PUBLISH_CHANNEL
    return PUBLISH_CHANNEL_SECRETS.get(key, PUBLISH_CHANNEL_SECRETS[DEFAULT_PUBLISH_CHANNEL])
