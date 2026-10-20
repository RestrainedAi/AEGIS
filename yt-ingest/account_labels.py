"""Canonical SUNO account labels for catalog export and Vault filters."""

from __future__ import annotations

HANDLE_ALIAS_MAP = {
    "unshakableechos2341": "vanessa_primary",
    "nessihenize": "vanessa_secondary",
}

SOURCE_ID_PREFIX = "suno_"


def canonical_account_label(raw_handle: str = "", raw_label: str = "") -> str:
    handle = str(raw_handle or "").strip()
    label = str(raw_label or "").strip()
    picked = label or handle
    if not picked:
        return ""
    return HANDLE_ALIAS_MAP.get(picked, HANDLE_ALIAS_MAP.get(handle, picked))


def canonical_account_handle(raw_handle: str = "") -> str:
    handle = str(raw_handle or "").strip()
    if not handle:
        return ""
    return HANDLE_ALIAS_MAP.get(handle, handle)


def source_id_for_handle(handle: str) -> str:
    return f"{SOURCE_ID_PREFIX}{str(handle or '').strip()}"
