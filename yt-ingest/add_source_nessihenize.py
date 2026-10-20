#!/usr/bin/env python3
"""
Provision the AEONIMUS / @nessihenize SUNO source under Vanessa's Sundrop workspace.

Seeds settings from the existing vanessa_primary source (suno_unshakableechos2341):
same workspace, plan, tier, harvest flags, and lifecycle — new handle + account label.
"""

from __future__ import annotations

import json
import sys
import urllib.error
import urllib.request
from datetime import datetime, timezone

from gcp_access_token import get_access_token

PROJECT = "stable-framing-482501-t9"
DATABASE = "(default)"
FS_BASE = f"https://firestore.googleapis.com/v1/projects/{PROJECT}/databases/{DATABASE}"

TEMPLATE_SOURCE = "sources/suno_unshakableechos2341"
TARGET_SOURCE = "sources/suno_nessihenize"
TARGET_HANDLE = "nessihenize"
TARGET_ACCOUNT_LABEL = "vanessa_secondary"
TARGET_PROFILE_URL = "https://suno.com/@nessihenize"
TARGET_DISPLAY_NAME = "AEONIMUS"


def req(token: str, url: str, *, method: str = "GET", body: dict | None = None) -> dict:
    data = None if body is None else json.dumps(body).encode("utf-8")
    request = urllib.request.Request(
        url,
        data=data,
        method=method,
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        },
    )
    with urllib.request.urlopen(request, timeout=60) as response:
        raw = response.read()
        return json.loads(raw) if raw else {}


def fval(field: dict | None) -> str:
    if not field:
        return ""
    for key in ("stringValue", "integerValue", "booleanValue", "timestampValue"):
        if key in field:
            return str(field[key])
    return ""


def fs_string(value: str):
    return {"stringValue": str(value)}


def fs_bool(value: bool):
    return {"booleanValue": bool(value)}


def load_doc(token: str, doc_path: str) -> dict:
    encoded = "/".join(segment for segment in doc_path.split("/") if segment)
    url = f"{FS_BASE}/documents/{encoded}"
    return req(token, url)


def upsert_doc(token: str, doc_path: str, fields: dict):
    encoded = "/".join(segment for segment in doc_path.split("/") if segment)
    mask = "&".join(f"updateMask.fieldPaths={key}" for key in fields.keys())
    url = f"{FS_BASE}/documents/{encoded}?{mask}"
    req(token, url, method="PATCH", body={"fields": fields})


def build_target_fields(template_fields: dict, now: str, *, existed: bool) -> dict:
    workspace_id = fval(template_fields.get("workspaceId")) or "studio-unshakableechos2341"
    plan_id = fval(template_fields.get("planId")) or "studio-monthly"
    tier_id = fval(template_fields.get("tierId")) or "studio_monthly"
    audience = fval(template_fields.get("audience")) or "customer"
    owner_uid = fval(template_fields.get("ownerUid"))
    owner_email = fval(template_fields.get("ownerEmail")) or "nessihenize@gmail.com"

    fields = {
        "platform": fs_string("suno"),
        "handle": fs_string(TARGET_HANDLE),
        "accountLabel": fs_string(TARGET_ACCOUNT_LABEL),
        "displayName": fs_string(TARGET_DISPLAY_NAME),
        "profileUrl": fs_string(TARGET_PROFILE_URL),
        "workspaceId": fs_string(workspace_id),
        "ownerUid": fs_string(owner_uid),
        "ownerEmail": fs_string(owner_email),
        "planId": fs_string(plan_id),
        "tierId": fs_string(tier_id),
        "audience": fs_string(audience),
        "status": fs_string("active"),
        "isActive": fs_bool(True),
        "harvestEnabled": fs_bool(True),
        "ingestionMode": fs_string("public_profile"),
        "authorityStatus": fs_string("partial_source"),
        "provisioningState": fs_string("assigned"),
        "assignedAt": fs_string(now),
        "updatedAt": fs_string(now),
        "seededFromSourceId": fs_string("suno_unshakableechos2341"),
        "seededFromAccountLabel": fs_string("vanessa_primary"),
    }

    if not existed:
        fields["createdAt"] = fs_string(now)

    return fields


def main() -> int:
    token = get_access_token()
    now = datetime.now(timezone.utc).isoformat()

    try:
        template = load_doc(token, TEMPLATE_SOURCE)
    except urllib.error.HTTPError as exc:
        print(f"ERROR: could not read template source {TEMPLATE_SOURCE}: {exc}", file=sys.stderr)
        return 1

    template_fields = template.get("fields", {})
    if not template_fields:
        print(f"ERROR: template source {TEMPLATE_SOURCE} has no fields", file=sys.stderr)
        return 1

    existed = False
    try:
        load_doc(token, TARGET_SOURCE)
        existed = True
    except urllib.error.HTTPError as exc:
        if exc.code != 404:
            raise

    fields = build_target_fields(template_fields, now, existed=existed)
    upsert_doc(token, TARGET_SOURCE, fields)

    action = "Updated" if existed else "Created"
    print(f"{action} {TARGET_SOURCE}")
    print(f"  handle       : {TARGET_HANDLE}")
    print(f"  accountLabel : {TARGET_ACCOUNT_LABEL}")
    print(f"  workspaceId  : {fval(fields['workspaceId'])}")
    print(f"  planId       : {fval(fields['planId'])}")
    print(f"  harvestEnabled: true")
    print(f"  profileUrl   : {TARGET_PROFILE_URL}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
