#!/usr/bin/env python3
"""
pipeline_monitor.py — Aeonimus Pipeline Health Monitor
=======================================================

Modes (--mode):
  post-harvest   Called by entrypoint.sh after harvest completes.
                 Reads harvest stats, sends digest or failure alert.
  alert          Called by entrypoint.sh trap on unexpected exit.
                 Sends an immediate failure alert email.
  daily-digest   Called by Cloud Scheduler every morning.
                 Full pipeline health check + summary email.

Email via Gmail SMTP using an App Password stored in Secret Manager.
Secret name : pipeline-monitor-config
Secret value: JSON  {"from": "you@gmail.com", "password": "xxxx xxxx xxxx xxxx", "to": "you@gmail.com"}

To create the secret (run once in Cloud Shell):
  echo '{"from":"aeonimusai@gmail.com","password":"YOUR_APP_PASSWORD","to":"aeonimusai@gmail.com"}' \
    | gcloud secrets create pipeline-monitor-config \
        --data-file=- --project=stable-framing-482501-t9
"""

import argparse
import base64
import json
import os
import smtplib
import sys
import urllib.parse
import urllib.request
from datetime import datetime, timezone, timedelta
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from pathlib import Path
from gcp_access_token import get_access_token

# ── Config ────────────────────────────────────────────────────────────────────
PROJECT         = os.environ.get("GCP_PROJECT", "stable-framing-482501-t9")
DATABASE        = "(default)"
WORK_DIR        = Path(os.environ.get("WORK_DIR", "/app"))
CATALOG_BUCKET  = "aeonimus-workspaces"
CATALOG_META    = "exports/suno/latest_catalog_wide.meta.json"
STALE_HOURS     = 26   # alert if catalog older than this
SOURCE_IDLE_HOURS = int(os.environ.get("SOURCE_IDLE_HOURS", "26"))
SOURCE_SCAN_STALE_HOURS = int(os.environ.get("SOURCE_SCAN_STALE_HOURS", "26"))
QUEUE_COLLECTION = "ytUploadQueue"
SECRET_MONITOR  = "pipeline-monitor-config"
STATUS_SUMMARY_PATH = WORK_DIR / "pipeline_monitor_status.json"


def _safe_console_text(value) -> str:
    text = str(value)
    encoding = getattr(sys.stdout, "encoding", None) or "utf-8"
    try:
        text.encode(encoding)
        return text
    except Exception:
        return text.encode(encoding, errors="backslashreplace").decode(encoding, errors="ignore")


def log_info(message: str):
    print(_safe_console_text(message))


def log_warn(message: str):
    print(_safe_console_text(message), file=sys.stderr)


def parse_iso_datetime(value: str):
    text = str(value or "").strip()
    if not text:
        return None
    try:
        return datetime.fromisoformat(text.replace("Z", "+00:00"))
    except Exception:
        return None

# ── Auth ──────────────────────────────────────────────────────────────────────
def get_gcp_token() -> str:
    """Works both in Cloud Run (metadata server) and locally."""
    return get_access_token()


def get_secret(token: str, secret_id: str) -> str:
    url = (f"https://secretmanager.googleapis.com/v1/projects/{PROJECT}"
           f"/secrets/{secret_id}/versions/latest:access")
    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {token}"})
    with urllib.request.urlopen(req, timeout=15) as r:
        data = json.loads(r.read())
    return base64.b64decode(data["payload"]["data"]).decode("utf-8")


# ── Firestore helpers ──────────────────────────────────────────────────────────
def fs_query_status_counts(token: str) -> dict:
    """Return {status: count} for all ytUploadQueue docs."""
    url = (f"https://firestore.googleapis.com/v1/projects/{PROJECT}"
           f"/databases/{DATABASE}/documents:runQuery")
    body = json.dumps({
        "structuredQuery": {
            "from": [{"collectionId": QUEUE_COLLECTION}],
            "select": {"fields": [{"fieldPath": "status"}]},
            "limit": 2000,
        }
    }).encode()
    req = urllib.request.Request(url, data=body, method="POST",
          headers={"Authorization": f"Bearer {token}",
                   "Content-Type": "application/json"})
    counts = {"new": 0, "queued": 0, "uploading": 0, "done": 0, "error": 0}
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            results = json.loads(r.read())
        for row in results:
            doc = row.get("document")
            if not doc:
                continue
            status = doc.get("fields", {}).get("status", {}).get("stringValue", "unknown")
            counts[status] = counts.get(status, 0) + 1
    except Exception as e:
        log_warn(f"  [WARN] queue count failed: {e}")
    return counts


