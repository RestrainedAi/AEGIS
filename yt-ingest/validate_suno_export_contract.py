#!/usr/bin/env python3
"""
Cheap local validator for the SUNO export contract.

This validates the `sunoSongs -> export row` mapping without any Firestore,
Cloud Run, or bucket access. It uses a checked-in fixture so the rebuild
contract can be verified locally after schema/mapping changes.
"""

import json
from pathlib import Path

from rebuild_catalog import FIELDNAMES, build_meta, build_rows


FIXTURE_PATH = Path(__file__).parent / "fixtures" / "suno_export_contract_fixture.json"


def main():
    fixture = json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))
    run_ts = fixture["runTs"]
    rows = build_rows(fixture["docs"], run_ts)
    meta = build_meta(run_ts, len(rows))

    assert len(rows) == 2, f"expected 2 rows, got {len(rows)}"
    assert meta["generatedAt"] == run_ts
    assert meta["rowCount"] == 2
    assert meta["artifact"].endswith("latest_catalog_wide.csv")

    canonical = next(row for row in rows if row["songKey"] == "clip-canonical")
    legacy = next(row for row in rows if row["songKey"] == "clip-legacy")

    # Canonical nested media must win.
    assert canonical["audio_url"].endswith("clip-canonical.mp3")
    assert canonical["video_url"].endswith("clip-canonical.mp4")
    assert canonical["image_url"].endswith("clip-canonical.jpg")

    # Export aliases remain view-model fields derived from canonical truth.
    assert canonical["gcs_mp3"] == canonical["audio_url"]
    assert canonical["gcs_mp4"] == canonical["video_url"]
    assert canonical["gcs_thumb"] == canonical["image_url"]
    assert canonical["gcs_latest_audio"] == canonical["audio_url"]
    assert canonical["gcs_latest_mp4"] == canonical["video_url"]
    assert canonical["gcs_latest_thumb"] == canonical["image_url"]

    # Raw/source refs should fall back into export diagnostics.
    assert canonical["rawClipJsonGcs"].endswith("clip-canonical.json")

    # Tags should normalize to CSV-friendly output.
    assert canonical["tags"] == "electronic,cinematic"

    # Legacy top-level aliases must still work as fallback only.
    assert legacy["title"] == "Legacy Raw Title"
    assert legacy["audio_url"].endswith("clip-legacy.mp3")
    assert legacy["video_url"].endswith("clip-legacy.mp4")
    assert legacy["image_url"].endswith("clip-legacy.jpg")
    assert legacy["gcs_mp3"] == legacy["audio_url"]
    assert legacy["gcs_mp4"] == legacy["video_url"]
    assert legacy["gcs_thumb"] == legacy["image_url"]
    assert legacy["gcs_latest_audio"] == legacy["audio_url"]
    assert legacy["gcs_latest_mp4"] == ""
    assert legacy["gcs_latest_thumb"] == legacy["image_url"]

    # Export rows must keep context-only runId and freshness fields.
    assert canonical["runId"] == run_ts
    assert canonical["lastSeenAt"] == "2026-03-29T11:05:00Z"
    assert legacy["lastSeenAt"] == "2026-03-28T09:30:00Z"

    missing_columns = [field for field in FIELDNAMES if field not in canonical]
    assert not missing_columns, f"missing export columns in canonical row: {missing_columns}"

    print("SUNO export contract validation passed.")


if __name__ == "__main__":
    main()
