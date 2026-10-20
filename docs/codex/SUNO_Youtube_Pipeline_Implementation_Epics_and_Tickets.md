# AEGIS Implementation Epics and Tickets

## Product

AEGIS: SUNO YouTube Pipeline

## Purpose

This document converts the approved project map into implementation-ready epics and ticket groups. It is intended as the execution bridge between product planning and engineering delivery.

## Usage Notes

Current execution policy: [Development DNA](DEVELOPMENT_PRINCIPLES.md). Each feature has one accountable owner, and large features have bounded specialist tasks with explicit context, dependencies, write ownership, and acceptance checks. Record assignments and evidence in the [feature brief](templates/FEATURE_BRIEF.md) linked to the [existing board](../board/README.md). The historical ticket proposals below do not establish current implementation status or actual external Jira issues.

1. These epics assume the current canonical docs set in `docs/codex/`.
2. Where production truth is still not confirmed, tickets are written to force that decision early.
3. Ticket language is written so it can be copied into Jira, Linear, Notion, or GitHub Issues with minimal editing.

## Delivery Phasing

1. Phase 1: Stabilize
2. Phase 2: Consolidate
3. Phase 3: Scale

---

## EPIC 1: Confirm Authoritative Production Paths

### Objective

Establish the actual production authority for SUNO ingest, YouTube ingest, catalog export, and viewer delivery so the team stops planning against ambiguity.

### Success Criteria

1. One documented production path for SUNO ingest
2. One documented production path for YouTube ingest
3. One documented production path for catalog export
4. One documented production path for viewer delivery
5. Decision record approved by product and engineering

### Tickets

1. Audit live SUNO ingest path across scripts, jobs, and deployed services
2. Audit live YouTube ingest path across API routes, jobs, and queue flows
3. Audit catalog export generation path and publication schedule
4. Audit viewer delivery path and runtime dependency on GCS export
5. Produce source-of-truth matrix for collections, buckets, and jobs
6. Draft architecture decision record for authoritative production paths
7. Review and approve production path decision with stakeholders

---

## EPIC 2: Standardize Configuration and Secrets

### Objective

Remove configuration drift and security risk by standardizing environment variables, runtime assumptions, and secret handling.

### Success Criteria

1. Config naming standard approved
2. Conflicting env variables removed or aliased consistently
3. Checked-in secrets removed and rotated
4. Deployment scripts reference standardized configuration

### Tickets

1. Inventory all env vars used across Node, Python, shell, and deployment scripts
2. Identify conflicting names such as `YT_API_KEY` vs `YOUTUBE_API_KEY`
3. Define canonical env variable naming standard
4. Update code paths to use canonical env names
5. Add backward-compatible aliases only where needed for transition
6. Audit checked-in credentials and sensitive artifacts
7. Remove in-repo secrets and rotate affected credentials
8. Document runtime config contract for local, job, and service environments

---

## EPIC 3: Clean Repository Operationally

### Objective

Reduce repo noise and maintenance risk by removing generated artifacts, duplicate operational files, and stale script variants from the main working path.

### Success Criteria

1. Duplicate/stale script inventory completed
2. Generated artifacts removed from tracked source where safe
3. Repo structure reflects authoritative code paths clearly

### Tickets

1. Inventory duplicate scripts across root and `yt-ingest/`
2. Inventory committed build artifacts, logs, backups, and duplicate file variants
3. Mark files as active, transitional, or stale
4. Remove or archive stale artifacts that are not source-of-truth
5. Add ignore rules for generated outputs going forward
6. Document canonical script entrypoints for ops and deployment

---

## EPIC 4: Rationalize the SUNO Ingest Path

### Objective

Choose and formalize the future-state SUNO ingest backbone while preserving the operationally valuable delta and media completeness logic.

### Success Criteria

1. Future-state SUNO ingest path selected
2. Delta detection remains supported
3. Media preservation remains GCS-first
4. Firestore indexing authority is explicit

### Tickets

