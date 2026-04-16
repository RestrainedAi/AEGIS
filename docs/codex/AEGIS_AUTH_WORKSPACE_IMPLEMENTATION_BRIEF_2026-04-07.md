# AEGIS Auth / Workspace Implementation Brief

Date: 2026-04-07

## Summary

Implement a real login and workspace model on top of the existing Vault without changing the
Song Master Recording and Recipe contract.

Use Firebase Authentication with Identity Platform for identity, Firestore for workspace and
membership state, and a separate platform-admin allowlist for master controls.

## Data Model

### `users/{uid}`

Authoritative human identity profile.

Suggested fields:

- `email`
- `displayName`
- `photoURL`
- `authProviders` array
- `createdAt`
- `lastLoginAt`
- `status` (`active`, `invited`, `suspended`)
- `defaultWorkspaceId`

### `workspaces/{workspaceId}`

Customer-owned container for sources, vault assets, plan state, and quotas.

Suggested fields:

- `name`
- `slug`
- `ownerUid`
- `planId`
- `status` (`active`, `trialing`, `past_due`, `suspended`)
- `createdAt`
- `updatedAt`
- `sourceLimit`
- `storageLimitGb`
- `seatLimit`
- `features` map or entitlement mirror

### `workspaces/{workspaceId}/memberships/{uid}`

Membership and role assignment for a user inside a workspace.

Suggested fields:

- `uid`
- `workspaceId`
- `role` (`owner`, `admin`, `editor`, `viewer`)
- `status` (`active`, `invited`, `revoked`)
- `createdAt`
- `updatedAt`
- `invitedBy`

### `admins/{uid}`

Platform-admin allowlist for your master control center.

Suggested fields:

- `email`
- `role` (`superadmin`)
- `isActive`
- `created_at`
- `updated_at`

Keep this separate from customer workspace membership. It is for platform control only.

## Auth Boundary

### Login methods

Use:

- Google sign-in
- email magic link

Defer:

- password login
- SAML / enterprise SSO
- MFA as a required baseline

### Backend rule

Every privileged request must:

1. verify the Firebase/Identity Platform ID token
2. resolve the requesting user
3. resolve workspace membership for the target workspace
4. enforce role-based access
5. separately check platform-admin allowlist for master controls

### Authorization split

- Customer workspace access uses `users` + `workspaces` + `memberships`
- Platform admin access uses `admins`
- Customer data must never infer platform-admin powers
- Platform-admin powers must never be granted by workspace role alone

## Role Model

Workspace roles:

- `owner`
- `admin`
- `editor`
- `viewer`

Platform role:

- `platform_admin` or `superadmin`

Suggested behavior:

- `owner` can manage billing, members, sources, and workspace settings
- `admin` can manage workspace operations but not transfer ownership
- `editor` can manage content and publish workflows
- `viewer` can inspect data only
- `platform_admin` can inspect and override any workspace, manage support, and perform global ops

## Rollout Plan

### Phase 1

- add auth provider integration
- add user profile records
- add workspace and membership collections
- seed platform-admin allowlist from the existing admin bootstrap path

### Phase 2

- scope the current Vault routes by workspace membership
- keep legacy single-workspace behavior as the default fallback
- avoid changing `sunoSongs` source truth shape yet

### Phase 3

- add workspace-aware source and vault views
- add platform-admin control center
- add plan and entitlement mirrors after auth boundaries are stable

### Phase 4

- enforce workspace isolation on reads and writes
- add billing and entitlement gates only after auth is proven

## Migration Notes

- Existing `sunoSongs`, `ytUploadQueue`, and export artifacts remain the content authority
- Backfill a default workspace for legacy records rather than rewriting song truth
- Keep auth fields additive so current operator flows continue working during rollout
- Use the current `admins` bootstrap as the starting platform-admin registry, not the long-term customer role model

## Acceptance Criteria

- A user can sign in and get a stable `uid`
- A user can belong to one or more workspaces
- Workspace role checks are enforced server-side
- Platform-admin access is distinct from workspace access
- No existing song source-truth fields are altered by auth rollout
