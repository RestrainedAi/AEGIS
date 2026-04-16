# RUNBOOK: Fix Vault -> YouTube Upload Auth (AEGIS) (2026-03-22)

This document captures the exact current blocker and the step-by-step fix path to get the SUNO Vault publishing to YouTube working again.

Scope: "After the Vault" only (queue + uploader). Vault UI/content is owned by Wegener.

## Executive Summary

The Vault-to-YouTube pipeline is wired, but uploads are failing due to OAuth/account readiness.

Observed failures:
1. YouTube upload API returns `youtubeSignupRequired` (HTTP 401 Unauthorized).
2. After rotating OAuth client secrets in Google Auth Platform, the current Secret Manager payload became invalid: refresh exchange fails with `invalid_client` (HTTP 401).

To publish today:
1. Ensure the publishing Google account has completed YouTube channel signup/terms.
2. Ensure Secret Manager `youtube-oauth-client-secrets` contains the CURRENT client secret (matches the enabled secret in Auth Platform).
3. Generate a NEW refresh token for the correct publishing account with both `youtube.upload` and `youtube.force-ssl` scopes, then store it in Secret Manager `youtube-oauth-refresh-token`.
4. Execute Cloud Run Job `yt-upload-job` and verify `ytStatus=done` gets written to Firestore `sunoSongs`.

## Current System Locations (Google Cloud)

Project:
- `stable-framing-482501-t9`

Secret Manager (runtime credentials used by uploader):
- Secret: `youtube-oauth-client-secrets`
- Secret: `youtube-oauth-refresh-token`

Cloud Run Jobs (uploads):
- Job: `yt-upload-job` (region `us-central1`)

Cloud Scheduler (auto-trigger uploads):
- Scheduler job: `yt-upload-daily` (region `us-central1`, schedule `0 6 * * *` UTC)

Firestore collections (runtime state):
- `sunoSongs` (source of truth for clip metadata, includes `media.videoUrl`, and receives `ytStatus`, `ytVideoId`, `ytCanonicalUrl`)
- `ytUploadQueue` (upload queue work items)

## How It Works (Minimal)

1. Vault queues a clip by writing a doc to Firestore `ytUploadQueue` with `songKey`.
2. `yt-upload-job` runs `queue_manager.py`, selects queued items, and calls `youtube_uploader.py`.
3. `youtube_uploader.py`:
   - reads clip doc: Firestore `sunoSongs/{songKey}`
   - resolves video path: prefers `media.videoUrl` (supports `gs://bucket/object`)
   - downloads MP4 from GCS
   - performs a resumable upload to YouTube
   - writes back `ytStatus=done`, `ytVideoId`, `ytCanonicalUrl` to Firestore `sunoSongs/{songKey}`
4. Queue item is set to `done` (or re-queued with incremented retry count on failure).

## What Was Confirmed On 2026-03-22

1. Queue creation from the Vault is working (it creates `ytUploadQueue` docs).
2. Cloud Run Job `yt-upload-job` exists and is ready.
3. Uploader failures were observed in Cloud Run logs:
   - `HTTP Error 401: Unauthorized`
   - YouTube error reason: `youtubeSignupRequired`
4. After OAuth client secret rotation, refresh exchange began failing:
   - `invalid_client` / `Unauthorized`
   This indicates Secret Manager `youtube-oauth-client-secrets` does not match the currently enabled OAuth secret.

## Do Not Do These Things

1. Do not paste refresh tokens or client secrets into chat, email, or tickets.
2. Do not rely on the Google Cloud Console to "show you" the client secret later. It is only visible at creation time.
3. Do not rotate secrets repeatedly without updating Secret Manager and re-authorizing refresh tokens. It increases thrash.

## Step 1: Fix `invalid_client` (Client Secret Mismatch)

Goal: make the refresh-token exchange succeed again.

You need to update Secret Manager secret `youtube-oauth-client-secrets` to contain the CURRENT client secret.

Where:
1. Google Cloud Console -> Auth Platform -> Clients -> open the Desktop client used by uploader (commonly named `yt-ingest-1 uploader`).
2. Under "Client secrets", either:
   - Re-enable the previous secret that matches what Secret Manager currently holds, OR
   - Create a new secret and capture its value immediately.

Then:
1. Google Cloud Console -> Secret Manager -> secret `youtube-oauth-client-secrets`
2. Go to the "Versions" tab -> "Add new version"
3. Paste the full JSON payload (installed/web format) that includes:
   - `client_id`
   - `client_secret` (the NEW one)
   - `redirect_uris`
4. Create the version.

Validation (safe):
- After updating, a refresh exchange should work again.
- If you have terminal access, you can validate via a small script; otherwise proceed to Step 2 and test by running the upload job.

## Step 2: Fix `youtubeSignupRequired` (YouTube Account Readiness)

