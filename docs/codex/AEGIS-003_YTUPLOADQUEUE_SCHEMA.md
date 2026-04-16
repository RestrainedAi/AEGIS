# AEGIS-003 ytUploadQueue Schema

## Collection

- `ytUploadQueue`

## Purpose

Dedicated Firestore collection for SUNO clip publishing work items destined for YouTube.

This collection exists to separate upload queue semantics from:

1. ingest content records
2. catalog item records
3. operational run records

## Minimum Schema

### Required Fields

1. `songKey`
   - Firestore `sunoSongs` document identifier
2. `status`
   - canonical viewer/API creation state is `queued`
   - allowed values: `queued`, `uploading`, `done`, `error`
3. `createdAt`
   - ISO-8601 timestamp
4. `retryCount`
   - integer
5. `queuedAt`
   - ISO-8601 timestamp written by the queue endpoint at creation

### Recommended Operational Fields

1. `startedAt`
   - should be written when queue status first transitions to `uploading`
2. `uploadedAt`
3. `ytVideoId`
4. `errorMsg`
5. `requestedFrom`
6. `gcsVideoUrl`

### Queue Metadata Override Fields To Retain

1. `ytDescription`
2. `ytPrivacy`
3. `ytLanguage`
4. `ytLicense`
5. `ytCategory`
6. `ytAlteredContent`
7. `ytShortsRemixing`

These are queue-owned per-request overrides and should be retained even if some are not surfaced in every UI.

### Mirrored Item YouTube Lifecycle Fields To Retain

These do not belong on `ytUploadQueue`, but they should be preserved on `sunoSongs` as mirrored publish outcome fields:

1. `ytStatus`
2. `ytVideoId`
3. `ytCanonicalUrl`
4. `ytStartedAt`
5. `ytUploadedAt`
6. `ytPublishedAt`
7. `ytError`
8. `ytErrorAt`

## Status Model

### States

1. `new`
2. `queued`
3. `uploading`
4. `done`
5. `error`

Canonical rule:

1. `queued` is the canonical initial state for viewer/API-created queue records
2. `new` is legacy/internal only unless another producer is intentionally retained

### Allowed Transitions

1. `queued -> uploading`
2. `uploading -> done`
3. `uploading -> queued` for retry
4. `queued -> error` if retry ceiling is exceeded
5. `new -> queued` only for legacy/internal producers if explicitly retained

## Idempotency Rules

Queue insertion should be idempotent by `songKey`.

Recommended behavior:

1. if an item is already `queued`, do not create a duplicate
2. if an item is already `uploading`, do not create a duplicate
3. if an item is already `done`, return existing result metadata
4. if an item is `error`, requeue should be an explicit operator action

## Current First-Wave Implementation State

Implemented:

1. `yt-ingest/queue_manager.py` now uses `ytUploadQueue`
2. `suno-viewer/server.js` queue endpoint creates records in `ytUploadQueue`
3. live viewer/API queue creation should be treated as direct `queued` creation, not `new`

Remaining follow-up:

1. full migration strategy for any historical queue data in `items`
2. stronger queue query indexes if production scale requires them
3. explicit schema validation if queue API surface expands
4. consistent `startedAt` writes when records first enter `uploading`
