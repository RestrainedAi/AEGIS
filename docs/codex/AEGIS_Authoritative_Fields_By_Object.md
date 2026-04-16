# AEGIS Authoritative Fields By Object

## Purpose

This document is the quick-reference version of the AEGIS contract model.

Use it when deciding:

1. which object owns a field
2. which system writes it
3. which downstream surfaces may read it
4. which fields should never be overloaded or duplicated casually

Objects covered:

1. `Source`
2. `Run`
3. `Item`
4. `Queue Item`
5. `Interaction Record`
6. `Export Artifact`

## Layer Model

AEGIS should now use two views of the same system:

1. engineering entities
2. product layers

The product layers are:

1. `Creation Layer`
2. `Asset Layer`
3. `Distribution Layer`
4. `Interaction Layer`
5. `Operations Layer`

These are hard ownership boundaries, not just UI lenses.

### Canonical layer mapping

| Layer | Primary authority | Purpose |
| --- | --- | --- |
| `Creation Layer` | `sunoSongs` | preserves what made the song and the raw Suno building blocks |
| `Asset Layer` | `sunoSongs` plus storage/export artifacts | preserves media files and portable derivatives |
| `Distribution Layer` | `ytUploadQueue` plus mirrored publish outcome on `sunoSongs` | preserves where the song went and publish lifecycle |
| `Interaction Layer` | future engagement collection keyed by `songKey` | preserves audience response and performance history |
| `Operations Layer` | `Source`, `Run`, `Export Artifact` | preserves health, evidence, freshness, and diagnostics |

### Song truth rule

Every song should be treated as a compound record with four user-facing planes:

1. `creation`
2. `assets`
3. `distribution`
4. `interaction`

The vault is the source of truth for the combined view, but ownership inside that view must stay separated.

## 1. Source

### Purpose

Represents where content comes from and how healthy or fresh that source is.

### Authoritative storage

Future-state source record model.

Today, source state may be partly computed across mixed backend paths.

### Authoritative fields

| Field | Owned by | Written by | Read by |
| --- | --- | --- | --- |
| `sourceId` | Source | source onboarding / ingest setup | dashboard, sources list, source detail, runs |
| `platform` | Source | source onboarding / config | sources list, source detail, filters |
| `type` | Source | source onboarding / config | sources list, source detail |
| `handle` or playlist identifier | Source | source onboarding / config | source detail, ingest path |
| `displayLabel` | Source | source onboarding / config | source-facing UI |
| `profileUrl` | Source | source onboarding / config | source detail, ops |
| `status` | Source | computed initially, later authoritative source model | dashboard, sources, issues |
| `lastRunId` | Source | run completion path | dashboard, source detail |
| `lastCrawledAt` | Source | ingest completion path | dashboard, source detail |
| `freshness` | Source | computed | dashboard, sources, issues |

### Notes

1. `status` and `freshness` are likely computed first, not natively stored.
2. Source state should never be inferred only from catalog export timestamps.
3. In the current Python harvest path, `Source` is still partly a target-state contract rather than a consistently written authoritative object.

## 2. Run

### Purpose

Represents one ingest, sync, rebuild, or related processing execution.

### Authoritative storage

Run collections and job execution records.

### Authoritative fields

| Field | Owned by | Written by | Read by |
| --- | --- | --- | --- |
| `runId` | Run | ingest or job trigger path | runs list, run detail, lineage |
| `pipeline` | Run | run creator | runs list, run detail |
| `sourceId` | Run | run creator | runs list, run detail, source detail |
| `status` | Run | run execution path | dashboard, runs, issues |
| `startedAt` | Run | run execution path | runs list, run detail |
| `completedAt` | Run | run completion path | runs list, run detail |
| `counts` | Run | run execution path | dashboard, runs, run detail |
| `errorCount` | Run | run execution path | dashboard, runs, issues |
| `artifact references` | Run | run execution path | run detail |
| `log references` | Run | run execution path | run detail |

### Notes

1. Run labels should be normalized for the UI even if backend run models vary.
2. Run status is not the same as source health or export freshness.

## 3. Item

### Purpose

Represents one cataloged SUNO asset that the vault can browse and that the publish flow can reference.

### Authoritative storage

Firestore `sunoSongs`

### Authoritative fields