def fs_count_songs(token: str) -> dict:
    """Return {status: count} for sunoSongs."""
    url = (f"https://firestore.googleapis.com/v1/projects/{PROJECT}"
           f"/databases/{DATABASE}/documents:runQuery")
    body = json.dumps({
        "structuredQuery": {
            "from": [{"collectionId": "sunoSongs"}],
            "select": {"fields": [{"fieldPath": "status"}, {"fieldPath": "ytStatus"}]},
            "limit": 5000,
        }
    }).encode()
    req = urllib.request.Request(url, data=body, method="POST",
          headers={"Authorization": f"Bearer {token}",
                   "Content-Type": "application/json"})
    counts = {"active": 0, "removed_from_suno": 0, "yt_done": 0, "yt_error": 0}
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            results = json.loads(r.read())
        for row in results:
            doc = row.get("document")
            if not doc:
                continue
            fields = doc.get("fields", {})
            status   = fields.get("status",   {}).get("stringValue", "")
            yt_status = fields.get("ytStatus", {}).get("stringValue", "")
            if status == "removed_from_suno":
                counts["removed_from_suno"] += 1
            else:
                counts["active"] += 1
            if yt_status == "done":
                counts["yt_done"] += 1
            elif yt_status == "error":
                counts["yt_error"] += 1
    except Exception as e:
        log_warn(f"  [WARN] song count failed: {e}")
    return counts


def fs_get_latest_song_field(token: str, field_path: str) -> dict:
    url = (f"https://firestore.googleapis.com/v1/projects/{PROJECT}"
           f"/databases/{DATABASE}/documents:runQuery")
    body = json.dumps({
        "structuredQuery": {
            "from": [{"collectionId": "sunoSongs"}],
            "select": {
                "fields": [
                    {"fieldPath": "songKey"},
                    {"fieldPath": "title"},
                    {"fieldPath": "account_handle"},
                    {"fieldPath": "account_label"},
                    {"fieldPath": "createdAt"},
                    {"fieldPath": "lastSeenAt"},
                    {"fieldPath": "status"},
                ]
            },
            "orderBy": [{"field": {"fieldPath": field_path}, "direction": "DESCENDING"}],
            "limit": 1,
        }
    }).encode()
    req = urllib.request.Request(
        url,
        data=body,
        method="POST",
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=30) as r:
        results = json.loads(r.read())
    for row in results:
        doc = row.get("document")
        if not doc:
            continue
        fields = doc.get("fields", {})
        return {
            "songKey": fields.get("songKey", {}).get("stringValue", ""),
            "title": fields.get("title", {}).get("stringValue", ""),
            "accountHandle": fields.get("account_handle", {}).get("stringValue", "")
                or fields.get("account_label", {}).get("stringValue", ""),
            "createdAt": fields.get("createdAt", {}).get("stringValue", ""),
            "lastSeenAt": fields.get("lastSeenAt", {}).get("stringValue", ""),
            "status": fields.get("status", {}).get("stringValue", ""),
            "orderedBy": field_path,
        }
    return {}


def fs_get_source_freshness(token: str) -> dict:
    latest_created = {}
    latest_seen = {}
    try:
        latest_created = fs_get_latest_song_field(token, "createdAt")
    except Exception as e:
        log_warn(f"  [WARN] latest source createdAt query failed: {e}")
    try:
        latest_seen = fs_get_latest_song_field(token, "lastSeenAt")
    except Exception as e:
        log_warn(f"  [WARN] latest source lastSeenAt query failed: {e}")

    now = datetime.now(timezone.utc)
    latest_created_at = parse_iso_datetime(latest_created.get("createdAt", ""))
    latest_seen_at = parse_iso_datetime(latest_seen.get("lastSeenAt", ""))
    source_content_age_hours = (
        round((now - latest_created_at).total_seconds() / 3600, 2)
        if latest_created_at
        else None
    )
    source_seen_age_hours = (
        round((now - latest_seen_at).total_seconds() / 3600, 2)
        if latest_seen_at
        else None
    )

    return {
        "latestCreatedSong": latest_created,
        "latestSeenSong": latest_seen,
        "sourceContentAgeHours": source_content_age_hours,
        "sourceSeenAgeHours": source_seen_age_hours,
        "sourceIdleThresholdHours": SOURCE_IDLE_HOURS,
        "sourceScanStaleThresholdHours": SOURCE_SCAN_STALE_HOURS,
    }


