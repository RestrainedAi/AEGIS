# SUNO To YouTube Production Workflow Specification

## Purpose

This document defines the current and target production workflow for moving SUNO content from discovery through storage, catalog publication, and YouTube upload.

It is based on the checked-in code and scripts in the `AEGIS` repository.

Unless explicitly labeled as "Observed", "Current", or "Current State", workflow and architecture guidance in this document should be treated as recommended future-state production design.

## Executive Summary

The repository contains most of the pieces required for a full SUNO-to-YouTube pipeline, but they are not fully joined into one production-safe flow.

The strongest current implementation is:

1. detect SUNO delta
2. capture media to GCS
3. index songs in Firestore `sunoSongs`
4. rebuild viewer catalog CSV
5. queue selected clips for YouTube
6. upload queued clips via scheduled Cloud Run Job

The main missing links are:

1. a reliable automated catalog rebuild trigger after harvest
2. uploader auth and runtime reliability in production
3. tighter alignment between queue lifecycle, uploader outcomes, and operator-visible UI state

## Exact Component Responsibilities

### `yt-ingest/catalog_sync_firestore_multi.py`

Responsibility:

- determine SUNO clip delta against Firestore and GCS
- mark removed clips
- generate `delta_manifest.csv`

It should not be treated as:

- the full catalog rebuild process
- the YouTube publishing process

### `yt-ingest/download_media_gcs.py`

Responsibility:

- fetch missing SUNO media assets
- use direct URLs first
- fall back to Playwright interception when needed
- upload canonical assets to GCS

It should not be treated as:

- the Firestore indexing authority
- the viewer catalog builder

### `yt-ingest/firestore_upsert.py`

Responsibility:

- write derived SUNO metadata to Firestore after GCS upload succeeds

It should not be treated as:

- media acquisition logic
- queue management

### `yt-ingest/rebuild_catalog.py`

Responsibility:

- read Firestore `sunoSongs`
- flatten records into the wide viewer CSV
- publish the current viewer dataset to GCS

It should not be treated as:

- a delta detector
- a queue builder

### `suno-viewer/server.js`

Responsibility:

- serve the current published catalog CSV to the viewer
- serve the built frontend assets
- validate and create YouTube queue items from Vault publish actions
- trigger the upload job and expose queue-status aggregation for the UI

It should not be treated as:

- the place where catalog data is generated

### `suno-viewer/src/components/VaultGrid.tsx`

Responsibility:

- browse and play published SUNO catalog entries
- provide publish actions that hand selected clips to the YouTube queue flow
- surface queue and publish state for operators inside the Vault

It should not be treated as:

- the queue implementation
- the upload worker

### `yt-ingest/queue_manager.py`

Responsibility:

- manage upload queue state
- process queued items through the uploader

It should not be treated as:

- the primary ingest `items` model
- the viewer data source

### `yt-ingest/youtube_uploader.py`

Responsibility:

- read one queued SUNO clip
- resolve the correct media artifact
- upload it to YouTube
- write back upload status and resulting video metadata

It should not be treated as:

- the queue creator
- the harvest job

### `yt-ingest/deploy_upload_job.sh`

Responsibility:

- package and deploy the YouTube uploader job
- create the upload scheduler trigger

It should not be treated as:

- a harvest deployment script

## Current Observed Workflow

### Stage 1: Delta Detection

Primary files:

- `yt-ingest/daily_suno_job.sh`
- `yt-ingest/catalog_sync_firestore_multi.py`

Behavior:

- queries live SUNO profile clip IDs
- compares them with Firestore `sunoSongs`
- identifies:
  - new clips
  - removed clips
  - existing clips missing GCS media
- writes `delta_manifest.csv`
- writes `delta_report.json`

Additional behavior:

- marks removed clips in Firestore
- can patch removed status into the viewer CSV already stored in GCS

### Stage 2: Media Capture

Primary file:

