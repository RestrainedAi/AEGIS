# AEGIS Component Reuse Map

This document maps useful patterns from the legacy browser-extension-style designs into the future AEGIS product surfaces.

Goal:

1. identify what can be reused
2. show how it should be adapted
3. prevent accidental migration of patterns that do not fit the current product

## Reuse Categories

### Reuse Directly

Patterns that can transfer with only small visual or structural changes.

### Reinterpret

Patterns that are directionally useful but need to be redesigned for desktop-first, multi-surface product use.

### Retire

Patterns that do not fit the new AEGIS structure and should not be carried forward.

## Legacy Pattern Inventory

Key patterns observed in the shared references:

1. Workspace selector list
2. Filter chip groups
3. Exclusion chips
4. Sectioned option panels
5. Toggle rows
6. File or artifact options module
7. Queue review list
8. Thumbnail plus metadata rows
9. Sticky bottom primary CTA
10. Progress or status message bar
11. Narrow single-column extension layout

## Screen Mapping

## 1. Dashboard

Primary purpose:

1. system health
2. freshness monitoring
3. issue triage

Legacy patterns to reuse:

1. Sectioned option panels
   - Reinterpret
   - Use for grouped dashboard modules such as health, recent runs, and issues
2. Progress or status message bar
   - Reinterpret
   - Use for platform health banners, incident banners, or rebuild freshness notices
3. Filter chip groups
   - Reuse directly
   - Use for date presets, platform filters, or severity quick filters

Do not reuse:

1. Sticky bottom CTA
2. Single-column utility flow

Dashboard-specific adaptation:

1. replace task-execution emphasis with triage emphasis
2. use multi-column desktop layout
3. prioritize metrics, freshness, and issue ranking

## 2. Sources List

Primary purpose:

1. manage monitored inputs
2. scan source health

Legacy patterns to reuse:

1. Workspace selector list
   - Reinterpret
   - Use as a source grouping or source navigation concept
2. Filter chip groups
   - Reuse directly
   - Use for platform, status, and freshness filtering
3. Sectioned option panels
   - Reinterpret
   - Use for grouped list controls, saved views, or sidebar filters
4. Progress or status message bar
   - Reinterpret
   - Use for stale source warnings or action-required notices

Do not reuse:

1. Download-specific copy
2. Toggle-heavy setup approach as default list interaction

Sources-specific adaptation:

1. convert "workspace list" into a data-rich source list with health signals
2. increase density and table behavior
3. preserve compact control rhythm

## 3. Source Detail

Primary purpose:

1. full view of one source
2. monitor health, recent runs, and output

Legacy patterns to reuse:

1. Sectioned option panels
   - Reuse directly
   - Use for source metadata, schedule, config, and issue panels
2. Sticky primary CTA
   - Reinterpret
   - Use as a visible `Run Ingest` or `Retry Source` action in a safer desktop position
3. Progress or status message bar
   - Reuse directly
   - Use for freshness warnings, last run state, or degraded source notice
4. Thumbnail plus metadata rows
   - Reuse directly
   - Use for recent items from this source

Do not reuse:

1. one-page downloader flow

Source Detail adaptation:

1. keep section framing
2. replace downloader options with source health and history
3. make latest run and recent items the focal supporting surfaces

## 4. Runs List

Primary purpose:

1. monitor execution history
2. identify failures and partial completion

Legacy patterns to reuse:

1. Queue review list
   - Reinterpret
   - Use the dense review style as a base for run rows or grouped failures
2. Filter chip groups
   - Reuse directly
   - Use for status, platform, and date presets
3. Progress or status message bar
   - Reuse directly
   - Use for running, delayed, or incident banners

Do not reuse:

1. bottom-anchored task CTA as the dominant page action

Runs List adaptation:

1. translate queue density into table scanning
2. make status, duration, counts, and errors more prominent than artwork or media

## 5. Run Detail

Primary purpose:

1. explain what happened in a run
2. show affected items and artifacts

Legacy patterns to reuse:

1. Queue review list
   - Reuse directly
   - Use for processed item review
2. Thumbnail plus metadata rows
   - Reuse directly
   - Use for items touched in the run
3. Sectioned option panels
   - Reuse directly
   - Use for errors, artifacts, logs, and stage summaries
4. Progress or status message bar
   - Reinterpret
   - Use for stage progress and run outcome callouts
5. Sticky primary CTA
   - Reinterpret
   - Use sparingly for `Retry`, `Open Failed Items`, or `Reprocess` later

