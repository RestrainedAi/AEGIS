# AEGIS YouTube Data Formalization Plan

## Purpose

This document narrows the `Vault to YouTube` stream to the specific work required to formalize and finalize the data AEGIS sends to, receives from, and stores about YouTube before additional database, queue, and uploader buildout continues.

The central question is:

`What exact YouTube data contract does AEGIS queue, upload, persist, and expose back to the Vault?`

Once that contract is stable, the next step is to build or refine:

1. the queue schema
2. the uploader input/output contract
3. the Firestore write-back model
4. the export and UI status mapping rules

This plan is deliberately biased toward:

1. inspect-first work
2. reuse of existing Firestore and queue data
3. narrow validation using already indexed songs
4. avoiding unnecessary Cloud Run or harvest cost

## Scope

This plan covers:

1. queue item identity fields
2. uploader input fields
3. YouTube media contract
4. timestamps and lineage
5. lifecycle and status fields
6. YouTube result fields written back to Firestore
7. what the Vault/export actually requires from YouTube-side state

This plan does not cover:

1. SUNO harvest identity and media contracts
2. downloader packaging/export work
3. generalized analytics beyond required operational metadata

## Current Production Truth

Based on the checked-in code and recent handoff notes:

1. the Vault UI can create queue records through `/api/queue-for-youtube`
2. queue records are written into `ytUploadQueue`
3. the uploader reads from `sunoSongs` and uploads to YouTube
4. the uploader writes back YouTube result fields into `sunoSongs`
5. the Vault UI already shows queue/upload state and polls queue progress

That means the current effective YouTube data path is:

1. user selects a song in the Vault
2. Vault validates publish readiness from Firestore
3. Vault creates a `ytUploadQueue` record
4. upload job reads queue item and source song doc
5. uploader resolves media and uploads to YouTube
6. uploader writes result fields back into Firestore
7. Vault reflects queue/upload state

## Data Domains That Must Be Formalized First

### 1. Canonical YouTube Queue Item Schema

Fields currently involved or implied:

1. `songKey`
2. `status`
3. `createdAt`
4. `queuedAt`
5. `startedAt`
6. `uploadedAt`
7. `retryCount`
8. `errorMsg`
9. `requestedFrom`
10. `gcsVideoUrl`

Questions to settle:

1. What is the minimum canonical queue item shape?
2. Which fields are required at queue creation time?
3. Which fields are operator-only or runtime-only?
4. Which fields belong in queue docs versus source item docs?

### 2. Canonical YouTube Media Contract

Fields currently involved or implied:

1. `media.videoUrl` from `sunoSongs`
2. `gcsVideoUrl` on queue docs
3. fallback `gcsPath`
4. canonical `gs://bucket/object` references

Questions to settle:

1. What is the required uploader input field for video media?
2. Is `gcsVideoUrl` a snapshot convenience field or required canonical field?
3. Should queue docs store media references redundantly if `sunoSongs` is the source of truth?
4. What minimum media contract makes an item publishable?

### 3. YouTube Timestamp and Lineage Model

Fields currently involved:

1. `createdAt`
2. `queuedAt`
3. `startedAt`
4. `uploadedAt`
5. `ytUploadedAt`
6. `ytPublishedAt`

Questions to settle:

1. Which timestamps belong to queue lifecycle?
2. Which timestamps belong to YouTube result lifecycle?
3. How should queue lineage point back to the source item and source run?
4. What timestamp fields are needed in the Vault UI versus only in ops surfaces?

### 4. YouTube Lifecycle and Status Contract

Fields currently involved:

1. queue `status`
2. item `ytStatus`
3. queue `retryCount`
4. queue `errorMsg`
5. item `ytError`

Questions to settle:

1. What are the canonical queue states?
2. What are the canonical item-level YouTube states?
3. Which statuses are runtime-only and which should be user-facing?
4. How should queue status map into Vault badges and issue states?
5. What is the exact boundary between queue failure and item failure?

### 5. Canonical YouTube Result / Write-Back Contract

Fields currently involved:

1. `ytVideoId`
2. `ytCanonicalUrl`
3. `ytStatus`
4. `ytUploadedAt`
5. `ytPublishedAt`
6. `ytError`
7. queue-side `uploadedAt`

Questions to settle:

1. Which result fields are canonical on `sunoSongs`?
2. Which fields also need to remain on queue docs?
3. What should be written on success versus failure?
4. What should be preserved for idempotency and duplicate prevention?

### 6. Canonical Catalog Export / Vault Requirements From YouTube

Fields currently relevant to export/UI:

1. `ytStatus`
2. `ytVideoId`
3. `ytCanonicalUrl`
4. `ytPublishedAt`

Questions to settle:

1. Which YouTube fields must appear in catalog export rows?
2. Which fields are optional but useful?
3. Which missing fields should degrade UI only versus block a feature?
4. What does the Vault actually require to render publish state correctly?

## “Other?” Domains That Should Also Be Included

In addition to the five items you listed, these should be formalized too:

### 1. Queue metadata override contract

The Vault currently captures YouTube metadata overrides such as:

1. description
2. privacy
3. language
4. license
5. category
6. alteredContent
7. shortsRemixing

