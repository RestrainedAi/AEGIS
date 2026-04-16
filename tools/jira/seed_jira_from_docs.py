#!/usr/bin/env python3
"""
Seed Jira issues from repo docs.

Reads:
  - AEGIS/docs/codex/SUNO_Youtube_Pipeline_Implementation_Epics_and_Tickets.md
  - AEGIS/docs/codex/SUNO_Youtube_Pipeline_First_Wave_Ticket_Board.md

Creates:
  - Epics (one per "## EPIC N: Title")
  - Tasks for first-wave tickets (AEGIS-xxx, AEGIS-Dxxx)

Links tasks to epics when possible and applies labels so the board is usable immediately.

Auth:
  - Jira Cloud API token (Basic auth with email:token)
"""

from __future__ import annotations

import argparse
import base64
import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Any


REPO_ROOT = Path(__file__).resolve().parents[2]
AEGIS_DIR = REPO_ROOT / "AEGIS"

DOC_EPICS = AEGIS_DIR / "docs" / "codex" / "SUNO_Youtube_Pipeline_Implementation_Epics_and_Tickets.md"
DOC_BOARD = AEGIS_DIR / "docs" / "codex" / "SUNO_Youtube_Pipeline_First_Wave_Ticket_Board.md"


@dataclass(frozen=True)
class Epic:
    num: int
    title: str
    summary: str
    description: str
    labels: list[str]


@dataclass(frozen=True)
class Task:
    key_hint: str  # e.g. "AEGIS-003"
    summary: str
    description: str
    labels: list[str]
    epic_num: int | None


def die(msg: str) -> None:
    raise SystemExit(msg)


def env(name: str, default: str | None = None) -> str:
    v = os.environ.get(name, default)
    if v is None or not str(v).strip():
        die(f"Missing required env var: {name}")
    return str(v).strip()


def jira_req(method: str, url: str, auth_header: str, body: dict | None = None) -> Any:
    data = None
    headers = {"Authorization": auth_header, "Accept": "application/json"}
    if body is not None:
        data = json.dumps(body).encode("utf-8")
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            raw = r.read()
            if not raw:
                return None
            return json.loads(raw)
    except urllib.error.HTTPError as e:
        body_text = ""
        try:
            raw = e.read()
            body_text = raw.decode("utf-8", errors="replace")
        except Exception:
            body_text = ""
        detail = f"HTTP {e.code} calling {method} {url}"
        if body_text:
            detail += f"\n{body_text[:2000]}"
        die(detail)


def jira_auth_header(email: str, token: str) -> str:
    b = base64.b64encode(f"{email}:{token}".encode("utf-8")).decode("ascii")
    return f"Basic {b}"


def jira_get_myself(base_url: str, auth: str) -> dict[str, Any]:
    return jira_req("GET", f"{base_url}/rest/api/3/myself", auth)


def jira_get_project(base_url: str, auth: str, project_key: str) -> dict[str, Any]:
    return jira_req("GET", f"{base_url}/rest/api/3/project/{project_key}", auth)


def read_text(p: Path) -> str:
    if not p.exists():
        die(f"Missing doc file: {p}")
    return p.read_text(encoding="utf-8", errors="replace")


EPIC_RE = re.compile(r"^## EPIC\s+(?P<num>\d+):\s+(?P<title>.+?)\s*$", re.M)


def parse_epics(md: str) -> list[Epic]:
    matches = list(EPIC_RE.finditer(md))
    epics: list[Epic] = []
    for i, m in enumerate(matches):
        num = int(m.group("num"))
        title = m.group("title").strip()
        start = m.end()
        end = matches[i + 1].start() if i + 1 < len(matches) else len(md)
        chunk = md[start:end].strip()
        summary = f"EPIC {num}: {title}"
        desc = chunk
        labels = ["seeded-by-codex", "from-docs", f"epic-{num}"]
        epics.append(Epic(num=num, title=title, summary=summary, description=desc, labels=labels))
    return epics


TICKET_H3_RE = re.compile(r"^###\s+(AEGIS-(?:D)?\d+)\s*$", re.M)


def _extract_block(md: str, start_idx: int, end_idx: int) -> str:
    return md[start_idx:end_idx].strip()


def parse_first_wave_tasks(md: str) -> list[Task]:
    matches = list(TICKET_H3_RE.finditer(md))
    tasks: list[Task] = []
    for i, m in enumerate(matches):
        key_hint = m.group(1).strip()
        start = m.end()
        end = matches[i + 1].start() if i + 1 < len(matches) else len(md)
        block = _extract_block(md, start, end)

        # Parse "- Title:" when present; else fallback to first non-empty line.
        title_m = re.search(r"^- Title:\s*(.+?)\s*$", block, flags=re.M)
        title = title_m.group(1).strip() if title_m else (block.splitlines()[0].strip() if block else key_hint)
        summary = f"{key_hint} {title}"

        # Heuristic epic mapping (best-effort; still labeled even if not linked).
        epic_num = None
        if key_hint in {"AEGIS-002", "AEGIS-007"}:
            epic_num = 2
        elif key_hint in {"AEGIS-001", "AEGIS-006", "AEGIS-009"}:
            epic_num = 6
        elif key_hint in {"AEGIS-003", "AEGIS-004"}:
            epic_num = 7
        elif key_hint in {"AEGIS-005"}:
            epic_num = 8
        elif key_hint in {"AEGIS-008"}:
            epic_num = 1
        elif key_hint.startswith("AEGIS-D"):
            epic_num = 15

        labels = ["seeded-by-codex", "from-first-wave", key_hint.lower()]
        tasks.append(Task(key_hint=key_hint, summary=summary, description=block, labels=labels, epic_num=epic_num))
    return tasks


