# AEGIS Design and Engineering Alignment Note

This note captures the most important reconciliation points between the future-state UX direction and the current repository reality.

Primary reference:

- `docs/codex/LAPLACE_CODEX_RECONCILIATION.md`

## Confirmed Direction

The future-state UX model remains the correct target:

1. `Source`
2. `Run`
3. `Item`
4. `Issue`
5. `Artifact`

The UI should continue to teach this model even though the backend is not yet fully normalized.

## Current Backend Reality

The current codebase still has split authority across multiple collections and workflows, including:

1. `sunoSongs`
2. `sources`
3. `runs`
4. `items`
5. `yt_runs`

This means the UX should be designed against the future-state model, but implementation should assume an interim bridge layer.

## Design Constraints To Respect

### 1. Issues are a computed UX surface in Phase 1

There is no first-class `issues` object yet.

Implication:

1. The `Issues` screen should aggregate derived conditions such as failed runs, stale sources, missing media, and missing transcripts.
2. The design should avoid assuming a dedicated persisted issue workflow in the first implementation pass.

### 2. Catalog freshness is currently export-based

The viewer depends on a published CSV artifact rather than a live Firestore-backed catalog.

Implication:

1. Catalog status may be eventually consistent rather than real-time.
2. UX should display freshness clearly.
3. System messaging should be honest about last updated time.

### 3. Publish and upload flows are not yet fully implemented

Important missing or unstable pieces include:

1. No production-ready `/api/queue-for-youtube` route yet
2. No production-safe dedicated upload queue collection yet
3. Uploader schema mismatch with current SUNO Firestore records

Implication:

1. Publish-related UI should be treated as later-phase or flagged as dependent on backend normalization.
2. If exposed early, publish states must clearly show queueing, delay, and recoverable failure.

### 4. Source and Run screens should avoid overclaiming authority

The UX can unify Source and Run concepts, but the backend still has mixed models and partial coverage.

Implication:

1. Design should support phased rollout.
2. Screens may need partial or read-only versions before full control surfaces are safe.

## Near-Term Technical Backbone To Design Around

Near-term implementation should assume the SUNO production backbone is:

1. Harvest to GCS
2. Firestore `sunoSongs`
3. Catalog rebuild
4. Viewer from published CSV
5. Dedicated YouTube upload queue
6. Scheduled uploader job

## Design Decisions That Still Stand

These design decisions remain valid and should not change:

1. Desktop-first operations UI
2. Dense ops views and richer catalog surfaces
3. Strong lineage across Source, Run, Item, and Artifact
4. Status never conveyed by color alone
5. Dashboard, Catalog, Runs, Sources, and Issues as the main product structure

## Immediate UX Delivery Guidance

Near-term screen implementation priority should remain:

1. Dashboard
2. Catalog Browser
3. Runs List
4. Run Detail
5. Sources List
6. Source Detail
7. Item Detail
8. Issues View

With this practical note:

1. `Issues` starts as computed
2. `Catalog` should show last refresh time
3. `Publish` actions should be deferred or explicitly marked dependent on backend readiness
4. Deep lineage and admin actions can be phased behind the first read-oriented releases

## Bottom Line

The design direction is still correct.

The engineering bridge is the current constraint, not the UX model itself.

The right approach is:

1. keep the future-state UX model intact
2. phase implementation against current operational truth
3. avoid implying backend capabilities that do not yet exist
