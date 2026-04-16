# AEGIS Design Board Page Map v1

## Purpose

This document is the first design-board blueprint for AEGIS. It translates the current product, UX, and implementation docs into a single page map that can drive Figma, FigJam, or equivalent design-board setup.

This blueprint is future-state in UX model, but implementation-aware in sequencing. It keeps the AEGIS object model intact while respecting current engineering realities:

1. `Issues` are a computed UX surface in Phase 1.
2. `Catalog` freshness is currently export-based, not truly live.
3. `Publish` and upload controls remain gated until queue and uploader normalization are complete.
4. `Source` and `Run` controls should launch read-oriented first where backend authority is still mixed.
5. `Inspect Queue` now exists as a lightweight contextual operator surface inside the Vault and should be designed as a bridge-state publishing-ops pattern.

Primary source docs:

1. `docs/design/README.md`
2. `docs/design/aegis-ui-ux-strategy-memo.md`
3. `docs/design/aegis-ux-requirements-spec-v1.md`
4. `docs/design/aegis-wireframe-brief-v1.md`
5. `docs/design/aegis-design-engineering-alignment.md`
6. `docs/design/aegis-component-reuse-map.md`
7. `docs/codex/SUNO_Youtube_Pipeline_Master_Product_Document.md`
8. `docs/codex/SUNO_Youtube_Pipeline_Project_Map.md`
9. `docs/codex/SUNO_Youtube_Pipeline_Implementation_Epics_and_Tickets.md`

## Product Shell and Navigation Model

### Product model the shell must teach

AEGIS should present one consistent user-facing system model across all pages:

1. `Source`: where content comes from
2. `Run`: a single ingest or sync execution
3. `Item`: a cataloged song, video, or asset
4. `Issue`: a problem affecting freshness, completeness, or usability
5. `Artifact`: supporting evidence, logs, exports, or files linked from other objects

### Primary navigation

Top-level product navigation:

1. `Dashboard`
2. `Sources`
3. `Runs`
4. `Catalog`
5. `Issues`

Contextual utility surface tied to `Catalog`:

1. `Queue Ops / Inspect Queue`

### Global utility bar

Shared shell utilities:

1. Global search across sources, runs, and items
2. Catalog freshness and last-updated indicator
3. Notifications or recent failures
4. User or role menu

### Shell behavior

The shell should separate operations surfaces from media-review surfaces:

1. `Dashboard`, `Sources`, `Runs`, and `Issues` should feel dense, operational, and scan-first.
2. `Catalog` and `Item Detail` should feel more editorial and media-forward.
3. Every detail page should expose lineage links so users can move between `Source`, `Run`, and `Item`.
4. Freshness should remain visible at shell level because export timing materially affects trust in the catalog.

### Page hierarchy

```text
Dashboard
Sources
  Source Detail
    Overview
    Run History
    Items
    Settings
Runs
  Run Detail
    Summary
    Processed Items
    Errors
    Artifacts
    Logs
Catalog
  Queue Ops (contextual inspector)
  Item Detail
    Overview
    Media
    Metadata
    Transcript
    Source and Lineage
Issues
Global Search later
Admin later
```

### Implementation-aware shell notes

1. The current `suno-viewer` effectively acts as an early `Catalog Browser` with publish affordances, not the full AEGIS shell.
2. The first implemented shell should prioritize read clarity, freshness visibility, and cross-object traceability before deep control surfaces.
3. `Global Search`, `Admin`, `Add Source`, `Retry`, and `Manual Trigger` should be represented on the board as later or gated surfaces, not assumed as Day 1 implementation.
4. `Publish` is now live, but deeper queue cleanup and upload-ops handling should still be shown as a bridge-state operational surface rather than a finished admin system.

## Screen Inventory

