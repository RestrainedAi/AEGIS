# AEGIS First-Wave Ticket Board

## Product

AEGIS: SUNO YouTube Pipeline

## Purpose

This document reformats the first-wave sprint backlog into a board-ready delivery view for immediate engineering pickup.

## Board Columns

This first-wave view is a planning baseline. The [repo delivery board](../board/README.md) and its `tasks.json` hold recorded board state. Apply [Development DNA](DEVELOPMENT_PRINCIPLES.md) and the [feature brief](templates/FEATURE_BRIEF.md): one accountable owner per feature, bounded specialist tasks, inspected handoffs, and integrated acceptance evidence before closure. Preserve the original proposals below; this policy update does not mark them completed or create external issues.

1. Backlog
2. Ready
3. In Progress
4. Review
5. Done
6. Blocked

## Priority Scale

1. `P0` = must complete before broader feature work
2. `P1` = high-value immediate follow-on
3. `P2` = important but can wait until foundations stabilize

## Size Scale

1. `S` = small
2. `M` = medium
3. `L` = large
4. `XL` = extra large

## Recommended Owners

1. `Platform`
2. `Backend`
3. `Ops`
4. `Product`
5. `Design`
6. `Security`

## Status Update - 2026-03-22

1. `AEGIS-001` is effectively complete.
   - `yt-ingest/rebuild_catalog.py` is confirmed as the authoritative viewer export generator.
   - `suno-viewer/server.js` serves `/catalog.csv` from `gs://aeonimus-workspaces/exports/suno/latest_catalog_wide.csv`.
2. `AEGIS-005` is effectively complete on the Vault boundary.
   - The live Publish flow writes `ytUploadQueue` entries from the Vault UI and carries `gcsVideoUrl` sourced from Firestore `sunoSongs.media.videoUrl`.
3. `AEGIS-006` is effectively complete for current operations.
   - Post-harvest rebuild is wired in `yt-ingest/daily_suno_job.sh`.
   - A manual rebuild was successfully run on 2026-03-22 after metadata repair.
4. `AEGIS-003` is partially validated and now blocked downstream rather than in the Vault.
   - `ytUploadQueue` is live and receiving queue docs from `https://music.aeonimus.info/vanessa`.
   - Current blocker is uploader-side `401 Unauthorized`, observed on queued items after the Vault handed them off correctly.
5. SUNO Vault recovery status:
   - live Vanessa catalog moved from 1,562 empty titles to 202 empty titles after Firestore metadata repair plus export rebuild
   - 138 of the remaining untitled Vanessa rows are already `removed_from_suno`
   - no new SUNO media downloads were run during this recovery pass

---

## Ready

### AEGIS-001

- Title: Confirm authoritative catalog export generator
- Priority: `P0`
- Size: `M`
- Owner: `Platform`
- Status: `Ready`
- Depends on: none
- Risk: high

Problem:

Viewer freshness depends on a GCS CSV export path, but the authoritative generator and refresh trigger must be confirmed before automation changes are made.

Primary files:

1. `yt-ingest/rebuild_catalog.py`
2. `suno-viewer/server.js`
3. `yt-ingest/daily_suno_job.sh`
4. root `daily_suno_job.sh`

Tasks:

1. verify whether `rebuild_catalog.py` is the canonical generator for `latest_catalog_wide.csv`
2. trace how and when it currently runs
3. identify whether export generation is chained, scheduled, or manual
4. document the confirmed export dependency path

Acceptance criteria:

1. one short engineering note exists naming the authoritative export generator
2. the refresh trigger path is described clearly
3. the viewer dependency on the generated artifact is confirmed

Test notes:

1. verify generated export path matches the path served by `suno-viewer/server.js`
2. verify notes are grounded in checked-in code or deployed job evidence

### AEGIS-002

- Title: Standardize YouTube API environment naming
- Priority: `P0`
- Size: `M`
- Owner: `Backend`
- Status: `Ready`
- Depends on: none
- Risk: medium

Problem:

The code uses conflicting env names such as `YT_API_KEY` and `YOUTUBE_API_KEY`, which creates path-specific breakage risk.

Primary files:

1. `yt-ingest/index.ts`
2. `yt-ingest/lib/youtube.ts`
3. deployment scripts referencing API keys

Tasks:

1. inventory actual env usage
2. choose canonical env name
3. update runtime code to use canonical naming
4. add temporary backward-compatible alias if needed
5. document the standard in `docs/codex/`

Acceptance criteria:

1. one canonical env variable name is used in the main code path
2. legacy alias behavior is explicit if retained
3. runtime config documentation is updated

Test notes:

1. verify both main YouTube code paths resolve config correctly
2. verify no references to deprecated names remain without transition comment

### AEGIS-003

- Title: Define dedicated `ytUploadQueue` schema
- Priority: `P0`
- Size: `M`
- Owner: `Backend`
- Status: `Ready`
- Depends on: none
- Risk: high

Problem:

Queue records currently appear to overload Firestore `items`, which collides semantically with ingest and catalog records.

Primary files:

1. `yt-ingest/queue_manager.py`
2. `yt-ingest/youtube_uploader.py`
3. `docs/codex/SUNO_SUNO_To_YouTube_Production_Workflow_Spec.md`

Tasks:

1. define the target queue collection name
2. define the minimum queue schema
3. define queue statuses and allowed transitions
4. document dedupe and idempotency behavior

Acceptance criteria:

1. queue collection name is approved
2. queue schema is documented
3. queue status model is documented

Test notes:

1. validate the schema covers create, retry, success, and failure states
2. verify no required uploader fields are omitted

### AEGIS-005

- Title: Align YouTube uploader with real SUNO media schema
- Priority: `P0`
- Size: `M`
- Owner: `Backend`
- Status: `Ready`
- Depends on: none
- Risk: high

Problem:

The uploader expects a media field that does not appear to match the Firestore write shape from SUNO indexing.

Primary files:

1. `yt-ingest/youtube_uploader.py`
2. `yt-ingest/firestore_upsert.py`

Tasks:

1. compare uploader input expectations with real `sunoSongs` field shape
2. update uploader to resolve media from `media.videoUrl` or the approved canonical field
3. add direct `gs://` parsing support
4. validate behavior against real or representative sample docs

Acceptance criteria:

1. uploader resolves the correct media path from indexed SUNO docs
2. `gs://` URIs are supported explicitly
3. a sample validation path is documented

Test notes:

1. run dry validation against sample `sunoSongs` documents
2. confirm fallback path assumptions are removed or documented

### AEGIS-006

- Title: Decide and implement post-harvest catalog rebuild orchestration
- Priority: `P0`
- Size: `L`
- Owner: `Platform`
- Status: `Ready`
- Depends on: `AEGIS-001`
- Risk: high

Problem:

The catalog rebuild path exists, but it is not clearly guaranteed to run after successful harvest completion.

Primary files:

1. `yt-ingest/rebuild_catalog.py`
2. `yt-ingest/daily_suno_job.sh`
3. root `daily_suno_job.sh`
4. deploy scripts used for harvest jobs

Tasks:

1. choose orchestration mode: inline, chained job, or separate scheduled job
2. implement the selected orchestration
3. log success and failure
4. expose last successful rebuild timestamp if practical

Acceptance criteria:

1. harvest completion reliably causes a catalog rebuild
2. rebuild success and failure are logged
3. operators have a clear recovery path when rebuild fails

Test notes:

1. simulate successful harvest completion and verify rebuild trigger
2. simulate rebuild failure and verify log visibility

### AEGIS-007

- Title: Audit and remove checked-in secrets
- Priority: `P0`
- Size: `M`
- Owner: `Security`
- Status: `Ready`
- Depends on: none
- Risk: high

Problem:

The repo contains checked-in secrets and sensitive operational artifacts.

Primary files:

1. `client_secret.json`
2. auth and deploy helper scripts

Tasks:

1. inventory checked-in secrets and sensitive artifacts
2. remove them from the repo where safe
3. rotate any affected credentials
4. document approved secret handling path

Acceptance criteria:

1. no active secrets remain in tracked source
2. affected credentials are rotated
3. secret handling guidance is documented

Test notes:

1. verify replacement auth path exists before removing local secret dependency
2. verify no broken script references remain

---

## Backlog

### AEGIS-004

- Title: Update queue manager to use `ytUploadQueue`
- Priority: `P1`
- Size: `M`
- Owner: `Backend`
- Status: `Backlog`
- Depends on: `AEGIS-003`
- Risk: medium

Problem:

Queue processing should use the dedicated queue collection rather than `items`.

Primary files:

1. `yt-ingest/queue_manager.py`

Tasks:

1. switch queue reads and writes to `ytUploadQueue`
2. preserve current processing semantics where possible
3. add any necessary migration guards

Acceptance criteria:

1. queue manager no longer uses `items` for upload queue behavior
2. queue status updates work against `ytUploadQueue`
3. transition logic is documented where needed

### AEGIS-008

- Title: Document canonical ops entry points
- Priority: `P1`
- Size: `S`
- Owner: `Ops`
- Status: `Backlog`
- Depends on: `AEGIS-001`
- Risk: medium

