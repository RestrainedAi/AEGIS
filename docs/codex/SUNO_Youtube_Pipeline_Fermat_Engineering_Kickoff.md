# Fermat Engineering Kickoff

## Product

AEGIS: SUNO YouTube Pipeline

## Audience

Fermat and any engineering contributors beginning implementation work.

## Purpose

This document is the direct coding handoff from product planning into engineering execution. It identifies what is ready to build now, what remains decision-dependent, where to work in the repo, and how to sequence the first coding wave safely.

## Read This First

Before coding, use these docs as the baseline:

First read the current [agent instructions](../../AGENTS.md), [Development DNA](DEVELOPMENT_PRINCIPLES.md), [master authority map](AEGIS_MASTER_SOURCE_OF_TRUTH.md), and [workstream ownership](AEGIS_Workstream_Ownership_And_Change_Control.md). Give each feature one accountable owner, with bounded specialists for large features; record the actual current agent assignment rather than assuming Fermat or another historical name is active.

Use the [feature brief](templates/FEATURE_BRIEF.md) and [test handoff workflow](../../test/README.md) for dependency order, conditional decisions, bounded repair loops, and verified integration. The first-wave recommendations below are preserved planning history; revalidate their implementation assumptions against the active checkout, deployed revision, and existing board before acting.

1. `README.md`
2. `SUNO_Youtube_Pipeline_Repo_Overview.md`
3. `SUNO_SUNO_To_YouTube_Production_Workflow_Spec.md`
4. `SUNO_Youtube_Pipeline_Implementation_Epics_and_Tickets.md`

## Current Engineering Position

The repo is operational but architecturally mixed. The main coding risks are:

1. more than one apparent ingest path exists
2. source-of-truth collections are not fully unified
3. uploader assumptions do not fully match SUNO indexing output
4. the catalog rebuild step is not clearly chained to harvest completion
5. the UI-to-YouTube queue handoff is not implemented in checked-in code

The most productive coding approach is to start with infrastructure clarity and low-risk hardening work before building new user-facing features.

## Recommended First Coding Wave

### Start Here

1. Confirm the authoritative export generator and export dependency
2. standardize environment variable naming across the active paths
3. align uploader asset resolution with actual Firestore schema
4. introduce a dedicated YouTube upload queue model
5. wire catalog rebuild into a reliable post-harvest flow

### Do Not Start With

1. broad UI redesign implementation
2. deep SUNO API path replacement
3. collection migrations without first confirming production authority
4. deleting transitional code before active path ownership is confirmed
5. downloader-product parity implementation before the first stabilization wave is grounded

## Immediate Coding Priorities

### Priority 0: Safety and Truth

Goal:

Prevent coding against the wrong production assumptions.

Immediate tasks:

1. confirm which scripts and jobs actually drive catalog freshness
2. confirm whether `rebuild_catalog.py` is the live export authority
3. confirm whether `queue_manager.py` and `youtube_uploader.py` are active or staged

### Priority 1: Low-Risk Technical Corrections

Goal:

Fix the clearest schema and configuration mismatches without changing broad product behavior.

Best candidates:

1. env naming standardization
2. uploader schema alignment
3. dedicated upload queue schema definition

### Priority 2: Reliability Wiring

Goal:

Make the system more dependable without requiring full architecture replacement.

Best candidates:

1. post-harvest catalog rebuild orchestration
2. export freshness logging
3. queue idempotency and status traceability

## Primary File Targets

### Likely Active

1. `yt-ingest/catalog_sync_firestore_multi.py`
2. `yt-ingest/download_media_gcs.py`
3. `yt-ingest/firestore_upsert.py`
4. `yt-ingest/rebuild_catalog.py`
5. `yt-ingest/queue_manager.py`
6. `yt-ingest/youtube_uploader.py`
7. `yt-ingest/index.ts`
8. `yt-ingest/routes/youtube.ts`
9. `suno-viewer/server.js`
10. `suno-viewer/src/components/VaultGrid.tsx`

### Read Carefully Before Touching

1. `daily_suno_job.sh`
2. `yt-ingest/daily_suno_job.sh`
3. `deploy_upload_job.sh`
4. `deploy_viewer.sh`
5. `scheduler_setup.sh`

These files may reflect multiple historical environments and should not be normalized blindly.

## Proposed First Deliverables

### Deliverable 1: Export Authority Confirmation

Output:

1. short engineering note naming the authoritative export builder
2. short note describing how and when the export is refreshed

### Deliverable 2: Config Alignment Patch

Output:

1. canonical env names documented
2. runtime code updated to use them consistently
3. backward compatibility retained only where required

### Deliverable 3: Queue Model Separation

Output:

1. dedicated `ytUploadQueue` schema
2. queue manager and uploader updated to use it
3. queue lifecycle states documented

### Deliverable 4: Uploader Schema Alignment

Output:

1. uploader reads `media.videoUrl` or the chosen canonical field
2. direct `gs://` parsing supported
3. dry-run validation documented

### Deliverable 5: Catalog Rebuild Orchestration

Output:

1. rebuild runs reliably after successful harvest
2. success/failure is logged
3. export freshness is visible to operators

## Downloader Track Note

The competitor downloader capability set has now been captured as a separate planned product track in:

1. `SUNO_Downloader_Competitive_Capability_Gap_Analysis.md`
2. `SUNO_Youtube_Pipeline_Implementation_Epics_and_Tickets.md`
3. `SUNO_Youtube_Pipeline_First_Wave_Ticket_Board.md`

Engineering guidance:

1. do not treat downloader parity as part of the first stabilization sprint
2. use the downloader track as a planned downstream build target
3. prioritize foundational reliability work first so the downloader experience is built on stable pipeline behavior

## Engineering Rules Of Engagement

1. treat `docs/codex/` as the documentation baseline
2. avoid deleting code paths until active production truth is confirmed
3. document any inferred assumption before baking it into code
4. isolate schema changes so they can be tested safely
5. prefer additive changes over destructive refactors in the first wave

## Decision Gates

Stop and confirm before proceeding if you hit:

1. uncertainty about active production collections
2. conflicting deployment scripts with unknown production authority
3. any migration that changes Firestore collection semantics
4. any change that could break viewer freshness without a rollback path

## What “Done” Looks Like For The First Wave

1. The team knows which export path is authoritative
2. Config naming drift is reduced materially
3. The uploader can resolve the real stored media artifact
4. Queue records no longer overload the `items` collection
5. Harvest completion leads reliably to a fresh catalog export

At that point, the repo is in a much better position for UI-to-queue work and broader workflow consolidation.
