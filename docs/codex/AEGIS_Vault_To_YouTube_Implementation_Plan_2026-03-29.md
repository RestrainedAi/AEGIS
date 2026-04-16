# AEGIS Vault to YouTube Implementation Plan - 2026-03-29

## Purpose

This is the next implementation plan for the `Vault to YouTube` stream under the current ownership rules in:

- [AEGIS_Workstream_Ownership_And_Change_Control.md](C:/Users/blahn/OneDrive/Desktop/SUNO%20YouTube%20Pipeline/enviroment/AEGIS/docs/codex/AEGIS_Workstream_Ownership_And_Change_Control.md)

This plan stays inside `Confucius` write ownership:

1. vault UI handoff
2. queue manager behavior
3. uploader behavior
4. queue and upload state visibility

It does **not** directly implement Firestore/schema changes. Any schema-affecting proposal is called out separately for approval by the user or `Epicurus`.

## Execution Style

1. read-first validation before runtime execution
2. prefer queue/item/export inspection over new Cloud Run executions
3. use one known-good item if live validation is required
4. avoid SUNO harvest reruns for YouTube-side validation

## In-Order Tasks

### 1. Validate current viewer-visible YouTube state from existing data

Goal:

1. confirm the Vault correctly reflects existing YouTube result state from export data
2. confirm current UI state matches the locked contract model

Files:

1. [suno-viewer/src/components/VaultGrid.tsx](C:/Users/blahn/OneDrive/Desktop/SUNO%20YouTube%20Pipeline/enviroment/AEGIS/suno-viewer/src/components/VaultGrid.tsx)
2. [suno-viewer/src/types.ts](C:/Users/blahn/OneDrive/Desktop/SUNO%20YouTube%20Pipeline/enviroment/AEGIS/suno-viewer/src/types.ts)
3. [yt-ingest/rebuild_catalog.py](C:/Users/blahn/OneDrive/Desktop/SUNO%20YouTube%20Pipeline/enviroment/AEGIS/yt-ingest/rebuild_catalog.py)

Read-first validation:

1. inspect export columns already emitted for `ytStatus`, `ytVideoId`, `ytCanonicalUrl`, `ytPublishedAt`
2. verify the viewer uses export-backed YouTube state before any new queue action

Implementation:

1. keep the UI hydration path from export-backed YouTube fields
2. tighten any local type/state mismatches if needed

### 2. Normalize queue and publish state visibility in the Vault UI

Goal:

1. make the card-level and banner-level states reflect queue truth cleanly
2. keep queue lifecycle and item YouTube outcome distinct in the UI

Files:

1. [suno-viewer/src/components/VaultGrid.tsx](C:/Users/blahn/OneDrive/Desktop/SUNO%20YouTube%20Pipeline/enviroment/AEGIS/suno-viewer/src/components/VaultGrid.tsx)
2. [suno-viewer/src/types.ts](C:/Users/blahn/OneDrive/Desktop/SUNO%20YouTube%20Pipeline/enviroment/AEGIS/suno-viewer/src/types.ts)

Read-first validation:

1. inspect current queue-status aggregation response shape
2. inspect existing card badge logic and disabled-publish rules

Implementation:

1. normalize the user-facing labels for `queued`, `uploading`, `done`, and `error`
2. ensure already-published items render consistently from mirrored item fields
3. ensure error text only appears where current data actually supports it

### 3. Tighten the server-side queue handoff without changing schema

Goal:

1. make the queue boundary explicit and stable
2. improve duplicate handling and response semantics without changing stored contract fields

Files:

1. [suno-viewer/server.js](C:/Users/blahn/OneDrive/Desktop/SUNO%20YouTube%20Pipeline/enviroment/AEGIS/suno-viewer/server.js)

Read-first validation:

1. inspect current queue creation responses for new vs existing queue docs
2. inspect current Firestore queries used for dedupe

Implementation:

1. keep queue creation anchored to `sunoSongs.media.videoUrl`
2. return clearer API responses for:
   - already queued
   - already uploading
   - already done
3. keep `gcsVideoUrl` snapshot behavior as diagnostics only

### 4. Harden queue manager lifecycle behavior against the locked contract

Goal:

1. make queue progression behavior more explicit without introducing new schema directly
2. align queue-manager behavior with the `queued` canonical entry state

Files:

1. [yt-ingest/queue_manager.py](C:/Users/blahn/OneDrive/Desktop/SUNO%20YouTube%20Pipeline/enviroment/AEGIS/yt-ingest/queue_manager.py)

Read-first validation:

1. inspect current status transitions in code
2. inspect existing queue docs and historical queue logs before changing runtime behavior

Implementation:

1. reduce reliance on `new` where the live viewer path already creates `queued`
2. keep duplicate prevention for `queued`, `uploading`, and `done`
3. keep retry behavior explicit and operator-readable

### 5. Harden uploader behavior and result handling without widening schema

Goal:

1. tighten the uploader around existing authoritative fields
2. make result handling and duplicate prevention clearer

Files:

1. [yt-ingest/youtube_uploader.py](C:/Users/blahn/OneDrive/Desktop/SUNO%20YouTube%20Pipeline/enviroment/AEGIS/yt-ingest/youtube_uploader.py)

Read-first validation:

1. inspect uploader success/failure write-back behavior
2. inspect existing secrets/log assumptions before any live execution

Implementation:

1. keep `sunoSongs.media.videoUrl` as the canonical media lookup
2. keep `ytVideoId` duplicate guard behavior explicit
3. keep queue overrides mapped into uploader metadata without shifting ownership

### 6. Reconcile workflow docs to current implementation truth

Goal:

1. keep implementation docs aligned with what now exists
2. reduce future confusion and duplicate investigation

Files:

1. [docs/codex/SUNO_SUNO_To_YouTube_Production_Workflow_Spec.md](C:/Users/blahn/OneDrive/Desktop/SUNO%20YouTube%20Pipeline/enviroment/AEGIS/docs/codex/SUNO_SUNO_To_YouTube_Production_Workflow_Spec.md)
2. queue/uploader implementation notes under `docs/codex/`

Implementation:

1. remove stale wording that treats the Vault publish handoff as hypothetical
2. keep docs aligned to the ownership and contract decisions already locked

## Schema Changes To Propose Back First

These should be proposed to the user or `Epicurus`, not implemented directly here.

### Proposal 1

Lock one canonical queue creation state:

1. `queued` for viewer/API-created queue items
2. treat `new` as legacy/internal unless another producer still needs it

### Proposal 2

Add or explicitly bless queue lifecycle timing fields:

1. `startedAt` on `ytUploadQueue`

### Proposal 3

Explicitly retain full item-level YouTube lifecycle fields in the authoritative field dictionary:

1. `ytStartedAt`
2. `ytUploadedAt`
3. `ytError`
4. `ytErrorAt`

### Proposal 4

Explicitly retain queue-level metadata override fields in the authoritative field dictionary:

1. `ytDescription`
2. `ytPrivacy`
3. `ytLanguage`
4. `ytLicense`
5. `ytCategory`
6. `ytAlteredContent`
7. `ytShortsRemixing`

## Recommended Immediate Order

1. finish read-first validation of viewer/export-backed YouTube state
2. normalize Vault UI state visibility
3. tighten server-side queue response semantics
4. align queue manager behavior to the canonical queue entry model
5. harden uploader result handling
6. hand any schema-affecting proposals to the user or `Epicurus`

## Short Conclusion

The next productive Vault-to-YouTube pass is not a broad rebuild.

It is a narrow implementation pass focused on:

1. better state visibility
2. cleaner queue handoff behavior
3. clearer uploader/result handling
4. only proposing schema changes where they are truly needed
