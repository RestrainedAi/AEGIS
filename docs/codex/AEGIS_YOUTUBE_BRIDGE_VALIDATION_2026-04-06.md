# AEGIS YouTube Bridge Validation

Date: 2026-04-06
Scope:

- `AEGIS-002`
- `AEGIS-003`
- `AEGIS-004`
- `AEGIS-005`
- `AEGIS-010`

## Summary

The checked-in code strongly supports the intended YouTube bridge architecture:

- normalized env naming in the TypeScript ingest service
- dedicated `ytUploadQueue` queue model
- uploader support for canonical SUNO media fields and raw `gs://` paths
- viewer publish action writing directly into the queue

What is still missing is live runtime verification of deployed env/config and one full end-to-end publish lifecycle test.

## What Was Verified

### AEGIS-002 — Standardize YouTube API environment naming

Verified in the current TypeScript ingest entrypoint:

- `yt-ingest/index.ts` resolves:
  - `process.env.YOUTUBE_API_KEY || process.env.YT_API_KEY || ""`

That matches the intended policy:

- prefer `YOUTUBE_API_KEY`
- support `YT_API_KEY` as legacy alias

Important nuance:

- there is also a checked-in `yt-ingest/index.js` that still references only `YT_API_KEY`
- however, `yt-ingest/package.json` points runtime to:
  - `dist/index.js`
- and the TypeScript source of record is:
  - `index.ts`

Interpretation:

- the normalized policy appears correct in the maintained TypeScript runtime path
- the root `index.js` should be treated as stale or transitional unless proven active

### AEGIS-003 — Define dedicated `ytUploadQueue` schema

Verified in checked-in backend and monitoring code:

- `yt-ingest/queue_manager.py` documents and uses `ytUploadQueue`
- `yt-ingest/pipeline_monitor.py` also targets `ytUploadQueue`
- `suno-viewer/server.js` uses:
  - `const QUEUE_COLLECTION = "ytUploadQueue"`

Interpretation:

- queue semantics are separated from the main song catalog in the checked-in implementation

### AEGIS-004 — Update queue manager to use `ytUploadQueue`

Verified in checked-in queue processor:

- `yt-ingest/queue_manager.py` defaults:
  - `QUEUE_COLLECTION = os.environ.get("QUEUE_COLLECTION", "ytUploadQueue")`
- all list/query/create paths in that file target the queue collection, not the catalog collection

Interpretation:

- the checked-in queue manager implementation is aligned to `ytUploadQueue`

### AEGIS-005 — Align YouTube uploader with real SUNO media schema

Verified in checked-in uploader logic:

- `yt-ingest/youtube_uploader.py` resolves video media in this order:
  1. `media.videoUrl`
  2. `gcsPath`
  3. handle-based fallback
  4. songKey-based fallback

Verified in GCS support:

- uploader explicitly parses `gs://` URIs
- uploader raises high-signal errors for invalid `gs://` paths

Interpretation:

- the uploader is aligned to the canonical nested SUNO media schema
- direct `gs://` handling exists in the checked-in implementation

### AEGIS-010 — Implement viewer-to-queue publish action

Verified in checked-in web app:

- `suno-viewer/src/components/VaultGrid.tsx` calls:
  - `/api/queue-for-youtube`
  - `/api/trigger-upload-job`
  - `/api/publish-states`
  - `/api/queue-normalize`

Verified in viewer backend:

- `suno-viewer/server.js` implements `/api/queue-for-youtube`
- it:
  - loads the song doc
  - requires `media.videoUrl`
  - avoids duplicate queue creation
  - retries existing error rows when requested
  - creates queue docs in `ytUploadQueue`
  - stores per-song YouTube metadata overrides from the UI

Interpretation:

- the checked-in viewer-to-queue bridge exists
- it is more than a mock button; it writes durable queue records with metadata overrides

## What Is Still Missing

### Live env verification

Still needed for `AEGIS-002`:

- confirm the deployed runtime actually has the intended env names and values

### End-to-end queue lifecycle verification

Still needed for `AEGIS-003`, `AEGIS-004`, and `AEGIS-010`:

- viewer action creates queue item
- queue item transitions through status changes
- upload job consumes that item correctly
- durable YouTube result is written back to `sunoSongs`

### Real uploader dry run or live run against a current song doc

Still needed for `AEGIS-005`:

- confirm a real current song doc resolves `media.videoUrl` correctly in runtime

## Ticket Status Recommendation

### AEGIS-002

Recommended status:

- remain `Review`

Reason:

- implementation looks correct in `index.ts`
- deployed env/runtime still needs confirmation

### AEGIS-003

Recommended status:

- remain `Review`

Reason:

- checked-in schema separation is real
- live lifecycle proof still needed

### AEGIS-004

Recommended status:

- remain `Review`

Reason:

- queue manager is pointed at `ytUploadQueue`
- still needs end-to-end lifecycle proof

### AEGIS-005

Recommended status:

- remain `Review`

Reason:

- contract resolution logic is implemented
- real runtime validation against a live song doc still needed

### AEGIS-010

Recommended status:

- remain `Review`

Reason:

- checked-in bridge exists
- live click-through and job handoff still need proof

## Next Best Validation Steps

1. In an interactive shell with fresh auth, validate the deployed env/runtime for the ingest and queue jobs
2. Use one known-good song in the Vault to:
   - queue for YouTube
   - trigger upload job
   - observe queue status transitions
   - confirm Firestore song write-back
3. Capture one end-to-end evidence note and attach it back to:
   - `AEGIS-003`
   - `AEGIS-004`
   - `AEGIS-005`
   - `AEGIS-010`
