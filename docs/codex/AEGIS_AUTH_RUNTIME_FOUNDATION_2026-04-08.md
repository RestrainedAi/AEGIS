# AEGIS Auth Runtime Foundation

Date: 2026-04-08

## Summary

The first runtime-safe auth foundation is now in place in the Vault service.

This pass does **not** force a hard login yet. Instead, it adds real Firebase-backed session
resolution, workspace object support, and platform-admin scaffolding while preserving the current
legacy operator flow.

It now also includes the first beta signup / approval loop:

- Google sign-in
- email magic link
- signed-in access request submission
- platform-admin approval into workspace membership
- tier-aware intake for `beta`, `free`, and early paid lanes
- plan catalog shell with pricing placeholders, entitlement families, and workspace limits
- first plan-derived entitlement enforcement on safe surfaces:
  - YouTube publish actions
  - queue inspection
  - queue normalization
  - upload-job triggering
- automatic bootstrap workspace seeding for the two initial approved identities so they land in
  real workspace-backed sessions
- active workspace switching from the auth controls when a user belongs to multiple workspaces
- deny / review-note handling in the Control Center
- catalog health inspection in `/api/admin/overview`, including GCS vs fallback serving state and
  missing required export columns
- plan-aware workspace defaults during admin approval and manual workspace creation so newly approved
  workspaces inherit source, storage, seat, and entitlement defaults from the selected tier
- bootstrap approval/admin recognition for:
  - `blahnikdigitaldesigns@gmail.com`
  - `aeonimusai@gmail.com`

## What Was Added

### Viewer service runtime

Updated:

- [server.js](C:\Users\blahn\OneDrive\Desktop\SUNO YouTube Pipeline\enviroment\AEGIS\suno-viewer\server.js)

Key additions:

- Firebase Admin initialization using Application Default Credentials
- bearer-token session resolution with Firebase ID token verification
- automatic `users/{uid}` provisioning and login timestamp refresh
- workspace and membership lookup via Firestore
- legacy-mode fallback for the current private/internal rollout
- new endpoints:
  - `GET /api/auth/session`
  - `GET /api/signup/catalog`
  - `GET /api/workspaces`
  - `POST /api/workspaces`
  - `GET /api/admin/overview`
  - `POST /api/access-requests`
  - `GET /api/admin/access-requests`
  - `POST /api/admin/access-requests/:requestId/approve`
  - `POST /api/admin/access-requests/:requestId/deny`

### Shared frontend types

Updated:

- [types.ts](C:\Users\blahn\OneDrive\Desktop\SUNO YouTube Pipeline\enviroment\AEGIS\suno-viewer\src\types.ts)
- [App.tsx](C:\Users\blahn\OneDrive\Desktop\SUNO YouTube Pipeline\enviroment\AEGIS\suno-viewer\src\App.tsx)
- [AdminControlCenter.tsx](C:\Users\blahn\OneDrive\Desktop\SUNO YouTube Pipeline\enviroment\AEGIS\suno-viewer\src\components\AdminControlCenter.tsx)
- [AuthControls.tsx](C:\Users\blahn\OneDrive\Desktop\SUNO YouTube Pipeline\enviroment\AEGIS\suno-viewer\src\components\AuthControls.tsx)
- [firebaseAuth.tsx](C:\Users\blahn\OneDrive\Desktop\SUNO YouTube Pipeline\enviroment\AEGIS\suno-viewer\src\lib\firebaseAuth.tsx)
- [VaultGrid.tsx](C:\Users\blahn\OneDrive\Desktop\SUNO YouTube Pipeline\enviroment\AEGIS\suno-viewer\src\components\VaultGrid.tsx)
- [main.tsx](C:\Users\blahn\OneDrive\Desktop\SUNO YouTube Pipeline\enviroment\AEGIS\suno-viewer\src\main.tsx)

Added:

- `UserProfile`
- `WorkspaceSummary`
- `WorkspaceMembership`
- `AuthSession`
- `AdminOverview`
- `AccessRequest`
- role/status unions for workspace and user state
- `/control-center` route with a first visible admin shell for:
  - auth posture
  - active workspace focus
  - queue pulse
  - export freshness
  - tier-aware approval and denial actions
- `/signup` route with the first customer-facing beta / free / paid intake surface
- header auth controls with:
  - Google sign-in
  - email magic link
  - beta / free / paid request intake
- signup catalog details for:
  - workspace/source/storage/member limits
  - publishing allowance
  - included entitlement families
- token-aware frontend API calls for the privileged Vault and admin routes

### Firestore authorization scaffolding

Updated:

- [firestore.rules](C:\Users\blahn\OneDrive\Desktop\SUNO YouTube Pipeline\enviroment\AEGIS\yt-ingest\firestore.rules)

Added additive rule helpers for:

- `isPlatformAdmin()`
- `isActiveWorkspaceMember(workspaceId)`
- `isWorkspaceEditor(workspaceId)`
- `users/{uid}`
- `workspaces/{workspaceId}`
- `workspaces/{workspaceId}/memberships/{uid}`

These rule changes are scaffolding for the identity rollout and should be deployed only as part of
the explicit auth cutover plan.

## Intentional Boundaries

- `sunoSongs` remains the Creation + Asset source of truth
- `ytUploadQueue` remains the Distribution queue authority
- auth/workspace state wraps access around those authorities and does not rewrite them
- legacy mode remains available so current operator flows do not break during rollout

## Next Moves

1. Seed the first real `workspaces/*` and `memberships/*` records beyond the legacy workspace.
2. Replace hardcoded approval defaults with richer plan limits and entitlement bundles.
3. Add withdrawal handling for access requests and richer admin triage actions.
4. Add route-by-route authorization enforcement for write actions under `AEGIS-AUTH-003`.
5. Expand entitlement enforcement gradually from publish/queue controls into broader paid-only actions.
6. Only after that begin customer-facing billing and full entitlement enforcement.