Problem:

Multiple scripts exist for similar operational duties. Engineers need one documented entrypoint list before making runtime changes.

Primary files:

1. `docs/codex/SUNO_Youtube_Pipeline_Repo_Overview.md`
2. `docs/codex/SUNO_SUNO_To_YouTube_Production_Workflow_Spec.md`
3. active deployment and scheduler scripts

Tasks:

1. label each major script as active, transitional, or stale
2. identify canonical entrypoints for harvest, export, viewer, and upload
3. update docs with the final entrypoint list

Acceptance criteria:

1. canonical operational entrypoints are documented
2. engineers can identify what not to use

### AEGIS-009

- Title: Add minimal export freshness visibility
- Priority: `P1`
- Size: `M`
- Owner: `Platform`
- Status: `Backlog`
- Depends on: `AEGIS-006`
- Risk: medium

Problem:

The team needs a quick way to determine whether the viewer is current without manual bucket inspection.

Primary files:

1. `yt-ingest/rebuild_catalog.py`
2. `suno-viewer/server.js`
3. any logging or metadata destination used by active jobs

Tasks:

1. record last successful export timestamp
2. make freshness visible in logs or a simple endpoint or metadata file
3. document how operators can check freshness

Acceptance criteria:

1. export freshness can be checked without deep manual investigation
2. the check path is documented

---

## Suggested Initial Assignment

### Fermat Immediate Pickup

1. `AEGIS-001`
2. `AEGIS-002`
3. `AEGIS-003`
4. `AEGIS-005`

### Follow Immediately After

1. `AEGIS-006`
2. `AEGIS-007`

### Then Pull

1. `AEGIS-004`
2. `AEGIS-008`
3. `AEGIS-009`

---

## Sprint Exit Criteria

1. authoritative export path is confirmed
2. env naming drift is reduced
3. uploader matches the real SUNO schema
4. queue semantics are separated from content records
5. catalog rebuild is wired into harvest completion
6. checked-in secrets are removed
7. operators can tell whether the viewer export is fresh

---

## Downloader Track Backlog

These tickets should remain out of the first stabilization sprint, but they are now part of the approved expanded target so design and engineering can plan against them explicitly.

### AEGIS-D001

- Title: Define downloader workspace and filter model
- Priority: `P1`
- Size: `L`
- Owner: `Product`
- Status: `Backlog`
- Depends on: `AEGIS-001`
- Risk: medium

Problem:

The competitor product exposes downloader-first filtering, but AEGIS does not yet have a normalized downloader selection model.

Acceptance criteria:

1. workspace or source-group model is defined
2. include filters are defined
3. exclusion rules are defined
4. required backend metadata gaps are identified

### AEGIS-D002

- Title: Define downloader packaging and export options
- Priority: `P1`
- Size: `L`
- Owner: `Product`
- Status: `Backlog`
- Depends on: `AEGIS-D001`
- Risk: medium

Problem:

AEGIS needs explicit downloader output rules for file types, packaging presets, grouping, and zip behavior.

Acceptance criteria:

1. supported file types are documented
2. packaging presets are documented
3. organization and zip rules are documented
4. backend capability gaps are identified

### AEGIS-D003

- Title: Define downloader queue review UX and data model
- Priority: `P1`
- Size: `L`
- Owner: `Design`
- Status: `Backlog`
- Depends on: `AEGIS-D001`, `AEGIS-D002`
- Risk: medium

Problem:

AEGIS lacks a review-and-edit queue step before download execution.

Acceptance criteria:

1. queue review UX requirements are documented
2. queue item shape is defined
3. selection, deselection, search, and bulk actions are defined

### AEGIS-D004

- Title: Define metadata embedding and sidecar export scope
- Priority: `P2`
- Size: `M`
- Owner: `Product`
- Status: `Backlog`
- Depends on: `AEGIS-D002`
- Risk: low

Problem:

Competitor parity includes lyrics embedding, cover embedding, and sidecar exports, but AEGIS has not yet scoped these capabilities.

Acceptance criteria:

1. lyrics embedding decision is documented
2. cover embedding decision is documented
3. JSON and TXT sidecar behavior is documented

### AEGIS-D005

- Title: Define downloader execution controls and history model
- Priority: `P2`
- Size: `M`
- Owner: `Product`
- Status: `Backlog`
- Depends on: `AEGIS-D003`
- Risk: medium

Problem:

AEGIS lacks a downloader-specific model for execution strategy, history, and user-controlled batch execution.

Acceptance criteria:

1. scan-to-download flow is documented
2. queue strategy profile options are documented
3. history behavior is documented
4. progress and completion feedback requirements are documented
