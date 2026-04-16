# AEGIS SUNO Harvest Data Formalization Plan

## Purpose

This document narrows the `SUNO Harvest` stream to the specific work required to formalize and finalize the data harvested from SUNO before additional database and harvest-file buildout continues.

The intent is to answer one question first:

`What exact SUNO data contract does AEGIS harvest, preserve, index, and export?`

Once that contract is stable, the next step is to build or refine:

1. the database shape
2. the Firestore write model
3. the harvest manifest and indexing files
4. the export validation rules

This plan is deliberately biased toward:

1. inspect-first work
2. low-run-count validation
3. formalizing data from current production truth
4. avoiding expensive exploratory harvest runs

## Scope

This plan covers:

1. source identity fields
2. clip identity fields
3. media location fields
4. metadata fields harvested from SUNO
5. lifecycle/status fields
6. export-required fields
7. field authority and lineage

This plan does not cover:

1. YouTube queue schema
2. uploader contract beyond shared field references
3. downloader packaging/export tracks

## Current Production Truth

Based on the current checked-in and live-confirmed path:

1. `catalog_sync_firestore_multi.py` is the active delta and source-comparison stage.
2. `download_media_gcs.py` is the active media capture stage.
3. `firestore_upsert.py` writes or merges `sunoSongs` documents after successful media upload.
4. `rebuild_catalog.py` is the authoritative viewer export generator.
5. `pipeline_monitor.py` checks export freshness and queue state after harvest.

That means the current effective SUNO harvest data path is:

1. public SUNO profile discovery
2. delta manifest generation
3. media capture into GCS
4. Firestore indexing into `sunoSongs`
5. CSV export generation from `sunoSongs`

## Data Domains That Must Be Formalized First

### 1. Source Identity

Fields that identify where a harvested item came from:

1. `sourceId`
2. `handle`
3. `account_sourceId`
4. `account_handle`
5. `account_label`

Questions to settle:

1. Which field is canonical in Firestore?
2. Which fields are export aliases only?
3. How should source identity be represented across `sunoSongs`, `sources`, and export rows?

### 2. Clip Identity

Fields that identify a unique SUNO item:

1. `songKey`
2. clip UUID from SUNO
3. document ID in `sunoSongs`

Questions to settle:

1. Is `songKey` always the clip UUID?
2. Is the Firestore document ID always the same value?
3. What normalization rule applies if the upstream format changes?

### 3. Media Location Contract

Fields describing where media exists and what is current:

1. `media.audioUrl`
2. `media.videoUrl`
3. `media.thumbUrl`
4. `media.audioExt`
5. `gcs.audio`
6. `gcs.video`
7. `gcs.thumb`
8. `gcs_mp3`
9. `gcs_mp4`
10. `gcs_thumb`
11. `gcs_latest_audio`
12. `gcs_latest_mp4`
13. `gcs_latest_thumb`

Questions to settle:

1. Which fields are canonical write fields?
2. Which are convenience/export fields only?
3. How should current versus historical object references be represented?
4. What is the required minimum media contract for a valid indexed SUNO item?

### 4. Harvested Metadata Contract

Fields currently harvested or inferred:

1. `title`
2. `createdAt`
3. `updatedAt`
4. `importedAt`
5. `lastSeenAt`
6. `tags`
7. `prompt`
8. `modelName`
9. `isInstrumental`
10. `views`
11. `likes`
12. `commentsCount`
13. `remixCount`
14. `duration`

Questions to settle:

1. Which are source-truth fields from SUNO?
2. Which are pipeline-generated timestamps?
3. Which are optional and should never block indexing?
4. Which fields are required for export completeness?

### 5. Lifecycle and Status Contract

Fields currently involved:

1. `status`
2. `removedAt`
3. `ytStatus`
4. `ytVideoId`
5. `ytCanonicalUrl`
6. `ytPublishedAt`

Questions to settle:

1. Which statuses belong to SUNO lifecycle only?
2. Which statuses belong to downstream publishing only?
3. What should be modeled in `sunoSongs` versus a separate issue or queue layer?

### 6. Export Contract