| Screen | Type | Product layer | Primary purpose | Suggested delivery band | Implementation note |
| --- | --- | --- | --- | --- | --- |
| Dashboard | Top-level | Operations overview | Daily control tower for health, freshness, and triage | Phase 1 | Counts are initially derived from runs, freshness, and asset completeness |
| Sources List | Top-level | Inputs | Scan and manage monitored sources | Phase 1/2 bridge | Source health is likely computed across mixed backend paths |
| Source Detail | Detail | Inputs + lineage | Inspect one source, its health, and its output | Phase 2 | Control surfaces should launch selectively and read-first |
| Runs List | Top-level | Processing | Monitor execution history and active failures | Phase 1 | May bridge multiple run collections and vocabularies |
| Run Detail | Detail | Processing + evidence | Explain one run end to end | Phase 2 | Stage and artifact rendering may vary by pipeline |
| Catalog Browser | Top-level | Outputs | Browse, search, filter, and play items | Phase 1 | Must show export freshness and avoid implying real-time sync |
| Queue Inspector | Contextual utility | Publishing ops | Inspect queued, contradictory, active, and failed upload rows from the Vault | Phase 1/2 bridge | Ships as an embedded operational surface within Catalog rather than a separate admin page |
| Item Detail | Detail | Outputs + lineage | Inspect one asset for completeness and usability | Phase 2 | Publish stays gated until queue/uploader epics land |
| Issues View | Top-level | Computed exceptions | Prioritize what needs attention first | Phase 2 | Derived from stale, failed, missing, and removed signals |
| Global Search | Utility | Cross-object | Find sources, runs, and items from one field | Later Phase 2/3 | Useful as a shell utility even before a dedicated full search page |
| Admin | Utility | Platform governance | Settings, exports, roles, and system controls | Phase 3 | Defer until authority and ownership models stabilize |

## Page Blueprints

### 1. Dashboard

**Goal**

Give operators a daily control tower that answers whether ingest, freshness, and asset completeness are healthy.

**Primary user**

1. Content operations manager
2. Technical operator

**Core modules**

1. Platform health summary
2. Recent runs summary
3. Failed or partial runs panel
4. Stale sources panel
5. New items in the last 24 hours
6. Missing media summary
7. Transcript coverage summary
8. Last catalog export or rebuild timestamp
9. Quick actions

**Primary actions**

1. Open failed runs
2. Open stale sources
3. Jump to latest catalog additions
4. Filter by date preset, platform, or severity shortcut

**Primary states**

1. Healthy day
2. Warning-heavy day
3. Incident day
4. Empty or newly configured system

**Linked destinations**

1. `Runs List` filtered to failed, partial, or today
2. `Run Detail` for recent problem runs
3. `Sources List` filtered to stale or warning
4. `Source Detail` for affected sources
5. `Catalog Browser` filtered to new items
6. `Issues View` grouped by severity or issue type
7. `Queue Inspector` when publish cleanup or queue triage is needed

**Implementation notes**

1. Treat dashboard issue counts as computed, not persisted.
2. Show freshness from export or rebuild timestamps where available.
3. Tie this page to Workstream 8 and EPICs 11, 12, and 13.

### 2. Sources List

**Goal**

Provide a dense, scannable inventory of monitored sources and their health.

**Primary user**

1. Content operations manager
2. Admin

**Core modules**

1. Search
2. Filters for platform, status, freshness, and type
3. Dense source table
4. Saved or quick views later
5. Add Source CTA, visibly gated if not implemented

**Primary actions**

1. Search sources
2. Filter to stale, failed, disabled, or platform-specific sets
3. Open a source
4. Add source later

**Primary states**

1. No sources configured
2. Filtered empty state
3. Mixed-health dataset

**Linked destinations**

1. `Source Detail`
2. `Runs List` filtered by source
3. `Catalog Browser` filtered by source or account
4. `Issues View` filtered to source-linked exceptions

**Implementation notes**

1. Health may require a bridge layer across multiple collections.
2. Row actions should start conservative and mostly read-oriented.
3. Tie this page to Workstream 3, Workstream 8, and EPICs 11 and 12.

### 3. Source Detail

**Goal**

Give a full operating view of one source, including health, latest run behavior, recent items, and known issues.

**Primary user**

1. Content operations manager
2. Admin

**Core modules**

1. Source header with identity, platform, type, and status
2. Health summary cards
3. Latest run summary
4. Run history table
5. Recent items from this source
6. Schedule and config panel
7. Known issues panel
8. Optional run trigger area when authoritative

**Primary actions**

1. Open latest run
2. Inspect run history
3. Inspect source items
4. Open source-linked issues
5. Trigger or retry later, only if backend-safe

**Primary states**

1. Healthy source
2. Stale source
3. Failed recent run
4. Disabled source

**Linked destinations**

1. `Runs List` filtered by source
2. `Run Detail`
3. `Catalog Browser` filtered by source
4. `Item Detail`
5. `Issues View` filtered by source

**Implementation notes**

1. This page should be phased after source lineage and authority are clearer.
2. `Settings` and trigger actions should be hidden or unavailable until backend ownership is normalized.
3. Tie this page to Workstream 3, Workstream 4, Workstream 5, and EPIC 12.

### 4. Runs List

**Goal**

Act as the central operational monitoring surface for execution history.

**Primary user**

1. Content operations manager
2. Technical operator