1. Compare API-based SUNO ingest against Python harvest path
2. Map exact responsibilities for delta detection, media capture, indexing, and export
3. Decide whether the API path is transitional, parallel, or future replacement
4. Define target SUNO ingest architecture
5. Define transition plan from duplicate SUNO logic to the target path
6. Document ownership of `sunoSongs`, `sources`, `runs`, and related collections

---

## EPIC 5: Rationalize the YouTube Ingest Path

### Objective

Unify direct and queued YouTube ingestion patterns into one clear operating model.

### Success Criteria

1. Direct and queued YouTube paths are compared and decisioned
2. One future-state YouTube ingest model is selected
3. Caption enrichment ownership is clear
4. Firestore model impact is documented

### Tickets

1. Compare `/ingest` flow against `/yt/runs` plus Pub/Sub flow
2. Compare collection writes across `items`, `runs`, `runs_legacy`, and `yt_runs`
3. Define the future-state YouTube ingest flow
4. Define the role of caption fetching in the future-state flow
5. Document migration approach for legacy YouTube collections
6. Update architecture docs with chosen YouTube operating model

---

## EPIC 6: Formalize the Catalog Export Pipeline

### Objective

Turn catalog generation into an explicit, owned, and validated platform stage.

### Success Criteria

1. Catalog export owner assigned
2. Export generation flow documented
3. Export publication timing defined
4. Export freshness and completeness checks implemented

### Tickets

1. Confirm the authoritative export generator for `latest_catalog_wide.csv`
2. Define canonical catalog export schema
3. Document export input collections and required fields
4. Define when export runs after harvest or indexing completes
5. Add validation checks for missing fields and stale timestamps
6. Add operational logging for export success and failure
7. Document viewer dependency on export freshness

---

## EPIC 7: Separate the YouTube Upload Queue Model

### Objective

Fix semantic and operational collision between upload queue records and catalog item records by introducing a dedicated upload queue collection and workflow.

### Success Criteria

1. Dedicated queue collection defined
2. Queue schema approved
3. Queue manager updated to use the dedicated collection
4. Upload state is traceable without overloading `items`

### Tickets

1. Define target upload queue collection name and schema
2. Update queue manager to read and write the dedicated queue collection
3. Update uploader to consume the new queue model
4. Add idempotency rules for queue creation
5. Define terminal and retryable queue states
6. Add migration or deprecation plan for any current queue use of `items`

---

## EPIC 8: Align Uploader With Actual Asset Schema

### Objective

Ensure the YouTube uploader resolves real media artifacts from the actual SUNO indexing schema rather than brittle or outdated assumptions.

### Success Criteria

1. Uploader reads the correct source field for media
2. `gs://` URI parsing is supported explicitly
3. Upload dry-run succeeds against real sample documents

### Tickets

1. Audit uploader assumptions about `gcsPath` and fallback object locations
2. Compare uploader expectations against `firestore_upsert.py` write shape
3. Update uploader to resolve media from `media.videoUrl` or canonical replacement field
4. Add support for direct `gs://` parsing
5. Test uploader resolution against sample `sunoSongs` documents
6. Document the uploader input contract

---

## EPIC 9: Automate Post-Harvest Catalog Rebuild

### Objective

Guarantee that successful harvest completion results in a fresh viewer catalog artifact.

### Success Criteria

1. Catalog rebuild is wired into the post-harvest flow
2. Success and failure are logged
3. Viewer staleness caused by missing rebuild is materially reduced

### Tickets

1. Decide whether rebuild runs inline, as a chained job, or as a separate scheduled job
2. Implement the selected orchestration pattern
3. Add success and failure logging for rebuild execution
4. Add timestamp visibility for last successful export
5. Document operational recovery path when rebuild fails

---

## EPIC 10: Implement Viewer-to-Queue Publish Action

### Objective

Complete the missing handoff from catalog UI to YouTube publishing queue.

### Success Criteria

1. Publish action exists in the viewer
2. API route exists for queue submission
3. Queue creation is idempotent
4. UI shows queue or upload state

### Tickets

