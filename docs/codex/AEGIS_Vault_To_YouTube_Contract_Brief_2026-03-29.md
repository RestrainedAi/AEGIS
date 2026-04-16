# AEGIS Vault to YouTube Contract Brief - 2026-03-29

## Purpose

This brief aligns the `Vault to YouTube` stream to:

1. [AEGIS_Data_Contract_Alignment_Brief.md](C:/Users/blahn/OneDrive/Desktop/SUNO%20YouTube%20Pipeline/enviroment/AEGIS/docs/codex/AEGIS_Data_Contract_Alignment_Brief.md)
2. current repo truth in the viewer, queue manager, uploader, and export code

It is intentionally concise and biased toward:

1. read-first validation
2. current code truth
3. minimum contract changes
4. avoiding assumptions that require extra harvest runs

## 1. Authoritative Entities and Collections

### Authoritative entities

1. `Item`
   - authoritative record: `sunoSongs/{songKey}`
   - purpose: source item identity, harvested media truth, and final YouTube result truth
2. `Queue Item`
   - authoritative record: `ytUploadQueue/{queueId}`
   - purpose: publish work request, queue lifecycle, retry state, and operator-visible queue outcome
3. `Export Artifact`
   - authoritative artifacts:
     - `gs://aeonimus-workspaces/exports/suno/latest_catalog_wide.csv`
     - `gs://aeonimus-workspaces/exports/suno/latest_catalog_wide.meta.json`
   - purpose: viewer-facing projection of item state

### Non-authoritative but relevant

1. Vault UI local `ytStatus` state
   - convenience state only
   - not a source of truth
2. queue-status aggregate endpoint
   - operational summary only
   - not item-level truth

## 2. Required Fields for Queue, Uploader, Publish Readiness, and Status

### Item fields required for publish readiness

These belong on `sunoSongs`.

Required:

1. `songKey`
2. `media.videoUrl`

Strongly recommended:

1. `title`
2. `status`
3. `handle`
4. `ytStatus`
5. `ytVideoId`
6. `ytCanonicalUrl`

Interpretation:

1. publish readiness is primarily `songKey + media.videoUrl`
2. `ytVideoId` is the strongest duplicate-upload guard
3. item `status` may block publishing if the item is removed or otherwise non-active, but that rule is not yet fully formalized in backend contract

### Queue fields required at queue creation time

These belong on `ytUploadQueue`.

Required:

1. `songKey`
2. `status`
3. `createdAt`
4. `queuedAt`
5. `retryCount`

Current viewer-created fields:

1. `requestedFrom`
2. `gcsVideoUrl`

Optional queue metadata overrides:

1. `ytDescription`
2. `ytPrivacy`
3. `ytLanguage`
4. `ytLicense`
5. `ytCategory`
6. `ytAlteredContent`
7. `ytShortsRemixing`

Retention rule:

1. queue override fields should be retained on queue records even if some current UI flows do not populate all of them
2. these overrides remain queue-owned request metadata and should not be copied back as harvest-owned item truth

### Queue lifecycle/status fields

Required:

1. `status`
2. `retryCount`

Required for useful operations visibility:

1. `queuedAt`
2. `uploadedAt`
3. `ytVideoId`
4. `errorMsg`

Recommended but currently inconsistent:

1. `startedAt`

Clarification:

1. `startedAt` should be written once a queue item first transitions to `uploading`
2. it may be absent at creation time, but it should not be absent from terminal queue records that passed through `uploading`

### Item fields required as uploader write-back

These belong on `sunoSongs`.

Required on success:

1. `ytStatus`
2. `ytVideoId`
3. `ytCanonicalUrl`
4. `ytUploadedAt`
5. `ytPublishedAt`

Required on failure:

1. `ytStatus`
2. `ytError`
3. `ytErrorAt`

Recommended for full lifecycle clarity:

1. `ytStartedAt`

Retention rule:

1. mirrored item YouTube lifecycle fields should be preserved on `sunoSongs` even if the export or UI only uses a subset today
2. queue progression continues to belong to `ytUploadQueue`; item mirrors are publish outcomes, not queue authority

### Export fields required from YouTube-side state

Current export already carries:

1. `ytStatus`
2. `ytVideoId`
3. `ytCanonicalUrl`
4. `ytPublishedAt`

That is sufficient for read-only published-state visibility, but not for queue-progress visibility.

## 3. Field Ownership

### `sunoSongs` ownership

Harvest/indexing owns:

1. `songKey`
2. harvested identity fields
3. `media.*`
4. source/item `status`
5. source lineage and freshness fields

Uploader owns:

1. `ytStatus`
2. `ytStartedAt`
3. `ytVideoId`
4. `ytCanonicalUrl`
5. `ytUploadedAt`
6. `ytPublishedAt`
7. `ytError`
8. `ytErrorAt`

### `ytUploadQueue` ownership

Viewer/API owns at creation:

1. `songKey`
2. initial `status`
3. `createdAt`
4. `queuedAt`
5. `retryCount`
6. `requestedFrom`
7. queue-level metadata overrides
8. optional `gcsVideoUrl` snapshot

Queue manager owns after creation:

1. queue `status`
2. retry progression
3. `errorMsg`
4. `uploadedAt`
5. `ytVideoId`
6. `startedAt` once added

### Export ownership

`rebuild_catalog.py` owns projection only.

It may mirror item YouTube fields into export, but it should not define queue truth or queue lifecycle.

## 4. Producer -> Consumer Boundaries

### Boundary A: Item index -> Vault queue endpoint

Producer:

1. `sunoSongs`

Consumer:

1. `POST /api/queue-for-youtube`

