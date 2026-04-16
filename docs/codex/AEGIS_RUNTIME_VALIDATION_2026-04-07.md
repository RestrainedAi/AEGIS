# AEGIS Runtime Validation

Date: 2026-04-07

Scope:

- `AEGIS-002`
- `AEGIS-003`
- `AEGIS-004`
- `AEGIS-005`
- `AEGIS-007`
- `AEGIS-009`
- `AEGIS-010`

## Summary

The live `Vault -> ytUploadQueue -> yt-upload-job -> YouTube -> Firestore` path is now
proven in production.

What is validated:

- queue rows are created in `ytUploadQueue`
- `yt-upload-job` consumes them and completes successfully
- YouTube uploads succeed and write back durable publish state to `sunoSongs`
- uploader runtime resolves `media.videoUrl` from real nested SUNO media docs using `gs://`
- caption upload now gets past the earlier anonymous GCS fetch problem and fails for a new,
  concrete reason: insufficient YouTube OAuth scope for the captions endpoint

What is not fully closed:

- the deployed `yt-playlist-ingest` runtime still exposes only legacy `YT_API_KEY`, so the
  environment naming standard is not fully rolled out in production
- export freshness metadata exists, but it is still not surfaced in an operator-facing app path
- caption upload is blocked by OAuth scope, not by media or queue plumbing

## Runtime Evidence

### Live service and job revisions

- `suno-viewer` live revision: `suno-viewer-00035-q4c`
- `yt-upload-job` latest successful execution: `yt-upload-job-xvmbx`
- `yt-upload-job-xvmbx` image digest:
  - `us-central1-docker.pkg.dev/stable-framing-482501-t9/aeonimus-jobs/yt-uploader@sha256:36e96ef1da0e3eeb4ec88534c20223c17d42ff552298e6704a0f7e2dc3580c27`

### Test song 1

- Song key: `86c02df0-1d21-4cfe-a85e-847fdbc91148`
- Title: `Sovereign Memory Restore`
- Queue row: `pHp3cTgk2VI3DN7LrYTQ`

Queue evidence:

- `status = done`
- `requestedFrom = viewer`
- `startedAt = 2026-04-08T01:18:37Z`
- `uploadedAt = 2026-04-08T01:18:39Z`
- `ytVideoId = AC-PfY5aFEk`
- `gcsVideoUrl = gs://aeonimus-suno-media/suno/handles/unshakableechos2341/86c02df0-1d21-4cfe-a85e-847fdbc91148.mp4`

Song evidence:

- `ytStatus = done`
- `ytVideoId = AC-PfY5aFEk`
- `ytCanonicalUrl = https://www.youtube.com/watch?v=AC-PfY5aFEk`
- `ytPublishedAt = 2026-04-08T01:18:39Z`
- `ytError = ""`
- `ytCaptionsStatus = error`
- `ytCaptionsSource = gcsLyricsVtt`
- `ytCaptionsTrackId = ""`
- `ytCaptionsUpdatedAt = 2026-04-08T01:18:39Z`

Caption blocker:

- `ytCaptionsError` records a YouTube 403 with `insufficientPermissions`
- this confirms the prior anonymous GCS access failure is fixed and the remaining blocker is
  OAuth scope on the YouTube captions endpoint

### Test song 2

- Song key: `d3e1249d-7e8c-4f82-b7ba-ddca0eca8ff2`
- Title: `Recursion_Max`
- Queue row: `G44Ti0Hdrp49br1MMOC0`

Queue evidence:

- `status = done`
- `retryCount = 2`
- `startedAt = 2026-04-08T01:18:35Z`
- `uploadedAt = 2026-04-08T01:18:37Z`
- `ytVideoId = eexFwppF0wo`

Song evidence:

- `ytStatus = done`
- `ytVideoId = eexFwppF0wo`
- `ytCanonicalUrl = https://www.youtube.com/watch?v=eexFwppF0wo`
- `ytPublishedAt = 2026-04-08T01:18:37Z`
- `ytError = ""`
- `ytCaptionsStatus = error`
- `ytCaptionsSource = gcsLyricsVtt`
- `ytCaptionsTrackId = ""`
- `ytCaptionsUpdatedAt = 2026-04-08T01:18:37Z`

Interpretation:

- the original failing candidate now uploads successfully
- writeback to `sunoSongs` is durable
- caption failure is specific and consistent across multiple live uploads

### Export freshness evidence