# ── Catalog age check ──────────────────────────────────────────────────────────
def get_catalog_age(token: str) -> tuple[float | None, str]:
    """Returns (age_hours, generated_at_str). age_hours=None if unreachable."""
    url = (f"https://storage.googleapis.com/storage/v1/b/{CATALOG_BUCKET}"
           f"/o/{urllib.parse.quote(CATALOG_META, safe='')}?alt=media")
    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {token}"})
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            meta = json.loads(r.read())
        generated_at = meta.get("generatedAt", "")
        if not generated_at:
            return None, "unknown"
        dt = datetime.fromisoformat(generated_at.replace("Z", "+00:00"))
        age_hours = (datetime.now(timezone.utc) - dt).total_seconds() / 3600
        return age_hours, generated_at
    except Exception as e:
        log_warn(f"  [WARN] catalog meta fetch failed: {e}")
        return None, "unreachable"


# ── Harvest stats from local report ───────────────────────────────────────────
def read_harvest_report() -> dict:
    report_path = WORK_DIR / "delta_report.json"
    if report_path.exists():
        try:
            return json.loads(report_path.read_text())
        except Exception:
            pass
    return {}


# ── Email ─────────────────────────────────────────────────────────────────────
def send_email(subject: str, html_body: str, config: dict):
    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"]    = config["from"]
    msg["To"]      = config["to"]
    msg.attach(MIMEText(html_body, "html"))

    with smtplib.SMTP_SSL("smtp.gmail.com", 465) as server:
        server.login(config["from"], config["password"])
        server.sendmail(config["from"], [config["to"]], msg.as_string())

    log_info(f"  [EMAIL] Sent: {subject}")


def _row(label: str, value: str, color: str = "#ccc") -> str:
    return (f'<tr><td style="padding:6px 12px;color:#888;font-size:13px">{label}</td>'
            f'<td style="padding:6px 12px;color:{color};font-size:13px;font-weight:600">'
            f'{value}</td></tr>')