Run Detail adaptation:

1. this is the strongest target for the queue review pattern
2. preserve high scannability
3. make stage progression clearer than in the legacy designs

## 6. Catalog Browser

Primary purpose:

1. browse and review media assets
2. search, filter, and play

Legacy patterns to reuse:

1. Filter chip groups
   - Reuse directly
   - Use for status, source, platform, and media availability
2. Exclusion chips
   - Reuse directly
   - Use for hide removed, hide missing media, hide transcript missing
3. Thumbnail plus metadata rows
   - Reuse directly
   - Use in table mode
4. Workspace selector list
   - Reinterpret
   - Use for source or account quick filters in sidebar mode
5. Queue review list
   - Reinterpret
   - Use only in bulk review mode, not as the default catalog layout

Do not reuse:

1. settings-heavy utility sections as dominant above-the-fold content

Catalog adaptation:

1. preserve compact filtering
2. increase editorial quality of media cards
3. support both grid and table views
4. keep player behavior more polished than utility-like

## 7. Item Detail

Primary purpose:

1. inspect one asset in depth
2. verify completeness, lineage, and usability

Legacy patterns to reuse:

1. File or artifact options module
   - Reinterpret
   - Use as asset presence and artifact availability panel
2. Sectioned option panels
   - Reuse directly
   - Use for metadata, transcript, lineage, and artifacts
3. Progress or status message bar
   - Reuse directly
   - Use for removed, incomplete, or processing notices
4. Thumbnail plus metadata composition
   - Reuse directly
   - Use in the top summary region

Do not reuse:

1. action-first downloader framing

Item Detail adaptation:

1. translate "file options" into an evidence and completeness module
2. keep media central
3. subordinate technical metadata using tabs or accordions

## 8. Issues View

Primary purpose:

1. prioritize operational exceptions
2. point users to the next fix

Legacy patterns to reuse:

1. Queue review list
   - Reinterpret
   - Use for a prioritized issue queue
2. Filter chip groups
   - Reuse directly
   - Use for severity, issue type, source, and age
3. Progress or status message bar
   - Reuse directly
   - Use for incident-level banners
4. Sectioned option panels
   - Reinterpret
   - Use for grouped issue categories or severity sections

Issues adaptation:

1. treat issues like a triage queue rather than a settings page
2. use strong row scanning and actionability

## Cross-Screen Component Mapping

### Filter Chips

Reuse level:

1. Reuse directly

Map to:

1. Dashboard quick filters
2. Sources filters
3. Runs saved views
4. Catalog filters
5. Issues filters

### Thumbnail Plus Metadata Row

Reuse level:

1. Reuse directly

Map to:

1. Catalog table rows
2. Run Detail item rows
3. Source Detail recent items
4. Issues rows when the issue relates to an item

### Queue Review List

Reuse level:

1. Reinterpret strongly

Map to:

1. Run Detail affected items
2. Issues queue
3. Publish queue later
4. Bulk review surfaces

### Sectioned Panels

Reuse level:

1. Reuse directly

Map to:

1. Source Detail
2. Run Detail
3. Item Detail
4. Dashboard modules

### Sticky CTA Pattern

Reuse level:

1. Reinterpret carefully

Map to:

1. Source-level run trigger
2. Retry actions later
3. Bulk action confirmation areas

Should not be used as:

1. a default page footer CTA across the product

### Toggle Rows

Reuse level:

1. Reinterpret minimally

Map to:

1. Settings screens
2. Source configuration only

Should not dominate:

1. Dashboard
2. Catalog
3. Runs
4. Issues

## Visual Reuse Guidance

Keep:

1. thin borders and modular framing
2. compact controls
3. disciplined section labeling
4. high scannability rows

Change:

1. reduce consumer utility vibes
2. soften the aggressive pink-orange CTA treatment
3. improve page-level hierarchy
4. create stronger distinction between operational and media contexts
5. give desktop layouts more air and structure

## Recommended Design Moves From Here

1. Use this reuse map when building the first low-fidelity screen pack
2. Start with `Runs`, `Catalog`, and `Item Detail`, where the legacy patterns are most transferable
3. Avoid using the extension as a dashboard or page-architecture template
4. Build a new desktop shell first, then insert reused component patterns inside it

## Bottom Line

The legacy extension work is most valuable as:

1. a component reference library
2. an interaction rhythm reference
3. a visual tone starting point

It should not be treated as:

1. a product architecture reference
2. a navigation reference
3. a screen-template system for AEGIS
