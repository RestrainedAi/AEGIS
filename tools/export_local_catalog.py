#!/usr/bin/env python3
"""
Build a local multi-zip catalog export for a specific Suno handle/workspace.

This is the operator-side companion to the Vault export flow so we can produce
portable catalog bundles directly from GCS when UI auth/account switching is in
the way.
"""

from __future__ import annotations

import argparse
import csv
import io
import json
import os
import re
import zipfile
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, Iterable, List, Optional

from google.cloud import storage


CATALOG_BUCKET = "aeonimus-workspaces"
CATALOG_OBJECT = "exports/suno/latest_catalog_wide.csv"
DEFAULT_MAX_PART_BYTES = int(1.5 * 1024 * 1024 * 1024)


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def safe_file_part(value: str, fallback: str = "untitled") -> str:
    cleaned = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "-", str(value or ""))
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    return (cleaned[:80] if cleaned else fallback)


def byte_label(num: int) -> str:
    units = ["B", "KB", "MB", "GB", "TB"]
    value = float(max(num, 0))
    idx = 0
    while value >= 1024 and idx < len(units) - 1:
        value /= 1024
        idx += 1
    if idx == 0 or value >= 10:
        return f"{value:.0f} {units[idx]}"
    return f"{value:.1f} {units[idx]}"


def parse_gs_url(url: str) -> Optional[tuple[str, str]]:
    text = str(url or "").strip()
    if not text.startswith("gs://"):
        return None
    remainder = text[5:]
    if "/" not in remainder:
        return None
    bucket, obj = remainder.split("/", 1)
    return bucket, obj


def ext_from_path(path_text: str, fallback: str = "") -> str:
    ext = Path(str(path_text or "")).suffix
    return ext or fallback


def serialize_csv(rows: List[Dict[str, str]]) -> str:
    if not rows:
        return ""
    headers: List[str] = []
    seen = set()
    for row in rows:
        for key in row.keys():
            if key not in seen:
                headers.append(key)
                seen.add(key)
    buffer = io.StringIO()
    writer = csv.DictWriter(buffer, fieldnames=headers, lineterminator="\n")
    writer.writeheader()
    writer.writerows(rows)
    return buffer.getvalue()


@dataclass
class AssetDescriptor:
    kind: str
    export_path: str
    exists: bool
    estimated_bytes: int = 0
    bucket: str = ""
    object_name: str = ""
    note: str = ""
    inline_content: Optional[str] = None


def fetch_catalog_rows(client: storage.Client) -> List[Dict[str, str]]:
    blob = client.bucket(CATALOG_BUCKET).blob(CATALOG_OBJECT)
    text = blob.download_as_text()
    reader = csv.DictReader(io.StringIO(text))
    rows: List[Dict[str, str]] = []
    for row in reader:
      rows.append({str(k or "").strip(): "" if v is None else str(v) for k, v in row.items()})
    return rows


def resolve_blob_asset(
    client: storage.Client,
    kind: str,
    gs_url: str,
    export_path: str,
    note: str,
) -> AssetDescriptor:
    parsed = parse_gs_url(gs_url)
    if not parsed:
        return AssetDescriptor(kind=kind, export_path=export_path, exists=False, note=note)
    bucket_name, object_name = parsed
    blob = client.bucket(bucket_name).blob(object_name)
    if not blob.exists():
        return AssetDescriptor(kind=kind, export_path=export_path, exists=False, note=note)
    blob.reload()
    return AssetDescriptor(
        kind=kind,
        export_path=export_path,
        exists=True,
        estimated_bytes=int(blob.size or 0),
        bucket=bucket_name,
        object_name=object_name,
    )


