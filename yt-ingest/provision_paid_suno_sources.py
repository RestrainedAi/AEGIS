#!/usr/bin/env python3
"""
Provision reserved paid-tier SUNO sources and workspaces.

This seeds:
- workspaces/{workspaceId}
- sources/suno_{handle}

The workspaces are intentionally created as reserved platform-owned placeholders
until the real signed-in user identity is linked later.
"""

from __future__ import annotations

import json
import urllib.request
from datetime import datetime, timezone

from gcp_access_token import get_access_token

PROJECT = "stable-framing-482501-t9"
DATABASE = "(default)"
FS_BASE = f"https://firestore.googleapis.com/v1/projects/{PROJECT}/databases/{DATABASE}"

RESERVED_SOURCES = [
    {
        "handle": "unshakableechos2341",
        "workspaceId": "studio-unshakableechos2341",
        "workspaceName": "Unshakable Echos Studio",
        "workspaceSlug": "studio-unshakableechos2341",
        "accountLabel": "unshakableechos2341_studio",
        "profileUrl": "https://suno.com/@unshakableechos2341",
        "planId": "studio-monthly",
        "tierId": "studio_monthly",
    },
    {
        "handle": "gravitystruth",
        "workspaceId": "studio-gravitystruth",
        "workspaceName": "Gravitys Truth Studio",
        "workspaceSlug": "studio-gravitystruth",
        "accountLabel": "gravitystruth_studio",
        "profileUrl": "https://suno.com/@gravitystruth",
        "planId": "studio-monthly",
        "tierId": "studio_monthly",
    },
]


def req(token: str, url: str, *, method: str = "GET", body: dict | None = None):
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
        return json.loads(response.read()) if response.readable() else {}


def fs_string(value: str):
    return {"stringValue": str(value)}


def fs_bool(value: bool):
    return {"booleanValue": bool(value)}


def fs_int(value: int):
    return {"integerValue": str(int(value))}


def upsert_doc(token: str, doc_path: str, fields: dict):
    encoded = "/".join(segment for segment in doc_path.split("/") if segment)
    mask = "&".join(f"updateMask.fieldPaths={key}" for key in fields.keys())
    url = f"{FS_BASE}/documents/{encoded}?{mask}"
    body = {"fields": fields}
    req(token, url, method="PATCH", body=body)


def main():
    token = get_access_token()
    now = datetime.now(timezone.utc).isoformat()

    for item in RESERVED_SOURCES:
        workspace_path = f"workspaces/{item['workspaceId']}"
        source_path = f"sources/suno_{item['handle']}"

        upsert_doc(
            token,
            workspace_path,
            {
                "name": fs_string(item["workspaceName"]),
                "slug": fs_string(item["workspaceSlug"]),
                "ownerUid": fs_string(""),
                "planId": fs_string(item["planId"]),
                "status": fs_string("reserved"),
                "provisioningState": fs_string("reserved"),
                "audience": fs_string("customer"),
                "tierId": fs_string(item["tierId"]),
                "reservedForHandle": fs_string(item["handle"]),
                "sourceLimit": fs_int(25),
                "storageLimitGb": fs_int(250),
                "seatLimit": fs_int(10),
                "createdAt": fs_string(now),
                "updatedAt": fs_string(now),
            },
        )

        upsert_doc(
            token,
            source_path,
            {
                "platform": fs_string("suno"),
                "handle": fs_string(item["handle"]),
                "accountLabel": fs_string(item["accountLabel"]),
                "profileUrl": fs_string(item["profileUrl"]),
                "workspaceId": fs_string(item["workspaceId"]),
                "planId": fs_string(item["planId"]),
                "tierId": fs_string(item["tierId"]),
                "audience": fs_string("customer"),
                "status": fs_string("active"),
                "isActive": fs_bool(True),
                "harvestEnabled": fs_bool(True),
                "provisioningState": fs_string("reserved"),
                "createdAt": fs_string(now),
                "updatedAt": fs_string(now),
            },
        )

        print(f"OK {workspace_path}")
        print(f"OK {source_path}")


if __name__ == "__main__":
    main()
