# AEGIS Jira-Ready Caption and Auth Tickets

Date: 2026-04-07

This note turns the current caption blocker and new auth/workspace stream into copy-ready ticket bodies.

## AEGIS-011 Fix YouTube Caption OAuth Scopes and Refresh Token

Summary:
- Caption insertion is the only remaining live blocker in the proven YouTube publish pipeline.

Problem:
- The current production uploader can publish videos successfully, but caption insertion fails with YouTube `403 insufficientPermissions`.
- Runtime evidence shows:
  - queue creation works
  - `yt-upload-job` processes rows
  - video upload succeeds
  - Firestore writeback succeeds
  - caption insertion fails after the upload step
- Scope validation now confirms the current refresh-token path only carries:
  - `https://www.googleapis.com/auth/youtube.upload`
  and is missing:
  - `https://www.googleapis.com/auth/youtube.force-ssl`
- This indicates the active refresh token lacks the scope needed by `captions.insert`.

Implementation Notes:
- Reauthorize the publishing account with:
  - `https://www.googleapis.com/auth/youtube.upload`
  - `https://www.googleapis.com/auth/youtube.force-ssl`
- Update Secret Manager:
  - `youtube-oauth-client-secrets`
  - `youtube-oauth-refresh-token`
- Rerun `yt-upload-job` with a known-good queued song.

Acceptance Criteria:
- `ytCaptionsStatus = done`
- `ytCaptionsTrackId` is populated
- `ytCaptionsSource = gcsLyricsVtt`
- `ytCaptionsError` is absent or cleared on the validated song

References:
- [AEGIS_RUNTIME_VALIDATION_2026-04-07.md](C:\Users\blahn\OneDrive\Desktop\SUNO YouTube Pipeline\enviroment\AEGIS\docs\codex\AEGIS_RUNTIME_VALIDATION_2026-04-07.md)
- [AEGIS-011_YT_CAPTION_OAUTH_SCOPE_FIX.md](C:\Users\blahn\OneDrive\Desktop\SUNO YouTube Pipeline\enviroment\AEGIS\docs\codex\AEGIS-011_YT_CAPTION_OAUTH_SCOPE_FIX.md)
- [RUNBOOK_VAULT_TO_YT_OAUTH_FIX_2026-03-22.md](C:\Users\blahn\OneDrive\Desktop\SUNO YouTube Pipeline\enviroment\AEGIS\docs\codex\RUNBOOK_VAULT_TO_YT_OAUTH_FIX_2026-03-22.md)
- [validate_youtube_oauth_scopes.py](C:\Users\blahn\OneDrive\Desktop\SUNO YouTube Pipeline\enviroment\AEGIS\yt-ingest\validate_youtube_oauth_scopes.py)

## AEGIS-AUTH-001 Establish Firebase Auth and Identity Platform Backbone

Summary:
- Add the identity backbone for Sundrop/AEGIS so real user login exists before paid upgrades and admin controls.

Problem:
- The current system has no production-grade identity boundary, workspace ownership model, or durable user object.
- Billing, feature gating, and account separation should not be layered on top of implicit single-user assumptions.

Implementation Notes:
- Use Firebase Auth with Identity Platform enabled.
- Initial customer-facing login methods:
  - Google sign-in
  - email magic link
- Introduce `users/{uid}` as the canonical user profile object.
- Keep the rollout additive and do not mutate `sunoSongs` or `ytUploadQueue` schemas.

Acceptance Criteria:
- Firebase Auth and Identity Platform are enabled in the target project
- sign-in works for Google and email link
- first-login provisioning creates a `users/{uid}` record
- platform admin handling remains separate from customer workspace roles

References:
- [AEGIS_AUTH_ADMIN_TIERING_MONETIZATION_PLAN_2026-04-07.md](C:\Users\blahn\OneDrive\Desktop\SUNO YouTube Pipeline\enviroment\AEGIS\docs\codex\AEGIS_AUTH_ADMIN_TIERING_MONETIZATION_PLAN_2026-04-07.md)
- [AEGIS_AUTH_WORKSPACE_IMPLEMENTATION_BRIEF_2026-04-07.md](C:\Users\blahn\OneDrive\Desktop\SUNO YouTube Pipeline\enviroment\AEGIS\docs\codex\AEGIS_AUTH_WORKSPACE_IMPLEMENTATION_BRIEF_2026-04-07.md)

## AEGIS-AUTH-002 Implement Workspace, Membership, and Role Model

Summary:
- Add hard workspace separation around the existing Vault and pipeline authorities.

Problem:
- We need customer account separation, role-based access, and a clean future home for entitlements without rewriting content authorities.

Implementation Notes:
- Add:
  - `workspaces/{workspaceId}`
  - `workspaces/{workspaceId}/memberships/{uid}`
  - `admins/{uid}` allowlist for platform admins
- Default workspace roles:
  - `owner`
  - `admin`
  - `editor`
  - `viewer`
- Keep `platform_admin` separate from workspace roles.

Acceptance Criteria:
- workspace records can be created and queried
- membership records determine workspace access
- platform admins bypass workspace restrictions without overloading customer role fields
- no source-of-truth song fields are repurposed for auth state

References:
- [AEGIS_AUTH_WORKSPACE_IMPLEMENTATION_BRIEF_2026-04-07.md](C:\Users\blahn\OneDrive\Desktop\SUNO YouTube Pipeline\enviroment\AEGIS\docs\codex\AEGIS_AUTH_WORKSPACE_IMPLEMENTATION_BRIEF_2026-04-07.md)

## AEGIS-AUTH-003 Add Backend Authorization Boundary

Summary:
- Ensure backend routes and queue actions honor authenticated identity and workspace membership.

Problem:
- Even with login and workspaces, backend APIs must enforce role-aware access or the platform remains effectively single-tenant.

Implementation Notes:
- Add auth checks to viewer/server routes and any privileged job-triggering endpoints.
- Resolve effective access from:
  - user identity
  - workspace membership
  - platform admin allowlist
- Keep read/write boundaries explicit by role.

Acceptance Criteria:
- unauthenticated requests cannot access protected workspace data
- authenticated users are scoped to authorized workspaces
- privileged admin actions require `platform_admin` or explicit workspace role
- distribution actions do not mutate creation-layer source truth

References:
- [AEGIS_AUTH_WORKSPACE_IMPLEMENTATION_BRIEF_2026-04-07.md](C:\Users\blahn\OneDrive\Desktop\SUNO YouTube Pipeline\enviroment\AEGIS\docs\codex\AEGIS_AUTH_WORKSPACE_IMPLEMENTATION_BRIEF_2026-04-07.md)