Fields required by `rebuild_catalog.py` and the vault:

1. identity fields
2. title and timestamps
3. media pointers
4. status
5. downstream YouTube state where present

Questions to settle:

1. What is the canonical export schema?
2. Which missing fields should fail export validation?
3. Which missing fields should only degrade the row?

## Priority Epic Cut

The harvest-data formalization work should start with these epics and ticket groups:

### Tier 1: Must finalize first

1. `EPIC 4: Rationalize the SUNO Ingest Path`
2. `EPIC 6: Formalize the Catalog Export Pipeline`
3. `EPIC 11: Define Status Taxonomy and Operational UI Model`

### Tier 2: Immediate follow-on

1. `EPIC 1: Confirm Authoritative Production Paths`
2. `EPIC 9: Automate Post-Harvest Catalog Rebuild`
3. `EPIC 13: Establish Monitoring and Operational Visibility`

## Exact Harvest-Data Tickets To Start With

These are the first tickets I would execute in order.

### Ticket 1

`Define canonical SUNO item schema for sunoSongs`

Deliverables:

1. canonical field list for `sunoSongs`
2. required vs optional fields
3. canonical names vs aliases
4. field ownership notes

Primary files:

1. `yt-ingest/firestore_upsert.py`
2. `yt-ingest/catalog_sync_firestore_multi.py`
3. `yt-ingest/rebuild_catalog.py`

### Ticket 2

`Define canonical SUNO media contract`

Deliverables:

1. canonical GCS and media fields
2. required media minimum for valid indexing
3. rules for `gcs_*` versus nested `media` and `gcs` fields
4. treatment of zero-byte and missing assets

Primary files:

1. `yt-ingest/firestore_upsert.py`
2. `yt-ingest/download_media_gcs.py`
3. `yt-ingest/rebuild_catalog.py`

### Ticket 3

`Define canonical harvest timestamp and lineage model`

Deliverables:

1. meanings of `createdAt`, `updatedAt`, `importedAt`, and `lastSeenAt`
2. which timestamps are SUNO-derived versus pipeline-derived
3. export freshness relationship to item freshness

Primary files:

1. `yt-ingest/firestore_upsert.py`
2. `yt-ingest/rebuild_catalog.py`
3. `yt-ingest/pipeline_monitor.py`

### Ticket 4

`Define SUNO lifecycle and status contract`

Deliverables:

1. valid `status` values for harvest-owned lifecycle
2. rules for `removed_from_suno`
3. separation between harvest status and downstream YouTube status
4. issue mapping guidance for stale, incomplete, and removed records

Primary files:

1. `yt-ingest/catalog_sync_firestore_multi.py`
2. `yt-ingest/firestore_upsert.py`
3. `yt-ingest/rebuild_catalog.py`

### Ticket 5

`Define canonical catalog export schema from sunoSongs`

Deliverables:

1. approved export field list
2. required field validation rules
3. degraded-but-allowed field rules
4. row completeness checks

Primary files:

1. `yt-ingest/rebuild_catalog.py`
2. `suno-viewer/server.js`
3. vault UI field consumers

## Recommended Working Order

### Pass 1: Data contract decisions

1. SUNO item schema
2. media contract
3. timestamp and lineage model
4. lifecycle/status model
5. export schema

### Pass 2: Database and harvest file implementation

Once the above five are approved:

1. update Firestore write shape
2. update harvest manifest field contract
3. update export generator and validations
4. add documentation for canonical field usage

### Pass 3: Monitoring and UI dependencies

After the schema is stable:

1. export freshness visibility
2. issue derivation rules
3. dashboard and item-detail field mapping

## Build-Next Rule

Do not expand the SUNO Harvest database or harvest-file surface further until these five ticket groups are settled.

That keeps the project from:

1. hardening duplicate field shapes
2. mixing source-truth and pipeline-truth data
3. overloading status fields
4. making the export contract harder to clean up later

## Immediate Recommendation

Start by approving the first five harvest-data tickets as the active planning cut.

Once those are approved, the next phase is:

1. design the final `sunoSongs` schema
2. map it to export schema
3. update the harvest and indexing files to match
