# AEGIS Distribution Retire / Republish Plan

## Why This Exists

Published YouTube rows should not be treated as immutable song truth.

The Vault is the Song Master Recording and Recipe. YouTube publishing is a
distribution-layer action that may need to be retired, replaced, republished,
or reconciled later without mutating the original source record.

## Problem

If an operator deletes a YouTube video directly on the platform:

- `ytStatus` can stay incorrectly marked as done
- `ytVideoId` and `ytCanonicalUrl` can become stale
- queue logic can become contradictory
- the system loses a clean audit trail for what happened

## Product Rule

Do not use direct YouTube deletion as the primary workflow.

Use Vault-managed distribution lifecycle actions so the system can preserve
history, detach broken publishes cleanly, and republish safely.

## Planned Lifecycle States

1. `Published`
   - active YouTube publish exists
2. `Retired`
   - previous publish remains in history but is no longer the active publish
3. `Republish Pending`
   - operator has requested a fresh publish
4. `Republished`
   - new publish becomes active; previous publish remains historical
5. `Detached`
   - platform-side publish disappeared or was deleted manually; Vault state has
     been cleaned without altering the song master record

## Planned Operator Actions

- `Retire Publish`
  - mark current publish as no longer active
  - optionally change YouTube privacy to `private` instead of deleting
- `Republish as New`
  - create a fresh queue row and new publish outcome
- `Replace Active Publish`
  - move the active pointer to the new YouTube publish
- `Sync Publish State`
  - reconcile if YouTube and Vault disagree
- `Detach Broken Publish`
  - clean up stale published references if a platform-side delete already happened

## Data Boundary

- Song master record:
  - keeps original SUNO metadata and preserved artifacts
- Distribution state:
  - keeps active publish fields
- Publish history:
  - should preserve prior YouTube publish attempts and outcomes

The next implementation should add a publish-history object instead of
overwriting or erasing older YouTube outcomes.
