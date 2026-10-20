#!/usr/bin/env python3
"""Verify that the catalog rebuilt by harvest is the catalog published to GCS."""

from __future__ import annotations

import argparse
import csv
import io
import json
import sys
import urllib.parse
import urllib.request
from pathlib import Path

from gcp_access_token import get_access_token
from rebuild_catalog import FIELDNAMES, GCS_DEST, GCS_META_DEST


def required_columns_missing(fieldnames: list[str] | None) -> list[str]:
    available = set(fieldnames or [])
    return [name for name in FIELDNAMES if name not in available]


def inspect_csv(payload: bytes, source: str) -> tuple[list[str], int]:
    try:
        reader = csv.DictReader(io.StringIO(payload.decode("utf-8-sig")))
        fields = reader.fieldnames or []
        missing = required_columns_missing(fields)
        if missing:
            raise ValueError(f"{source} is missing required columns: {', '.join(missing)}")
        rows = sum(1 for _ in reader)
    except UnicodeDecodeError as exc:
        raise ValueError(f"{source} is not valid UTF-8 CSV: {exc}") from exc
    return fields, rows


def inspect_meta(payload: bytes, source: str, expected_artifact: str) -> dict:
    try:
        meta = json.loads(payload.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ValueError(f"{source} is not valid JSON: {exc}") from exc

    if meta.get("artifact") != expected_artifact:
        raise ValueError(
            f"{source} artifact mismatch: {meta.get('artifact')!r} != {expected_artifact!r}"
        )
    if not meta.get("generatedAt"):
        raise ValueError(f"{source} is missing generatedAt")
    if int(meta.get("rowCount") or 0) <= 0:
        raise ValueError(f"{source} has non-positive rowCount: {meta.get('rowCount')!r}")
    return meta


def parse_gcs_uri(uri: str) -> tuple[str, str]:
    if not uri.startswith("gs://") or "/" not in uri[5:]:
        raise ValueError(f"Invalid GCS URI: {uri!r}")
    bucket, object_name = uri[5:].split("/", 1)
    return bucket, object_name


def fetch_gcs(uri: str) -> bytes:
    bucket, object_name = parse_gcs_uri(uri)
    encoded_object = urllib.parse.quote(object_name, safe="")
    url = f"https://storage.googleapis.com/download/storage/v1/b/{bucket}/o/{encoded_object}?alt=media"
    request = urllib.request.Request(url, headers={"Authorization": f"Bearer {get_access_token()}"})
    with urllib.request.urlopen(request, timeout=120) as response:
        return response.read()


def validate(local_csv: bytes, local_meta: bytes, published_csv: bytes | None, published_meta: bytes | None) -> None:
    _, local_rows = inspect_csv(local_csv, "local catalog CSV")
    local = inspect_meta(local_meta, "local catalog metadata", GCS_DEST)
    if local_rows != int(local["rowCount"]):
        raise ValueError(f"local row count mismatch: CSV={local_rows} metadata={local['rowCount']}")

    if published_csv is None or published_meta is None:
        return

    _, published_rows = inspect_csv(published_csv, "published catalog CSV")
    published = inspect_meta(published_meta, "published catalog metadata", GCS_DEST)
    if published_rows != int(published["rowCount"]):
        raise ValueError(f"published row count mismatch: CSV={published_rows} metadata={published['rowCount']}")
    if published["generatedAt"] != local["generatedAt"]:
        raise ValueError(
            f"published generatedAt mismatch: local={local['generatedAt']} published={published['generatedAt']}"
        )
    if published_rows != local_rows:
        raise ValueError(f"published row count mismatch: local={local_rows} published={published_rows}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--local-csv", default="latest_catalog_wide.csv")
    parser.add_argument("--local-meta", default="latest_catalog_wide.meta.json")
    parser.add_argument("--skip-published", action="store_true")
    args = parser.parse_args()

    local_csv = Path(args.local_csv).read_bytes()
    local_meta = Path(args.local_meta).read_bytes()
    published_csv = published_meta = None
    if not args.skip_published:
        published_csv = fetch_gcs(GCS_DEST)
        published_meta = fetch_gcs(GCS_META_DEST)

    validate(local_csv, local_meta, published_csv, published_meta)
    print("Published SUNO catalog contract validation passed.")


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"[ERROR] Published SUNO catalog contract validation failed: {exc}", file=sys.stderr)
        sys.exit(1)