def jira_find_field_ids(base_url: str, auth: str) -> dict[str, str]:
    """
    Returns a mapping of Jira field display names -> field ids.
    We only need Epic Name and Epic Link (names vary slightly across instances).
    """
    fields = jira_req("GET", f"{base_url}/rest/api/3/field", auth)
    out: dict[str, str] = {}
    for f in fields:
        name = f.get("name")
        fid = f.get("id")
        if isinstance(name, str) and isinstance(fid, str):
            out[name] = fid
    return out


def jira_adf(text: str) -> dict:
    # Minimal Atlassian Document Format (ADF) doc from plain text.
    # Jira v3 create issue requires ADF for description in many configs.
    return {
        "type": "doc",
        "version": 1,
        "content": [
            {
                "type": "paragraph",
                "content": [{"type": "text", "text": text[:30000]}],
            }
        ],
    }


def jira_search_by_summary(base_url: str, auth: str, project_key: str, summary: str) -> str | None:
    jql = f'project = "{project_key}" AND summary ~ {json.dumps(summary)} ORDER BY created DESC'
    data = jira_req(
        "POST",
        f"{base_url}/rest/api/3/search/jql",
        auth,
        {
            "jql": jql,
            "maxResults": 1,
            "fields": ["summary"],
            "fieldsByKeys": False,
        },
    )
    issues = (data or {}).get("issues") or []
    if not issues:
        return None
    # Only treat as match if summary is exactly equal (avoid fuzzy collisions).
    it = issues[0]
    if (it.get("fields") or {}).get("summary") == summary:
        return it.get("key")
    return None


def jira_create_issue(base_url: str, auth: str, fields: dict) -> str:
    data = jira_req("POST", f"{base_url}/rest/api/3/issue", auth, {"fields": fields})
    key = (data or {}).get("key")
    if not key:
        die(f"Failed to create issue: {data}")
    return key


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true", help="Print what would be created, do not call Jira.")
    args = ap.parse_args()

    base_url = env("JIRA_BASE_URL", "https://aeonimusai.atlassian.net")
    email = env("JIRA_EMAIL", "")
    token = env("JIRA_API_TOKEN", "")
    project_key = env("JIRA_PROJECT_KEY", "DEV")
    if email.lower() == "you@yourdomain.com":
        die("JIRA_EMAIL is still set to the placeholder value 'you@yourdomain.com'. Use the real Jira account email for the API token owner.")
    auth = jira_auth_header(email, token)

    # Optional diagnostics: print API-authenticated user + project data (helps detect wrong token/email pairing)
    try:
        user = jira_get_myself(base_url, auth)
        print(f"Authenticated Jira user: {user.get('displayName')} <{user.get('emailAddress')}> (accountId={user.get('accountId')})")
    except Exception as exc:
        print(f"Warning: failed to fetch authenticated user: {exc}")

    try:
        project = jira_get_project(base_url, auth, project_key)
        print(f"Project access: {project.get('key')} - {project.get('name')} (type={project.get('projectTypeKey')})")
    except Exception as exc:
        print(f"Warning: failed to fetch project info for {project_key}: {exc}")

    md_epics = read_text(DOC_EPICS)
    md_board = read_text(DOC_BOARD)
    epics = parse_epics(md_epics)
    tasks = parse_first_wave_tasks(md_board)

    if args.dry_run:
        print(f"Would create {len(epics)} epics and {len(tasks)} first-wave tasks in {project_key}.")
        print("First 5 epics:")
        for e in epics[:5]:
            print("  -", e.summary)
        print("First 10 tasks:")
        for t in tasks[:10]:
            print("  -", t.summary, f"(epic {t.epic_num})")
        return 0

    field_ids = jira_find_field_ids(base_url, auth)
    epic_name_fid = field_ids.get("Epic Name")
    if not epic_name_fid:
        print("Warning: Could not find Jira field id for 'Epic Name'. Proceeding without it and relying on Summary for epic naming.")

    epic_keys: dict[int, str] = {}

    # Create epics first.
    for e in epics:
        existing = jira_search_by_summary(base_url, auth, project_key, e.summary)
        if existing:
            epic_keys[e.num] = existing
            continue
        fields = {
            "project": {"key": project_key},
            "summary": e.summary,
            "issuetype": {"name": "Epic"},
            "labels": e.labels,
            "description": jira_adf(e.description),
        }
        if epic_name_fid:
            fields[epic_name_fid] = e.summary  # keep it simple: epic name mirrors summary
        key = jira_create_issue(base_url, auth, fields)
        epic_keys[e.num] = key

    # Create tasks.
    for t in tasks:
        existing = jira_search_by_summary(base_url, auth, project_key, t.summary)
        if existing:
            continue
        fields = {
            "project": {"key": project_key},
            "summary": t.summary,
            "issuetype": {"name": "Task"},
            "labels": t.labels + ([f"epic-{t.epic_num}"] if t.epic_num else []),
            "description": jira_adf(t.description),
        }
        if t.epic_num and t.epic_num in epic_keys:
            # Jira Cloud is standardizing parent linkage across project types.
            # Use parent instead of the deprecated Epic Link custom field.
            fields["parent"] = {"key": epic_keys[t.epic_num]}
        jira_create_issue(base_url, auth, fields)

    print("Done: Jira seeding complete.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
