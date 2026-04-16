# AEGIS Zero-Byte Media Prevention Handoff

Date: 2026-03-31
Stream: Vault to YouTube -> upstream prevention handoff
Status: Live uploader/viewer hardening complete; upstream prevention not yet implemented

## What We Confirmed

Two remaining Vault-to-YouTube failures were not caused by YouTube auth/runtime problems.

They were caused by zero-byte MP4 objects in GCS:

- `gs://aeonimus-suno-media/suno/handles/unshakableechos2341/63cae7f5-8d32-4ef1-9fd7-79983121501c.mp4`
- `gs://aeonimus-suno-media/suno/handles/unshakableechos2341/c901a10f-9e5c-40a0-b395-a456e17c98d0.mp4`

Observed live failure sequence before uploader hardening:

- uploader logged `downloaded 0 bytes`
- YouTube upload then failed with `Failed to parse Content-Range header`

Uploader hardening is now live and correctly converts that low-signal YouTube symptom into this actionable operator error:

- `Media file is empty (0 bytes): gs://... Recapture or repair the source video object before retrying YouTube upload.`

## Current System Truth

- New Vault-to-YouTube publishes are healthy.
- Queue cleanup/operator tooling is healthy.
- The remaining unresolved work is upstream media-integrity prevention.
- This should now be treated as a harvest/media-validation problem, not a Vault queue problem.

## Best Upstream Prevention Targets

### 1. `download_media_gcs.py`

Best primary prevention point.

Why:

- it is the file that actually streams bytes into GCS
- it already checks existing GCS objects and treats 0-byte existing objects as invalid
- it is the earliest place to reject or repair empty uploads before downstream systems see them

Recommended hardening:

1. After `stream_bytes_to_gcs(...)` or `stream_to_gcs(...)`, immediately stat the written object.
2. If object size is `0`, delete it and treat the download as failed.
3. Emit a high-signal log line including `clip_id`, `handle`, and object URI.
4. Do not allow 0-byte uploads to remain in canonical storage.

Desired behavior:

- a bad or interrupted download should fail there
- delta/retry logic can pick it up again later
- uploader never sees a placeholder zero-byte MP4

### 2. `catalog_sync_firestore_multi.py`

Already mostly correct.

Why:

- it uses `gsutil ls -l`
- it explicitly excludes 0-byte files from the GCS file set
- it already treats 0-byte objects as missing so they can be re-downloaded

Recommendation:

- keep this logic as the standard behavior model
- if other delta paths disagree, align them to this implementation

### 3. `delta_check_firestore.py`

Potentially stale/weaker path that should be audited.

Why:

- its `gs_exists(...)` uses `gsutil stat` only
- unlike the multi-handle path, it does not currently exclude 0-byte objects
- if this path still runs anywhere, it can misclassify empty files as valid

Recommendation:

- either retire this path if unused
- or harden it to match the zero-byte exclusion behavior already present in `catalog_sync_firestore_multi.py`

## Recommended Order

1. Harden `download_media_gcs.py` so newly written zero-byte media objects are rejected immediately.
2. Audit whether `delta_check_firestore.py` is still active anywhere.
3. If active, align its GCS existence logic to exclude 0-byte objects.
4. Keep `catalog_sync_firestore_multi.py` as the reference behavior for zero-byte exclusion.
5. After upstream hardening, repair/recapture the known bad MP4 objects and retry their queue rows.

## Smallest Safe Implementation Shape

Avoid schema work first.

The smallest safe change is:

- add post-write object-size validation in `download_media_gcs.py`
- delete zero-byte outputs immediately
- log them as download failures so normal retry/delta paths can recover them later

No database contract change is required for that first pass.

## Optional Future Improvements

These are good follow-ups, but not required for the first prevention pass:

- persist a structured media-integrity flag in Firestore
- record object byte size in a media/gcs subfield
- add a dedicated admin report of `Media Repair` candidates upstream of YouTube
- auto-recapture zero-byte media on next harvest pass instead of waiting for a manual retry

## Ownership Notes

- Vault/UI/uploader hardening for error clarity is complete on the Vault-to-YouTube side.
- Upstream prevention belongs on the harvest/media side and should be coordinated through the current ownership model.
- If `queue_manager.py` behavior needs to change later, coordinate with its current implementation owner.

## Live Result Snapshot

As of this handoff:

- queue totals: `done=42`, `queued=2`, `error=0`
- the 2 queued rows are now intentionally holding actionable media-repair errors instead of misleading YouTube errors
- the next operational step is media repair, not queue debugging