**Core modules**

1. Date filter
2. Status, source, pipeline, and platform filters
3. Saved views
4. Dense sortable table
5. Incident or running banner

**Primary actions**

1. Filter to running, failed, partial, or today
2. Open a run
3. Change sort or density
4. Save a useful operational view later

**Primary states**

1. Real-time running state
2. Failed-heavy dataset
3. No runs for selected period

**Linked destinations**

1. `Run Detail`
2. `Source Detail`
3. `Sources List`
4. `Issues View`
5. `Dashboard`

**Implementation notes**

1. Normalize user-facing pipeline language even if underlying collections remain split.
2. This should be one of the earliest screens after the shell and status system.
3. Tie this page to Workstream 3, Workstream 8, and EPICs 11, 12, and 13.

### 5. Run Detail

**Goal**

Explain a single run from start to finish, including stages, affected items, errors, artifacts, and logs.

**Primary user**

1. Technical operator
2. Content operations manager

**Core modules**

1. Run header with source, status, timestamps, and available actions
2. Metrics strip
3. Stage timeline or progression module
4. Processed items table
5. Errors and warnings panel
6. Artifacts panel
7. Logs panel

**Primary actions**

1. Inspect stage outcome
2. Inspect affected items
3. Review errors and artifacts
4. Jump to source or items
5. Retry later when backend-safe

**Primary states**

1. Running live
2. Partial completion
3. Hard failure
4. Successful completion

**Linked destinations**

1. `Runs List`
2. `Source Detail`
3. `Item Detail`
4. `Issues View`
5. `Dashboard`

**Implementation notes**

1. Stage representation may need source-specific logic for SUNO and YouTube pipelines.
2. Artifact and log sections should tolerate uneven backend data.
3. Tie this page to Workstream 3, Workstream 8, and EPICs 11, 12, and 13.

### 6. Catalog Browser

**Goal**

Provide the primary content exploration surface for finding, reviewing, and playing catalog items.

**Primary user**

1. Creative reviewer or curator
2. Content operations manager

**Core modules**

1. Catalog search
2. Filter rail or filter bar
3. Active filter chips
4. Sort controls
5. Grid and table toggle
6. Main results area
7. Persistent mini-player
8. Freshness timestamp and data-source messaging

**Primary actions**

1. Search content
2. Filter by source, account, platform, status, transcript, media presence, and date
3. Toggle grid or table density
4. Play content
5. Open an item
6. Publish later when queue architecture is ready

**Primary states**

1. Loading skeletons
2. Empty results
3. Missing artwork fallback
4. Missing media fallback
5. Stale export warning

**Linked destinations**

1. `Item Detail`
2. `Source Detail`
3. `Run Detail` via lineage links
4. `Issues View` via status or exception filters

**Implementation notes**

1. This is the strongest current implementation anchor because the existing viewer already covers core browse, filter, play, and publish-adjacent behavior.
2. Copy must remain honest about export-backed freshness.
3. Tie this page to Workstream 6, Workstream 7, EPIC 6, EPIC 9, EPIC 10, and EPIC 12.

### 7. Item Detail

**Goal**

Provide a full inspection view for a single catalog item, with media, completeness, metadata, transcript, and lineage.

**Primary user**

1. Creative reviewer
2. Admin
3. Technical operator

**Core modules**

1. Header with title, platform, status, and source link
2. Hero media area with artwork and player
3. Metadata strip
4. Completeness summary
5. Transcript panel
6. Artifact references
7. Run and source lineage
8. Raw metadata section
9. Publish status or queue state later

**Primary actions**

1. Play the item
2. Inspect metadata and transcript
3. Open source lineage
4. Open run lineage
5. Publish later if media readiness and queue support exist

**Primary states**

1. Fully complete
2. Missing transcript
3. Missing media
4. Removed from source
5. Processing

**Linked destinations**

1. `Catalog Browser`
2. `Source Detail`
3. `Run Detail`
4. `Issues View`

**Implementation notes**

1. Metadata depth can phase in as lineage and normalization improve.
2. Publish affordances should be hidden, unavailable, or dependency-labeled until EPICs 7 through 10 are complete.
3. Tie this page to Workstream 6, Workstream 7, EPIC 10, EPIC 11, and EPIC 12.

### 8. Issues View

**Goal**

Provide a prioritized operational inbox that tells users what to fix first.

**Primary user**

1. Content operations manager
2. Technical operator

**Core modules**

1. Severity summary
2. Filters for severity, issue type, platform, source, and age
3. Grouping options
4. Prioritized issue list or table
5. Recommended-action column or module

