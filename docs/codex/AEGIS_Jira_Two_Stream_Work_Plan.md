# AEGIS Jira Two-Stream Work Plan

## Purpose

This note reorganizes the current AEGIS work into the two active delivery streams the project is now operating against:

1. `SUNO Harvest`
2. `Vault to YouTube`

The goal is to make Jira planning, agent assignment, and design-to-engineering execution cleaner by separating ingest and preservation work from downstream publishing work.

This document is meant to complement the existing backlog docs, not replace them.

Primary sources:

1. `docs/board/tasks.json`
2. `docs/codex/SUNO_Youtube_Pipeline_First_Wave_Ticket_Board.md`
3. `docs/codex/SUNO_Youtube_Pipeline_Implementation_Epics_and_Tickets.md`
4. `docs/codex/SUNO_SUNO_To_YouTube_Production_Workflow_Spec.md`
5. `docs/design/aegis-design-board-page-map-v1.md`

## Stream 1: SUNO Harvest

### Mission

Keep the SUNO acquisition, preservation, and vault freshness path healthy and trustworthy.

### Scope

This stream owns:

1. source discovery from SUNO public profiles
2. delta detection
3. media capture and repair
4. Firestore indexing
5. catalog export generation
6. vault freshness
7. harvest monitoring, digesting, and incident visibility

### User-facing outcomes

1. The vault updates when new public SUNO songs are published.
2. Missing media and stale sources are visible quickly.
3. Operators can tell whether the problem is harvest, media capture, or export publish.

### Operating constraint

SUNO harvest execution must be treated as an expensive operational action.

Planning and execution assumptions:

1. Harvest runs take significant time and consume real Google Cloud resources.
2. Server resources should be assumed limited unless explicitly expanded.
3. Manual harvest runs should be rare, hypothesis-driven, and high-signal.
4. The team should prefer dry checks, config inspection, log review, digest review, and export inspection before triggering a run.
5. Each manual run should be designed to answer multiple validation questions at once.

Working rule:

1. Do not trigger a manual harvest run without a stated hypothesis, validation target, and expected operational value.

Validation order for this stream:

1. inspect live config
2. inspect latest logs
3. inspect export freshness
4. inspect digest and monitor evidence
5. trigger a harvest only if the earlier evidence is insufficient

### Jira epic grouping

Recommended epics under `SUNO Harvest`:

1. `Harvest Reliability`
2. `Catalog Rebuild and Freshness`
3. `Harvest Monitoring and Alerts`
4. `Harvest UX and Visibility`

### Existing tickets that belong here

#### Core stability

1. `AEGIS-001` Confirm authoritative catalog export generator
2. `AEGIS-006` Decide and implement post-harvest catalog rebuild orchestration
3. `AEGIS-008` Document canonical ops entry points
4. `AEGIS-009` Add minimal export freshness visibility
5. `EPIC-13` Establish monitoring and operational visibility
6. `EPIC-14` Establish quality and release discipline

#### Design and product surfaces

1. `EPIC-11` Define status taxonomy and operational UI model
2. `EPIC-12` Deliver UX handoff for core product surfaces

#### Likely net-new child tickets

1. Separate harvest freshness from export freshness in operator-facing UI
2. Add explicit `partial harvest` handling so export rebuild still runs
3. Create issue rules for stale source, missing media, removed item, and failed rebuild
4. Add runbook and recovery notes for digest alert follow-up
5. Add safe cleanup/lifecycle policy for zero-byte and stale media artifacts later

### Recommended Jira issue types

1. Epic
2. Story
3. Task
4. Bug

### Suggested first working order

1. Lock the production harvest path and recovery path
2. Make freshness and failures visible in the product shell
3. Finish the dashboard, runs, and issues experience for this stream

### Execution style for this stream

The SUNO Harvest stream should optimize for:

1. low-run-count validation
2. high-signal checks
3. dry-run or inspect-first workflows
4. minimal exploratory execution
5. recovery procedures that avoid repeated reruns

## Stream 2: Vault to YouTube

### Mission

Turn the vault into a reliable staging and handoff surface for YouTube publishing.

### Scope

This stream owns:

1. publish readiness states
2. queue creation from the vault
3. queue schema and lifecycle
4. uploader input contract
5. YouTube auth and execution reliability
6. queue and upload status visibility in the UI

### User-facing outcomes

1. A user can select an item in the vault and queue it for YouTube safely.
2. Queue records are distinct from catalog records.
3. Users can see whether an item is queued, uploaded, failed, or blocked.

### Jira epic grouping

Recommended epics under `Vault to YouTube`:

1. `Queue Model and Contract`
2. `Vault Publish Handoff`
3. `Uploader Reliability`
4. `Publish UX and Status Visibility`

### Existing tickets that belong here

#### Core publishing path

1. `AEGIS-002` Standardize YouTube API environment naming
2. `AEGIS-003` Define dedicated `ytUploadQueue` schema
3. `AEGIS-004` Update queue manager to use `ytUploadQueue`
4. `AEGIS-005` Align YouTube uploader with real SUNO media schema
5. `AEGIS-010` Implement viewer-to-queue publish action

#### Product and design support

1. `EPIC-11` Define status taxonomy and operational UI model
2. `EPIC-12` Deliver UX handoff for core product surfaces

### Likely net-new child tickets

1. Add queue state badges to Catalog Browser and Item Detail
2. Add item-level publish readiness checks before queue submission
3. Create queue review and upload history views
4. Clarify duplicate-submission prevention rules in UI and backend
5. Add uploader failure reason surfacing in operator-facing screens

### Recommended Jira issue types

1. Epic
2. Story
3. Task
4. Bug

### Suggested first working order

1. Lock queue schema and queue lifecycle
2. Validate the end-to-end vault publish handoff
3. Make queue and upload state visible in the vault UI
4. Tackle uploader auth and execution issues as a separate reliability lane

## Shared Layer

Some work spans both streams and should either live in shared epics or be linked across tickets.

### Shared concerns

1. status taxonomy
2. dashboard shell
3. issues model
4. item detail lineage
5. release discipline
6. monitoring standards

### Shared design surfaces

1. `Dashboard`
2. `Catalog Browser`
3. `Item Detail`
4. `Issues View`

### Shared implementation surfaces

1. `suno-viewer`
2. Firestore `sunoSongs`
3. export freshness metadata
4. queue and uploader status mapping

## Recommended Jira Structure

### Option A: Two epics with child stories

Use:

1. `SUNO Harvest`
2. `Vault to YouTube`

And group the current work as child stories/tasks beneath those two umbrella epics.

This is the fastest structure if Jira is still being normalized.

### Option B: Two initiatives with multiple epics

Use:

1. Initiative: `SUNO Harvest`
2. Initiative: `Vault to YouTube`

Under them, create the recommended epics listed above.

This is the better long-term structure if Jira will hold the project for a while.

## Recommended Agent Assignment

### Agent 1: SUNO Harvest Lead

Owns:

1. harvest reliability
2. export rebuild
3. freshness visibility
4. incidents and monitoring

### Agent 2: Vault to YouTube Lead

Owns:

1. queue model
2. publish handoff
3. uploader contract
4. queue and upload state in the UI

## Immediate Next Step

If moving this into Jira now, the cleanest first move is:

1. create the two stream epics
2. move or relabel the existing AEGIS tickets under the correct stream
3. add net-new child stories only where the stream still has gaps
4. assign one working agent per stream

That gives the team a clear split between:

1. `Can the vault stay fresh?`
2. `Can the vault publish to YouTube?`
