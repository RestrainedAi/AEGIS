# AEGIS Vault to YouTube Working Brief - 2026-03-29

## Purpose

This document is the current working brief for the `Vault to YouTube` stream.

It focuses only on:

1. viewer publish handoff
2. queue schema and lifecycle
3. uploader contract
4. uploader auth and runtime reliability
5. queue and upload state visibility in the UI

This brief is intended to guide the next implementation pass and keep the Vault stream separate from the SUNO Harvest stream.

## Stream Definition

### Mission

Turn the Vault into a reliable staging and handoff surface for YouTube publishing.

### Scope

This stream owns:

1. Publish actions in the Vault UI
2. Firestore `ytUploadQueue`
3. queue dedupe and lifecycle rules
4. uploader media resolution and upload write-back
5. YouTube OAuth/runtime readiness
6. queue/upload state visibility in the Vault

## Operating Constraint

This stream should assume real Google Cloud cost and runtime pressure.

Especially important:

1. do not assume SUNO harvest reruns are freely available for validation
2. do not assume Cloud Run executions are cheap enough to use as exploratory debugging
3. treat current server resources as constrained

Default stream behavior should therefore be:

1. prefer read-first validation
2. reuse existing Firestore, GCS, queue, and log data
3. prefer one-item validation over many-item validation
4. separate uploader validation from harvest validation
5. avoid recommendations that trigger unnecessary Cloud Run cost

Practical implication:

Vault-to-YouTube work should validate against already indexed songs and already available media first, and should only use narrow live executions when they answer a specific blocker.

## Tickets In This Stream

### Core publishing path

1. `AEGIS-002` Standardize YouTube API environment naming
2. `AEGIS-003` Define dedicated `ytUploadQueue` schema
3. `AEGIS-004` Update queue manager to use `ytUploadQueue`
4. `AEGIS-005` Align YouTube uploader with real SUNO media schema
5. `AEGIS-010` Implement viewer-to-queue publish action

### Shared product and design support

1. `EPIC-11` Define status taxonomy and operational UI model
2. `EPIC-12` Deliver UX handoff for core product surfaces

### Net-new child tickets recommended for this stream

1. Add queue state badges to Catalog Browser and Item Detail
2. Add publish readiness checks before queue creation
3. Create queue review and upload history view
4. Clarify duplicate queue behavior and requeue rules
5. Surface uploader failure reasons in operator-facing UI

## Current Repo Truth

## 1. The Vault UI already contains a real YouTube publish flow

Observed in:

1. [server.js](C:/Users/blahn/OneDrive/Desktop/SUNO%20YouTube%20Pipeline/enviroment/AEGIS/suno-viewer/server.js)
2. [VaultGrid.tsx](C:/Users/blahn/OneDrive/Desktop/SUNO%20YouTube%20Pipeline/enviroment/AEGIS/suno-viewer/src/components/VaultGrid.tsx)

What exists in code now:

1. `POST /api/queue-for-youtube`
2. `POST /api/trigger-upload-job`
3. `GET /api/queue-status`
4. per-song Publish button
5. multi-select Publish Selected flow
6. YouTube metadata modal
7. queue polling banner
8. queue/upload badges in the Vault UI

This means the Vault-to-queue boundary is implemented in the repo, not just planned.

## 2. Queue creation is server-side validated against Firestore, not CSV

Observed in:

1. [server.js](C:/Users/blahn/OneDrive/Desktop/SUNO%20YouTube%20Pipeline/enviroment/AEGIS/suno-viewer/server.js)

The queue endpoint:

1. requires `songKey`
2. loads the `sunoSongs/{songKey}` Firestore doc
3. validates `media.videoUrl`
4. prevents duplicate queue docs when a queue record already exists
5. writes queue docs into `ytUploadQueue`

This is the correct architectural direction and avoids gating publish on stale CSV fields.

## 3. Queue management uses `ytUploadQueue`

Observed in:

1. [queue_manager.py](C:/Users/blahn/OneDrive/Desktop/SUNO%20YouTube%20Pipeline/enviroment/AEGIS/yt-ingest/queue_manager.py)
2. [AEGIS-003_YTUPLOADQUEUE_SCHEMA.md](C:/Users/blahn/OneDrive/Desktop/SUNO%20YouTube%20Pipeline/enviroment/AEGIS/docs/codex/AEGIS-003_YTUPLOADQUEUE_SCHEMA.md)

The queue manager now:

1. reads `ytUploadQueue`
2. treats `queued` as the live canonical entry state for viewer-created queue items
3. can still migrate legacy `new` items into `queued`
4. processes `queued`
5. writes `done` on success
6. retries in `queued` until retry ceiling is reached
7. marks terminal queue errors when retry ceiling is exceeded

That means the schema split from catalog records is materially in place.

## 4. The uploader contract is aligned to `sunoSongs.media.videoUrl`

Observed in:

1. [youtube_uploader.py](C:/Users/blahn/OneDrive/Desktop/SUNO%20YouTube%20Pipeline/enviroment/AEGIS/yt-ingest/youtube_uploader.py)
2. [AEGIS-005_UPLOADER_SCHEMA_ALIGNMENT_NOTE.md](C:/Users/blahn/OneDrive/Desktop/SUNO%20YouTube%20Pipeline/enviroment/AEGIS/docs/codex/AEGIS-005_UPLOADER_SCHEMA_ALIGNMENT_NOTE.md)

The uploader now:

1. resolves `media.videoUrl` first
2. supports `gs://` parsing directly
3. only falls back to older path assumptions when canonical media fields are absent
4. writes back:
   - `ytVideoId`
   - `ytCanonicalUrl`
   - `ytStatus`
   - `ytUploadedAt`
   - `ytPublishedAt`
   - `ytError`
