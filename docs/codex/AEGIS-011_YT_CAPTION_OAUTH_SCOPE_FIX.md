# AEGIS-011 YouTube Caption OAuth Scope Fix

Date: 2026-04-07

## Summary

The YouTube publish path is now live and proven. Video upload succeeds, queue lifecycle is
correct, and Firestore writeback is durable.

The remaining blocker is limited to caption insertion.

Observed runtime result:

- `ytStatus = done`
- `ytCaptionsStatus = error`
- `ytCaptionsSource = gcsLyricsVtt`
- `ytCaptionsError` contains YouTube `403 insufficientPermissions`

This confirms:

1. the earlier anonymous GCS `gcsLyricsVtt` fetch failure is fixed
2. the uploader is reaching the captions endpoint
3. the current OAuth token does not carry the required scope for caption insertion

## Required Outcome

Update the Secret Manager-backed YouTube OAuth credential path so the uploader receives a refresh
token authorized with the scopes needed for:

- video upload: `https://www.googleapis.com/auth/youtube.upload`
- caption insertion: `https://www.googleapis.com/auth/youtube.force-ssl`

Then rerun a validated test song and confirm:

- `ytCaptionsStatus = done`
- `ytCaptionsTrackId` is populated
- `ytCaptionsSource = gcsLyricsVtt`

## Recommended Fix Path

1. confirm the active OAuth client secret in Auth Platform still matches:
   - `youtube-oauth-client-secrets`
2. generate a new refresh token for the publishing account with both:
   - `https://www.googleapis.com/auth/youtube.upload`
   - `https://www.googleapis.com/auth/youtube.force-ssl`
3. store the new refresh token in:
   - `youtube-oauth-refresh-token`
4. execute `yt-upload-job`
5. verify caption writeback on a known test song

## Notes

- do not reopen queue or media alignment tickets
- do not treat this as a Vault UI issue
- this is an uploader credential and scope issue only
- reference: [YouTube Data API captions.insert](https://developers.google.com/youtube/v3/docs/captions/insert)

## Validation Update

Local/runtime scope validation now confirms the currently stored production refresh-token path is missing the caption scope.

Observed result from `validate_youtube_oauth_scopes.py`:

- required scopes:
  - `https://www.googleapis.com/auth/youtube.upload`
  - `https://www.googleapis.com/auth/youtube.force-ssl`
- active scopes:
  - `https://www.googleapis.com/auth/youtube.upload`
- missing scopes:
  - `https://www.googleapis.com/auth/youtube.force-ssl`

This means the blocker is no longer speculative. The production refresh token must be reissued with `youtube.force-ssl` added.
