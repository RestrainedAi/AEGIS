# AEGIS UI/UX Strategy Memo

## Executive Direction

AEGIS should be designed as a media operations console with a strong catalog layer, not as a music consumer app and not as a generic admin dashboard. The product should feel calm, precise, and trustworthy. Operational surfaces should answer "Is the system healthy?" while catalog surfaces should answer "What content do we have, and is it usable?"

The future-state UX should organize the product around three clear layers:

1. Inputs: sources and source health
2. Processing: runs, statuses, issues, artifacts
3. Outputs: cataloged items and item readiness

The core product model should be explicit everywhere:

1. `Source`: where content comes from
2. `Run`: a single ingest or sync job
3. `Item`: a song, video, or cataloged asset
4. `Issue`: anything blocking freshness, completeness, or usability
5. `Artifact`: supporting evidence, not a top-level navigation object

## Product UX Framework

The interface should follow a hub-and-drill model:

1. Overview surfaces summarize health, freshness, and volume.
2. Management surfaces let users inspect source and run behavior.
3. Content surfaces let users browse and evaluate media.
4. Detail surfaces reveal lineage, artifacts, and exceptions.

This creates a repeatable user rhythm:

1. See system state
2. Identify anomaly or opportunity
3. Drill into source, run, or item
4. Take action or confirm resolution

## Information Architecture

Top-level product structure:

1. `Dashboard`
   - Platform health, freshness, and operational summary
2. `Sources`
   - Manage SUNO profiles and YouTube playlists
3. `Runs`
   - Inspect ingest and processing activity
4. `Catalog`
   - Browse, search, filter, and play content
5. `Issues`
   - Surface failed runs, missing assets, and stale sources
6. `Search`
   - Global retrieval across sources, runs, and items
7. `Admin` later
   - Settings, exports, roles, and system controls

Recommended object relationships:

1. Sources create runs
2. Runs produce or update items
3. Items carry media, metadata, transcripts, and state
4. Issues point back to the source, run, or item that needs attention
5. Artifacts support traceability and debugging

## Navigation Model

Primary navigation:

1. Dashboard
2. Sources
3. Runs
4. Catalog
5. Issues

Global utility bar:

1. Global search
2. Date and freshness indicator
3. Notifications or recent failures
4. User or role menu

Secondary navigation:

On Source detail:

1. Overview
2. Run History
3. Items
4. Settings

On Run detail:

1. Summary
2. Processed Items
3. Errors
4. Artifacts
5. Logs

On Item detail:

1. Overview
2. Media
3. Metadata
4. Transcript
5. Source and Lineage

## Core Screen Concepts

### Dashboard

Purpose: daily control tower for operations.

Must answer:

1. Did today's ingest complete successfully?
2. Which sources are stale?
3. What failed or is at risk?
4. How much new content arrived recently?

Recommended modules:

1. Total active sources
2. Recent runs summary
3. Sources needing attention
4. Newly added items
5. Missing media summary
6. Transcript coverage summary
7. Quick actions

### Sources

Purpose: manage monitored inputs.

Recommended list view:

1. Source name
2. Platform
3. Type
4. Status
5. Last run
6. Last successful ingest
7. Item count
8. Freshness indicator

Source detail should make it easy to answer:

1. Is this source healthy?
2. What content has it produced?
3. What happened in the last run?
4. Is this source stale or degraded?

### Runs

Purpose: central operational monitoring surface.

Recommended list columns:

1. Run ID
2. Source
3. Pipeline
4. Status
5. Start time
6. Duration
7. Item counts
8. Error count

Run detail should explain:

1. What happened in each stage
2. Which items were affected
3. Which errors or warnings occurred
4. Which artifacts and logs support diagnosis

### Catalog

Purpose: primary content exploration surface.

Recommended capabilities:

1. Search
2. Filter by source, platform, account, and state
3. Sort by newest, popularity, and duration
4. Grid and table toggle
5. Persistent playback behavior
6. Strong media cards or dense rows