1. Define API contract for queueing a clip for YouTube
2. Implement `/api/queue-for-youtube` or equivalent route
3. Validate source item existence and media readiness before queue creation
4. Prevent duplicate queue records for already queued or uploaded clips
5. Add Publish action to the viewer item card or detail view
6. Display queue state and upload state in the viewer
7. Add operator-facing error messaging for publish failures

---

## EPIC 11: Define Status Taxonomy and Operational UI Model

### Objective

Create a consistent language and state model for source, run, item, export, and upload status across docs, backend, and UI.

### Success Criteria

1. Shared status vocabulary approved
2. UI state model aligns to backend states
3. Issues view taxonomy is defined

### Tickets

1. Inventory status fields across source, run, item, export, and queue models
2. Define canonical status vocabulary and transitions
3. Map current backend statuses to canonical statuses
4. Define issue categories such as stale, failed, missing media, missing transcript, and removed
5. Publish status glossary for product, design, and engineering

---

## EPIC 12: Deliver UX Handoff for Core Product Surfaces

### Objective

Convert the approved UX direction into implementation-ready design requirements for the core operational and catalog interfaces.

### Success Criteria

1. Priority screen set approved
2. Core data objects are reflected consistently in UI
3. Handoff package is ready for engineering sequencing

### Tickets

1. Finalize information architecture for Dashboard, Sources, Runs, Catalog, and Issues
2. Finalize priority workflows for ops, curator, and admin users
3. Produce detailed UX requirements for Dashboard
4. Produce detailed UX requirements for Sources list and detail
5. Produce detailed UX requirements for Runs list and detail
6. Produce detailed UX requirements for Catalog browser and Item detail
7. Produce detailed UX requirements for Issues view
8. Define component and status system dependencies for engineering

---

## EPIC 13: Establish Monitoring and Operational Visibility

### Objective

Make failures, staleness, and backlog visible enough for routine operation without deep code inspection.

### Success Criteria

1. Dashboard metric set defined
2. Queue backlog visibility exists
3. Export freshness is visible
4. Run and upload failures are visible

### Tickets

1. Define minimum dashboard metrics for ingest, export, and upload
2. Add queue backlog metrics and status summaries
3. Add export freshness indicator and last successful export timestamp
4. Add failed run and stale source visibility requirements
5. Define operator issue triage workflow
6. Document alerting backlog for future implementation

---

## EPIC 14: Establish Quality and Release Discipline

### Objective

Reduce regression risk and make deployment changes more predictable.

### Success Criteria

1. Minimum validation strategy approved
2. Smoke checks exist for critical paths
3. Release checklist exists
4. Rollback expectations are documented

### Tickets

1. Identify critical flows that require automated validation
2. Define minimum build and smoke-check pipeline
3. Add validation for ingest, export, and viewer-serving paths
4. Define release checklist for production-affecting changes
5. Define rollback guidance for failed deploys or broken jobs
6. Document ownership for production incident response

---

## EPIC 15: Build Downloader Filter and Selection Model

### Objective

Create the first-class downloader selection layer required for competitive parity with downloader-first products.

### Success Criteria

1. Users can select source groups or workspaces
2. Users can apply include filters before queue creation
3. Users can apply exclusion rules before queue creation
4. Queue candidates are generated from explicit user selections rather than implicit full-library processing only

### Tickets

1. Define downloader workspace or source-group model
2. Define content-type filter model such as liked, published, remaster, stems, and uploads
3. Define exclusion rule model such as no covers, no remasters, no stems, and no uploads
4. Map existing metadata fields to downloader filter requirements
5. Define queue candidate generation behavior from filter state
6. Identify backend data gaps needed to support the filter model

---

## EPIC 16: Build Downloader Packaging and Export Options

### Objective

Provide user-controlled asset selection and packaging options so the product behaves like a downloader, not just a backend ingest system.

### Success Criteria

1. Supported output asset types are defined clearly
2. Packaging presets are defined
3. Organization options are defined
4. Local export and packaging rules are documented for implementation

