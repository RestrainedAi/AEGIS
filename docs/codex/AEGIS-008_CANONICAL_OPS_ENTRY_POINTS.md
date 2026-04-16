# AEGIS-008 Canonical Ops Entry Points

## Decision

The canonical operational entry points for the current AEGIS runtime live in:

- `yt-ingest/` for harvest, export, queue, and runtime verification
- `suno-viewer/` for the live Vault web application

Repo-root script duplicates should not be treated as authoritative unless they are explicitly called out below.

## Current Classification

### Active

#### Harvest runtime

- `yt-ingest/entrypoint.sh`
  - Active Cloud Run Job entrypoint for `suno-harvest`
  - Verified in checked-in code to:
    - sync/fetch manifest
    - run media harvest
    - run `rebuild_catalog.py`
    - run post-harvest monitor

- `yt-ingest/rebuild_catalog.py`
  - Canonical catalog export generator
  - Writes:
    - `latest_catalog_wide.csv`
    - `latest_catalog_wide.meta.json`

- `yt-ingest/pipeline_monitor.py`
  - Active post-harvest monitor path referenced by `entrypoint.sh`

- `yt-ingest/queue_manager.py`
  - Active queue-processing implementation for `ytUploadQueue`

#### Harvest deploy and verification

- `yt-ingest/redeploy_harvest.sh`
  - Active operator redeploy/update path for the harvest job
  - Includes:
    - required-file checks
    - Cloud Build submit
    - Cloud Run job update
    - runtime-shape verification
    - optional immediate trigger

- `yt-ingest/verify_harvest_runtime.ps1`
  - Active read-only validation path for Windows/PowerShell operators
  - Intended to verify:
    - auth
    - secret presence
    - service account
    - env vars
    - latest execution metadata

#### Viewer

- `deploy_viewer.sh`
  - Active repo-root viewer deploy helper
  - Builds local viewer app, builds/pushes container, deploys `suno-viewer`

- `suno-viewer/server.js`
  - Active Cloud Run service server for the Vault viewer
  - Serves `/catalog.csv` from:
    - `gs://aeonimus-workspaces/exports/suno/latest_catalog_wide.csv`

### Transitional

- `yt-ingest/daily_suno_job.sh`
  - Valid checked-in shell orchestration path
  - Useful as a local/manual operator script and runtime reference
  - Not the actual Cloud Run entrypoint when `entrypoint.sh` is used in the current harvest container

- `daily_suno_job.sh`
  - Repo-root duplicate of the local/manual orchestration pattern
  - Similar intent, different working-directory assumptions
  - Should not be treated as the primary production job entrypoint

- `yt-ingest/deploy_viewer.py`
  - Narrow update helper that patches `suno-viewer` to the latest image
  - Useful for image-roll-forward workflows
  - Not a full rebuild-and-deploy path by itself

- `startup.sh`
  - Useful operator bootstrap/checklist for Cloud Shell sessions
  - Not a deploy or runtime entrypoint

### Stale / Suspect / Cleanup Candidates

- `scheduler_setup.sh`
  - Contains obvious corruption/garbling in the checked-in file contents
  - Should not be trusted as an authoritative scheduler setup script

- `daily_suno_job_(1).sh`
- `deploy_viewer_(1).sh`
- `yt-ingest/queue_manager_(1).py`
- `yt-ingest/rebuild_catalog.recovered.from-cloud-*`
  - Duplicate or recovery artifacts
  - Keep only if needed for recovery provenance
  - Otherwise label archival or remove from normal operator path

## Operational Interpretation

If an operator needs to understand the live system quickly, use this model:

1. Harvest job runtime:
   - `yt-ingest/entrypoint.sh`
2. Export generator:
   - `yt-ingest/rebuild_catalog.py`
3. Harvest redeploy:
   - `yt-ingest/redeploy_harvest.sh`
4. Harvest verification:
   - `yt-ingest/verify_harvest_runtime.ps1`
5. Queue processor:
   - `yt-ingest/queue_manager.py`
6. Viewer app:
   - `suno-viewer/`
7. Viewer deploy:
   - `deploy_viewer.sh`

## Current Documentation Gap

The repo currently contains enough duplicate and legacy-looking scripts that a new operator can still choose the wrong path by inspection alone. This ticket should not be considered fully closed until this mapping is surfaced in:

- a short repo-level runbook
- or the board/ops docs the team actually uses day to day

## Recommended Follow-Up

1. Add a short repo-root `OPERATIONS.md` or `RUNBOOK.md`
2. Mark duplicate scripts clearly as `transitional` or `stale`
3. Remove corrupted scheduler artifacts from the normal operator path