### Item Detail

Purpose: full record view for an asset.

Must clearly represent:

1. Content title
2. Source or account
3. Media availability
4. Transcript availability
5. Ingestion and run lineage
6. Removed or incomplete state

### Issues

Purpose: one place for operational exceptions.

Priority issue types:

1. Failed runs
2. Missing audio
3. Missing thumbnails
4. Missing transcripts
5. Removed-from-source content
6. Stale sources

## UX Patterns

### Status Model

Source status:

1. Healthy
2. Warning
3. Stale
4. Failed
5. Disabled

Run status:

1. Queued
2. Running
3. Ready
4. Partial
5. Failed

Item status:

1. Active
2. Incomplete
3. Missing Media
4. Transcript Missing
5. Removed
6. Processing

Design rules:

1. Use consistent badge language everywhere
2. Do not rely on color alone
3. Separate system state from content state

### Progressive Disclosure

Use three levels of depth:

1. Summary cards and badges
2. Structured detail sections
3. Advanced metadata drawers or accordions

### Cross-Object Traceability

Every source, run, and item page should reveal linked lineage:

1. Source > Run > Item
2. Item > Produced by Run > From Source

### Dual-Density Views

1. Operations screens default to dense tables
2. Catalog screens default to richer media views
3. Users can switch view modes where appropriate

## Visual System Direction

The visual language should combine editorial restraint with enterprise rigor.

Recommended direction:

1. Light-neutral base with strong contrast
2. Structured surfaces using warm gray or graphite tones
3. Accent palette driven by status and content context
4. Rich media framing in catalog areas
5. Tighter, data-forward framing in operations areas

Desired tone:

1. Professional
2. High-trust
3. Operationally capable
4. Content-aware
5. Structured and scalable

Avoid:

1. Consumer streaming tropes
2. Overly playful music branding
3. Dashboard clutter
4. Overdesigned analytics visuals

## Component Recommendations

Core components:

1. Data tables
2. Status badges
3. Filter chips
4. Search inputs
5. Empty states
6. Error panels
7. Metric cards
8. Media cards
9. Playback module
10. Side panels or drawers
11. Tabs for detail views
12. Toasts and banners
13. Timeline or stage progression module
14. Artifact reference lists
15. Transcript panels

## Responsive Strategy

Primary target: desktop first. Tablet support is important. Mobile can be deferred.

Recommended behavior:

1. Dashboard and ops tables optimize for desktop
2. Catalog browsing scales cleanly to tablet
3. Detail views collapse into stacked sections on narrower screens
4. Filters move into drawers or collapsible panels on tablet

## Accessibility Expectations

The product should follow enterprise-grade accessibility discipline:

1. Sufficient color contrast
2. Status not conveyed by color alone
3. Full keyboard navigability
4. Clear focus states
5. Semantic hierarchy in dense screens
6. Accessible playback controls
7. Readable typography at data-heavy densities

## Phased Delivery Recommendation

### Phase 1

1. Information architecture and navigation model
2. Dashboard
3. Sources List
4. Runs List
5. Catalog Browser baseline
6. Shared status model and component foundations

Goal: make the platform understandable and operable.

### Phase 2

1. Run Detail
2. Item Detail
3. Source Detail
4. Issues View
5. Global search
6. Saved views and better filter behavior

Goal: enable confident diagnosis and content review.

### Phase 3

1. Add Source flow
2. Manual run trigger and retry flows
3. Bulk operations
4. Export management
5. Role-aware views
6. Publishing readiness states
7. Audit and lineage enhancements

Goal: turn AEGIS into an actively managed platform.

## Recommended Immediate Deliverables

1. UX framework diagram showing Source, Run, Item, Issue, and Artifact relationships
2. Sitemap and navigation model
3. Wireframes for Dashboard, Runs List, Run Detail, Catalog, and Item Detail
4. Status and severity framework
5. Component inventory
6. High-fidelity concept for one ops screen and one catalog screen
7. Responsive behavior notes for desktop and tablet
