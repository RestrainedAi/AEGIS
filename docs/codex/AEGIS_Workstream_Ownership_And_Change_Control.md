# AEGIS Workstream Ownership and Change Control

## Purpose

This note defines who owns which work surfaces so multiple contributors and agents can work in parallel without stepping on each other.

The rule is simple:

1. anything with a single source of truth gets a single owner
2. shared surfaces must have one designated writer
3. all other contributors adapt to that ownership instead of making conflicting edits

## Workstream Owners

### Feature ownership within workstreams

Apply [Development DNA](DEVELOPMENT_PRINCIPLES.md) within the ownership boundaries below. Every feature has one accountable owner; large features use a team of specialists with bounded tasks and focused context. Record the current agent filling each role, owned files, dependencies, handoffs, and acceptance evidence in the existing board or [feature brief](templates/FEATURE_BRIEF.md). These requirements supplement the named workstream owners; they do not grant a specialist ownership of another stream's shared surfaces.

### 1. SUNO Harvest

Owner:

`Epicurus`

Scope:

1. SUNO source discovery
2. delta detection
3. media capture and repair
4. Firestore indexing
5. catalog rebuild and export freshness
6. harvest monitoring and digest logic

Primary write surfaces:

1. `yt-ingest/catalog_sync_firestore_multi.py`
2. `yt-ingest/download_media_gcs.py`
3. `yt-ingest/firestore_upsert.py`
4. `yt-ingest/rebuild_catalog.py`
5. `yt-ingest/entrypoint.sh`
6. harvest-focused runbooks and contract docs

### 2. Vault to YouTube

Owner:

`Confucius`

Scope:

1. vault publish handoff
2. queue creation
3. queue processing
4. uploader behavior
5. YouTube result handling
6. queue and upload state visibility in the UI

Primary write surfaces:

1. `suno-viewer/server.js`
2. `suno-viewer/src/...`
3. `yt-ingest/queue_manager.py`
4. `yt-ingest/youtube_uploader.py`
5. queue/uploader docs and workflow notes

## Single-Writer Rule for Shared Surfaces

### Firestore schema and database changes

Single owner:

`Epicurus`

This includes:

1. Firestore collection definitions
2. document field additions or removals
3. status/value contract changes
4. canonical field ownership decisions
5. schema-affecting changes to `sunoSongs`, `ytUploadQueue`, or future source/run records

### Rule

`Confucius` may propose schema changes but should not implement database/schema changes directly.

Any queue/uploader change that requires a Firestore contract update should be handed to `Epicurus` or coordinated through the main agent first.

## Shared Docs Ownership

### Contract and schema docs

Single owner:

`Epicurus`

Includes:

1. `AEGIS_Data_Contract_Alignment_Brief.md`
2. `AEGIS_Authoritative_Fields_By_Object.md`
3. any future field dictionary or schema contract note

### Jira and product orchestration docs

Single owner:

Main agent

Includes:

1. stream planning docs
2. epic/story breakdown docs
3. workstream ownership docs

### Design board and Figma structure

Single owner:

Main agent with user direction

Includes:

1. Figma board structure
2. design board docs
3. shell, screen, and flow planning artifacts

## Coordination Rules

1. `Epicurus` can change harvest code and schema-owned surfaces directly.
2. `Confucius` can change vault, queue manager, uploader, and viewer surfaces directly.
3. If `Confucius` needs a schema change, it must be proposed first and then implemented only by `Epicurus`.
4. If a file or contract affects both streams, the main agent decides ownership before work starts.
5. Prefer adding data now over dropping data, but keep provenance and ownership explicit.

## Legacy Retirement Rule

When older logic is still present, the default approach is:

1. keep compatibility logic live only if it may still be exercised
2. do not leave large commented-out legacy code blocks in place
3. add a short inline note with the Jira key when compatibility logic is temporary
4. confirm the old path is truly unused before retiring it
5. remove retired logic cleanly in one small change
6. rely on Jira plus git history for recovery, not commented-out rollback code

### Example

If a legacy queue status such as `new` may still be emitted by an older producer, keep the compatibility branch alive and annotate it briefly, for example:

`TEMP compatibility for legacy queue items emitting new. Retire after producer audit. See DEV-44.`

This keeps the active path understandable while preserving a clear breadcrumb to the retirement decision.

## Immediate Operating Agreement

Starting now:

1. `Epicurus` is the sole database/schema writer.
2. `Confucius` is the sole vault-to-uploader implementation writer.
3. Main agent owns cross-stream coordination, Figma/design direction, and product-level decisions.

This should remain in force until the current schema and contract stabilization phase is complete.
