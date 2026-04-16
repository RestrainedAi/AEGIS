# AEGIS UX Requirements Spec v1

## Product Model

AEGIS should teach one consistent system model:

1. `Source`: where content comes from
2. `Run`: a single ingest or sync job
3. `Item`: a song, video, or cataloged asset
4. `Issue`: a problem affecting freshness, completeness, or usability
5. `Artifact`: supporting evidence

## Global Requirements

1. Primary navigation: Dashboard, Sources, Runs, Catalog, Issues
2. Global search retrieves sources, runs, and items from one field
3. Status must never rely on color alone
4. Desktop first, tablet supported, mobile deferred
5. Every detail page should link to related source, run, and item lineage
6. Phase 1 implementations should respect current backend authority, especially the SUNO production path
7. `Issues` should be treated as a computed UX surface until a first-class backend issue model exists
8. Catalog views should expose freshness clearly because the current viewer path is export-based
9. Publish and upload actions should be deferred or explicitly marked as dependent on backend readiness

## Dashboard

Purpose: daily control tower for operations.

Primary users:

1. Content operations manager
2. Technical operator

Questions this screen must answer:

1. Did today's ingest succeed?
2. What is stale or failing?
3. What new content arrived?

Required modules:

1. Platform health summary
2. Recent runs summary
3. Stale sources panel
4. Failed or partial runs panel
5. New items in the last 24 hours
6. Missing media and transcript summary
7. Quick actions

Primary actions:

1. Open failed runs
2. Open stale sources
3. Jump to latest items

States:

1. Healthy day
2. Warning-heavy day
3. Incident day
4. Empty or newly configured system

Implementation constraints:

1. Dashboard issue counts should initially be derived from existing runs, source freshness, and asset completeness signals
2. Dashboard freshness metrics should display the last successful catalog rebuild or last known export update when available

## Sources List

Purpose: manage all monitored inputs.

Primary users:

1. Content operations manager
2. Admin

Questions this screen must answer:

1. What sources exist?
2. Which are healthy?
3. Which need attention?

Required modules:

1. Search
2. Filters for platform, status, freshness, and type
3. Dense data table
4. Add Source action

Required columns:

1. Source name
2. Platform
3. Type
4. Status
5. Last run
6. Last successful ingest
7. Item count
8. Freshness
9. Actions

States:

1. No sources configured
2. Filtered empty results
3. Mixed-health dataset

Implementation constraints:

1. Source health may initially require computed aggregation across multiple backend collections
2. Source controls should begin as read-oriented unless backend ownership is normalized for the underlying source model

## Source Detail

Purpose: complete operating view for one source.

Primary users:

1. Content operations manager
2. Admin

Questions this screen must answer:

1. Is this source healthy?
2. What happened in the last run?
3. What content has this source produced?

Required modules:

1. Source header with identity, platform, status, and trigger action
2. Health summary cards
3. Latest run summary
4. Run history
5. Recent items from source
6. Schedule and config panel
7. Known issues panel

Secondary navigation:

1. Overview
2. Run History
3. Items
4. Settings

States:

1. Healthy source
2. Stale source
3. Failed recent run
4. Disabled source

Implementation constraints:

1. Source detail may need phased rollout because source lineage is not yet fully coherent across current backend paths
2. Source settings and trigger actions should be exposed only where engineering can guarantee authoritative behavior

## Runs List

Purpose: central execution history surface.

Primary users:

1. Content operations manager
2. Technical operator

Questions this screen must answer:

1. What ran?
2. What failed?
3. What is still running?

Required modules:

1. Date filter
2. Status, platform, pipeline, and source filters
3. Saved views
4. Dense sortable table

Required columns:

1. Run ID
2. Source
3. Pipeline
4. Status
5. Start time
6. Duration
7. Items processed
8. Errors
9. Missing assets

States:

1. Real-time running state
2. Failed-heavy dataset
3. No runs for selected period

Implementation constraints:

1. Runs List may need to distinguish between authoritative run sources until the backend run model is normalized
2. Filters and labels should prefer user-facing pipeline language over raw collection names

## Run Detail

Purpose: explain a single run end to end.

Primary users:

1. Technical operator
2. Content operations manager

Questions this screen must answer:

1. Where did the run succeed or fail?
2. Which items were affected?
3. Which artifacts or logs support diagnosis?

Required modules:

1. Run header with source, status, timestamps, and actions
2. Top metrics strip
3. Stage timeline or progress model
4. Processed items table
5. Errors and warnings panel
6. Artifacts panel
7. Logs panel

Secondary navigation:

1. Summary
2. Processed Items
3. Errors
4. Artifacts
5. Logs

States:

1. Running live
2. Partial completion
3. Hard failure
4. Successful completion

Implementation constraints:

1. Run detail should prioritize read visibility first and avoid assuming all pipeline stages are uniformly modeled in the backend
2. Artifact and log sections may need source-specific rendering depending on whether data comes from legacy or unified paths

## Catalog Browser

Purpose: browse and review media assets.

Primary users:

1. Creative reviewer or curator
2. Content operations manager

Questions this screen must answer:

1. What content exists?
2. Can I quickly find and play it?

Required modules:

1. Catalog search
2. Filters for source, account, platform, item state, transcript, media presence, and date
3. Sort controls
4. Grid and table toggle
5. Persistent playback behavior
6. Empty, loading, and error states

Required item card or row content:

1. Artwork or thumbnail
2. Title
3. Source or account
4. Platform badge
5. Status badges
6. Transcript and media indicators
7. Date
8. Play affordance

States:

1. Loading skeletons
2. Empty results
3. Missing artwork or missing media fallback

Implementation constraints:

1. Catalog freshness should show last published or last rebuilt time because viewer data is currently export-based
2. Catalog status should avoid implying real-time sync unless export automation has been tightened

## Item Detail

Purpose: full inspection view for a single asset.

Primary users:

1. Creative reviewer
2. Admin
3. Technical operator

Questions this screen must answer:

1. Is the item playable?
2. Is the item complete?
3. Where did it come from?
4. What run touched it last?

Required modules:

1. Header with title, platform, status, and source link
2. Hero area with artwork and player
3. Metadata strip
4. Status summary
5. Transcript panel
6. Artifact references
7. Run and source lineage
8. Raw metadata section

Secondary navigation:

1. Overview
2. Media
3. Metadata
4. Transcript
5. Source and Lineage

States:

1. Fully complete
2. Missing transcript
3. Missing media
4. Removed from source
5. Processing

Implementation constraints:

1. Item detail should support phased metadata depth because some lineage and processing state may not yet be fully normalized
2. Publish-to-YouTube actions should be hidden or marked unavailable until queue architecture and API support are production-ready

## Issues View

Purpose: prioritized operational inbox.

Primary users:

1. Content operations manager
2. Technical operator

Questions this screen must answer:

1. What should be fixed first?
2. What is blocking freshness or completeness?

Required modules:

1. Severity summary
2. Filters for severity, issue type, platform, source, and age
3. Grouping options
4. Prioritized issue list or table

Priority issue types:

1. Failed runs
2. Missing audio
3. Missing thumbnails
4. Missing transcripts
5. Removed-from-source items
6. Stale sources

Required issue row content:

1. Issue title
2. Affected object
3. Severity
4. First seen or age
5. Current status
6. Recommended action

States:

1. No active issues
2. Incident-heavy state
3. Low-severity backlog

Implementation constraints:

1. Issues should initially be computed from failed runs, stale sources, missing media, transcript gaps, and removed items
2. The first release should avoid issue workflows that imply persisted ownership, assignment, or resolution history unless backend support exists

## Status Model

Source statuses:

1. Healthy
2. Warning
3. Stale
4. Failed
5. Disabled

Run statuses:

1. Queued
2. Running
3. Ready
4. Partial
5. Failed

Item statuses:

1. Active
2. Incomplete
3. Missing Media
4. Transcript Missing
5. Removed
6. Processing

## Shared UX Rules

1. Keep summary information first and technical detail second
2. Always link Source, Run, and Item to each other where relevant
3. Operations screens default to dense tables
4. Catalog screens default to visual browsing
5. Design empty, loading, and degraded states intentionally
6. Make every operational issue actionable
7. Do not expose backend collection complexity directly in user-facing language
8. Favor stable, computed truth over incomplete real-time claims

## Delivery Phasing

### Phase 1

1. Dashboard
2. Sources List
3. Runs List
4. Catalog Browser
5. Shared status and component foundations

### Phase 2

1. Run Detail
2. Item Detail
3. Source Detail
4. Issues View

### Phase 3

1. Add Source flow
2. Retry and manual run actions
3. Bulk actions
4. Export management
5. Role-aware admin surfaces