- `yt-ingest/download_media_gcs.py`

Behavior:

- reads `delta_manifest.csv`
- attempts direct media download using provided URLs
- falls back to Playwright interception of real media streams
- uploads media to canonical GCS paths:
  - `gs://aeonimus-suno-media/suno/handles/{handle}/{clip_id}.mp3`
  - `gs://aeonimus-suno-media/suno/handles/{handle}/{clip_id}.m4a`
  - `gs://aeonimus-suno-media/suno/handles/{handle}/{clip_id}.mp4`
  - `gs://aeonimus-suno-media/suno/handles/{handle}/{clip_id}.jpg`

### Stage 3: Firestore Indexing

Primary file:

- `yt-ingest/firestore_upsert.py`

Behavior:

- writes or merges `sunoSongs/{clip_id}`
- stores media URIs and availability flags
- uses GCS as the system of truth and Firestore as a derived index

Primary fields written:

- `songKey`
- `sourceId`
- `handle`
- `title`
- `status`
- `createdAt`
- `media.audioUrl`
- `media.videoUrl`
- `media.thumbUrl`
- `media.audioExt`
- `gcs.audio`
- `gcs.video`
- `gcs.thumb`

### Stage 4: Catalog Rebuild

Primary file:

- `yt-ingest/rebuild_catalog.py`

Behavior:

- reads all documents in Firestore collection `sunoSongs`
- flattens them into `latest_catalog_wide.csv`
- uploads to:
  - `gs://aeonimus-workspaces/exports/suno/latest_catalog_wide.csv`

This is the authoritative full export builder for the viewer.

### Stage 5: Viewer Publication

Primary files:

- `suno-viewer/server.js`
- `suno-viewer/src/components/VaultGrid.tsx`

Behavior:

- `/catalog.csv` returns the GCS object `exports/suno/latest_catalog_wide.csv`
- frontend fetches `/catalog.csv`
- renders searchable playback UI for SUNO tracks
- exposes `POST /api/queue-for-youtube`
- exposes `POST /api/trigger-upload-job`
- exposes `GET /api/queue-status`
- provides per-song and batch publish actions in the Vault UI

### Stage 6: YouTube Queue

Primary file:

- `yt-ingest/queue_manager.py`

Behavior:

- manages queue state in Firestore
- statuses include:
  - `new`
  - `queued`
  - `uploading`
  - `done`
  - `error`
- processes queued items by calling `youtube_uploader.upload_clip()`

Observed note:

- the live viewer path currently creates queue items directly as `queued`
- `new` should be treated as legacy/internal unless another producer still relies on it

### Stage 7: YouTube Upload

Primary file:

- `yt-ingest/youtube_uploader.py`

Behavior:

- reads clip metadata from Firestore
- obtains OAuth refresh credentials from Secret Manager
- downloads source media from GCS
- uploads clip to YouTube with resumable upload protocol
- writes back YouTube result fields to Firestore

Expected write-back fields:

- `ytVideoId`
- `ytCanonicalUrl`
- `ytStatus`
- `ytUploadedAt`
- `ytError`

### Stage 8: Upload Scheduling

Primary files:

- `yt-ingest/Dockerfile.uploader`
- `yt-ingest/deploy_upload_job.sh`

Behavior:

- builds uploader container
- creates or updates Cloud Run Job `yt-upload-job`
- creates Cloud Scheduler trigger `yt-upload-daily`
- configured schedule is daily at `06:00 UTC`

## Current State Assessment

### What Works Conceptually

The following chain is conceptually implemented:

1. SUNO delta detection
2. GCS media download
3. Firestore indexing
4. catalog rebuild
5. queued YouTube upload worker

### What Is Missing Or Broken

#### 1. The UI-to-queue path exists, but still needs live runtime hardening

Observed:

- `suno-viewer/server.js` implements `/api/queue-for-youtube`
- `suno-viewer/server.js` implements `/api/trigger-upload-job`
- `suno-viewer/server.js` implements `/api/queue-status`
- `suno-viewer/src/components/VaultGrid.tsx` includes per-song and batch publish workflow

Impact:

- the checked-in queue handoff exists, but end-to-end production reliability still depends on uploader auth, queue lifecycle clarity, and narrow live validation

#### 2. Queue storage separation is implemented, but lifecycle handling still needs operational hardening

Observed:

- `queue_manager.py` uses Firestore collection `ytUploadQueue`
- the live viewer path creates queue entries in `ytUploadQueue`
- queue lifecycle now centers on `queued`, `uploading`, `done`, and `error`
- legacy `new` handling may still exist for compatibility, but it is no longer the primary viewer path

Impact:

- queue and item ownership are separated correctly, but duplicate prevention, retry behavior, and operator-facing queue semantics still need to stay aligned

#### 3. Uploader schema alignment is implemented, but live auth/runtime validation remains the main open issue

Observed:

- `youtube_uploader.py` resolves `sunoSongs.media.videoUrl` first
- `youtube_uploader.py` supports direct `gs://` parsing
- legacy fallback paths still exist only for compatibility when canonical media fields are absent

Impact:

- the main remaining production risk is uploader credential/runtime readiness, not missing schema alignment
- parse the `gs://` URI directly

#### 4. Catalog rebuild is not clearly chained to harvest completion

Observed:

- `rebuild_catalog.py` exists and is authoritative
- no clean scheduler or job chain was found that guarantees it runs after successful harvest

Impact:

- viewer can be stale even when harvest is current

Recommendation:

- add a dedicated post-harvest catalog rebuild job
- trigger it after successful SUNO harvest

#### 5. Auth bootstrap paths are split

Observed:

- `youtube_auth.js` is a local helper path that had depended on tracked `client_secret.json`; the tracked secret has now been removed and replaced with a local-file expectation
- production uploader expects Secret Manager secrets

Impact:

- local auth helper does not represent the production upload auth path

Recommendation:

- retire or clearly label local-only auth scripts
- standardize on Secret Manager-based OAuth refresh flow

## Source-Of-Truth Decisions

These decisions are required to make the system coherent.

### Source of truth for SUNO media

Decision:

- GCS is the source of truth

Reason:

- `download_media_gcs.py` and `firestore_upsert.py` are already structured around GCS-first persistence
- Firestore records are derived from successful asset upload

### Source of truth for SUNO catalog index

Decision:

- Firestore `sunoSongs` should be the source of truth for viewer export generation

Reason:

- `rebuild_catalog.py` already reads `sunoSongs`
- viewer-facing CSV is downstream from that collection

### Source of truth for viewer data

Decision:

- `latest_catalog_wide.csv` in GCS is the published viewer artifact

Reason:

- `suno-viewer/server.js` is hard-coded to that object

### Source of truth for YouTube publishing queue

Decision:

- create a dedicated queue collection, recommended name `ytUploadQueue`

Reason:

- current use of `items` collides with the unified ingest model
- queue records are not the same thing as content records

### Source of truth for YouTube upload result

Decision:

- write YouTube outcome fields back onto the SUNO song document and optionally the queue document

Reason:

- operators need upload visibility on the content itself
- queue state alone is insufficient as a durable publishing record

### Source of truth for scheduling

Decision:

- use Cloud Scheduler and Cloud Run Jobs for recurring operational automation

Reason:

- the repo is already built around GCP job orchestration
- local scripts should remain support tooling, not production control planes

## Broken Links In The Current Pipeline

### Broken Link 1: Viewer publish action to queue creation

Observed:

- `VaultGrid.publish.patch.md` describes the UI and API contract
- no actual `/api/queue-for-youtube` implementation exists

Consequence:

- the user-visible publish action is not operational

### Broken Link 2: Queue storage model

Observed:

- `queue_manager.py` uses Firestore `items`
- `index.ts` also uses `items` for ingest content records

