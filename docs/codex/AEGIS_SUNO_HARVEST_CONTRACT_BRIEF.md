# AEGIS SUNO Harvest Contract Brief

## Purpose

This brief defines the current and recommended data contract for the `SUNO Harvest` stream, based on checked-in code and existing docs only.

Shared coordination reference:

1. `AEGIS_Data_Contract_Alignment_Brief.md`

It is intentionally optimized for:

1. low-cost operational validation
2. no extra harvest runs
3. contract clarity before schema expansion

## 1. Authoritative Entities and Collections

Aligned to the shared entity model, this stream should reason about:

1. `Source`
2. `Run`
3. `Item`
4. `Export Artifact`

For the SUNO Harvest stream specifically:

1. `Item` and `Export Artifact` are currently authoritative in production.
2. `Source` and `Run` are required entities in the target model, but remain transitional in the active Python harvest path until they are written consistently by that path.

### Harvest-authoritative today

#### `sunoSongs`

Role:

1. canonical indexed item collection for the active SUNO Harvest path
2. source for the vault export generator

Current writer:

1. `yt-ingest/firestore_upsert.py`

Current consumers:

1. `yt-ingest/catalog_sync_firestore_multi.py`
2. `yt-ingest/rebuild_catalog.py`
3. vault/export consumers

#### `gs://aeonimus-suno-media/suno/handles/{handle}/{clip}.{ext}`

Role:

1. canonical preserved media store for harvested SUNO assets

Current producer:

1. `yt-ingest/download_media_gcs.py`

Current consumer:

1. `yt-ingest/firestore_upsert.py`
2. downstream export and viewer consumers through indexed references

#### `gs://aeonimus-workspaces/exports/suno/latest_catalog_wide.csv`

Role:

1. canonical vault export artifact

Current producer:

1. `yt-ingest/rebuild_catalog.py`

Current consumer:

1. `suno-viewer/server.js`

#### `gs://aeonimus-workspaces/exports/suno/latest_catalog_wide.meta.json`

Role:

1. canonical export freshness artifact

Current producer:

1. `yt-ingest/rebuild_catalog.py`

Current consumer:

1. `yt-ingest/pipeline_monitor.py`
2. future dashboard/ops surfaces

### Present but not authoritative for the active harvest path

#### `sources`

Role:

1. intended canonical source collection

Reality:

1. the older `/suno/ingest` TypeScript path writes this
2. the active Python harvest path does not currently maintain it as its source of truth
3. per the shared alignment brief, this should still be treated as the target `Source` entity for future contract cleanup

#### `runs`

Role:

1. intended canonical run collection

Reality:

1. the older `/suno/ingest` TypeScript path writes this
2. the active Python harvest path currently relies more on Cloud Run execution history, logs, and artifacts than on a canonical Firestore run writer
3. per the shared alignment brief, this should still be treated as the target `Run` entity for future contract cleanup

#### `items`

Role:

1. older unified item collection from the TypeScript ingest path

Reality:

1. not the authoritative collection for active SUNO Harvest vault freshness today

## 2. Required Fields For Source / Run / Item / Export Freshness

### Source freshness

Required minimum fields:

1. `sourceId`
2. `handle`
3. `platform`
4. `type`
5. `displayLabel`
6. `profileUrl`
7. `lastRunId`
8. `lastCrawledAt`
9. `status`
10. `freshness`

Current state:

1. these fields exist conceptually in the TypeScript `sources` writer
2. they are not yet the canonical freshness source for the active Python harvest path
3. recommendation: keep this as the minimum target `Source` contract even if current production evidence still comes from Cloud Run plus export metadata

### Run freshness

Required minimum fields:

1. `runId`
2. `pipeline`
3. `sourceId`
4. `status`
5. `startedAt`
6. `completedAt`
7. `counts`
8. `errorCount`
9. `artifactRefs`
10. `logRefs`

Current state:

1. these exist conceptually in the TypeScript `runs` writer
2. for active production, freshness is still often inferred from Cloud Run execution history plus export metadata
3. recommendation: keep this as the minimum target `Run` contract even if current validation remains inspect-first

### Item freshness

Required minimum fields in `sunoSongs`:

1. `songKey`
2. `sourceId`
3. `handle`
4. `sourcePlatform`
5. `title`
6. `createdAt`
7. `importedAt`
8. `lastSeenAt`
9. `status`
10. `media.audioUrl`
11. `media.videoUrl`
12. `media.thumbUrl`
13. `media.audioExt`
14. `gcs.audio`
15. `gcs.video`
16. `gcs.thumb`

