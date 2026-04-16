# AEGIS Jira Epic and Story Breakdown

## Purpose

This document turns the current two-stream planning model into a Jira-ready epic and story structure.

It is designed to support immediate board setup in Jira without needing to reinterpret the repo backlog by hand.

Streams:

1. `SUNO Harvest`
2. `Vault to YouTube`
3. 'YouTube Playlist Download'
4. 'Shared UX and Status Model'

Shared product/design work is called out separately so it can be linked rather than duplicated.

## Recommended Jira Model

Use:

1. two top-level stream epics if you want speed, or
2. two initiatives with multiple child epics if you want cleaner long-term scaling

For immediate execution, the simplest structure is:

1. Epic: `SUNO Harvest`
2. Epic: `Vault to YouTube`
3. Epic: `Shared UX and Status Model`


Then place the stories and tasks below them.

## Stream 1: SUNO Harvest

### Epic

`SUNO Harvest`

Summary:

Keep the SUNO acquisition, preservation, export rebuild, and vault freshness path healthy and trustworthy.

### Stories and tasks

1. `AEGIS-001 Confirm authoritative catalog export generator`
   - existing ticket
   - keep under `SUNO Harvest`

2. `AEGIS-006 Decide and implement post-harvest catalog rebuild orchestration`
   - existing ticket
   - keep under `SUNO Harvest`

3. `AEGIS-008 Document canonical ops entry points`
   - existing ticket
   - keep under `SUNO Harvest`

4. `AEGIS-009 Add minimal export freshness visibility`
   - existing ticket
   - keep under `SUNO Harvest`

5. `Formalize partial-harvest behavior and rebuild guarantees`
   - new story
   - ensure partial media failures do not block export freshness

6. `Define issue rules for stale source, failed rebuild, missing media, and removed item`
   - new story
   - feeds dashboard and issues view

7. `Review and confirm tracked SUNO source coverage`
   - new task
   - verify current handles versus intended production scope

8. `Create harvest-to-vault smoke check`
   - new task
   - verify harvest, rebuild, export, and public vault freshness in one flow

9. `Write harvest recovery runbook`
   - new task
   - operator-focused recovery path for stale vault incidents

10. `Normalize stored sunoSongs freshness and removal fields`
   - completed normalization slice
   - deterministic backfill completed without broad fresh harvest

### Suggested execution order

1. `AEGIS-008 Document canonical ops entry points`
2. `AEGIS-006 Decide and implement post-harvest catalog rebuild orchestration`
3. `AEGIS-009 Add minimal export freshness visibility`
4. `Formalize partial-harvest behavior and rebuild guarantees`
5. `Create harvest-to-vault smoke check`
6. `Define issue rules for stale source, failed rebuild, missing media, and removed item`
7. `Review and confirm tracked SUNO source coverage`
8. `Write harvest recovery runbook`
9. `Normalize stored sunoSongs freshness and removal fields`

## Stream 2: Vault to YouTube

### Epic

`Vault to YouTube`

Summary:

Turn the vault into a reliable staging, queueing, and publishing surface for YouTube.

### Stories and tasks

1. `AEGIS-002 Standardize YouTube API environment naming`
   - existing ticket
   - keep under `Vault to YouTube`

2. `AEGIS-003 Define dedicated ytUploadQueue schema`
   - existing ticket
   - keep under `Vault to YouTube`

3. `AEGIS-004 Update queue manager to use ytUploadQueue`
   - existing ticket
   - keep under `Vault to YouTube`

4. `AEGIS-005 Align YouTube uploader with real SUNO media schema`
   - existing ticket
   - keep under `Vault to YouTube`

5. `AEGIS-010 Implement viewer-to-queue publish action`
   - existing ticket
   - keep under `Vault to YouTube`

6. `Validate vault-to-queue-to-uploader production flow`
   - new story
   - run the real end-to-end publish path and confirm status transitions

7. `Add queue and upload state badges to vault surfaces`
   - new story
   - target Catalog Browser and Item Detail

8. `Define publish readiness checks before queue submission`
   - new task
   - ensure missing media and blocked states are surfaced early

9. `Add duplicate submission and retry rules to queue UX`
   - new task
   - align backend lifecycle with user-facing expectations

10. `Surface uploader failure reasons to operators`
   - new task
   - show actionable failure messages and next steps

11. `Add lightweight queue inspection and cleanup guidance`
   - in-progress bridge task
   - keep queue triage self-service inside the Vault UI

### Suggested execution order

1. `AEGIS-003 Define dedicated ytUploadQueue schema`
2. `AEGIS-004 Update queue manager to use ytUploadQueue`
3. `AEGIS-005 Align YouTube uploader with real SUNO media schema`
4. `AEGIS-010 Implement viewer-to-queue publish action`
5. `Validate vault-to-queue-to-uploader production flow`
6. `Add queue and upload state badges to vault surfaces`
7. `Define publish readiness checks before queue submission`
8. `Add duplicate submission and retry rules to queue UX`
9. `Surface uploader failure reasons to operators`
10. `Add lightweight queue inspection and cleanup guidance`

## Shared Epics

These should not be duplicated into both stream epics as separate copies. Link them where needed.

### Shared Epic

`Shared UX and Status Model`

### Stories under shared work

1. `EPIC-11 Define status taxonomy and operational UI model`
2. `EPIC-12 Deliver UX handoff for core product surfaces`
3. `EPIC-13 Establish monitoring and operational visibility`
4. `EPIC-14 Establish quality and release discipline`

## Jira Creation Order

If setting this up in Jira today, create in this order:

1. Epic: `SUNO Harvest`
2. Epic: `Vault to YouTube`
3. Epic: `Shared UX and Status Model`

Then create the stream stories beneath them.

## Short Jira Titles List

Use these as clean issue titles if you want a quick import-friendly naming set.

### SUNO Harvest

1. `Confirm authoritative catalog export generator`
2. `Implement post-harvest catalog rebuild orchestration`
3. `Document canonical SUNO harvest entry points`
4. `Add export freshness visibility`
5. `Formalize partial-harvest rebuild guarantees`
6. `Define stale source and missing media issue rules`
7. `Confirm tracked SUNO source coverage`
8. `Add harvest-to-vault smoke check`
9. `Write harvest recovery runbook`
10. `Normalize stored sunoSongs freshness and removal fields`

### Vault to YouTube

1. `Standardize YouTube API environment naming`
2. `Define ytUploadQueue schema`
3. `Move queue manager to ytUploadQueue`
4. `Align uploader with SUNO media schema`
5. `Implement viewer-to-queue publish action`
6. `Validate vault-to-uploader production flow`
7. `Add queue and upload state badges`
8. `Define publish readiness checks`
9. `Add duplicate submission and retry rules`
10. `Surface uploader failure reasons`
11. `Add lightweight queue inspection and cleanup guidance`

### Shared

1. `Define AEGIS status taxonomy`
2. `Finalize UX handoff for core surfaces`
3. `Establish monitoring and visibility model`
4. `Establish quality and release discipline`

## Recommended Agent Assignment

1. `SUNO Harvest Lead` owns the first stream epic
2. `Vault to YouTube Lead` owns the second stream epic
3. `Design Lead` supports the shared UX and status epic

This structure keeps the project split on the right fault line:

1. keeping the vault fresh
2. turning the vault into a reliable publishing surface
