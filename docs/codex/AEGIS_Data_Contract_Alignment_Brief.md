# AEGIS Data Contract Alignment Brief

## Purpose

This document defines the high-level contract boundaries across the two active delivery streams:

1. `SUNO Harvest`
2. `Vault to YouTube`

The goal is to keep harvest, vault, queue, and uploader work aligned on:

1. authoritative entities
2. field ownership
3. producer -> consumer boundaries
4. minimum required fields
5. known drift that should be eliminated

It is not a full schema spec. It is the coordination brief for product, engineering, and agent execution.

## Product Layer Model

AEGIS should now treat the system as five hard ownership layers:

1. `Creation Layer`
2. `Asset Layer`
3. `Distribution Layer`
4. `Interaction Layer`
5. `Operations Layer`

These layers sit on top of the existing engineering entities and define field ownership.

### Layer-to-entity mapping

1. `Creation Layer`
   - primary authority: `sunoSongs`
   - owns the source-exposed building blocks that explain how a song was made
2. `Asset Layer`
   - primary authority: `sunoSongs` plus storage/export artifacts
   - owns media files and portable derivatives
3. `Distribution Layer`
   - primary authority: `ytUploadQueue`
   - owns publish workflow and destination state
4. `Interaction Layer`
   - primary authority: future engagement collection keyed by `songKey`
   - owns audience response and performance history
5. `Operations Layer`
   - primary authority: `Source`, `Run`, and `Export Artifact`
   - owns evidence, health, and freshness

### Song truth rule

Every song should be modeled as a compound record with four user-facing planes:

1. `creation`
2. `assets`
3. `distribution`
4. `interaction`

The Vault is the source of truth for the combined view, but the fields inside that view must keep their original ownership boundaries.

## Operating Constraint

Harvest execution is expensive.

SUNO harvest runs consume real Google Cloud resources and take significant time. Any contract work should prefer:

1. read-first validation
2. dry-run or static inspection
3. schema clarification before runtime experiments
4. avoiding unnecessary Cloud Run executions

## Core Entity Model

AEGIS should treat these as the primary entities:

1. `Source`
2. `Run`
3. `Item`
4. `Queue Item`
5. `Export Artifact`

### Entity roles

`Source`

1. Defines where content comes from
2. Owns source identity and freshness context

`Run`

1. Represents one ingest or processing execution
2. Owns operational state and evidence

`Item`

1. Represents one cataloged SUNO song or media asset
2. Lives primarily in Firestore `sunoSongs`

`Queue Item`

1. Represents one publishing work item for YouTube
2. Must be separate from catalog item records
3. Lives in Firestore `ytUploadQueue`

`Export Artifact`

1. Represents the viewer-facing published catalog output
2. Lives as generated files in `gs://aeonimus-workspaces/exports/suno/`

## Authoritative Collections and Artifacts

### SUNO Harvest stream

1. `sunoSongs`
   - authoritative indexed item store for vault/export consumption
2. `latest_catalog_wide.csv`
   - authoritative viewer export artifact
3. `latest_catalog_wide.meta.json`
   - authoritative export freshness metadata

### Vault to YouTube stream

1. `ytUploadQueue`
   - authoritative publishing queue collection
2. `sunoSongs`
   - upstream item source for publishable media and item metadata

## Contract 1: Harvest -> Item Index

### Producer

`firestore_upsert.py`

### Consumer

1. `rebuild_catalog.py`
2. vault UI
3. queue creation path
4. uploader

### Minimum required item fields

1. `songKey`
2. `sourceId`
3. `handle`
4. `sourcePlatform`
5. `title`
6. `status`
7. `createdAt`
8. `importedAt`
9. `lastSeenAt`
10. `media.audioUrl`
11. `media.videoUrl`
12. `media.thumbUrl`
13. `media.audioExt`
14. `gcs.audio`
15. `gcs.video`
16. `gcs.thumb`

### Recommended supporting item fields

1. `tags`
2. `prompt`
3. `modelName`
4. `isInstrumental`
5. `firstSeenAt`
6. `harvestedAt`
7. `indexedAt`
8. `rawTitle`
9. `rawMetadataRef`
10. `rawPayloadRef`
11. `artworkUrl`
12. `ytStatus`
13. `ytVideoId`
14. `ytCanonicalUrl`
15. `ytPublishedAt`
16. `lyrics`
17. `lyricsStatus`
18. `lyricsSource`
19. `lyricsRetrievedAt`
20. `displayTags`
21. `description`
22. `caption`
23. `negativePrompt`
24. `explicit`
25. `modelMajorVersion`
26. `gcsLyricsTxt`
27. `gcsLyricsJson`
28. future `gcsLyricsVtt`
29. normalized `styles`
30. optional `styleText`

### Ownership