Recommended-but-optional item fields:

1. `firstSeenAt`
2. `harvestedAt`
3. `indexedAt`
4. `tags`
5. `prompt`
6. `modelName`
7. `isInstrumental`
8. `rawTitle`
9. `rawMetadataRef`
10. `rawPayloadRef`
11. `artworkUrl`
12. `removedAt`

### Export freshness

Required minimum fields:

1. `generatedAt` in `latest_catalog_wide.meta.json`
2. `rowCount`
3. `artifact`
4. export row `lastSeenAt`
5. export row `status`

Freshness rule:

1. export freshness should be read primarily from `latest_catalog_wide.meta.json`
2. export row `runId` is row-level rebuild context, not the authoritative export-health signal

## 3. Field Ownership

### Source-owned by harvest source discovery

1. `sourceId`
2. `handle`
3. source freshness fields
4. `type`
5. `displayLabel`
6. `profileUrl`

### Item-owned by media-indexing path

Owned by `firestore_upsert.py`:

1. `songKey`
2. `sourceId`
3. `handle`
4. `sourcePlatform`
5. `title`
6. `createdAt`
7. `importedAt`
8. `lastSeenAt`
9. `status`
10. `media.*`
11. `gcs.*`
12. `firstSeenAt`
13. `harvestedAt`
14. `indexedAt`
15. `tags`
16. `prompt`
17. `modelName`
18. `isInstrumental`
19. `rawTitle`
20. `rawMetadataRef`
21. `rawPayloadRef`
22. `artworkUrl`

Owned by delta comparison / lifecycle logic:

1. `removedAt`
2. `status=removed_from_suno`
3. `lastSeenAt` should be harvest-owned, though current write ownership is not fully unified
4. `isRemoved`

### Export-owned by rebuild path

Owned by `rebuild_catalog.py`:

1. export row `runId`
2. `latest_catalog_wide.csv`
3. `latest_catalog_wide.meta.json`
4. `generatedAt`
5. `rowCount`
6. export alias fields for vault consumption

Validation path:

1. `yt-ingest/validate_suno_export_contract.py`
2. `yt-ingest/fixtures/suno_export_contract_fixture.json`

Use this path for cheap local validation of export mapping before any runtime harvest checks.

### Shared boundary alignment

Aligned to `AEGIS_Data_Contract_Alignment_Brief.md`:

1. harvest owns item media truth and export production
2. harvest does not own queue lifecycle
3. harvest does not own downstream YouTube result semantics
4. export artifacts are first-class contract objects, not just byproducts
5. `media.*` is canonical source/media truth
6. `gcs.*` is canonical only for harvest-managed storage presence and storage-backed completeness semantics

### Not harvest-owned

These fields exist in the export or item shape but are downstream-owned:

1. `ytStatus`
2. `ytVideoId`
3. `ytCanonicalUrl`
4. `ytPublishedAt`

## 4. Producer -> Consumer Boundaries

### Producer chain

1. `catalog_sync_firestore_multi.py`
   - produces delta manifest and removed-item updates
2. `download_media_gcs.py`
   - produces media in GCS
3. `firestore_upsert.py`
   - produces canonical `sunoSongs` item records
4. `rebuild_catalog.py`
   - produces export CSV and export meta
5. `pipeline_monitor.py`
   - produces freshness/alert interpretation

### Consumer chain

1. `catalog_sync_firestore_multi.py`
   - consumes `sunoSongs` and GCS presence to decide delta
2. `rebuild_catalog.py`
   - consumes `sunoSongs` to generate vault export
3. `suno-viewer/server.js`
   - consumes `latest_catalog_wide.csv`
4. `pipeline_monitor.py`
   - consumes `latest_catalog_wide.meta.json`

### Boundary rule

The active harvest path should treat:

1. GCS media as preservation truth
2. `sunoSongs` as indexed item truth
3. export meta as freshness truth

And, per the shared alignment brief:

4. queue state must remain outside this stream
5. downstream YouTube writeback fields may exist on item records, but they do not redefine harvest ownership

## 5. Known Drift / Ambiguity

### Drift 1: dual source/run models

The older `/suno/ingest` TypeScript path writes:

1. `sources`
2. `runs`
3. `items`

But the active Python harvest path that keeps the vault fresh is centered on:

1. `sunoSongs`
2. GCS media
3. export artifacts

This means source/run freshness is not yet cleanly unified under one active collection contract.