### Tickets

1. Define supported output asset types such as MP3, WAV, cover, JSON, and TXT
2. Confirm which asset types are currently supported by the backend and which require new implementation
3. Define packaging presets such as Simple, Producer, and Backup or equivalent
4. Define foldering, grouping, and zip behaviors
5. Define output path preview behavior
6. Define backend packaging contract for mixed-asset bundles

---

## EPIC 17: Build Downloader Queue Review Experience

### Objective

Introduce a dedicated queue review and edit step before download execution.

### Success Criteria

1. Users can review selected songs before execution
2. Users can search, select all, deselect, and adjust the queue
3. Queue contents are visible before download begins

### Tickets

1. Define queue review UX requirements
2. Define queue item shape for downloader execution
3. Add queue search and bulk selection behavior to the UX requirements
4. Define how queue edits affect downstream packaging
5. Define execution confirmation behavior and user messaging

---

## EPIC 18: Build Downloader Metadata Embedding and Export Enrichment

### Objective

Support richer exported files through metadata embedding and sidecar generation.

### Success Criteria

1. Lyrics embedding support is decisioned
2. Cover art embedding support is decisioned
3. Sidecar metadata outputs are defined
4. Output metadata rules are documented

### Tickets

1. Decide whether lyrics embedding is in scope for the first downloader release
2. Decide whether cover art embedding is in scope for the first downloader release
3. Define JSON and TXT sidecar export behavior
4. Define metadata field mapping from catalog records to exported files
5. Identify required audio packaging libraries or processing tools

---

## EPIC 19: Build Downloader Execution Controls and History

### Objective

Add execution, queue strategy, and history controls expected in a downloader product.

### Success Criteria

1. Scan and start-download flow is defined
2. Queue strategy profiles are defined
3. History behavior is defined
4. Completion feedback is defined

### Tickets

1. Define scan-to-queue-to-download execution flow
2. Define queue strategy profiles such as safe versus fast
3. Define history import, export, skip, and clear behavior
4. Define disk usage estimate and progress reporting requirements
5. Define terms acknowledgement or policy acknowledgement requirements if needed

---

## Recommended Sequencing

### First 30 Days

1. EPIC 1: Confirm Authoritative Production Paths
2. EPIC 2: Standardize Configuration and Secrets
3. EPIC 3: Clean Repository Operationally
4. EPIC 6: Formalize the Catalog Export Pipeline

### Next 30 to 60 Days

1. EPIC 4: Rationalize the SUNO Ingest Path
2. EPIC 5: Rationalize the YouTube Ingest Path
3. EPIC 7: Separate the YouTube Upload Queue Model
4. EPIC 8: Align Uploader With Actual Asset Schema
5. EPIC 9: Automate Post-Harvest Catalog Rebuild

### Next 60 to 90 Days

1. EPIC 10: Implement Viewer-to-Queue Publish Action
2. EPIC 11: Define Status Taxonomy and Operational UI Model
3. EPIC 12: Deliver UX Handoff for Core Product Surfaces
4. EPIC 13: Establish Monitoring and Operational Visibility
5. EPIC 14: Establish Quality and Release Discipline

### Downloader Track After Foundation Stabilizes

1. EPIC 15: Build Downloader Filter and Selection Model
2. EPIC 16: Build Downloader Packaging and Export Options
3. EPIC 17: Build Downloader Queue Review Experience
4. EPIC 18: Build Downloader Metadata Embedding and Export Enrichment
5. EPIC 19: Build Downloader Execution Controls and History

---

## Recommended Immediate Cut for Delivery System

If these need to become tickets immediately, create the first backlog wave from:

1. Audit live production paths
2. Standardize env variable naming
3. Remove checked-in secrets and rotate credentials
4. Confirm authoritative catalog export generator
5. Define dedicated `ytUploadQueue` schema
6. Align uploader to actual `sunoSongs` media field contract
7. Decide and implement post-harvest export rebuild orchestration

These seven items are the best starting point because they reduce ambiguity before feature execution begins.
