#!/usr/bin/env python3
"""
Cheap local validator for pipeline_monitor status classification.

This does not contact GCP or send email. It only verifies the pure
summary/status logic used by Step 5.
"""

from pipeline_monitor import (
    STALE_HOURS,
    SOURCE_IDLE_HOURS,
    SOURCE_SCAN_STALE_HOURS,
    build_status_summary,
)


def assert_equal(actual, expected, label):
    if actual != expected:
        raise AssertionError(f"{label}: expected {expected!r}, got {actual!r}")


def base_inputs():
    return {
        "mode": "post-harvest",
        "catalog_age": 1.5,
        "catalog_ts": "2026-03-30T10:47:08Z",
        "queue": {"new": 0, "queued": 0, "uploading": 0, "done": 25, "error": 0},
        "songs": {"active": 1773, "removed_from_suno": 139, "yt_done": 25, "yt_error": 0},
        "harvest": {"total_delta_rows": 156, "per_handle": []},
        "source": {
            "sourceContentAgeHours": 2.0,
            "sourceSeenAgeHours": 1.0,
            "latestCreatedSong": {"createdAt": "2026-03-30T09:47:08Z", "title": "Newest"},
            "latestSeenSong": {"lastSeenAt": "2026-03-30T10:47:08Z", "accountHandle": "vanessa_primary"},
            "sourceIdleThresholdHours": SOURCE_IDLE_HOURS,
            "sourceScanStaleThresholdHours": SOURCE_SCAN_STALE_HOURS,
        },
        "partial_harvest_exit": 0,
        "error_detail": "",
    }


def validate_healthy():
    summary = build_status_summary(**base_inputs())
    assert_equal(summary["status"], "healthy", "healthy status")
    assert_equal(summary["emailReason"], "", "healthy emailReason")


def validate_partial_harvest():
    payload = base_inputs()
    payload["partial_harvest_exit"] = 1
    summary = build_status_summary(**payload)
    assert_equal(summary["status"], "partial_harvest", "partial_harvest status")
    assert_equal(summary["emailReason"], "partial_harvest", "partial_harvest emailReason")
    assert_equal(summary["partialHarvestExitCode"], 1, "partialHarvestExitCode")


def validate_stale():
    payload = base_inputs()
    payload["catalog_age"] = STALE_HOURS + 1
    summary = build_status_summary(**payload)
    assert_equal(summary["status"], "stale", "stale status")
    assert_equal(summary["emailReason"], "catalog_stale", "stale emailReason")


def validate_source_idle():
    payload = base_inputs()
    payload["source"]["sourceContentAgeHours"] = SOURCE_IDLE_HOURS + 1
    summary = build_status_summary(**payload)
    assert_equal(summary["status"], "source_idle", "source_idle status")
    assert_equal(summary["emailReason"], "source_idle", "source_idle emailReason")


def validate_source_scan_stale():
    payload = base_inputs()
    payload["source"]["sourceSeenAgeHours"] = SOURCE_SCAN_STALE_HOURS + 1
    summary = build_status_summary(**payload)
    assert_equal(summary["status"], "source_scan_stale", "source_scan_stale status")
    assert_equal(summary["emailReason"], "source_scan_stale", "source_scan_stale emailReason")


def validate_queue_errors():
    payload = base_inputs()
    payload["queue"] = {"new": 0, "queued": 0, "uploading": 0, "done": 25, "error": 3}
    summary = build_status_summary(**payload)
    assert_equal(summary["status"], "queue_errors", "queue_errors status")
    assert_equal(summary["emailReason"], "queue_errors", "queue_errors emailReason")


def validate_failure():
    payload = base_inputs()
    payload["error_detail"] = "boom"
    summary = build_status_summary(**payload)
    assert_equal(summary["status"], "failure", "failure status")
    assert_equal(summary["emailReason"], "alert", "failure emailReason")


def main():
    validate_healthy()
    validate_partial_harvest()
    validate_source_scan_stale()
    validate_source_idle()
    validate_stale()
    validate_queue_errors()
    validate_failure()
    print("pipeline_monitor status validation passed.")


if __name__ == "__main__":
    main()
