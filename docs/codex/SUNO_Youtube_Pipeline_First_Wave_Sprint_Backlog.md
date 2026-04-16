# AEGIS First-Wave Sprint Backlog

## Product

AEGIS: SUNO YouTube Pipeline

## Purpose

This backlog is the first implementation cut intended for immediate engineering execution.

## Priority Legend

1. `P0` = must happen before broader feature work
2. `P1` = high-value immediate follow-on
3. `P2` = important, but can follow once foundations are stabilized

## Sprint Goal

Reduce ambiguity in production authority and remove the highest-risk technical mismatches blocking reliable coding.

---

## Ticket 1: Confirm Authoritative Catalog Export Generator

- Priority: `P0`
- Type: investigation plus documentation
- Dependencies: none

### Problem

Viewer freshness depends on a GCS CSV export path, but the authoritative generator and refresh trigger need to be confirmed explicitly before automation changes are made.

### Primary Files

1. `yt-ingest/rebuild_catalog.py`
2. `suno-viewer/server.js`
3. `yt-ingest/daily_suno_job.sh`
4. root `daily_suno_job.sh`

### Tasks

1. verify whether `rebuild_catalog.py` is the canonical generator for `latest_catalog_wide.csv`
2. trace how and when it currently runs
3. identify whether export generation is chained, scheduled, or manual
4. document the confirmed export dependency path

### Acceptance Criteria

1. one short engineering note exists naming the authoritative export generator
2. the refresh trigger path is described clearly
3. the viewer dependency on the generated artifact is confirmed

---

## Ticket 2: Standardize YouTube API Environment Naming

- Priority: `P0`
- Type: code plus documentation
- Dependencies: none

### Problem

The code uses conflicting env names such as `YT_API_KEY` and `YOUTUBE_API_KEY`, which creates path-specific breakage risk.

### Primary Files

1. `yt-ingest/index.ts`
2. `yt-ingest/lib/youtube.ts`
3. deployment scripts referencing API keys

### Tasks

1. inventory actual env usage
2. choose canonical env name
3. update runtime code to use canonical naming
4. add temporary backward-compatible alias if needed
5. document the standard in `docs/codex/`

### Acceptance Criteria

1. one canonical env variable name is used in the main code path
2. legacy alias behavior is explicit, if retained
3. runtime config documentation is updated

---

## Ticket 3: Define Dedicated `ytUploadQueue` Schema

- Priority: `P0`
- Type: design plus code
- Dependencies: none

### Problem

Queue records currently appear to overload Firestore `items`, which collides semantically with ingest/catalog records.

### Primary Files

1. `yt-ingest/queue_manager.py`
2. `yt-ingest/youtube_uploader.py`
3. production workflow spec in `docs/codex/`

### Tasks

1. define the target queue collection name
2. define the minimum queue schema
3. define queue statuses and allowed transitions
4. document dedupe and idempotency behavior

### Acceptance Criteria

1. queue collection name is approved
2. queue schema is documented
3. queue status model is documented

---

## Ticket 4: Update Queue Manager To Use `ytUploadQueue`

- Priority: `P1`
- Type: code
- Dependencies: Ticket 3

### Problem

Queue processing should use the dedicated queue collection rather than `items`.

### Primary Files

1. `yt-ingest/queue_manager.py`

### Tasks

1. switch queue reads and writes to `ytUploadQueue`
2. preserve current processing semantics where possible
3. add any necessary migration guards

### Acceptance Criteria

1. queue manager no longer uses `items` for upload queue behavior
2. queue status updates work against `ytUploadQueue`
3. code comments or docstrings explain any transition logic

---

## Ticket 5: Align YouTube Uploader With Real SUNO Media Schema

- Priority: `P0`
- Type: code
- Dependencies: none

### Problem

The uploader expects a media field that does not appear to match the Firestore write shape from SUNO indexing.

### Primary Files