Consequence:

- schema conflict
- ambiguous semantics
- risk of operational corruption

### Broken Link 3: Uploader media resolution

Observed:

- uploader expects `gcsPath` or a fallback object path in `aeonimus-workspaces`
- SUNO indexing writes `media.videoUrl` as a `gs://aeonimus-suno-media/...` URI

Consequence:

- uploader may target the wrong object or fail to resolve media

### Broken Link 4: Harvest completion to catalog rebuild

Observed:

- harvest exists
- catalog rebuild exists
- no clear orchestration guarantees rebuild after harvest

Consequence:

- viewer can lag behind storage and Firestore state

### Broken Link 5: Production auth path versus local auth helper

Observed:

- `youtube_auth.js` uses local file-based OAuth flow
- uploader uses Secret Manager refresh tokens

Consequence:

- multiple incompatible auth setups
- unclear onboarding path

### Broken Link 6: Scheduler configuration sprawl

Observed:

- multiple scheduler-related scripts exist
- at least one is malformed

Consequence:

- unclear production scheduler authority
- higher risk of configuration drift

## Recommended Authoritative Production Workflow

### Canonical Flow

1. Cloud Scheduler triggers SUNO harvest job
2. Harvest job runs delta detection
3. Harvest job downloads and stores missing media in GCS
4. Harvest job upserts `sunoSongs`
5. Harvest completion triggers catalog rebuild job
6. Catalog rebuild job regenerates and uploads `latest_catalog_wide.csv`
7. Viewer serves latest catalog from GCS
8. Operator selects clips to publish from viewer
9. Viewer calls `/api/queue-for-youtube`
10. API writes a record into `ytUploadQueue`
11. Scheduled uploader job processes queue
12. YouTube upload results are written back to Firestore

## Recommended Target Architecture

### Target Architecture Principles

1. One authoritative SUNO ingest path
2. One authoritative catalog export path
3. One dedicated upload queue model
4. No overloading of collections for unrelated purposes
5. Explicit post-harvest orchestration
6. Viewer reads published artifacts only

### Target Component Layout

#### Harvest Layer

Authoritative components:

- `catalog_sync_firestore_multi.py`
- `download_media_gcs.py`
- `firestore_upsert.py`

Responsibilities:

- discover delta
- store media in GCS
- write Firestore song records

#### Export Layer

Authoritative component:

- `rebuild_catalog.py`

Responsibilities:

- build and publish viewer CSV

#### Presentation Layer

Authoritative components:

- `suno-viewer/server.js`
- `suno-viewer/src/components/VaultGrid.tsx`

Responsibilities:

- serve the published catalog
- surface user actions like Publish

#### Queue Layer

Authoritative component:

- new queue API and Firestore collection `ytUploadQueue`

Responsibilities:

- create queue entries
- prevent duplicates
- track upload lifecycle

#### Upload Layer

Authoritative components:

- `queue_manager.py`
- `youtube_uploader.py`
- `Dockerfile.uploader`
- `deploy_upload_job.sh`

Responsibilities:

- process queue
- upload clips
- persist upload status

### Target Data Model

#### `sunoSongs`

Purpose:

- authoritative indexed metadata for harvested SUNO assets

Minimum required publishing fields:

- `songKey`
- `handle`
- `title`
- `status`
- `media.audioUrl`
- `media.videoUrl`
- `media.thumbUrl`
- `ytVideoId`
- `ytCanonicalUrl`
- `ytStatus`
- `ytUploadedAt`

#### `ytUploadQueue`

Purpose:

- dedicated upload work queue

Recommended fields:

- `songKey`
- `status`
- `createdAt`
- `queuedAt`
- `startedAt`
- `uploadedAt`
- `retryCount`
- `errorMsg`
- `ytVideoId`

#### GCS Published Artifact

Purpose:

- viewer-facing immutable-ish current snapshot

