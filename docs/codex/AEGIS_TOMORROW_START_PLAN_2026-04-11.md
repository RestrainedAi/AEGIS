# AEGIS Tomorrow Start Plan - 2026-04-11

## Start here

Tomorrow should begin with the monetization and lifecycle path that is now unblocked:

1. confirm the latest `suno-harvest` execution finished cleanly on the Firestore source-registry path
2. implement reserved paid-source claim flow for:
   - `unshakableechos2341`
   - `gravitystruth`
3. begin explicit upgrade, downgrade, and beta-migration lifecycle handling

## Primary goals

### 1. Finish source ownership runtime proof

- verify the current harvest execution completes successfully
- verify active source registry includes the reserved paid sources
- verify the next scheduled harvest will continue to use source records instead of fallback handle lists

### 2. Build paid-source claim flow

- operator can attach a signed-in customer identity to a reserved workspace and reserved SUNO source
- preserve harvest continuity
- preserve plan and role defaults
- return clear claim-state data in admin responses

### 3. Start the plan transition engine

Scope the first real lifecycle rules for:

- beta -> creator_monthly
- beta -> studio_monthly
- free -> creator_monthly
- creator_monthly -> studio_monthly
- studio_monthly -> creator_monthly with downgrade guardrails

### 4. Tighten beta review operations

- pending-only view in Control Center
- clear beta expiry visibility
- clear migration target visibility
- operator action hooks for approve, deny, reopen, expire, and migrate

## Suggested execution order

1. harvest runtime verification
2. reserved paid-source claim flow
3. Control Center beta-review improvements
4. upgrade/downgrade lifecycle scaffolding

## Expected outputs

- one successful harvest proof against the source registry path
- one admin flow for claiming reserved paid sources
- one lifecycle write path for beta expiry or migration metadata
- one board update reflecting the new runtime proof and next monetization steps
