# Handoff To Cicero (Vault + YouTube Publish) - 2026-03-21

Audience: Cicero (Vault owner)
Author: Codex agent (this thread)
Goal: Provide a complete snapshot of what I changed, what I observed in prod, and what to do next.

## Executive Summary

1. The "titles are messed up" behavior in the Vault is primarily a data problem, not a UI parser problem:
   - The published `catalog.csv` backing `https://music.aeonimus.info/vanessa` contains a very large number of empty `title` fields.
2. I implemented local code changes to support "Vault -> YouTube" publishing quickly:
   - Publish is now validated server-side (Firestore `sunoSongs.media.videoUrl`) instead of being blocked by missing CSV `gcs_mp4` fields.
   - Added a simple multi-select + "Publish Selected" action.
3. I added a one-time backfill script to repair missing titles in Firestore `sunoSongs` using the Studio API clip endpoint.
   - A dry-run worked; a full run was started but was interrupted/stopped, so Firestore may be partially updated.
4. In production, `https://music.aeonimus.info/catalog.csv` works, but `https://music.aeonimus.info/healthz` and `https://music.aeonimus.info/api/queue-for-youtube` returned 404 when I tested.
   - This strongly suggests the deployed `suno-viewer` container is not the same as the repo `server.js` I reviewed.

## What I Observed (Prod Reality Checks)

### Vault export data quality

I fetched the live CSV from:
- `https://music.aeonimus.info/catalog.csv`

Counts I measured (using Python CSV parsing):
- total rows: `1845`
- empty `title`: `1597`
- `title` values starting with `Title:`: `6`

Interpretation:
- The Vault UI showing "Untitled"/wrong titles from some page onward is very consistent with the export simply lacking `title` for most rows.

### Vault service routes

From my tests:
- `GET https://music.aeonimus.info/vanessa` returned `200` and looked like the Vite-built app served via Express.
- `GET https://music.aeonimus.info/healthz` returned `404`.
- `POST https://music.aeonimus.info/api/queue-for-youtube` returned `404`.

Interpretation:
- `suno-viewer` is deployed, but its server routes likely do not include `/healthz` or `/api/queue-for-youtube` yet.

### GCP jobs exist

In project `stable-framing-482501-t9` (region `us-central1`):
- Cloud Run Jobs listed:
  - `suno-harvest`
  - `yt-upload-job`
- Cloud Scheduler Jobs listed:
  - `suno-harvest-nightly` (2am America/Chicago)
  - `yt-upload-daily` (06:00 UTC)
  - plus legacy `aeonimus-suno-ingest`, `aeonimus-yt-playlist-ingest`

## Files I Changed / Added (Local Repo Workspace)

Note: this workspace currently shows `AEGIS/` as untracked in git, so I cannot provide a git diff.
Below is the authoritative list of files I edited/created during this session.

### 1) Vault UI changes (Publish + multi-select)

Edited:
- `D:\\_ Ai Apps GPTs Automations\\SUNO YouTube Pipeline\\enviroment\\AEGIS\\suno-viewer\\src\\components\\VaultGrid.tsx`