def build_export_rows(client: storage.Client, rows: Iterable[Dict[str, str]]) -> tuple[List[dict], int, int, int]:
    export_rows: List[dict] = []
    total_assets = 0
    total_bytes = 0
    missing_assets = 0

    for row in rows:
        song_key = safe_file_part(row.get("songKey") or "")
        title = row.get("title") or ""
        title_part = safe_file_part(title, song_key or "song")
        base_name = f"{song_key} {title_part}".strip()

        audio = resolve_blob_asset(
            client,
            "audio",
            row.get("gcs_latest_audio") or row.get("gcs_mp3") or row.get("audio_url") or "",
            f"audio/{base_name}{ext_from_path(row.get('gcs_latest_audio') or row.get('gcs_mp3') or row.get('audio_url'), '.mp3')}",
            "missing_audio",
        )
        image = resolve_blob_asset(
            client,
            "thumb",
            row.get("gcs_latest_thumb") or row.get("gcs_thumb") or row.get("image_url") or "",
            f"images/thumbs/{base_name}{ext_from_path(row.get('gcs_latest_thumb') or row.get('gcs_thumb') or row.get('image_url'), '.jpg')}",
            "missing_image",
        )
        lyrics_txt_path = row.get("gcsLyricsTxt") or ""
        inline_lyrics = (row.get("lyrics") or "").strip()
        if lyrics_txt_path:
            lyrics_txt = resolve_blob_asset(
                client,
                "lyrics_txt",
                lyrics_txt_path,
                f"lyrics/txt/{base_name}.txt",
                "missing_lyrics",
            )
        elif inline_lyrics:
            lyrics_txt = AssetDescriptor(
                kind="lyrics_txt",
                export_path=f"lyrics/txt/{base_name}.txt",
                exists=True,
                estimated_bytes=len(inline_lyrics.encode("utf-8")),
                inline_content=inline_lyrics,
            )
        else:
            lyrics_txt = AssetDescriptor(
                kind="lyrics_txt",
                export_path=f"lyrics/txt/{base_name}.txt",
                exists=False,
                note="missing_lyrics",
            )

        lyrics_vtt = resolve_blob_asset(
            client,
            "lyrics_vtt",
            row.get("gcsLyricsVtt") or "",
            f"lyrics/vtt/{base_name}.vtt",
            "missing_lyrics_vtt",
        )

        assets = [audio, image, lyrics_txt, lyrics_vtt]
        available_assets = [asset for asset in assets if asset.exists]
        missing_notes = [asset.note for asset in assets if not asset.exists and asset.note]

        total_assets += len(available_assets)
        total_bytes += sum(asset.estimated_bytes for asset in available_assets)
        missing_assets += len(assets) - len(available_assets)

        export_rows.append(
            {
                "row": row,
                "assets": assets,
                "estimated_bytes": sum(asset.estimated_bytes for asset in available_assets),
                "manifest": {
                    **row,
                    "audioPath": audio.export_path if audio.exists else "",
                    "thumbPath": image.export_path if image.exists else "",
                    "imagePath": image.export_path if image.exists else "",
                    "lyricsTxtPath": lyrics_txt.export_path if lyrics_txt.exists else "",
                    "lyricsVttPath": lyrics_vtt.export_path if lyrics_vtt.exists else "",
                    "exportPart": "",
                    "assetStatus": "complete"
                    if not missing_notes
                    else ("missing_multiple" if len(missing_notes) == len(assets) else "|".join(dict.fromkeys(missing_notes))),
                    "notes": ", ".join(missing_notes),
                },
            }
        )

    return export_rows, total_assets, total_bytes, missing_assets


def shard_rows(export_rows: List[dict], max_part_bytes: int) -> List[dict]:
    parts: List[dict] = []
    current = {"rows": [], "estimated_bytes": 0, "asset_count": 0}
    for row in export_rows:
        row_bytes = int(row["estimated_bytes"] or 0)
        row_asset_count = sum(1 for asset in row["assets"] if asset.exists)
        if current["rows"] and current["estimated_bytes"] + row_bytes > max_part_bytes:
            parts.append(current)
            current = {"rows": [], "estimated_bytes": 0, "asset_count": 0}
        current["rows"].append(row)
        current["estimated_bytes"] += row_bytes
        current["asset_count"] += row_asset_count
    if current["rows"] or not parts:
        parts.append(current)
    for index, part in enumerate(parts, start=1):
        part["part_number"] = index
        part["part_name"] = f"catalog_part_{index:02d}.zip"
    return parts


