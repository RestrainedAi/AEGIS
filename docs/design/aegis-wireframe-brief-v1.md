# AEGIS Wireframe Brief v1

## Screen 1: Dashboard

Purpose: daily control tower for operations.

Primary users:

1. Content operations manager
2. Technical operator

Must answer:

1. Did today's ingest complete?
2. What is stale or failing?
3. What new content arrived?

Layout:

1. Top bar with title, date range, and global search
2. Hero strip with metric cards
3. Left column for recent runs
4. Right column for issues needing attention
5. Bottom row for stale sources, latest additions, and coverage summaries

Recommended modules:

1. Platform Health
2. Runs Today
3. Items Added
4. Sources Stale
5. Recent Runs
6. Issues Needing Attention
7. Latest Catalog Additions
8. Transcript Coverage
9. Missing Media Summary

Responsive notes:

1. Cards stack to two columns on tablet
2. Tables collapse to condensed lists

Backend notes:

1. Issue counts should be derived from current operational signals in phase 1
2. Freshness widgets should expose last successful export or rebuild time where possible

## Screen 2: Sources List

Purpose: manage monitored inputs.

Must answer:

1. Which sources are active?
2. Which need attention?

Layout:

1. Header with title, search, and Add Source CTA
2. Filter bar for platform, status, freshness, and type
3. Main table area

Core columns:

1. Source Name
2. Platform
3. Type
4. Status
5. Last Run
6. Last Successful Ingest
7. Item Count
8. Freshness
9. Actions

States:

1. No sources
2. Filtered empty
3. Mixed-health dataset

Backend notes:

1. Source status may need computed rollups until the source model is fully normalized
2. Row actions should stay conservative until source ownership and control paths are stable

## Screen 3: Source Detail

Purpose: operating view for one source.

Must answer:

1. Is this source healthy?
2. What happened last run?
3. What content came from it?

Layout:

1. Header with source identity, platform, status, and manual trigger
2. Summary cards for freshness, success rate, output volume, and issues
3. Tab row
4. Overview content with metadata, latest run, run history, recent items, and issues

Tabs:

1. Overview
2. Run History
3. Items
4. Settings

States:

1. Healthy source
2. Stale source
3. Failed recent run

Backend notes:

1. Some source-level views may initially be read-only
2. Settings and trigger controls should only appear when backed by authoritative source handling

## Screen 4: Runs List

Purpose: central execution history view.

Must answer:

1. What ran?
2. What failed or is still running?

Layout:

1. Header with title and date range
2. Filter bar for status, pipeline, platform, source, and date
3. Saved views row
4. Dense sortable table

Saved views:

1. Today
2. Running
3. Failed
4. Partial

Core columns:

1. Run ID
2. Source
3. Pipeline
4. Status
5. Start Time
6. Duration
7. Items Processed
8. Errors
9. Missing Assets

Backend notes:

1. Run records may come from more than one current backend path
2. Labels should normalize those paths into one user-facing run vocabulary

## Screen 5: Run Detail

Purpose: explain one run end to end.

Must answer:

1. Where did the run succeed or fail?
2. Which items were affected?

Layout:

1. Header with run ID, source, status, times, and actions
2. Metrics strip
3. Stage timeline or progression module
4. Tab row
5. Tab content for summary, items, errors, artifacts, and logs

Tabs:

1. Summary
2. Processed Items
3. Errors
4. Artifacts
5. Logs

Summary modules:

1. Queued count
2. Processed count
3. Succeeded count
4. Warning count
5. Error count

States:

1. Running live
2. Partial completion
3. Hard failure
4. Successful completion

Backend notes:

1. Stage timelines may need source-specific logic for SUNO versus YouTube flows
2. Artifact and log references should tolerate uneven data availability across legacy and newer paths

## Screen 6: Catalog Browser

Purpose: browse and review media.

Must answer:

1. What content exists?
2. Can I quickly find and play it?

Layout:

1. Header with title and search
2. Filter rail or top filter bar
3. Toolbar with sort, view toggle, and active filter chips
4. Main results area
5. Persistent mini-player dock

Views:

1. Grid mode with media cards
2. Table mode with denser rows

Card or row content:

1. Artwork
2. Title
3. Source or account
4. Platform
5. Status badges
6. Media and transcript indicators
7. Date
8. Play button

States:

1. Loading skeletons
2. Empty results
3. Missing artwork fallback

Backend notes:

1. Show a visible "last updated" timestamp because the catalog is currently export-backed
2. Avoid UI copy that implies instant synchronization with ingest state

## Screen 7: Item Detail

Purpose: full asset inspection.

Must answer:

1. Is this item complete and usable?
2. Where did it come from?
3. What run touched it last?

Layout:

1. Header with title, platform, status, and source link
2. Hero section with artwork and player
3. Metadata strip
4. Tab row
5. Detail content area

Tabs:

1. Overview
2. Media
3. Metadata
4. Transcript
5. Source and Lineage

Overview modules:

1. Completeness summary
2. Source info
3. Latest run info
4. Quick links to source and run

States:

1. Fully complete
2. Missing transcript
3. Missing media
4. Removed from source

Backend notes:

1. Metadata depth may be phased depending on how much normalized lineage is available
2. Publish actions should remain deferred or visibly unavailable until the YouTube queue path is production-ready

## Screen 8: Issues View

Purpose: prioritized operational inbox.

Must answer:

1. What needs to be fixed first?

Layout:

1. Header with title and severity counts
2. Filter bar for severity, issue type, platform, source, and age
3. Group toggle
4. Prioritized issue list or table

Grouping options:

1. By severity
2. By type
3. By source

Issue row contents:

1. Issue title
2. Affected object
3. Severity
4. First seen or age
5. Current status
6. Recommended action

States:

1. No active issues
2. Bursty incident state
3. Long-tail backlog

Backend notes:

1. Issues should be rendered from computed conditions in the first release
2. Do not assume persisted assignment or resolution models yet

## Shared Wireframe Rules

1. Use consistent status badges across all screens
2. Keep summary information above technical detail
3. Always link Source, Run, and Item to each other
4. Operations screens default to dense layouts
5. Catalog screens default to visual browsing
6. Empty, loading, and degraded states must be designed deliberately
7. Treat backend gaps as rollout constraints, not reasons to weaken the future-state UX model