Contract:

1. queue creation reads `sunoSongs`
2. queue creation validates `media.videoUrl`
3. queue creation should not derive canonical media truth from export CSV

### Boundary B: Vault queue endpoint -> `ytUploadQueue`

Producer:

1. viewer API in `server.js`

Consumer:

1. `ytUploadQueue`

Contract:

1. queue doc is a publish request
2. queue doc may contain metadata overrides
3. queue doc must not replace item-level media or result truth

### Boundary C: `ytUploadQueue` -> queue manager

Producer:

1. `ytUploadQueue`

Consumer:

1. `queue_manager.py`

Contract:

1. queue manager reads queue lifecycle fields only
2. queue manager decides retry behavior and terminal queue state
3. queue manager passes the queue doc to uploader as runtime context

### Boundary D: queue manager -> uploader

Producer:

1. `queue_manager.py`

Consumer:

1. `youtube_uploader.py`

Contract:

1. uploader receives `songKey`
2. uploader may read queue metadata overrides from the queue doc
3. uploader resolves canonical media from `sunoSongs.media.videoUrl` first
4. uploader should treat queue `gcsVideoUrl` as optional snapshot convenience, not authority

### Boundary E: uploader -> item index

Producer:

1. `youtube_uploader.py`

Consumer:

1. `sunoSongs`
2. export rebuild
3. vault UI

Contract:

1. uploader writes final YouTube result state to the item record
2. rebuild/export reads item YouTube fields, not queue fields
3. published-state visibility in the vault should come from item YouTube fields

## 5. Known Drift and Ambiguity

### Drift 1: initial queue state is inconsistent

Docs and queue manager still describe `new -> queued`, but the viewer writes queue docs directly as `queued`.

Implication:

1. `new` is not a reliable canonical entry state for the live viewer path

### Drift 2: queue and item statuses overlap semantically

Queue uses:

1. `queued`
2. `uploading`
3. `done`
4. `error`

Item uses:

1. `ytStatus = uploading | done | error`

Implication:

1. identical words are carrying two different meanings
2. the UI can blur queue progress and published result unless ownership stays explicit

### Drift 3: queue stores `gcsVideoUrl`, but uploader does not treat it as authority

Viewer snapshots `gcsVideoUrl` into queue docs, but uploader resolves media from `sunoSongs.media.videoUrl` first and only uses legacy fallbacks after that.

Implication:

1. `gcsVideoUrl` is currently ambiguous
2. it looks canonical, but behaves as a convenience snapshot

### Drift 4: queue lifecycle timing is incomplete

Recommended docs include `startedAt`, but queue manager currently does not write it.

Implication:

1. queue runtime visibility is weaker than it should be
2. uploader start and queue start are not clearly separated

### Drift 5: duplicate and requeue rules are only partially encoded

Current behavior:

1. viewer checks for any existing queue doc by `songKey`
2. queue manager dedupes against `new`, `queued`, `uploading`, and `done`
3. `error` handling is retry-based inside queue manager, but explicit operator requeue semantics are not fully locked

Implication:

1. dedupe behavior is close, but not yet fully formalized as a contract

### Drift 6: export reflects item YouTube state, not queue state

This is mostly correct, but the UI still relies on local transient state plus aggregate queue polling for in-flight visibility.

Implication:

1. published state is durable
2. in-flight queue state is not durable in the export and should not be assumed to be

## 6. Minimum Contract Changes Recommended

### Change 1: lock authoritative ownership explicitly

Lock now:

1. `sunoSongs.media.videoUrl` is canonical media input
2. `ytUploadQueue` owns publish request and queue lifecycle
3. `sunoSongs` owns final YouTube result fields
4. export mirrors item YouTube result fields only

### Change 2: standardize queue creation state

Pick one canonical initial queue state and document it everywhere.

Minimum-change recommendation:

1. standardize on `queued` as the created state for viewer/API-created records
2. treat `new` as legacy/internal only until removed from docs and helper paths

### Change 3: add `startedAt` on queue transition to `uploading`

This is the smallest change that materially improves queue lineage and operator visibility.

### Change 4: demote `gcsVideoUrl` to optional snapshot-only field

Document:

1. `gcsVideoUrl` may be stored on queue docs for debugging or traceability
2. uploader authority remains `sunoSongs.media.videoUrl`

### Change 5: formalize duplicate and requeue rule

Lock now:

1. existing `queued` or `uploading` item -> no duplicate queue doc
2. existing `done` item -> return existing YouTube metadata, no duplicate queue doc
3. existing `error` item -> only requeue through explicit operator action

### Change 6: keep queue status out of export contract

Do not mirror queue lifecycle into the catalog export as canonical truth yet.

Reason:

1. it would blur item and queue ownership
2. current queue visibility should come from queue reads or queue-specific UI surfaces, not export rows

## Read-First Validation Notes

Use these validation paths before any runtime execution:

1. inspect representative `sunoSongs` docs for `media.videoUrl`, `ytStatus`, and `ytVideoId`
2. inspect existing `ytUploadQueue` docs for actual field usage and state transitions
3. inspect queue manager and uploader logs for lifecycle evidence
4. use one known-good already indexed song for any live validation

## Short Recommendation

The Vault-to-YouTube stream does not need a broad schema rewrite first.

It needs six contract locks:

1. authority split between `sunoSongs` and `ytUploadQueue`
2. canonical queue entry state
3. canonical media input
4. uploader write-back ownership
5. explicit duplicate/requeue rule
6. queue visibility staying outside export truth

Those changes are small enough to implement without extra harvest runs and strong enough to stabilize the stream.