| Field | Owned by | Written by | Read by |
| --- | --- | --- | --- |
| `creation.*` view of item truth | Creation Layer | harvest/indexing | vault, export, search |
| `assets.*` view of item truth | Asset Layer | harvest/indexing and artifact writers | vault, export, playback |
| `distribution.*` mirrored item truth | Distribution Layer | publish flow | vault UI, linkage, export where needed |
| `songKey` | Item | harvest/indexing | vault, queue, uploader, export |
| `sourceId` | Item | harvest/indexing | export, source linkage, queue |
| `sourcePlatform` | Item | harvest/indexing | export, source linkage, filters |
| `handle` | Item | harvest/indexing | vault, export, filters |
| `title` | Item | harvest/indexing | vault, export, uploader |
| `rawTitle` | Item | harvest/indexing | diagnostics, normalization review |
| `status` | Item | harvest/indexing | vault, export, issues |
| `createdAt` | Item | harvest/indexing | vault, export, sort |
| `importedAt` | Item | harvest/indexing | ops and debugging |
| `firstSeenAt` | Item | harvest/indexing | diagnostics, analytics |
| `lastSeenAt` | Item | harvest/indexing or refresh path | freshness and diagnostics |
| `harvestedAt` | Item | harvest/indexing | diagnostics, ops |
| `indexedAt` | Item | harvest/indexing | diagnostics, ops |
| `lyrics` | Item | harvest/indexing | vault, export, search |
| `lyricsStatus` | Item | harvest/indexing | vault, export, diagnostics |
| `lyricsSource` | Item | harvest/indexing | diagnostics, trust, recovery |
| `lyricsRetrievedAt` | Item | harvest/indexing | diagnostics, trust, recovery |
| `media.audioUrl` | Item | harvest/indexing | export, playback, diagnostics |
| `media.videoUrl` | Item | harvest/indexing | uploader, export, diagnostics |
| `media.thumbUrl` | Item | harvest/indexing | export, vault UI |
| `media.audioExt` | Item | harvest/indexing | uploader, diagnostics |
| `gcs.audio` | Item | harvest/indexing | health and completeness logic |
| `gcs.video` | Item | harvest/indexing | health and completeness logic |
| `gcs.thumb` | Item | harvest/indexing | health and completeness logic |
| `gcsLyricsTxt` | Item | artifact generation path | vault, export, local portability |
| `gcsLyricsJson` | Item | artifact generation path | vault, export, automation |
| `gcsLyricsVtt` | Item | future timed-text path | vault, export, publishing |
| `tags` | Item | harvest/indexing | export, filters |
| `displayTags` | Item | harvest/indexing | export, filters, UX |
| `prompt` | Item | harvest/indexing | export, uploader metadata |
| `styles` | Item | normalization path | export, search, filters |
| `styleText` | Item | normalization path | export, search, UX |
| `modelName` | Item | harvest/indexing | export, metadata |
| `modelMajorVersion` | Item | harvest/indexing | export, metadata |
| `isInstrumental` | Item | harvest/indexing | export, metadata |
| `description` | Item | harvest/indexing | vault, export, publishing |
| `caption` | Item | harvest/indexing | vault, export, publishing |
| `negativePrompt` | Item | harvest/indexing | diagnostics, advanced publishing |
| `explicit` | Item | harvest/indexing | export, policy, publishing |
| `rawMetadataRef` | Item | harvest/indexing | diagnostics, recovery |
| `rawPayloadRef` | Item | harvest/indexing | diagnostics, recovery |
| `artworkUrl` | Item | harvest/indexing | diagnostics, UI fallback |
| `ytStatus` | Item | publish flow | vault UI, export if mirrored |
| `ytVideoId` | Item | publish flow | vault UI, linkage |
| `ytCanonicalUrl` | Item | publish flow | vault UI, linkage |
| `ytStartedAt` | Item | publish flow | vault UI, lineage, troubleshooting |
| `ytUploadedAt` | Item | publish flow | vault UI, lineage, troubleshooting |
| `ytPublishedAt` | Item | publish flow | vault UI, lineage |
| `ytError` | Item | publish flow | vault UI, troubleshooting |
| `ytErrorAt` | Item | publish flow | vault UI, troubleshooting |

### Notes

1. Creation Layer owns the Suno creation record on the item.
2. Asset Layer owns media truth and portable derivatives on the item.
3. Publish may add mirrored Distribution Layer outcome fields.
4. Publish must not overwrite Creation Layer or Asset Layer truth.
5. Item state is not queue state.
6. Nested `media.*` and `gcs.*` are canonical; any top-level media aliases should be treated as compatibility fields only.
7. `lastSeenAt` should be treated as a required harvest-owned freshness field.
8. `media.*` is the canonical source/media truth for the item.
9. `gcs.*` is canonical only for harvest-managed storage presence and storage-backed completeness semantics.
10. Raw source fields such as `prompt`, `tags`, and `displayTags` should be retained even when normalized UX fields such as `styles` are added later.

## 4. Queue Item

### Purpose

Represents one request to publish an item to YouTube.

### Authoritative storage

Firestore `ytUploadQueue`

### Authoritative fields

| Field | Owned by | Written by | Read by |
| --- | --- | --- | --- |
| `songKey` | Queue Item | vault queue endpoint | queue manager, uploader, vault UI |
| `status` | Queue Item | queue manager / uploader flow | vault UI, queue review, ops |
| `createdAt` | Queue Item | vault queue endpoint | queue review, ops |
| `retryCount` | Queue Item | queue manager | queue review, ops |
| `queuedAt` | Queue Item | vault queue endpoint at creation | queue review, ops |
| `startedAt` | Queue Item | queue manager or uploader flow | queue review, ops |
| `uploadedAt` | Queue Item | uploader flow | queue review, ops |
| `ytVideoId` | Queue Item | uploader flow | queue review, linkage |
| `errorMsg` | Queue Item | uploader flow | queue review, operator troubleshooting |
| `requestedFrom` | Queue Item | vault UI or queue API | operator context |
| `gcsVideoUrl` | Queue Item | queue endpoint if explicitly mirrored | uploader fallback, diagnostics |
| `ytDescription` | Queue Item | vault queue endpoint or queue editor | uploader |
| `ytPrivacy` | Queue Item | vault queue endpoint or queue editor | uploader |
| `ytLanguage` | Queue Item | vault queue endpoint or queue editor | uploader |
| `ytLicense` | Queue Item | vault queue endpoint or queue editor | uploader |
| `ytCategory` | Queue Item | vault queue endpoint or queue editor | uploader |
| `ytAlteredContent` | Queue Item | vault queue endpoint or queue editor | uploader |
| `ytShortsRemixing` | Queue Item | vault queue endpoint or queue editor | uploader |

