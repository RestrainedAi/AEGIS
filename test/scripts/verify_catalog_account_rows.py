#!/usr/bin/env python3
"""Verify published catalog export contains rows for a SUNO account."""

from __future__ import annotations

import csv
import io
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "yt-ingest"))

from gcp_access_token import get_access_token  # noqa: E402

BUCKET = "aeonimus-workspaces"
OBJECT = "exports/suno/latest_catalog_wide.csv"


def fetch_catalog_csv() -> str:
    token = get_access_token()
    encoded = urllib.parse.quote(OBJECT, safe="")
    url = f"https://storage.googleapis.com/storage/v1/b/{BUCKET}/o/{encoded}?alt=media"
    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {token}"})
    with urllib.request.urlopen(req, timeout=120) as resp:
        return resp.read().decode("utf-8", errors="replace")


def row_matches(row: dict, *, account_label: str, source_id: str) -> bool:
    label = (row.get("account_label") or "").strip()
    handle = (row.get("account_handle") or "").strip()
    source = (row.get("account_sourceId") or "").strip()
    if source_id and source == source_id:
        return True
    if account_label and label == account_label:
        return True
    if account_label and handle == account_label:
        return True
    return False


def main() -> int:
    if len(sys.argv) < 4:
        print(
            "Usage: verify_catalog_account_rows.py <account_label> <source_id> <min_rows>",
            file=sys.stderr,
        )
        return 2

    account_label = sys.argv[1]
    source_id = sys.argv[2]
    min_rows = int(sys.argv[3])

    try:
        payload = fetch_catalog_csv()
    except urllib.error.HTTPError as exc:
        print(f"ERROR: failed to read gs://{BUCKET}/{OBJECT}: {exc}", file=sys.stderr)
        return 1
    except OSError as exc:
        print(f"ERROR: failed to read gs://{BUCKET}/{OBJECT}: {exc}", file=sys.stderr)
        return 1

    reader = csv.DictReader(io.StringIO(payload))
    if not reader.fieldnames:
        print("ERROR: catalog CSV has no header row", file=sys.stderr)
        return 1

    matches = 0
    for row in reader:
        if row_matches(
            row,
            account_label=account_label,
            source_id=source_id,
        ):
            matches += 1

    if matches < min_rows:
        print(
            "ERROR: expected >= "
            f"{min_rows} rows for label={account_label} or source={source_id}, found {matches}",
            file=sys.stderr,
        )
        return 1

    print(
        f"OK catalog rows for label={account_label} or source={source_id}: "
        f"{matches} (min={min_rows})"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