### Drift 2: top-level versus nested media fields

`firestore_upsert.py` writes canonical nested fields:

1. `media.audioUrl`
2. `media.videoUrl`
3. `media.thumbUrl`
4. `gcs.audio`
5. `gcs.video`
6. `gcs.thumb`

But `catalog_sync_firestore_multi.py` still queries some top-level aliases like:

1. `audioUrl`
2. `videoUrl`
3. `thumbUrl`

and `rebuild_catalog.py` emits export aliases like:

1. `gcs_mp3`
2. `gcs_mp4`
3. `gcs_thumb`

The contract is working, but naming authority is still mixed.

Clarification:

1. top-level `audioUrl`
2. top-level `videoUrl`
3. top-level `thumbUrl`

should be treated as compatibility aliases only, never as the canonical item truth.

Clarification:

1. export aliases such as `gcs_mp3`, `gcs_mp4`, `gcs_thumb`, `gcs_latest_*`, and `account_*` are valid export/view-model fields
2. they should not be treated as harvest-owned item truth

### Drift 3: source freshness is not first-class in the active path

The active Python harvest path tracks handles in code, not in a fully authoritative `sources` contract used by the job itself.

### Drift 4: export row context versus export health

The export row `runId` can look like freshness truth, but the authoritative export-health signal is actually:

1. `latest_catalog_wide.meta.json.generatedAt`

### Drift 5: downstream YouTube fields live in harvest-facing item/export shapes

`ytStatus` and related fields exist in the export shape but are not harvest-owned, which can blur ownership boundaries.

## 6. Minimum Contract Changes Recommended

### Change 1

Declare the active SUNO Harvest contract authoritative around:

1. GCS media
2. `sunoSongs`
3. export CSV
4. export meta

Treat `sources` and `runs` as transitional for this stream until the active Python path writes them consistently, but keep them as the target `Source` and `Run` contract entities.

### Change 2

Make nested item fields canonical for harvest-owned item truth:

1. `media.*`
2. `gcs.*`

Treat top-level media aliases as compatibility or export-only fields.

Clarification:

1. `media.*` is canonical source/media truth
2. `gcs.*` is canonical only for harvest-managed storage presence and storage-backed completeness semantics

### Change 3

Make export freshness authoritative from:

1. `latest_catalog_wide.meta.json.generatedAt`

not from row `runId` alone.

### Change 4

Define a minimal harvest-owned item contract:

1. `songKey`
2. `sourceId`
3. `handle`
4. `sourcePlatform`
5. `title`
6. `createdAt`
7. `importedAt`
8. `lastSeenAt`
9. `status`
10. `media.audioUrl`
11. `media.videoUrl`
12. `media.thumbUrl`
13. `media.audioExt`
14. `gcs.audio`
15. `gcs.video`
16. `gcs.thumb`

Retain when cheaply available:

1. `firstSeenAt`
2. `harvestedAt`
3. `indexedAt`
4. `rawTitle`
5. `rawMetadataRef`
6. `rawPayloadRef`
7. `artworkUrl`

### Change 5

Separate harvest-owned lifecycle from downstream publishing state explicitly:

1. keep `status` harvest-owned
2. treat `yt*` fields as downstream-owned extensions

### Change 6

Preserve the producer -> consumer boundary defined in the shared alignment brief:

1. `firestore_upsert.py` produces harvest-owned item truth
2. `rebuild_catalog.py` produces export truth
3. queue and uploader consumers may read item truth, but must not redefine it
4. raw/source-derived fields should be retained only with provenance-explicit names or references

### Change 7

Promote minimal source/run freshness contracts, but do not require expensive runs to validate them first.

Use:

1. current live config
2. current Cloud Run execution evidence
3. export metadata
4. existing job logs

before making source/run schema expansion decisions.

## Immediate Recommendation

Approve the following minimum contract decisions first:

1. `sunoSongs` is the active harvest-owned item authority
2. nested `media.*` is the canonical source/media truth
3. nested `gcs.*` is canonical only for harvest-managed storage presence and storage-backed completeness semantics
4. top-level media fields are compatibility aliases only
5. `lastSeenAt` is required harvest-owned freshness
6. export freshness is owned by `latest_catalog_wide.meta.json.generatedAt`
7. `sources` and `runs` remain transitional until the active Python path writes them directly
8. `yt*` fields are not harvest-owned

Once those five are approved, the next low-risk move is to draft the target `sunoSongs` schema and export schema without triggering any new harvest runs.