Artifact:

- `gs://aeonimus-workspaces/exports/suno/latest_catalog_wide.csv`

### Canonical Data Stores

#### GCS

Source of truth for media assets:

- `aeonimus-suno-media`

Viewer catalog export:

- `aeonimus-workspaces/exports/suno/latest_catalog_wide.csv`

#### Firestore

Recommended authority split:

- `sunoSongs`: SUNO content index
- `ytUploadQueue`: YouTube upload queue
- `sources`, `runs`: operational metadata if retained

Avoid:

- using `items` for multiple unrelated meanings

## Recommended Implementation Plan

### Phase 1: Stabilize Existing Flow

1. Update `youtube_uploader.py` to read `media.videoUrl`
2. Add a dedicated `ytUploadQueue` collection
3. update `queue_manager.py` to use `ytUploadQueue`
4. add explicit queue schema fields
5. add a post-harvest catalog rebuild step

### Phase 2: Wire User Action

1. implement `/api/queue-for-youtube`
2. add viewer `Publish` button
3. show upload status badge in viewer
4. write `queued` state immediately after submission

### Phase 3: Operational Hardening

1. define one scheduler for harvest
2. define one scheduler for upload processing
3. add logs and alerting around queue backlog and upload failures
4. remove duplicate and stale scripts from the main path

## Step-By-Step Production-Safe Implementation Plan

### Step 1: Freeze the authoritative SUNO path

Action:

- declare the Python harvest path authoritative for SUNO production ingest

Deliverable:

- written engineering decision naming the SUNO production path

### Step 2: Separate upload queue storage

Action:

- replace queue use of Firestore `items` with `ytUploadQueue`

Deliverable:

- queue manager updated
- uploader updated
- existing queue docs migrated or deprecated

### Step 3: Align uploader with actual SUNO schema

Action:

- update `youtube_uploader.py` to resolve source video from `media.videoUrl`
- support `gs://` URI parsing directly

Deliverable:

- dry-run upload succeeds against real `sunoSongs` documents

### Step 4: Implement queue creation API

Action:

- create `/api/queue-for-youtube`

Behavior:

- validate request
- verify clip exists
- verify clip has usable mp4 path
- create queue entry if not already queued or done

Deliverable:

- callable API endpoint with idempotent queue creation

### Step 5: Implement viewer publish UI

Action:

- apply the publish control into `VaultGrid.tsx`
- display queue and upload state

Deliverable:

- operator can queue clips from the viewer

### Step 6: Automate catalog rebuild after harvest

Action:

- package `rebuild_catalog.py` into a job or add it as a post-harvest step

Deliverable:

- successful harvest always produces a fresh viewer CSV

### Step 7: Normalize scheduler authority

Action:

- select one scheduler deployment script
- retire malformed or stale scheduler scripts

Deliverable:

- one authoritative scheduler setup path for harvest and one for upload

### Step 8: Add operational observability

Action:

- add queue backlog metrics
- add upload error summaries
- add catalog rebuild success logging

Deliverable:

- operators can answer:
  - what was harvested
  - what is queued
  - what failed
  - what reached YouTube

### Step 9: Clean repository operationally

Action:

- remove duplicate scripts
- remove committed build artifacts
- rotate secrets

Deliverable:

- authoritative repo state is easier to maintain and safer to operate

## Final Conclusion

The repo contains enough code to support a full SUNO-to-YouTube publishing system, but the final handoff between viewer selection and uploader execution is incomplete in the checked-in code.

The most reliable existing backbone is:

1. SUNO harvest to GCS
2. Firestore `sunoSongs`
3. catalog rebuild via `rebuild_catalog.py`
4. viewer on top of GCS CSV
5. Cloud Run upload job for queued clips

To make the pipeline production-safe, the team should prioritize:

1. queue collection separation
2. uploader schema alignment
3. catalog rebuild automation
4. viewer-to-queue API implementation