**Primary actions**

1. Filter and group issues
2. Open affected run, source, or item
3. Triage by severity
4. Move into corrective context

**Primary states**

1. No active issues
2. Incident-heavy state
3. Low-severity backlog

**Linked destinations**

1. `Run Detail`
2. `Source Detail`
3. `Item Detail`
4. `Runs List`
5. `Sources List`
6. `Dashboard`

**Implementation notes**

1. Treat issues as a computed surface in first release, not a persisted ticketing model.
2. Do not imply assignment, ownership history, or resolved-state workflows until backend support exists.
3. Tie this page to Workstream 8, EPIC 11, EPIC 12, and EPIC 13.

## Key Cross-Page Flows

### 1. Daily operations triage

1. Start on `Dashboard`
2. Identify failure, staleness, or low freshness
3. Jump to `Runs List`, `Run Detail`, or `Sources List`
4. Inspect affected `Item Detail` records when content-level damage is involved
5. Return to `Dashboard` or `Issues View` to verify remaining risk

### 2. Stale source remediation

1. Start on `Dashboard` stale sources panel or `Issues View`
2. Open `Source Detail`
3. Inspect latest run summary and run history
4. Open `Run Detail` if a recent failure explains staleness
5. Open source-linked items in `Catalog Browser` or `Item Detail` to confirm downstream impact

### 3. Run failure diagnosis

1. Start on `Runs List` or `Dashboard`
2. Open `Run Detail`
3. Inspect stage timeline, errors, artifacts, and logs
4. Jump to affected `Item Detail` records
5. Jump to `Source Detail` if the failure appears source-level rather than item-level

### 4. Catalog review and validation

1. Start on `Catalog Browser`
2. Search, filter, sort, and play content
3. Open `Item Detail`
4. Review completeness, transcript, metadata, and lineage
5. Jump to `Source Detail` or `Run Detail` when debugging provenance or missing assets

### 5. Issue-led exception handling

1. Start on `Issues View`
2. Group by severity, type, or source
3. Open affected object
4. Inspect root context in `Run Detail`, `Source Detail`, or `Item Detail`
5. Return to `Issues View` to continue triage

### 6. Future publish readiness flow

1. Start on `Catalog Browser` or `Item Detail`
2. Confirm media readiness, completeness, and status
3. Trigger `Publish` only after dedicated upload queue, idempotent API, and uploader schema alignment exist
4. Track queue or upload state through item and run-linked status surfaces

## Component Families Needed

### 1. Shell and navigation

1. Primary nav rail or top nav
2. Global utility bar
3. Breadcrumbs or lineage breadcrumbs
4. Detail page tab sets

### 2. Status and freshness

1. Status badges for source, run, item, export, and upload states
2. Severity badges for issues
3. Freshness indicators
4. Incident, warning, and info banners

### 3. Data browsing and filtering

1. Search inputs
2. Filter chips
3. Filter rails or drawers
4. Saved view controls
5. Sort controls
6. Grid and table density toggles

### 4. Data display

1. Dense data tables
2. Metric cards
3. Media cards
4. Thumbnail plus metadata rows
5. Queue-style review lists
6. Sectioned panels

### 5. Lineage and evidence

1. Source-run-item linkage modules
2. Stage timeline or progress tracker
3. Artifacts lists
4. Logs panels
5. Raw metadata blocks

### 6. Media and content review

1. Player module
2. Artwork and thumbnail treatment
3. Transcript panel
4. Metadata strip
5. Completeness summary

### 7. Actions and feedback

1. Conservative primary CTA pattern
2. Inline row actions
3. Toasts and banners
4. Empty states
5. Loading skeletons
6. Degraded-state messaging

### 8. Configuration and control surfaces later

1. Settings rows
2. Trigger and retry confirmation modules
3. Add Source forms
4. Publish and queue-status modules

### Reuse guidance from the current reuse map

1. Reuse directly: filter chips, thumbnail-plus-metadata rows, sectioned panels
2. Reinterpret carefully: queue review list, sticky CTA pattern, workspace selector patterns
3. Retire as architecture: single-column extension framing and downloader-first page structure

## Recommended Design Board Layout

The board should be structured as a working system map, not just a pile of frames.

### Section A: North star and constraints

Include:

1. Product goal and design principles
2. Object model: `Source`, `Run`, `Item`, `Issue`, `Artifact`
3. Implementation constraints:
   - computed issues
   - export-backed catalog freshness
   - gated publish flows
   - mixed source and run authority

### Section B: Product shell

Include:

1. Primary navigation model
2. Global utility bar
3. Shell layout options for desktop and tablet
4. Status and freshness language

### Section C: Screen inventory lane

Include one card for each core screen with:

1. Screen name
2. Product layer
3. Primary user
4. Delivery phase
5. Current implementation risk or dependency

### Section D: Operations lane

Place frames for:

1. Dashboard
2. Sources List
3. Source Detail
4. Runs List
5. Run Detail
6. Issues View

Use a left-to-right pattern:

1. list or overview screen
2. detail screen
3. states and edge cases

### Section E: Catalog lane

Place frames for:

1. Catalog Browser
2. Item Detail
3. player behavior
4. completeness states
5. future publish state modules

### Section F: Cross-page flow lane

Map the primary flows:

1. Daily ops triage
2. Stale source remediation
3. Run failure diagnosis
4. Catalog review and validation
5. Issue-led exception handling
6. Future publish readiness

### Section G: Component family library

Organize by:

1. shell and nav
2. status and freshness
3. data browsing
4. data display
5. lineage and evidence
6. media review
7. actions and feedback

### Section H: States and edge cases

Create one lane for shared state patterns:

1. loading
2. empty
3. stale
4. partial
5. failed
6. removed
7. missing media
8. missing transcript
9. unavailable or gated action

### Section I: Design-to-engineering mapping

For each page, add a small dependency block showing:

1. source data assumptions
2. required status vocabulary
3. whether actions are read-only, gated, or production-safe
4. linked epics or workstreams

### Suggested FigJam/Figma board lane order

```text
North Star and Constraints
Product Shell
Screen Inventory
Operations Lane
Catalog Lane
Cross-Page Flows
Component Families
States and Edge Cases
Design-to-Engineering Mapping
Phased Production Plan
```

## Phased Design-Production Order

This order reconciles the Laplace delivery guidance, the engineering alignment note, and the Codex project and epic structure.

### Phase 0: Board foundations

Deliver first:

1. Product model and IA board
2. Shell and navigation blueprint
3. Status taxonomy and severity language
4. Freshness language and export-trust rules
5. Shared component inventory

Why first:

1. Workstream 7 and EPIC 12 depend on a consistent IA and component language.
2. Workstream 8 and EPIC 11 depend on shared status and issue vocabulary.

### Phase 1A: Highest-value operational and catalog entry points

Design next:

1. Dashboard
2. Runs List
3. Catalog Browser

Why this order:

1. These pages give immediate visibility into platform health, execution history, and content inventory.
2. `Catalog Browser` already has the strongest implementation foothold in the existing viewer.
3. `Runs List` and `Dashboard` establish the operational backbone needed before deeper drill-down.

### Phase 1B: First drill-down surfaces

Design next:

1. Run Detail
2. Sources List

Why this order:

1. `Run Detail` is the most critical diagnosis screen after `Runs List`.
2. `Sources List` becomes more useful once the shell, status system, and run vocabulary are stable.

### Phase 2: Deep object detail and computed triage

Design next:

1. Item Detail
2. Source Detail
3. Issues View

Why this order:

1. `Item Detail` completes the catalog-review flow built on the current viewer foundation.
2. `Source Detail` should wait until source lineage and authority are less ambiguous.
3. `Issues View` should launch only after the computed issue taxonomy and severity model are clearly defined.

### Phase 3: Gated controls and utility expansion

Design after backend readiness:

1. Global search
2. Add Source flow
3. Manual run trigger and retry flows
4. Publish and queue-state surfaces
5. Export management
6. Admin and role-aware views

Why this order:

1. These surfaces depend on work still represented in EPICs 6 through 10 and later hardening workstreams.
2. They should not be designed as if authority is already production-safe.

## Recommended Immediate Board Deliverables

To make this blueprint actionable, the first board package should include:

1. One shell frame with primary nav and global utility bar
2. One inventory matrix covering all eight core screens
3. Low-fidelity blueprints for `Dashboard`, `Runs List`, `Run Detail`, `Catalog Browser`, and `Item Detail`
4. A shared status and severity panel
5. A freshness and trust panel covering export-backed catalog behavior
6. A component family lane seeded from the reuse map
7. A flow lane covering triage, diagnosis, catalog review, and issue-driven routing

## Bottom Line

AEGIS should be designed as one calm, high-trust operations and catalog system built around `Source`, `Run`, `Item`, `Issue`, and `Artifact`.

The board should not be organized by disconnected mockups. It should be organized by shell, core screens, flows, states, and implementation constraints so design can move directly into engineering sequencing without overclaiming backend readiness.
