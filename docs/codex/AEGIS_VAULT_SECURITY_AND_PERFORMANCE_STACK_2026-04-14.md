# AEGIS Vault Security And Performance Stack

Date: 2026-04-14

## Why this stack exists

Today exposed a useful cluster of real Vault follow-up work that should be tracked together instead of being left as scattered troubleshooting notes:

- the Vault crash after auth came from a client-side React hook-order bug
- authenticated Vault rendering also surfaced repeated `401` noise on protected thumbnail URLs
- browser storage review confirmed that our current Firebase SPA auth model is workable for beta, but still more exposed to XSS and extension risk than an HttpOnly server-session model
- DevTools traces showed the startup chain is still heavier than it needs to be, especially around `api/auth/session`

This stack is intentionally split into:

1. near-term beta-safe hardening
2. practical reliability cleanup
3. post-beta auth/security strengthening

## Existing tickets that already fit this lane

- `AEGIS-AUTH-001` Add Firebase Authentication with Identity Platform backbone
- `AEGIS-AUTH-003` Add backend authorization boundary and Firestore rules
- `AEGIS-027` Plan post-beta Vault serving transition away from CSV-primary
- `AEGIS-028` Add Vault diagnostic toolbox with operator-run checks and one-click common fixes
- `AEGIS-EDGE-002` Serve private song media without stale public fallback behavior

These remain valid and should not be replaced. The new tickets below narrow the follow-up into more actionable implementation slices.

## New stack additions

### `AEGIS-029`
Harden Vault auth storage and move privileged sessions toward HttpOnly cookies.

Intent:
- preserve beta momentum
- keep the current Firebase web login usable
- reduce browser-readable auth exposure for admin/operator access first

Primary outcomes:
- audit current auth/session material stored in local browser storage
- define which state can remain client-readable and which cannot
- add a server-issued HttpOnly cookie path for privileged surfaces

### `AEGIS-030`
Eliminate protected media URL leakage and repeated `401` thumbnail noise.

Intent:
- stop leaking raw protected media endpoints into the DOM where speculative browser fetches can hit them without auth
- keep the console useful by removing the flood of expected `401` media noise

Primary outcomes:
- protected media links should resolve through authenticated blob/object URLs
- card links and actions should not expose raw `/api/song-media/...` paths when the asset requires auth
- operator troubleshooting should be able to distinguish a real broken asset from a client-side fetch pattern problem

### `AEGIS-031`
Reduce Vault startup session latency and critical-request chaining.

Intent:
- improve first authenticated paint without destabilizing beta diagnostics
- reduce duplicate or unnecessary session work

Primary outcomes:
- reduce duplicate `api/auth/session` work where possible
- review preconnect/useful startup hints
- keep first render stable after the desktop Vault shell/focus changes

## Recommended sequencing

### During beta

Focus first on:

1. `AEGIS-028` Vault diagnostic toolbox
2. `AEGIS-030` protected media 401 cleanup
3. `AEGIS-031` startup/session latency cleanup

These are the highest leverage improvements that help debugging and operator confidence without forcing a big auth migration mid-beta.

### Post-beta or when privileged access expands

Focus next on:

1. `AEGIS-029` HttpOnly privileged-session path
2. `AEGIS-027` move Vault serving off CSV-primary

These are stronger structural changes and should be done with room for careful rollout and verification.

## Working principle

The current Firebase SPA auth model is acceptable for beta, but it should be treated as a transitional implementation, not the final security posture for admin/operator surfaces.

The practical goal is:

- do not bog down current product progress
- remove the noisiest and most misleading failure modes now
- build toward a tighter session, media, and read-model architecture once beta motion is established