### Notes

1. Queue state belongs here, not on the item as the authoritative queue source.
2. Item-level YouTube fields can mirror outcomes, but queue progression itself belongs to `ytUploadQueue`.
3. Duplicate prevention should be enforced at queue creation and queue processing.
4. `gcsVideoUrl` is mirrored-only diagnostic data, not canonical media authority.
5. For the live viewer path, `queued` is the canonical initial queue status.
6. `new` should be treated as legacy/internal only unless another producer explicitly requires it.

## 5. Interaction Record

### Purpose

Represents what happened to a song after release, playback, or audience exposure.

### Authoritative storage

Future-state engagement collection keyed by `songKey`.

Recommended logical name:

1. `songInteractions`

### Authoritative fields

| Field | Owned by | Written by | Read by |
| --- | --- | --- | --- |
| `songKey` | Interaction Record | interaction sync path | vault, analytics, downstream sync |
| `platform` | Interaction Record | interaction sync path | vault, analytics |
| `destinationId` | Interaction Record | interaction sync path | linkage, analytics |
| `publishedTo` | Interaction Record | interaction sync path | vault, analytics |
| `viewCount` | Interaction Record | interaction sync path | vault, analytics |
| `playCount` | Interaction Record | interaction sync path | vault, analytics |
| `uniqueListeners` | Interaction Record | interaction sync path | vault, analytics |
| `commentCount` | Interaction Record | interaction sync path | vault, analytics |
| `likeCount` | Interaction Record | interaction sync path | vault, analytics |
| `shareCount` | Interaction Record | interaction sync path | vault, analytics |
| `lastEngagementSyncAt` | Interaction Record | interaction sync path | vault, ops, analytics |
| `snapshots` or period breakdowns | Interaction Record | future interaction sync path | analytics, trend views |

### Notes

1. Interaction Layer is separate from Harvest and separate from Queue authority.
2. Interaction metrics should not be written as harvest-owned item truth.
3. Distribution may explain where a song was published, but Interaction owns how it performed.
4. Future live sync may read from YouTube or other downstream destinations without mutating Creation Layer truth.

## 6. Export Artifact

### Purpose

Represents the published vault-facing catalog output and its freshness metadata.

### Authoritative storage

1. `gs://aeonimus-workspaces/exports/suno/latest_catalog_wide.csv`
2. `gs://aeonimus-workspaces/exports/suno/latest_catalog_wide.meta.json`

### Authoritative fields

| Field | Owned by | Written by | Read by |
| --- | --- | --- | --- |
| `artifact path` | Export Artifact | rebuild path | viewer server, ops |
| `generatedAt` | Export Artifact | `rebuild_catalog.py` | dashboard, vault freshness, ops |
| `rowCount` | Export Artifact | `rebuild_catalog.py` | ops, diagnostics |
| `generator` | Export Artifact | `rebuild_catalog.py` | ops, diagnostics |
| exported item rows | Export Artifact | `rebuild_catalog.py` | vault UI |

### Notes

1. Export freshness is not item freshness.
2. Export freshness is not run freshness.
3. The viewer depends on the export artifact, not directly on Firestore.
4. Export row `runId` is useful context, but `generatedAt` in export metadata is the authoritative export freshness field.

## Cross-Object Rules

### Rule 1

`sunoSongs` is the authoritative indexed item object.

### Rule 2

`ytUploadQueue` is the authoritative publish-queue object.

### Rule 3

`rebuild_catalog.py` owns export generation.

### Rule 4

The vault UI may read queue or publish state, but it should not redefine queue ownership.

### Rule 5

Interaction metrics belong to a dedicated engagement authority and should not silently become harvest-owned item truth.

### Rule 6

Freshness must be modeled in at least three distinct ways:

1. source freshness
2. run freshness
3. export freshness

## Practical Decision Guide

If the question is:

`Where does the item and media truth live?`

Answer:

1. `sunoSongs`

`Where does queue and upload progression live?`

Answer:

1. `ytUploadQueue`

`Where does engagement and audience response live?`

Answer:

1. future interaction record keyed by `songKey`

`Where does vault freshness truth live?`

Answer:

1. `latest_catalog_wide.meta.json`

`Where should YouTube upload result fields be mirrored for UX convenience?`

Answer:

1. on the item record, but only as mirrored publish outcome fields, not as queue ownership
