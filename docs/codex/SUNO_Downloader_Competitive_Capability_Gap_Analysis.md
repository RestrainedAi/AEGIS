# SUNO Downloader Competitive Capability Gap Analysis

## Product

AEGIS: SUNO YouTube Pipeline

## Purpose

This document compares the downloader capabilities shown in the competitor screenshots against the current observed AEGIS repository. The goal is to identify which capabilities already exist, which exist only in backend form, and which still need product and engineering work.

## Scope

The screenshots appear to show a browser-extension-style SUNO downloader with:

1. workspace selection
2. content filtering
3. exclusion rules
4. file type and packaging options
5. metadata embedding
6. output organization controls
7. queue speed controls
8. history import and export
9. queue review before download
10. scan and batch download execution

This analysis compares those capabilities against the current repo as observed in:

1. `yt-ingest/`
2. `suno-viewer/`
3. the Python harvest pipeline
4. the current product and workflow docs in `docs/codex/`

## Summary Assessment

High-level conclusion:

1. AEGIS already has a strong backend pipeline for discovery, delta detection, media capture, metadata indexing, catalog export, and queue-oriented downstream processing.
2. AEGIS does not currently expose most downloader controls as a user-facing downloader product.
3. The biggest gap is not raw download capability. The biggest gap is user-controlled download workflow and packaging UX.
4. The competitor product is downloader-first. AEGIS is currently pipeline-first.

That means we should not assume parity just because the backend can already fetch media.

## Capability Matrix

### 1. Workspace Selection

Competitor capability:

1. choose from multiple workspaces
2. show counts by workspace
3. scan all or scan one workspace

AEGIS current state:

1. partial concept support in source and account organization
2. viewer has account-level filtering
3. backend supports source and handle segmentation
4. no explicit user-facing workspace selector was confirmed

Assessment:

- Backend support: partial
- UI support: partial
- Product parity: not achieved

Gap:

AEGIS needs a first-class concept for user-selectable workspaces, collections, or source groups if this is required for downloader parity.

Priority:

`P1`

### 2. Content Type Filters

Competitor capability:

1. filter liked
2. filter published
3. filter remasters
4. filter stems
5. filter uploads

AEGIS current state:

1. catalog filtering exists at a basic level in `suno-viewer/src/components/VaultGrid.tsx`
2. the current viewer supports search, account filtering, sort, and removed-content visibility
3. no confirmed user-facing filters for liked, published, remasters, stems, or uploads
4. backend metadata may contain some of these distinctions, but they are not exposed as a mature filter model

Assessment:

- Backend support: unclear to partial
- UI support: missing
- Product parity: not achieved

Gap:

AEGIS needs a normalized content classification model for download-relevant content types if these filters matter to target users.

Priority:

`P1`

### 3. Exclusion Rules

Competitor capability:

1. exclude covers
2. exclude remasters
3. exclude stems
4. exclude uploads

AEGIS current state:

1. removed-content filtering exists
2. no explicit user-configurable exclusion rule system was confirmed
3. exclusion logic is not exposed as a downloader control layer

Assessment:

- Backend support: limited
- UI support: missing
- Product parity: not achieved

Gap:

AEGIS needs a reusable include/exclude filter model that can be applied before queue generation or batch download.

Priority:

`P1`

### 4. File Type Selection

Competitor capability:

1. choose MP3
2. choose WAV
3. choose Cover
4. choose JSON
5. choose TXT

AEGIS current state:

1. backend definitely handles media and metadata artifacts
2. current SUNO pipeline clearly supports audio, image, and metadata storage
3. text and transcript artifacts exist in the platform
4. no current user-facing download UI for selecting output asset types was confirmed
5. WAV support specifically is not clearly established from the current observed production path

Assessment:

- Backend support: partial to strong, depending on file type
- UI support: missing
- Product parity: not achieved

Gap:

AEGIS needs:

1. a canonical asset selection model
2. a clear statement of which file outputs are supported
3. packaging rules for mixed-asset download bundles

Priority:

`P0`

### 5. Download Mode / Packaging Mode

Competitor capability:

1. simple
2. producer
3. backup

AEGIS current state:

1. no equivalent user-facing packaging presets were confirmed
2. backend architecture could support packaging variants, but they are not productized

Assessment:

- Backend support: possible but not formalized
- UI support: missing
- Product parity: not achieved

Gap:

AEGIS needs preset-based packaging definitions if we want a downloader product instead of raw artifact retrieval.

Priority:

`P1`

### 6. Embed Lyrics

Competitor capability:

1. embed lyrics into MP3 and WAV tags

AEGIS current state:

1. text fields such as lyrics or prompts exist in parts of the data model
2. transcript and text enrichment exist in the platform
3. no evidence of audio tag writing or embedded-lyrics export was confirmed

Assessment:

- Backend support: partial data availability
- UI support: missing
- Product parity: not achieved

Gap:

AEGIS needs explicit media post-processing for metadata tag writing.

Priority:

`P2`

### 7. Embed Cover Art

Competitor capability:

1. embed cover art into audio files

AEGIS current state:

1. cover and thumbnail assets are clearly stored or referenced
2. no evidence of embedded cover art processing into output files was confirmed

Assessment:

- Backend support: partial data availability
- UI support: missing
- Product parity: not achieved

Gap:

AEGIS needs audio packaging logic that can write artwork into the exported file.

Priority:

`P2`

### 8. Output Folder Naming

Competitor capability:

1. choose output folder name
2. preview resulting path

AEGIS current state:

1. GCS storage paths are structured
2. local folder naming and user-visible export destination management were not confirmed as a product feature
3. current system is cloud-pipeline oriented, not end-user desktop downloader oriented

Assessment:

- Backend support: no user-facing support
- UI support: missing
- Product parity: not achieved

Gap:

AEGIS needs explicit local export destination and packaging path rules if a direct downloader experience is required.

Priority:

`P1`

### 9. Organization Options

Competitor capability:

1. group by workspace
2. create song folders
3. zip each song

AEGIS current state:

1. backend storage is organized by source and asset
2. no confirmed user-facing controls for packaging, grouping, foldering, or zipping

Assessment:

- Backend support: partial conceptual support
- UI support: missing
- Product parity: not achieved

Gap:

AEGIS needs export and packaging options at queue-build time and output-build time.

Priority:

`P1`

### 10. Queue Strategy / Throttling

Competitor capability:

1. adjust queue speed
2. safer versus faster scan strategy

AEGIS current state:

1. backend jobs and batch workflows exist
2. throttling is an implementation concern but not a user-facing capability
3. no user-controlled queue speed setting was confirmed

Assessment:

- Backend support: likely internal only
- UI support: missing
- Product parity: not achieved

Gap:

AEGIS needs configurable scan or queue profiles if the runtime behavior should be user-tunable.

Priority:

`P2`

### 11. History and Data Controls

Competitor capability:

1. skip history
2. export history
3. import history
4. clear history

AEGIS current state:

1. operational run history exists
2. item and queue history exist conceptually in Firestore and logs
3. no downloader-style user history import/export/clear controls were confirmed

Assessment:

- Backend support: operationally yes
- UI support: missing
- Product parity: not achieved

Gap:

AEGIS needs a user-facing download history model if this is part of the intended downloader product.

Priority:

`P2`

### 12. Queue Review Screen

Competitor capability:

1. review the batch before download
2. search within the queue
3. select all / none
4. multi-select
5. adjust what will be downloaded before starting

AEGIS current state:

1. viewer supports browsing and searching catalog items
2. there is no confirmed pre-download queue review workflow
3. there is no confirmed batch selection UX for downloader packaging

Assessment:

- Backend support: partial
- UI support: missing
- Product parity: not achieved

Gap:

AEGIS needs a dedicated review-queue step between discovery/filtering and execution.

Priority:

`P0`

### 13. Batch Scan and Download Execution

Competitor capability:

1. scan library
2. review queue
3. start download
4. show estimated disk space

AEGIS current state:

1. batch harvest and batch artifact generation exist operationally
2. user-triggered scan and user-triggered download workflow are not currently productized
3. disk estimate was not confirmed anywhere in the current product

Assessment:

- Backend support: strong for batch processing
- UI support: missing
- Product parity: not achieved

Gap:

AEGIS needs a true downloader execution flow, not only a backend harvest system.

Priority:

`P0`

### 14. Compliance Acknowledgement / Terms Check

Competitor capability:

1. user acceptance checkbox before execution

AEGIS current state:

1. no equivalent downloader UX safeguard was confirmed

Assessment:

- Backend support: not needed
- UI support: missing
- Product parity: not achieved

Gap:

If the product is intended for direct-user download execution, legal and policy acknowledgment should be added.

Priority:

`P2`

## What AEGIS Already Does Well

Compared with the competitor screenshots, AEGIS is stronger in:

1. cloud-oriented ingest and media preservation
2. delta detection and incremental sync
3. Firestore-backed metadata indexing
4. catalog export and viewer separation
5. downstream YouTube publishing architecture

This means AEGIS has stronger operational pipeline foundations than the competitor-style extension UI suggests.

## Where AEGIS Is Clearly Behind

AEGIS is behind in downloader-product capabilities that a user can control directly:

1. filter-to-queue workflow
2. output packaging presets
3. file-type selection UI
4. organization and zip controls
5. queue review before execution
6. local-download-oriented history management
7. metadata embedding options

## Recommended Capability Tiers

### Tier 1: Must-Have for Competitive Downloader Parity

1. file type selection
2. queue review screen
3. batch scan and download execution flow
4. include and exclude filters
5. packaging and organization options

### Tier 2: Strong Differentiators for Professional Users

1. workspace or source-group selection
2. packaging presets like Simple, Producer, Backup
3. export path preview
4. history management
5. upload-ready or publish-ready queueing after download preparation

### Tier 3: Nice-to-Have Polishing

1. embed lyrics into audio tags
2. embed cover art into audio tags
3. queue speed tuning
4. terms acknowledgment UX
5. disk usage estimate

## Product Recommendation

Do not treat this as a request to copy a browser extension screen-for-screen.

Instead, add a downloader product layer to AEGIS built on top of the existing pipeline strengths:

1. source and workspace selection
2. include and exclude filtering
3. asset-type selection
4. packaging preset selection
5. queue review and edit
6. execution and packaging
7. optional downstream publish handoff

That would give AEGIS both:

1. stronger backend operations than the competitor
2. comparable downloader usability

## Recommended New Epics

### EPIC D1: Downloader Filter and Selection Model

Scope:

1. workspace selection
2. content-type filters
3. exclusion rules
4. queue candidate generation

### EPIC D2: Downloader Packaging and Export Options

Scope:

1. file type selection
2. packaging presets
3. foldering and zip options
4. local export path model

### EPIC D3: Downloader Queue Review UX

Scope:

1. review queue screen
2. search within queue
3. select all / select none
4. multi-select and remove
5. execution confirmation

### EPIC D4: Metadata Embedding and Export Enrichment

Scope:

1. embed lyrics
2. embed cover art
3. JSON and TXT sidecar output
4. metadata validation

### EPIC D5: Downloader Execution Controls and History

Scope:

1. scan execution
2. queue strategy profiles
3. history import/export/clear
4. freshness and completion reporting

## Recommended Immediate Next Step

If downloader parity is a priority, add these new downloader epics to the planning set before broad UI implementation begins. The first product decision to make is:

Should AEGIS support:

1. cloud-pipeline-first operations only, or
2. a true end-user downloader workflow with packaging and local export controls

The competitor screenshots point clearly to option 2.
