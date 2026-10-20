# AEGIS Source Ownership And Tier Lifecycle Plan

Date: 2026-04-10
Owner: Platform + Product
Status: Active planning with first implementation bridge in progress

## Purpose

Now that Vault access, workspace membership, and beta approvals exist, source ownership has to become explicit.

We need one clear chain:

- user identity
- workspace membership
- workspace plan
- owned SUNO source handles
- entitlement limits
- beta expiry and paid migration path

This doc defines the current operating model and the next implementation steps.

## Current data model

### Users

`users/{uid}`

Current important fields:

- `defaultWorkspaceId`
- `status`
- `audience`
- `betaStatus`
- `betaApprovedAt`
- `betaExpiresAt`
- `betaMigrationTargetPlanId`

Meaning:

- the user record holds lifecycle posture
- it does not hold the source-of-truth plan alone
- it points the user toward the workspace that actually carries the plan contract

### Workspaces

`workspaces/{workspaceId}`

Current important fields:

- `ownerUid`
- `planId`
- `status`
- `audience`
- `sourceLimit`
- `storageLimitGb`
- `seatLimit`
- `features`

Meaning:

- the workspace is the plan container
- the workspace carries limits and entitlements
- upgrades and downgrades should primarily change the workspace contract

### Memberships

`workspaces/{workspaceId}/memberships/{uid}`

Current important fields:

- `uid`
- `workspaceId`
- `role`
- `status`

Meaning:

- membership controls who can act inside the workspace
- role controls what they can do
- plan does not live on membership

### Sources

`sources/suno_{handle}`

Current important fields:

- `platform`
- `handle`
- `profileUrl`
- `workspaceId`
- `planId`
- `tierId`
- `audience`
- `isActive`
- `harvestEnabled`
- `provisioningState`

Reliability fields required for the current source contract:

- `ingestionMode` (`public_profile`, `owned_library`, or `official_export`)
- `authorityStatus` (`verified`, `partial_source`, or `blocked_source`)
- `lastAuthoritativeSnapshotAt`
- `latestAuthoritativeSongAt`
- `lastSourceError`
- `archivedAt`
- `archiveReason`

New ownership bridge fields now in use:

- `ownerUid`
- `ownerEmail`
- `assignedAt`
- `betaStatus`
- `betaExpiresAt`
- `betaMigrationTargetPlanId`

Meaning:

- the source record is the handle ownership bridge
- it ties a SUNO account to a specific workspace and therefore to a specific plan
- harvest should follow active `sources/*` records rather than a hardcoded handle list
- archived customers retain their existing catalog and media, but are excluded
  from new collection until a deliberate reactivation changes their source state

## Current platform rule

The authoritative commercial path is:

`user -> membership -> workspace.planId -> workspace entitlements`

The authoritative source-ownership path is:

`source.handle -> source.workspaceId -> workspace.planId`

That means:

- users belong to workspaces
- workspaces own plan and limits
- sources belong to workspaces
- sources inherit operational posture from the workspace plan

## Beta lifecycle

### Beta request

The beta applicant provides:

- workspace name
- SUNO handle
- SUNO profile URL
- YouTube channel URL
- intended use
- preferred upgrade target after beta

Stored in:

- `accessRequests`

### Beta approval

On approval, the system now:

1. creates or updates the workspace
2. creates membership
3. sets `defaultWorkspaceId`
4. writes beta lifecycle fields to `users/{uid}`
5. writes approval fields to `accessRequests/{requestId}`
6. links the approved SUNO handle into `sources/suno_{handle}`

### Beta expiry

Required behavior:

- beta users keep `betaExpiresAt`
- cron or admin review should detect expired beta users
- expired beta should move to:
  - `expired`
  - `upgraded`
  - or `revoked`

### Beta migration target

The preferred migration path should remain explicit:

- `creator_monthly`
- `studio_monthly`

This lets us convert approved beta users into paid customers without re-onboarding them from scratch.

## Paid tier onboarding

For top-tier customers, we should allow reserved workspaces and reserved sources before the real login is linked.

Current reserved Studio examples:

- `unshakableechos2341`
- `gravitystruth`

Reserved records now exist as:

- `workspaces/studio-unshakableechos2341`
- `sources/suno_unshakableechos2341`
- `workspaces/studio-gravitystruth`
- `sources/suno_gravitystruth`

This supports a cleaner high-touch onboarding path:

1. reserve workspace and source
2. approve real signed-in identity
3. attach identity to reserved workspace
4. claim the reserved source into that workspace

## Upgrade path

Primary upgrade path:

- beta -> creator_monthly
- beta -> studio_monthly
- free -> creator_monthly
- creator_monthly -> studio_monthly

Backend changes required on upgrade:

1. patch `workspaces/{workspaceId}.planId`
2. patch workspace limits:
   - `sourceLimit`
   - `storageLimitGb`
   - `seatLimit`
3. patch workspace entitlements/features
4. patch linked `sources/*`:
   - `planId`
   - `tierId`
   - `audience`
   - lifecycle status
5. patch `users/{uid}`:
   - `betaStatus = upgraded` when leaving beta
   - keep migration history
6. write an upgrade event record later when billing exists

Frontend requirements:

- show current plan
- show upgrade target
- explain what changes immediately
- explain if source/member/storage limits increase

## Downgrade path

Primary downgrade path:

- studio_monthly -> creator_monthly
- creator_monthly -> free

Downgrades need guardrails because they can violate current usage.

Backend downgrade checks must evaluate:

- current number of sources vs new `sourceLimit`
- current members vs new `seatLimit`
- storage consumed vs new `storageLimitGb`
- publishing activity vs new plan permissions

Possible downgrade outcomes:

- immediate downgrade if current usage fits
- scheduled downgrade at period end
- downgrade blocked until workspace is cleaned up

Frontend requirements:

- preview what the downgrade changes
- show any over-limit blockers
- show what the user must remove before downgrade can complete

## Separation rule

We should not create a physically separate beta user database.

Recommendation:

- keep one identity system
- distinguish beta vs customer with explicit lifecycle fields
- distinguish workspace commercial posture with `planId`
- distinguish source ownership with `sources/*`

Why:

- simpler migration from beta to paid
- easier audit history
- less duplication
- less risk of orphaned users and workspaces

## Immediate next implementation steps

### In progress

- source registry driven harvest via `catalog_sync_firestore_multi.py`
- reserved Studio source/workspace provisioning for high-touch paid users
- approval-time source claiming into workspace ownership

### Next

1. add a workspace/source lifecycle admin view
2. add explicit upgrade and downgrade endpoints
3. add over-limit checks for downgrade
4. add beta-expiry enforcement job or review path
5. add billing event and plan history once payments exist

## Ticket mapping

- `AEGIS-BIZ-003`
  - tie SUNO source ownership to workspace and plan lifecycle
- `AEGIS-BIZ-004`
  - define upgrade, downgrade, and beta migration lifecycle

## Recommended rule going forward

Do not treat a user as being “on a tier” directly.

Treat the workspace as being on a tier, and treat the user and the SUNO source handles as attached to that workspace.

That keeps identity, ownership, and monetization aligned.