def build_digest_html(
    mode: str,
    catalog_age: float | None,
    catalog_ts: str,
    queue: dict,
    songs: dict,
    harvest: dict,
    source: dict,
    partial_harvest_exit: int = 0,
    error_detail: str = "",
) -> str:
    now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    stale = catalog_age is not None and catalog_age > STALE_HOURS
    source_content_age = source.get("sourceContentAgeHours")
    source_seen_age = source.get("sourceSeenAgeHours")
    source_idle = source_content_age is not None and source_content_age > SOURCE_IDLE_HOURS
    source_scan_stale = source_seen_age is not None and source_seen_age > SOURCE_SCAN_STALE_HOURS

    if error_detail:
        header_bg = "#2b0f0f"
        header_color = "#ff6a6a"
        status_icon = "🚨"
        status_text = "PIPELINE FAILURE"
    elif partial_harvest_exit:
        header_bg = "#2b1f0f"
        header_color = "#ffaa44"
        status_icon = "⚠️"
        status_text = "HARVEST PARTIAL"
    elif source_scan_stale:
        header_bg = "#2b0f0f"
        header_color = "#ff6a6a"
        status_icon = "🚨"
        status_text = "SOURCE SCAN STALE"
    elif source_idle:
        header_bg = "#2b1f0f"
        header_color = "#ffaa44"
        status_icon = "⚠️"
        status_text = "SOURCE IDLE"
    elif stale:
        header_bg = "#2b1f0f"
        header_color = "#ffaa44"
        status_icon = "⚠️"
        status_text = "CATALOG STALE"
    else:
        header_bg = "#0f2b1a"
        header_color = "#4aff8a"
        status_icon = "✅"
        status_text = "PIPELINE HEALTHY"

    catalog_age_str = f"{catalog_age:.1f}h ago" if catalog_age is not None else "unknown"
    catalog_color   = "#ff6a6a" if stale else "#4aff8a"
    source_content_age_str = f"{source_content_age:.1f}h ago" if source_content_age is not None else "unknown"
    source_seen_age_str = f"{source_seen_age:.1f}h ago" if source_seen_age is not None else "unknown"
    source_content_color = "#ff6a6a" if source_idle else "#4aff8a"
    source_seen_color = "#ff6a6a" if source_scan_stale else "#4aff8a"

    per_handle = harvest.get("per_handle", [])
    harvest_rows = ""
    for h in per_handle:
        if "error" in h:
            harvest_rows += _row(h.get("handle","?"), f"ERROR: {h['error']}", "#ff6a6a")
        else:
            harvest_rows += _row(
                h.get("handle","?"),
                f"new={h.get('new_clips',0)}  missing_gcs={h.get('missing_gcs',0)}  delta={h.get('delta_rows',0)}",
            )

    error_section = ""
    if error_detail:
        error_section = f"""
        <div style="background:#1a0808;border:1px solid #ff3333;border-radius:8px;
                    padding:14px;margin:16px 0;font-family:monospace;font-size:12px;
                    color:#ffaaaa;white-space:pre-wrap;word-break:break-all">
{error_detail[:2000]}
        </div>"""
    elif partial_harvest_exit:
        error_section = f"""
        <div style="background:#1f1608;border:1px solid #ffaa44;border-radius:8px;
                    padding:14px;margin:16px 0;font-family:monospace;font-size:12px;
                    color:#ffd7aa;white-space:pre-wrap;word-break:break-all">
Harvest completed with partial media failures (exit code {partial_harvest_exit}).
Catalog export was still rebuilt from the successfully synced items.
        </div>"""

    return f"""<!DOCTYPE html>
<html><body style="background:#0a0a1a;font-family:Arial,sans-serif;margin:0;padding:20px">
<div style="max-width:600px;margin:0 auto">

  <!-- Header -->
  <div style="background:{header_bg};border-radius:12px;padding:20px 24px;margin-bottom:16px">
    <div style="font-size:22px;font-weight:700;color:{header_color}">
      {status_icon} Aeonimus Pipeline — {status_text}
    </div>
    <div style="color:#666;font-size:12px;margin-top:4px">{now} · {mode}</div>
  </div>

  <!-- Catalog -->
  <div style="background:#12121f;border-radius:10px;padding:16px;margin-bottom:12px">
    <div style="color:#7c6fff;font-size:11px;font-weight:700;letter-spacing:.08em;
                text-transform:uppercase;margin-bottom:10px">Catalog</div>
    <table style="width:100%;border-collapse:collapse">
      {_row("Last updated", catalog_age_str, catalog_color)}
      {_row("Updated at", catalog_ts[:19].replace("T"," "))}
      {_row("Total songs", str(songs.get("active",0) + songs.get("removed_from_suno",0)))}
      {_row("Active", str(songs.get("active",0)), "#4aff8a")}
      {_row("Removed from Suno", str(songs.get("removed_from_suno",0)), "#888")}
      {_row("Published to YouTube", str(songs.get("yt_done",0)), "#4a9fff")}
      {_row("YouTube errors", str(songs.get("yt_error",0)), "#ff6a6a" if songs.get("yt_error",0) > 0 else "#888")}
    </table>
  </div>

  <!-- Source freshness -->
  <div style="background:#12121f;border-radius:10px;padding:16px;margin-bottom:12px">
    <div style="color:#7c6fff;font-size:11px;font-weight:700;letter-spacing:.08em;
                text-transform:uppercase;margin-bottom:10px">Source Freshness</div>
    <table style="width:100%;border-collapse:collapse">
      {_row("Newest source song age", source_content_age_str, source_content_color)}
      {_row("Newest source song at", str(source.get("latestCreatedSong", {}).get("createdAt", ""))[:19].replace("T"," "))}
      {_row("Newest source title", str(source.get("latestCreatedSong", {}).get("title", "")) or "unknown")}
      {_row("Latest source scan age", source_seen_age_str, source_seen_color)}
      {_row("Latest source seen at", str(source.get("latestSeenSong", {}).get("lastSeenAt", ""))[:19].replace("T"," "))}
      {_row("Latest source handle", str(source.get("latestSeenSong", {}).get("accountHandle", "")) or "unknown")}
    </table>
  </div>

  <!-- Upload queue -->
  <div style="background:#12121f;border-radius:10px;padding:16px;margin-bottom:12px">
    <div style="color:#7c6fff;font-size:11px;font-weight:700;letter-spacing:.08em;
                text-transform:uppercase;margin-bottom:10px">Upload Queue</div>
    <table style="width:100%;border-collapse:collapse">
      {_row("Queued",    str(queue.get("queued",0)))}
      {_row("Uploading", str(queue.get("uploading",0)))}
      {_row("Done",      str(queue.get("done",0)), "#4aff8a")}
      {_row("Errors",    str(queue.get("error",0)),
             "#ff6a6a" if queue.get("error",0) > 0 else "#888")}
    </table>
  </div>

  <!-- Harvest -->
  {"" if not per_handle else f'''
  <div style="background:#12121f;border-radius:10px;padding:16px;margin-bottom:12px">
    <div style="color:#7c6fff;font-size:11px;font-weight:700;letter-spacing:.08em;
                text-transform:uppercase;margin-bottom:10px">Last Harvest</div>
    <table style="width:100%;border-collapse:collapse">
      {harvest_rows}
      {_row("Total delta rows", str(harvest.get("total_delta_rows",0)))}
    </table>
  </div>'''}

  {error_section}

  <!-- Footer -->
  <div style="text-align:center;color:#333;font-size:11px;margin-top:16px">
    sundrop pipeline monitor · <a href="https://music.aeonimus.info" style="color:#555">music.aeonimus.info</a>
  </div>
</div>
</body></html>"""