def write_zip_part(
    client: storage.Client,
    part: dict,
    manifest_csv: str,
    summary_json: str,
    target_path: Path,
) -> int:
    target_path.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(target_path, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as zf:
        zf.writestr("manifest/catalog.csv", manifest_csv)
        zf.writestr("manifest/summary.json", summary_json)
        for row in part["rows"]:
            for asset in row["assets"]:
                if not asset.exists:
                    continue
                if asset.inline_content is not None:
                    zf.writestr(asset.export_path, asset.inline_content)
                    continue
                blob = client.bucket(asset.bucket).blob(asset.object_name)
                zf.writestr(asset.export_path, blob.download_as_bytes())
    return target_path.stat().st_size


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--handle", required=True)
    parser.add_argument("--workspace-id", default="")
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--max-part-bytes", type=int, default=DEFAULT_MAX_PART_BYTES)
    args = parser.parse_args()

    client = storage.Client(project="stable-framing-482501-t9")
    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    print(f"[1/5] loading latest catalog export from gs://{CATALOG_BUCKET}/{CATALOG_OBJECT}")
    rows = fetch_catalog_rows(client)
    filtered = [row for row in rows if (row.get("account_handle") or "").strip() == args.handle]
    if args.workspace_id:
        print(f"      workspace hint: {args.workspace_id}")
    print(f"      matched {len(filtered)} rows for handle {args.handle}")
    if not filtered:
        raise SystemExit("No catalog rows matched that handle.")

    print("[2/5] resolving exportable assets and manifest rows")
    export_rows, total_assets, total_bytes, missing_assets = build_export_rows(client, filtered)

    print("[3/5] sharding bundle parts by size")
    parts = shard_rows(export_rows, args.max_part_bytes)
    manifest_rows: List[Dict[str, str]] = []
    for row in export_rows:
        matched = next((part for part in parts if row in part["rows"]), None)
        row["manifest"]["exportPart"] = matched["part_name"] if matched else ""
        manifest_rows.append(row["manifest"])
    manifest_csv = serialize_csv(manifest_rows)
    summary = {
        "generatedAt": utc_now_iso(),
        "workspaceId": args.workspace_id,
        "handle": args.handle,
        "totalRows": len(export_rows),
        "totalAssets": total_assets,
        "totalBytes": total_bytes,
        "totalBytesLabel": byte_label(total_bytes),
        "missingAssets": missing_assets,
        "partCount": len(parts),
        "maxPartBytes": args.max_part_bytes,
        "maxPartBytesLabel": byte_label(args.max_part_bytes),
        "parts": [
            {
                "partName": part["part_name"],
                "rowCount": len(part["rows"]),
                "assetCount": part["asset_count"],
                "estimatedBytes": part["estimated_bytes"],
                "estimatedBytesLabel": byte_label(part["estimated_bytes"]),
            }
            for part in parts
        ],
    }
    summary_json = json.dumps(summary, indent=2) + "\n"
    (output_dir / "catalog.csv").write_text(manifest_csv, encoding="utf-8", newline="")
    (output_dir / "summary.json").write_text(summary_json, encoding="utf-8")

    print("[4/5] writing zip parts")
    for index, part in enumerate(parts, start=1):
        print(
            f"      part {index}/{len(parts)}: {part['part_name']} "
            f"({len(part['rows'])} rows, {part['asset_count']} assets, est {byte_label(part['estimated_bytes'])})"
        )
        size = write_zip_part(client, part, manifest_csv, summary_json, output_dir / part["part_name"])
        part["sizeBytes"] = size
        part["sizeLabel"] = byte_label(size)
        print(f"         wrote {part['part_name']} -> {byte_label(size)}")

    summary["parts"] = [
        {
            **part_summary,
            "sizeBytes": part.get("sizeBytes", 0),
            "sizeLabel": part.get("sizeLabel", byte_label(0)),
        }
        for part_summary, part in zip(summary["parts"], parts)
    ]
    (output_dir / "summary.json").write_text(json.dumps(summary, indent=2) + "\n", encoding="utf-8")

    print("[5/5] complete")
    print(f"      output: {output_dir}")
    print(f"      rows: {len(export_rows)}")
    print(f"      assets: {total_assets}")
    print(f"      bytes: {byte_label(total_bytes)}")
    print(f"      parts: {len(parts)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