Goal: ensure the publishing Google account is allowed to upload.

1. Log into YouTube in a browser as the intended publishing account (the account that should publish to `https://www.youtube.com/@AeonimusAI`).
2. Complete any prompts to:
   - create/activate a YouTube channel
   - accept YouTube terms
   - enable required YouTube features

If the publishing account is a Brand Account manager, ensure it is properly granted permissions to the channel.

## Step 3: Generate a NEW Refresh Token (Correct Account + Offline Access)

You must generate a refresh token via an OAuth consent flow. You do NOT get it from Secret Manager or the OAuth client screen.

Fast path: OAuth 2.0 Playground
1. Open: https://developers.google.com/oauthplayground
2. Click the gear icon (top right):
   - enable "Use your own OAuth credentials"
3. Enter:
   - OAuth Client ID: from your Desktop client (`yt-ingest-1 uploader`)
   - OAuth Client secret: the one you just stored into `youtube-oauth-client-secrets`
4. In Step 1, add scopes:
   - `https://www.googleapis.com/auth/youtube.upload`
   - `https://www.googleapis.com/auth/youtube.force-ssl`
5. Click "Authorize APIs".
6. Choose the publishing Google account.
7. Approve consent.
8. Click "Exchange authorization code for tokens".
9. Copy the `refresh_token` value (this is the value to store).

If you do not receive a refresh token:
- You may have previously authorized this client and Google is reusing authorization.
- Force consent (Playground often does); if needed, revoke app access in the Google Account security settings and try again.

Caption scope note:
- `captions.insert` requires broader YouTube authorization than upload-only flows.
- Keep `youtube.upload` for video upload and add `youtube.force-ssl` for caption insertion.
- Reference: [YouTube Data API captions.insert](https://developers.google.com/youtube/v3/docs/captions/insert)

Local helper option:
- You can mint and validate the production refresh-token path from the repo with:
  - [setup_youtube_oauth.py](C:\Users\blahn\OneDrive\Desktop\SUNO YouTube Pipeline\enviroment\AEGIS\yt-ingest\setup_youtube_oauth.py)
  - [validate_youtube_oauth_scopes.py](C:\Users\blahn\OneDrive\Desktop\SUNO YouTube Pipeline\enviroment\AEGIS\yt-ingest\validate_youtube_oauth_scopes.py)
- Recommended sequence:
  1. `python setup_youtube_oauth.py --update-secret`
  2. `python validate_youtube_oauth_scopes.py`
  3. `gcloud run jobs execute yt-upload-job --region=us-central1 --project=stable-framing-482501-t9`

## Step 4: Update Secret Manager `youtube-oauth-refresh-token`

1. Google Cloud Console -> Secret Manager -> secret `youtube-oauth-refresh-token`
2. Versions tab -> Add new version
3. Paste the refresh token string
4. Create version

## Step 5: Run One Upload Immediately (Do Not Wait For Scheduler)

Trigger the job manually:
- Cloud Run -> Jobs -> `yt-upload-job` -> "Run" (execute), OR
- CLI (if you have it):
  - `gcloud run jobs execute yt-upload-job --region=us-central1 --project=stable-framing-482501-t9`

What success looks like:
1. Cloud Run job logs show:
   - MP4 downloaded from GCS
   - upload initiated and completed
   - Firestore patched with `ytVideoId`, `ytCanonicalUrl`, `ytStatus=done`
2. Firestore `ytUploadQueue` item transitions to `done`.
3. Firestore `sunoSongs/{songKey}` shows:
   - `ytStatus=done`
   - `ytVideoId` populated
   - `ytCanonicalUrl` populated

Note: the uploader currently sets uploaded videos to `privacyStatus=private` initially. If you want `unlisted` or `public`, that is a code/config change.

## Fast Triage If It Still Fails

If you still see `invalid_client`:
- The `youtube-oauth-client-secrets` secret does not match the currently enabled OAuth client secret.

If you still see `youtubeSignupRequired`:
- YouTube terms/channel creation is not completed on the publishing account, OR
- You authorized the wrong Google account, OR
- The account does not actually have permission to upload to the target channel (Brand Account mismatch).

If you see `insufficientPermissions` or `forbidden`:
- Check which account was authorized.
- Confirm channel ownership/manager status.
- Confirm the refresh token was minted with both `youtube.upload` and `youtube.force-ssl`.

## Emergency Notes / Stabilization Suggestions (Non-blocking)

1. Consider updating `queue_manager.py` to mark the Cloud Run Job as failed if any upload fails (so "Succeeded" really means success). This is optional but reduces false confidence.
2. Consider adding a lightweight `/healthz` + "YouTube auth check" endpoint or a job preflight mode that tests initiate-upload and reports the reason without touching content.
