# SUNO YouTube Pipeline Repo Overview

## Executive Summary

The `AEGIS` repository is an operational workspace for a media ingestion and publishing system built around SUNO content, YouTube workflows, and a catalog viewer. It is not a single clean application. It contains a mix of active production code, support utilities, duplicated scripts, and legacy paths.

The repo has three main system surfaces:

1. A backend ingest layer in `yt-ingest/`
2. A frontend viewer in `suno-viewer/`
3. A Python and shell-based SUNO harvest pipeline that still appears to be operationally important

The dominant architecture pattern is:

1. Ingest or detect source content
2. Store media in Google Cloud Storage
3. Index metadata in Firestore
4. Export catalog data to CSV
5. Serve the catalog to a viewer
6. Optionally push selected SUNO assets into a YouTube publishing queue

## Major Folders

### `yt-ingest/`

Primary backend and worker area.

Key responsibilities:

- SUNO API ingest
- YouTube playlist ingest
- caption fetching
- Pub/Sub job handling
- Firestore and GCS data modeling
- Python media harvest and export support

Important files:

- `yt-ingest/index.ts`
- `yt-ingest/routes/youtube.ts`
- `yt-ingest/schema.ts`
- `yt-ingest/lib/firestore.ts`
- `yt-ingest/lib/pubsub.ts`
- `yt-ingest/lib/youtube.ts`
- `yt-ingest/download_media_gcs.py`
- `yt-ingest/firestore_upsert.py`
- `yt-ingest/rebuild_catalog.py`
- `yt-ingest/queue_manager.py`
- `yt-ingest/youtube_uploader.py`

### `suno-viewer/`

React and Vite frontend for browsing the SUNO vault.

Key responsibilities:

- fetch catalog CSV
- render searchable and filterable clip grid
- play audio inline
- support account-specific views

Important files:

- `suno-viewer/src/App.tsx`
- `suno-viewer/src/components/VaultGrid.tsx`
- `suno-viewer/src/components/AudioPlayer.tsx`
- `suno-viewer/server.js`

### Root `AEGIS/`

Contains:

- legacy viewer path
- deployment and scheduler scripts
- duplicate Python utilities
- one-off generators
- auth helpers
- operational logs and backups

Important files:

- `server.js`
- `daily_suno_job.sh`
- `deploy_viewer.sh`
- `startup.sh`
- `s.sh`
- `scheduler_setup.sh`
- `youtube_auth.js`

## System Architecture

### SUNO Path

There are two SUNO implementations in the repo:

1. A newer API-based path via `POST /suno/ingest` in `yt-ingest/index.ts`
2. A more operationally mature Python delta and media-harvest path centered on:
   - `yt-ingest/catalog_sync_firestore_multi.py`
   - `yt-ingest/download_media_gcs.py`
   - `yt-ingest/firestore_upsert.py`
   - `yt-ingest/rebuild_catalog.py`

The second path appears closer to the actual production workflow because it covers:

- delta detection
- GCS media capture
- Firestore indexing
- viewer catalog export

### YouTube Path

The repo contains two YouTube-related systems:

1. YouTube playlist ingestion into Firestore and GCS
2. YouTube publishing of SUNO clips through a queue and upload job

Playlist ingest is implemented in TypeScript:

- `POST /ingest`
- `POST /yt/runs`
- `POST /fetch_captions`
- `POST /internal/yt-job`

SUNO-to-YouTube publishing is implemented in Python:

- `yt-ingest/queue_manager.py`
- `yt-ingest/youtube_uploader.py`
- `yt-ingest/deploy_upload_job.sh`

## Data Stores and Services

### Google Cloud Storage

Used for:

- raw harvest artifacts
- SUNO media files
- viewer catalog export
- YouTube ingest artifacts
- transcript files

Important buckets and paths observed in code:

- `gs://aeonimus-suno-media/suno/handles/{handle}/...`
- `gs://aeonimus-workspaces/exports/suno/latest_catalog_wide.csv`

### Firestore

Observed collections:

- `sunoSongs`
- `sources`
- `runs`
- `items`
- `runs_legacy`
- `yt_runs`

This indicates split authority across multiple generations of design.

### Scheduling and Jobs

Observed job patterns:

- Cloud Scheduler
- Cloud Run services
- Cloud Run jobs
- Pub/Sub

The scheduler and deployment logic is spread across multiple scripts rather than one clear infrastructure entrypoint.

## Current Risks

### Structural Risks

- Multiple overlapping pipelines exist for similar responsibilities.
- There is no single documented authoritative source of truth for every workflow.
- Root and `yt-ingest/` contain duplicated operational scripts.

### Operational Risks

- Catalog rebuild is not clearly chained to harvest completion.
- Viewer freshness depends on a CSV export process that is not fully automated in one place.
- Scheduler and deployment scripts are partially stale or malformed.

### Security Risks

- a real `client_secret.json` had been present in the repository and should be treated as compromised; it has now been removed from tracked source and replaced with a safe example file
- Operational logs and deployment artifacts are checked in.

### Repository Hygiene Risks

- `node_modules/`, `dist/`, backups, duplicate copies, and logs are committed.
- This makes it harder to identify authoritative source files.

## Best Current Mental Model

The safest way to understand the repo today is:

1. SUNO harvest and media capture are driven primarily by Python and shell scripts.
2. Firestore `sunoSongs` acts as the main catalog backing store for viewer export.
3. `rebuild_catalog.py` generates the viewer CSV.
4. The React viewer serves that CSV.
5. A separate queue and uploader path is intended to push selected SUNO clips to YouTube, but the UI-to-queue handoff is not fully wired in the checked-in code.

This overview is intended to describe the current observed state of the repository. Recommendations for future-state production authority live in the product document, project map, and production workflow spec.