def build_status_summary(
    mode: str,
    catalog_age: float | None,
    catalog_ts: str,
    queue: dict,
    songs: dict,
    harvest: dict,
    source: dict,
    partial_harvest_exit: int = 0,
    error_detail: str = "",
) -> dict:
    stale = catalog_age is not None and catalog_age > STALE_HOURS
    queue_errors = queue.get("error", 0)
    source_content_age = source.get("sourceContentAgeHours")
    source_seen_age = source.get("sourceSeenAgeHours")
    source_idle = source_content_age is not None and source_content_age > SOURCE_IDLE_HOURS
    source_scan_stale = source_seen_age is not None and source_seen_age > SOURCE_SCAN_STALE_HOURS

    if error_detail:
        status = "failure"
        email_reason = "alert"
    elif partial_harvest_exit:
        status = "partial_harvest"
        email_reason = "partial_harvest"
    elif source_scan_stale:
        status = "source_scan_stale"
        email_reason = "source_scan_stale"
    elif source_idle:
        status = "source_idle"
        email_reason = "source_idle"
    elif stale:
        status = "stale"
        email_reason = "catalog_stale"
    elif queue_errors > 0:
        status = "queue_errors"
        email_reason = "queue_errors"
    else:
        status = "healthy"
        email_reason = ""

    return {
        "checkedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "mode": mode,
        "status": status,
        "emailReason": email_reason,
        "catalogGeneratedAt": catalog_ts,
        "catalogAgeHours": None if catalog_age is None else round(catalog_age, 2),
        "staleHoursThreshold": STALE_HOURS,
        "queueCounts": queue,
        "songCounts": songs,
        "harvestSummary": harvest,
        "sourceFreshness": source,
        "partialHarvestExitCode": partial_harvest_exit,
        "errorDetail": error_detail[:2000] if error_detail else "",
    }


def write_status_summary(summary: dict):
    try:
        STATUS_SUMMARY_PATH.write_text(json.dumps(summary, indent=2), encoding="utf-8")
        log_info(f"[monitor] Wrote status summary -> {STATUS_SUMMARY_PATH}")
    except Exception as e:
        log_warn(f"[monitor] WARN: could not write status summary: {e}")