5. treats existing durable YouTube outcomes as duplicate guards
6. clears stale error state on successful upload completion

This means the uploader-side media contract is largely corrected in code.

## 5. The workflow spec is partially outdated relative to the current repo

Observed in:

1. [SUNO_SUNO_To_YouTube_Production_Workflow_Spec.md](C:/Users/blahn/OneDrive/Desktop/SUNO%20YouTube%20Pipeline/enviroment/AEGIS/docs/codex/SUNO_SUNO_To_YouTube_Production_Workflow_Spec.md)

The workflow spec still contains older statements suggesting:

1. the Vault UI does not yet include publish workflow
2. the queue/API layer is still only a proposed path

That is no longer fully true in the repo.

So one important stream task is documentation reconciliation.

## Current Production Truth

The most reliable recent production truth available in repo docs is:

1. the Vault is operational again
2. the live Publish button creates queue docs in `ytUploadQueue`
3. the next blocker is downstream of the Vault boundary
4. queued items were previously failing uploader-side with `401 Unauthorized`

Primary source:

1. [HANDOFF_TO_CICERO_2026-03-22.md](C:/Users/blahn/OneDrive/Desktop/SUNO%20YouTube%20Pipeline/enviroment/AEGIS/docs/codex/HANDOFF_TO_CICERO_2026-03-22.md)

Important note:

I attempted to verify the current live Cloud Run service and job state today, but local `gcloud` auth requires reauthentication before non-interactive inspection will work again. So the production statements above are grounded in the latest checked-in handoff and code, but not re-verified live in this turn.

## What Is Already Fixed

1. The Vault-side Publish UI exists in the codebase.
2. Batch Publish Selected exists in the codebase.
3. The queue API validates against Firestore `sunoSongs.media.videoUrl`.
4. `ytUploadQueue` exists as the intended dedicated queue collection.
5. Queue processing code targets `ytUploadQueue`.
6. The uploader resolves canonical `gs://` media instead of only legacy path assumptions.
7. The UI already has queue polling and item-level YouTube badges.

## What Remains Open

1. Live uploader auth/credential reliability remains the primary blocker until re-verified.
2. End-to-end live validation from:
   - viewer
   - `ytUploadQueue`
   - `yt-upload-job`
   - YouTube
   has not yet been fully closed in the current brief.
3. Queue lifecycle semantics still need stricter validation:
   - duplicate handling
   - done handling
   - explicit requeue behavior
   - queue error terminality
4. Queue and upload state are present in the UI, but not yet shaped into a fuller operator review experience.
5. Product docs and workflow spec need reconciliation with what now exists in code.
6. Live Cloud Run deployment and service account state for `yt-upload-job` should be rechecked after auth refresh.

## First 5 Execution Tickets To Start With

### 1. Re-verify the live Vault-to-queue-to-upload path end to end

Type:

1. Story

Goal:

1. confirm the current live Publish action still creates `ytUploadQueue` docs
2. confirm the upload job still runs
3. capture the current live blocker precisely

Constraint note:

1. use one known-good song only
2. avoid broad reruns or batch tests

Acceptance:

1. one known-good `songKey` is queued from the live Vault
2. queue doc state transitions are recorded
3. uploader outcome is confirmed as success or specific failure

### 2. Close uploader auth and credential readiness

Type:

1. Bug

Goal:

1. eliminate the uploader-side auth failure path

Constraint note:

1. inspect secrets, service account readiness, queue docs, and logs before attempting repeated executions

Acceptance:

1. `yt-upload-job` can obtain required secrets and YouTube token
2. at least one queued clip completes successfully
3. Firestore write-back fields are present after upload

### 3. Validate queue lifecycle and dedupe rules in production

Type:

1. Story

Goal:

1. prove that queue records behave correctly for:
   - already queued
   - uploading
   - done
   - error

Constraint note:

1. prefer historical queue docs and narrow manual checks over repeated upload executions

Acceptance:

1. duplicate publish attempts do not create duplicate queue records
2. done items return stable result metadata
3. error items require explicit operator action or documented behavior

### 4. Surface queue and upload status clearly in the product model

Type:

1. Story

Goal:

1. align the current UI badges and banner behavior to the approved status model

Constraint note:

1. this should be driven mostly from existing UI behavior and current data, not new runtime cost

Acceptance:

1. item cards have clear states for queued, uploading, done, and error
2. item detail design requirements reflect those same states
3. operator-facing error text is explicit enough to act on

### 5. Reconcile docs and tickets to current implementation truth

Type:

1. Task

Goal:

1. update stale workflow/spec notes that still describe publish flow as missing

Constraint note:

1. this is a zero-cost clarity task and should be favored while resource pressure is high

Acceptance:

1. the workflow spec reflects the existence of:
   - publish UI
   - queue API
   - `ytUploadQueue`
   - queue-status polling
2. Jira ticket status matches real implementation state more closely

## Recommended Working Order

1. Verify live truth
2. Fix uploader auth if still broken
3. Validate queue lifecycle
4. Improve queue/upload visibility in shared product surfaces
5. Reconcile docs and Jira to current code truth

## Cost-Aware Execution Style

Use this stream style by default:

1. inspect before executing
2. validate with one item before validating with many
3. prefer queue, job, and log introspection before rerunning Cloud Run jobs
4. reuse existing indexed media instead of triggering new harvest work
5. keep YouTube-side validation isolated from SUNO-side cost whenever possible

## Short Conclusion

The Vault-to-YouTube stream is further along than the backlog alone suggests.

The Vault boundary is not the main missing piece anymore.

The center of gravity is now:

1. uploader auth and runtime validation
2. queue lifecycle hardening
3. clearer operator-facing status visibility
4. cleanup of doc/ticket drift