1. Harvest/indexing owns Creation Layer and Asset Layer truth on the item
2. Catalog export reads but should not redefine Creation Layer or Asset Layer ownership
3. Publish flow may write mirrored Distribution Layer fields back to the item record, but should not overwrite harvest-owned fields
4. Nested `media.*` and `gcs.*` are canonical; top-level media aliases should be treated as compatibility fields only
5. `media.*` is canonical source/media truth
6. `gcs.*` is canonical only for harvest-managed storage presence and storage-backed completeness/location semantics, never as a substitute for `media.*`
7. Raw/source-derived fields such as `prompt`, `tags`, and `displayTags` should be retained with provenance even after normalization work
8. Normalized UX/search fields such as `styles` and `styleText` should be derived from raw creation data, not replace it

## Contract 2: Item Index -> Catalog Export

### Producer

`rebuild_catalog.py`

### Consumer

1. `suno-viewer/server.js`
2. public vault UI
3. operators checking freshness

### Minimum export guarantees

1. export contains latest indexed items from `sunoSongs`
2. export includes item identity, source context, media references, and status
3. export metadata includes generation timestamp and row count

### Critical contract rule

The vault must distinguish:

1. item freshness
2. export freshness

These are not the same thing.

## Contract 3: Vault -> Queue

### Producer

Vault UI and queue endpoint

### Consumer

`ytUploadQueue`

### Minimum queue fields

1. `songKey`
2. `status`
3. `createdAt`
4. `retryCount`

### Recommended queue fields

1. `queuedAt`
2. `startedAt`
3. `uploadedAt`
4. `ytVideoId`
5. `errorMsg`
6. `requestedFrom`
7. `gcsVideoUrl`
8. `ytDescription`
9. `ytPrivacy`
10. `ytLanguage`
11. `ytLicense`
12. `ytCategory`
13. `ytAlteredContent`
14. `ytShortsRemixing`

### Contract rule

Queue records must never overload or replace item records in `sunoSongs`.

Queue state belongs to the queue collection, not the catalog record.
`queuedAt` should be treated as queue-endpoint-owned at creation.
For the live viewer path, `queued` should be treated as the canonical initial queue status.
`new` should be treated as legacy/internal only unless a second producer is explicitly retained.

## Contract 4: Interaction -> Vault / Analytics

### Producer

Future interaction sync path

### Consumer

1. vault UI
2. analytics and ranking surfaces
3. reporting or scorecard views later

### Planned interaction shell

1. `songKey`
2. `platform`
3. `destinationId`
4. `publishedTo`
5. `viewCount`
6. `playCount`
7. `uniqueListeners`
8. `commentCount`
9. `likeCount`
10. `shareCount`
11. `lastEngagementSyncAt`

### Contract rule

Interaction metrics must not be stored as harvest-owned item truth.

The first implementation wave should define this shell without requiring live metrics ingestion.

## Contract 5: Queue -> Uploader

### Producer

`queue_manager.py`

### Consumer

`youtube_uploader.py`

### Required inputs

1. `songKey`
2. queue `status`
3. retry metadata

### Uploader lookup contract

The uploader should resolve media from:

1. `sunoSongs.media.videoUrl` first
2. explicit `gs://` parsing
3. only documented legacy fallback paths if canonical media fields are absent

### Required result fields back to system

On queue item:

1. `status`
2. `ytVideoId`
3. `uploadedAt`
4. `errorMsg`
5. `retryCount`

On item record when appropriate:

1. `ytStatus`
2. `ytVideoId`
3. `ytCanonicalUrl`
4. `ytPublishedAt`
5. `ytStartedAt`
6. `ytUploadedAt`
7. `ytError`
8. `ytErrorAt`

## Known Contract Drift

### Drift 1

Export freshness and item freshness are often conflated.

### Drift 2

Queue state and item state are close enough conceptually that they can be accidentally overloaded.

### Drift 3

Legacy paths still imply older GCS location assumptions such as `gcsPath`, while newer indexing writes canonical `media.videoUrl`.

### Drift 4

Some operational visibility still depends on bucket inspection or script knowledge rather than surfaced metadata.

### Drift 5

`Source` and `Run` are still transitional as consistently written authoritative objects in the active Python harvest path.

## Minimum Contract Decisions To Lock

### Lock now

1. `sunoSongs` is the authoritative item index
2. `ytUploadQueue` is the authoritative publishing queue
3. `rebuild_catalog.py` is the authoritative catalog export generator
4. `latest_catalog_wide.meta.json` is the authoritative export freshness artifact
5. `media.videoUrl` is the canonical uploader media input
6. `gcsVideoUrl` is mirrored-only and never canonical media authority

### Clarify next

1. what exact field set the vault uses for publish readiness
2. what exact field set the dashboard/issues model uses for freshness and failure
3. whether queue state should be partially mirrored into the export for read-only vault visibility

## Recommended Immediate Follow-Up

### SUNO Harvest stream

1. lock and document harvest -> rebuild -> export ownership
2. surface export freshness without bucket inspection
3. formalize partial-harvest and failed-rebuild states

### Vault to YouTube stream

1. lock queue lifecycle and uploader contract
2. validate vault -> queue -> uploader boundaries end to end
3. surface queue and upload state in the UI without blurring item and queue ownership