What changed:
- Removed client-side gating that disabled Publish when CSV columns `gcs_mp4/gcs_latest_mp4` are empty.
  - Rationale: publishability should be validated server-side based on Firestore `sunoSongs.media.videoUrl` (gs:// mp4), not CSV.
- Added per-card checkbox "Select".
- Added header actions:
  - `Publish Selected (N)` queues songs sequentially via `/api/queue-for-youtube`.
  - `Clear` clears selection.

Impact:
- Vanessa can select 1+ songs and queue them for upload from the Vault UI once the deployed service exposes `/api/queue-for-youtube`.

### 2) Firestore title repair tool (one-time backfill)

Added:
- `D:\\_ Ai Apps GPTs Automations\\SUNO YouTube Pipeline\\enviroment\\AEGIS\\yt-ingest\\backfill_titles_from_studio_api.py`

What it does:
- Lists all `sunoSongs` docs from Firestore REST.
- For docs where `title` is empty or starts with `Title:`, fetches:
  - `https://studio-api.prod.suno.com/api/clip/<songKey>`
- Patches Firestore doc fields:
  - `title` (and `createdAt` if missing)
  - `updatedAt` to now

Windows compatibility:
- It runs `gcloud auth print-access-token` via `cmd /c ...` to work on Windows where `gcloud` is typically a `.cmd` shim.

How to run safely (recommended):
- Dry run: `python backfill_titles_from_studio_api.py --dry-run --limit 20`
- Real run in chunks: `python backfill_titles_from_studio_api.py --limit 200`
  - Repeat until `empty_titles` drops near zero, then run `rebuild_catalog.py`.

## Commands I Ran (Including Background Work)

### Vault CSV diagnosis

- Fetched the CSV from `https://music.aeonimus.info/catalog.csv` and computed title quality metrics via Python.

### YouTube publish route diagnosis

- `POST https://music.aeonimus.info/api/queue-for-youtube` with a test `songKey` returned 404 (route absent in deployed service).

### GCP checks

- `gcloud run jobs list --region=us-central1 --project=stable-framing-482501-t9`
- `gcloud scheduler jobs list --location=us-central1 --project=stable-framing-482501-t9`
- Confirmed `suno-viewer` service account:
  - `gcloud run services describe suno-viewer ...`
  - It is currently using the compute default service account.

### Backfill attempts

- Dry-run succeeded: `python ... backfill_titles_from_studio_api.py --dry-run --limit 5`
- Real run was started but was interrupted/stopped due to time and later "stop" instructions.
  - Firestore may have been partially updated.

## Background Processes (Started / Stopped)

I had multiple Python processes running from interrupted backfill attempts.
At user request ("stop"), I enumerated running Python processes and force-stopped them:
- Killed `python` PIDs: `31176`, `43440`, `59124`

I did not stop any Node processes; there were multiple Node processes running in the environment that appear unrelated to the backfill.

## What Needs To Happen Next (To Get Vanessa Working ASAP)

### A) Fix the Vault titles permanently (data + export)

1. Run the title backfill in manageable batches:
   - `python backfill_titles_from_studio_api.py --limit 200`
2. Rebuild and publish the export:
   - `python rebuild_catalog.py`
3. Confirm live CSV looks good:
   - `GET https://music.aeonimus.info/catalog.csv`
   - spot check that `title` is populated for the older catalog rows.

Notes:
- If the Studio API is rate-limiting, increase `--sleep` or run in fewer batches.

### B) Make Vault -> YouTube work today

1. Ensure the deployed `suno-viewer` server has these routes:
   - `GET /healthz`
   - `POST /api/queue-for-youtube`
2. If those routes are missing in prod (my last test returned 404), redeploy `suno-viewer` with the current `server.js`.
3. Validate queue creation:
   - POST `/api/queue-for-youtube` with a known-good `songKey` that has `sunoSongs.media.videoUrl` populated.
   - Confirm a new Firestore doc is created in `ytUploadQueue`.
4. Trigger upload immediately (optional, to avoid waiting for scheduler):
   - `gcloud run jobs execute yt-upload-job --region=us-central1 --project=stable-framing-482501-t9`
5. Watch job logs and confirm Firestore `sunoSongs` gets:
   - `ytVideoId`, `ytCanonicalUrl`, `ytStatus=done`, `ytUploadedAt`

## Known Risks / Gotchas

1. The export generator `rebuild_catalog.py` currently does not flatten nested `media.*` into the CSV `gcs_*` columns.
   - That's OK for publishing now (server validates against Firestore), but it is confusing for UI completeness badges.
2. There are multiple SUNO/YouTube ingest paths and historical scheduler scripts.
   - For Phase I, treat the operational backbone as:
     - harvest -> Firestore `sunoSongs` -> rebuild export -> viewer
     - viewer -> `ytUploadQueue` -> `yt-upload-job`