This needs a clear rule for:

1. required vs optional
2. where defaults live
3. what gets stored on queue docs
4. how queue overrides map into uploader metadata

### 2. Duplicate and requeue policy

This should be explicit, not inferred.

Questions:

1. what happens if a queued item is queued again?
2. what happens if an uploaded item is queued again?
3. what operator action is required to requeue an error item?
4. what fields prove idempotency?

### 3. UI state contract

The Vault already shows YouTube states, but that contract should be formalized.

Questions:

1. what status labels are operator-facing?
2. what status labels are user-facing in the Vault?
3. what banner states exist?
4. what error text can safely surface in-card vs detail-only?

## Exact YouTube-Data Tickets To Start With

These are the first tickets I would execute in order.

### Ticket 1

`Define canonical YouTube item schema`

Deliverables:

1. canonical field list for YouTube-related state on `sunoSongs`
2. required vs optional fields
3. canonical names vs aliases
4. field authority notes

Primary files:

1. `yt-ingest/youtube_uploader.py`
2. `suno-viewer/server.js`
3. `suno-viewer/src/components/VaultGrid.tsx`

### Ticket 2

`Define canonical YouTube media contract`

Deliverables:

1. approved uploader input field
2. role of `gcsVideoUrl` on queue docs
3. canonical `gs://` representation rules
4. minimum media requirements for publishability

Primary files:

1. `yt-ingest/youtube_uploader.py`
2. `suno-viewer/server.js`
3. `docs/codex/AEGIS-005_UPLOADER_SCHEMA_ALIGNMENT_NOTE.md`

### Ticket 3

`Define YouTube timestamp and lineage model`

Deliverables:

1. meanings of queue and YouTube timestamps
2. queue-to-item lineage rules
3. item-to-YouTube lineage rules
4. what timestamps belong in export and UI

Primary files:

1. `yt-ingest/queue_manager.py`
2. `yt-ingest/youtube_uploader.py`
3. `suno-viewer/server.js`

### Ticket 4

`Define YouTube lifecycle and status contract`

Deliverables:

1. canonical queue status set
2. canonical item-level `ytStatus` set
3. mapping from backend states to Vault states
4. retry, error, and terminal-state rules

Primary files:

1. `yt-ingest/queue_manager.py`
2. `yt-ingest/youtube_uploader.py`
3. `suno-viewer/src/components/VaultGrid.tsx`

### Ticket 5

`Define canonical catalog export schema from YouTube state`

Deliverables:

1. approved YouTube-related export fields
2. required vs optional export rules
3. degraded-but-allowed field rules
4. Vault UI dependency list

Primary files:

1. `yt-ingest/rebuild_catalog.py`
2. `suno-viewer/server.js`
3. `suno-viewer/src/components/VaultGrid.tsx`

## Recommended Working Order

### Pass 1: Data contract decisions

1. canonical YouTube item schema
2. canonical YouTube media contract
3. timestamp and lineage model
4. lifecycle and status contract
5. canonical export schema from YouTube state
6. metadata override contract
7. duplicate and requeue policy
8. UI state contract

### Pass 2: Database and queue/uploader implementation

Once the above are approved:

1. finalize queue schema
2. finalize uploader input/output contract
3. finalize Firestore write-back shape
4. update queue and uploader files to match the approved contract
5. update Vault API and UI field usage to match

### Pass 3: Export and UI alignment

After the schema is stable:

1. map approved fields into export
2. map approved states into Vault badges and banners
3. update item detail and ops surfaces for queue/upload visibility

## Coordination With SUNO Harvest

The YouTube side should coordinate with the SUNO side to maximize shared structure where it makes sense and separate concerns where it does not.

### Shared where possible

1. identity conventions
2. timestamp naming discipline
3. lifecycle/status vocabulary patterns
4. export field naming conventions
5. lineage concepts

### Separate where necessary

1. harvest lifecycle vs publish lifecycle
2. source-truth media vs uploader-ready media
3. queue records vs catalog item records
4. SUNO status vs YouTube status

## Build-Next Rule

Do not expand the YouTube queue, uploader, and export/database surface further until these contract tickets are settled.

That keeps the project from:

1. hardening duplicate queue fields
2. mixing queue lifecycle with item lifecycle
3. overloading `ytStatus` with multiple meanings
4. making Vault state mapping harder to clean up later

## Cost-Aware Rule

Because current server resources are limited:

1. prefer inspecting existing queue docs, item docs, and logs first
2. prefer one known-good item for live validation
3. avoid broad Cloud Run reruns
4. do not use SUNO harvest reruns as the default path for YouTube-side validation

## Immediate Recommendation

Start with the five contract tickets you named:

1. define canonical YouTube item schema
2. define canonical YouTube media contract
3. define YouTube timestamp and lineage model
4. define YouTube lifecycle and status contract
5. define canonical catalog export schema from YouTube

Then add the three additional contract tickets:

1. define queue metadata override contract
2. define duplicate and requeue policy
3. define UI state contract

That will give the Vault-to-YouTube stream the same strong data-first footing the SUNO Harvest stream is getting now.