# ── Main modes ────────────────────────────────────────────────────────────────
def run(mode: str, error_detail: str = "", partial_harvest_exit: int = 0):
    log_info(f"[monitor] mode={mode}")

    token = get_gcp_token()

    # Gather stats
    catalog_age, catalog_ts = get_catalog_age(token)
    queue   = fs_query_status_counts(token)
    songs   = fs_count_songs(token)
    harvest = read_harvest_report()
    source  = fs_get_source_freshness(token)

    stale       = catalog_age is not None and catalog_age > STALE_HOURS
    queue_errors = queue.get("error", 0)
    source_content_age = source.get("sourceContentAgeHours")
    source_seen_age = source.get("sourceSeenAgeHours")
    source_idle = source_content_age is not None and source_content_age > SOURCE_IDLE_HOURS
    source_scan_stale = source_seen_age is not None and source_seen_age > SOURCE_SCAN_STALE_HOURS
    summary = build_status_summary(
        mode,
        catalog_age,
        catalog_ts,
        queue,
        songs,
        harvest,
        source,
        partial_harvest_exit=partial_harvest_exit,
        error_detail=error_detail,
    )
    write_status_summary(summary)
    log_info(
        "[monitor] summary "
        f"status={summary['status']} "
        f"catalog_age_hours={summary['catalogAgeHours']} "
        f"source_content_age_hours={source_content_age} "
        f"source_seen_age_hours={source_seen_age} "
        f"queue_errors={queue_errors}"
    )

    # Determine subject
    if error_detail:
        subject = f"🚨 Aeonimus HARVEST FAILED — {datetime.now(timezone.utc).strftime('%Y-%m-%d')}"
    elif partial_harvest_exit:
        subject = f"⚠️ Aeonimus HARVEST PARTIAL (exit {partial_harvest_exit}) — {datetime.now(timezone.utc).strftime('%Y-%m-%d')}"
    elif source_scan_stale:
        subject = f"🚨 Aeonimus Source SCAN STALE ({source_seen_age:.0f}h) — {datetime.now(timezone.utc).strftime('%Y-%m-%d')}"
    elif source_idle:
        subject = f"⚠️ Aeonimus Source IDLE ({source_content_age:.0f}h) — {datetime.now(timezone.utc).strftime('%Y-%m-%d')}"
    elif stale:
        subject = f"⚠️ Aeonimus Catalog STALE ({catalog_age:.0f}h) — {datetime.now(timezone.utc).strftime('%Y-%m-%d')}"
    elif queue_errors > 0:
        subject = f"⚠️ Aeonimus Upload Queue has {queue_errors} error(s) — {datetime.now(timezone.utc).strftime('%Y-%m-%d')}"
    else:
        subject = f"✅ Aeonimus Pipeline OK — {datetime.now(timezone.utc).strftime('%Y-%m-%d')}"

    # Skip digest email if healthy and mode is post-harvest (avoid email spam on every run)
    # Only send on: failure, stale, daily-digest mode
    if (
        mode == "post-harvest"
        and not error_detail
        and not partial_harvest_exit
        and not source_scan_stale
        and not source_idle
        and not stale
        and queue_errors == 0
    ):
        log_info("[monitor] Pipeline healthy - skipping digest email (daily-digest will send it)")
        return

    # Load email config only when email sending is actually required.
    try:
        cfg_raw = get_secret(token, SECRET_MONITOR)
        email_cfg = json.loads(cfg_raw)
    except Exception as e:
        log_warn(f"[monitor] WARN: could not load email config from Secret Manager: {e}")
        log_info("[monitor] Set up secret 'pipeline-monitor-config' to enable email alerts.")
        return

    html = build_digest_html(
        mode,
        catalog_age,
        catalog_ts,
        queue,
        songs,
        harvest,
        source,
        partial_harvest_exit=partial_harvest_exit,
        error_detail=error_detail,
    )

    try:
        send_email(subject, html, email_cfg)
    except Exception as e:
        log_warn(f"[monitor] ERROR sending email: {e}")


def main():
    parser = argparse.ArgumentParser(description="Aeonimus pipeline health monitor")
    parser.add_argument("--mode", default="daily-digest",
                        choices=["post-harvest", "alert", "daily-digest"],
                        help="Execution mode")
    parser.add_argument("--error", default="",
                        help="Error detail string (used with --mode alert)")
    parser.add_argument("--partial-harvest-exit", type=int, default=0,
                        help="Non-zero exit code from media harvest when export still rebuilt")
    args = parser.parse_args()
    run(args.mode, error_detail=args.error, partial_harvest_exit=args.partial_harvest_exit)


if __name__ == "__main__":
    main()