Authenticated export metadata read confirms:

- `generatedAt = 2026-04-07T07:36:22Z`
- `rowCount = 1978`
- `generator = yt-ingest/rebuild_catalog.py`
- `artifact = gs://aeonimus-workspaces/exports/suno/latest_catalog_wide.csv`

This proves the freshness artifact exists and is current. The remaining gap is operator-facing
visibility, not export generation.

### Secret handling evidence

Repo-side secret cleanup remains true:

- `client_secret.json` is absent
- `client_secret.example.json` exists
- local untracked secret material is not required to be committed into the repo

Remaining secret rotation is an operational follow-up outside the codebase.

## Ticket Recommendations

### AEGIS-002 — Standardize YouTube API environment naming

Recommended status:

- `Blocked`

Reason:

- TypeScript code prefers `YOUTUBE_API_KEY` with legacy alias support
- deployed `yt-playlist-ingest` runtime still exposes only `YT_API_KEY`
- standard is implemented in code but not fully rolled out in production config

### AEGIS-003 — Define dedicated `ytUploadQueue` schema

Recommended status:

- `Done`

Reason:

- live queue rows are being created and processed in `ytUploadQueue`
- production queue semantics are separated from `sunoSongs`

### AEGIS-004 — Update queue manager to use `ytUploadQueue`

Recommended status:

- `Done`

Reason:

- production queue lifecycle is executing from `ytUploadQueue`
- successful items moved from queued to done with upload timestamps and video IDs

### AEGIS-005 — Align YouTube uploader with real SUNO media schema

Recommended status:

- `Done`

Reason:

- live uploads succeeded using real `sunoSongs` docs with nested `media.videoUrl`
- runtime consumed `gs://aeonimus-suno-media/.../*.mp4` correctly

### AEGIS-007 — Audit and remove checked-in secrets

Recommended status:

- `Done`

Reason:

- checked-in secret file remains removed from the repo
- safe example/local-secret guidance exists
- remaining rotation work is operational and external to the repository

### AEGIS-009 — Add minimal export freshness visibility

Recommended status:

- `Ready`

Reason:

- export freshness artifact exists and is populated
- next implementation should expose it through a small operator-facing surface such as a
  `/api/export-meta` endpoint and a lightweight viewer freshness badge or header block

### AEGIS-010 — Implement viewer-to-queue publish action

Recommended status:

- `Done`

Reason:

- live viewer queueing, job handoff, upload success, and Firestore writeback are now proven

## Next Best Move

Do not widen scope until the captions blocker is resolved.

The next concrete task is to update OAuth scopes or credentials so the uploader token has the
permission required for YouTube caption insertion. Once that is fixed, rerun one of the two
validated test songs and confirm:

- `ytCaptionsStatus = done`
- `ytCaptionsTrackId` is populated
- `ytCaptionsSource = gcsLyricsVtt`

## 2026-04-08 Caption Follow-Through

Caption upload is now proven in production.

What changed:

- the production YouTube refresh-token path was reissued with:
  - `https://www.googleapis.com/auth/youtube.upload`
  - `https://www.googleapis.com/auth/youtube.force-ssl`
- `yt-upload-job` was updated to the uploader image:
  - `us-central1-docker.pkg.dev/stable-framing-482501-t9/aeonimus-jobs/yt-uploader@sha256:4d391bde2190e4d9202bd20770cf6b290563f85654e5d0dc44f4d280b9e10c60`
- the uploader duplicate-upload guard was improved so already-uploaded videos can still receive caption retries without forcing a republish

Validated execution:

- Cloud Run execution: `yt-upload-job-pjcbv`
- fresh queue row: `z8wRICrr9l03dtdlck1u`
- validated song:
  - `86c02df0-1d21-4cfe-a85e-847fdbc91148`
  - `Sovereign Memory Restore`

Observed runtime result:

- queue row completed successfully
- uploader recognized the song was already uploaded
- caption retry was attempted against the existing video
- execution logs recorded:
  - `captions uploaded`
- Firestore writeback now shows:
  - `ytCaptionsStatus = done`
  - `ytCaptionsTrackId = AUieDabwxX2eOt5q-vVBz_AnqmTkezdzz9wP9WsRVkC0WAqPN5ezs1HWI0YaZac`
  - `ytCaptionsSource = gcsLyricsVtt`
  - `ytCaptionsError = ""`

Board impact:

- `AEGIS-011` can be treated as `Done`