1. `yt-ingest/youtube_uploader.py`
2. `yt-ingest/firestore_upsert.py`

### Tasks

1. compare uploader input expectations with real `sunoSongs` field shape
2. update uploader to resolve media from `media.videoUrl` or the approved canonical field
3. add direct `gs://` parsing support
4. validate behavior against real or representative sample docs

### Acceptance Criteria

1. uploader resolves the correct media path from indexed SUNO docs
2. `gs://` URIs are supported explicitly
3. a sample validation path is documented

---

## Ticket 6: Decide and Implement Post-Harvest Catalog Rebuild Orchestration

- Priority: `P0`
- Type: design plus code
- Dependencies: Ticket 1

### Problem

The catalog rebuild path exists, but it is not clearly guaranteed to run after successful harvest completion.

### Primary Files

1. `yt-ingest/rebuild_catalog.py`
2. `yt-ingest/daily_suno_job.sh`
3. root `daily_suno_job.sh`
4. any deploy scripts used for harvest jobs

### Tasks

1. choose orchestration mode: inline, chained job, or separate scheduled job
2. implement the selected orchestration
3. log success and failure
4. expose last successful rebuild timestamp if practical

### Acceptance Criteria

1. harvest completion reliably causes a catalog rebuild
2. rebuild success and failure are logged
3. operators have a clear recovery path when rebuild fails

---

## Ticket 7: Audit and Remove Checked-In Secrets

- Priority: `P0`
- Type: security and repo hygiene
- Dependencies: none

### Problem

The repo contains checked-in secrets and sensitive operational artifacts.

### Primary Files

1. `client_secret.json`
2. auth and deploy helper scripts

### Tasks

1. inventory checked-in secrets and sensitive artifacts
2. remove them from the repo where safe
3. rotate any affected credentials
4. document approved secret handling path

### Acceptance Criteria

1. no active secrets remain in tracked source
2. affected credentials are rotated
3. secret handling guidance is documented

---

## Ticket 8: Document Canonical Ops Entry Points

- Priority: `P1`
- Type: documentation
- Dependencies: Ticket 1

### Problem

Multiple scripts exist for similar operational duties. Engineers need one documented entrypoint list before making runtime changes.

### Primary Files

1. `docs/codex/SUNO_Youtube_Pipeline_Repo_Overview.md`
2. `docs/codex/SUNO_SUNO_To_YouTube_Production_Workflow_Spec.md`
3. active deployment and scheduler scripts

### Tasks

1. label each major script as active, transitional, or stale
2. identify canonical entrypoints for harvest, export, viewer, and upload
3. update docs with the final entrypoint list

### Acceptance Criteria

1. canonical operational entrypoints are documented
2. engineers can identify what not to use

---

## Ticket 9: Add Minimal Export Freshness Visibility

- Priority: `P1`
- Type: code plus observability
- Dependencies: Ticket 6

### Problem

The team needs a quick way to determine whether the viewer is current without manual bucket inspection.

### Primary Files

1. `yt-ingest/rebuild_catalog.py`
2. `suno-viewer/server.js`
3. any logging or metadata destination used by active jobs

### Tasks

1. record last successful export timestamp
2. make freshness visible in logs or a simple endpoint/metadata file
3. document how operators can check freshness

### Acceptance Criteria

1. export freshness can be checked without deep manual investigation
2. the check path is documented

---

## Suggested Execution Order

1. Ticket 1
2. Ticket 2
3. Ticket 3
4. Ticket 5
5. Ticket 6
6. Ticket 7
7. Ticket 4
8. Ticket 8
9. Ticket 9

## Definition of Done for First Wave

1. authoritative export path is confirmed
2. env naming drift is reduced
3. uploader matches the real SUNO schema
4. queue semantics are separated from content records
5. catalog rebuild is wired into harvest completion
6. checked-in secrets are removed
7. operators can tell whether the viewer export is fresh
