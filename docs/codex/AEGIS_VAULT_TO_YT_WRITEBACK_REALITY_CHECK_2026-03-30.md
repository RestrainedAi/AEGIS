# AEGIS Vault to YouTube Writeback Reality Check - 2026-03-30

## Purpose

Capture the current code truth for queue lifecycle and item-level YouTube writeback so the shared contract stays aligned with actual implementation behavior.

This note is read-only guidance for the `Vault to YouTube` stream and does not change ownership.

## Files reviewed

- [queue_manager.py](C:/Users/blahn/OneDrive/Desktop/SUNO%20YouTube%20Pipeline/enviroment/AEGIS/yt-ingest/queue_manager.py)
- [youtube_uploader.py](C:/Users/blahn/OneDrive/Desktop/SUNO%20YouTube%20Pipeline/enviroment/AEGIS/yt-ingest/youtube_uploader.py)
- [AEGIS_Vault_To_YouTube_Contract_Brief_2026-03-29.md](C:/Users/blahn/OneDrive/Desktop/SUNO%20YouTube%20Pipeline/enviroment/AEGIS/docs/codex/AEGIS_Vault_To_YouTube_Contract_Brief_2026-03-29.md)

## Confirmed current behavior

### Queue creation and lifecycle

`queue_manager.py` confirms:

1. canonical creation state is `queued`
2. `queuedAt` is written at queue creation
3. `retryCount` is initialized to `0`
4. `startedAt` is written when a queue item first transitions to `uploading`
5. `uploadedAt` and `ytVideoId` are written on queue success
6. `errorMsg` is written on queue failure

`new` still exists in the code as a legacy migration path:

1. `enqueue_new()` migrates `new` -> `queued`
2. duplicate protection still checks for `new`

Interpretation:

1. `queued` is the live canonical initial queue state
2. `new` is legacy/internal compatibility only

### Item-level writeback on `sunoSongs`

`youtube_uploader.py` confirms:

On success:

1. `ytStatus = done`
2. `ytVideoId`
3. `ytCanonicalUrl`
4. `ytUploadedAt`
5. `ytPublishedAt`
6. `ytError = ""`
7. `ytErrorAt = ""`

On in-progress start:

1. `ytStatus = uploading`
2. `ytStartedAt`

On failure:

1. `ytStatus = error`
2. `ytError`
3. `ytErrorAt`

Skip behavior:

1. if a `sunoSongs` item already has `ytVideoId`, uploader treats it as already uploaded
2. if `ytCanonicalUrl` is missing but can be reconstructed from the existing video ID, it patches it back

## Contract alignment result

### Aligned

The current code matches the locked shared contract on:

1. `queued` as canonical creation state
2. `startedAt` on queue transition to `uploading`
3. retention of queue lifecycle timestamps
4. mirrored item YouTube lifecycle fields on `sunoSongs`

### Watch points

1. `queue_manager.py` still actively queries `new`, so that legacy path should not be removed casually until all producers are confirmed clean
2. queue success writes `uploadedAt` and `ytVideoId` on queue docs, but canonical published outcome still belongs on `sunoSongs`
3. uploader defaults some YouTube metadata if queue overrides are not present, so queue override retention still matters

## Guidance for Confucius

Before touching queue manager or uploader behavior:

1. preserve `queued` as the canonical live creation state
2. keep `new` support only as an intentional migration/compatibility path until explicitly retired
3. preserve queue override fields on `ytUploadQueue`
4. preserve item-level writeback fields on `sunoSongs`
5. do not move canonical publish outcome truth from `sunoSongs` into export rows or queue docs

## Next shared cleanup candidates

1. explicitly retire `new` once no producer emits it
2. tighten queue success/failure state docs to match exact writeback order
3. add a cheap queue/uploader contract validator later if needed
