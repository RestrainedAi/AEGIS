# AEGIS-007 Secret Handling Note

## Confirmed Finding

The repository contained a real checked-in OAuth client secret in:

- `client_secret.json`

This should be treated as compromised.

## Action Taken In This First Wave

1. removed tracked `client_secret.json`
2. added `client_secret.example.json` with safe placeholder values
3. updated `youtube_auth.js` to require:
   - `YOUTUBE_CLIENT_SECRET_PATH`, or
   - an untracked local file `client_secret.local.json`
4. added a clear failure message instructing developers to use local untracked secrets or Secret Manager-backed production flows

## Approved Handling Path

### Local Legacy Helper Usage

If `youtube_auth.js` is still used locally:

1. create an untracked `client_secret.local.json`
2. or set `YOUTUBE_CLIENT_SECRET_PATH` to an untracked file location

### Production Upload Path

Production YouTube upload should continue using Secret Manager-backed values consumed by:

- `yt-ingest/youtube_uploader.py`

Specifically:

1. `youtube-oauth-refresh-token`
2. `youtube-oauth-client-secrets`

## Required Follow-Up Outside This Repo Change

1. rotate the compromised OAuth client secret
2. confirm any dependent refresh tokens remain valid or rotate them as needed
3. update deployment or onboarding guidance if secret names or sources change

## Important Note

Removing the file from source control does not rotate the credential.

Credential rotation must happen in the actual Google Cloud and OAuth client configuration.
