# AEGIS Typed Field Dictionary

## Purpose

This document is the implementation-facing field dictionary for the current AEGIS contract model.

It translates the agreed object ownership model into explicit field guidance:

1. object
2. field name
3. type
4. required vs optional
5. allowed values where relevant
6. writer
7. reader
8. notes

This is the best working contract reference for schema-aware implementation across:

1. SUNO Harvest
2. Vault to YouTube
3. viewer/export
4. dashboard and ops surfaces later
5. YouTube Playlist Downloader
6. Shared UX and Status Model   

## Layer Vocabulary

AEGIS should use the following product vocabulary consistently:

1. `Creation Record` = the full set of building blocks from Suno
2. `Portable Assets` = the downloadable usable outputs
3. `Distribution State` = publish workflow and destination state
4. `Interaction Record` = audience response and performance history
5. `Vault Source of Truth` = the combined authoritative view of all four layers

Core product rule:

`If Suno exposes it and it helps explain, reproduce, organize, search, or publish a song, the Vault should preserve it.`

## Conventions

### Type notation

1. `string`
2. `boolean`
3. `integer`
4. `timestamp-iso`
5. `string[]`
6. `object`
7. `object-ref`
8. `uri-gs`
9. `uri-http`

### Requirement notation

1. `required`
2. `optional`
3. `computed`
4. `mirrored`
5. `compat`

### Ownership shorthand

1. `Harvest`
2. `Publish`
3. `Queue Endpoint`
4. `Queue Manager`
5. `Uploader`
6. `Export Generator`
7. `Computed UI`

## 1. Source

### Current status

`Source` is still partly a target-state object in the active Python harvest path.

Treat several source fields as target-state or computed until source persistence is consistently written.

| Field | Type | Requirement | Writer | Reader | Allowed values / notes |
| --- | --- | --- | --- | --- | --- |
| `sourceId` | string | required | source onboarding / ingest setup | dashboard, sources, runs | stable identifier such as `suno_<handle>` |
| `platform` | string | required | source onboarding / config | sources, filters | `suno`, `youtube` |
| `type` | string | required | source onboarding / config | sources, detail | `profile`, `playlist`, or approved future values |
| `handle` | string | required for SUNO source | source onboarding / config | source detail, harvest | canonical public handle |
| `displayLabel` | string | optional now, required target-state | source onboarding / config | source-facing UI | human-friendly label |
| `profileUrl` | uri-http | optional now, recommended | source onboarding / config | source detail, ops | canonical profile URL |
| `status` | string | computed | Computed UI / later source writer | dashboard, sources, issues | `healthy`, `warning`, `stale`, `failed`, `disabled` |
| `freshness` | string | computed | Computed UI | dashboard, sources, issues | derived, not authoritative stored truth yet |
| `lastRunId` | string | optional | run completion path | dashboard, source detail | run linkage |
| `lastCrawledAt` | timestamp-iso | optional | ingest completion path | dashboard, source detail | last known crawl time |

## 2. Run

### Current status

`Run` is conceptually authoritative but still uneven across current backend paths.

Keep the contract richer than the current implementation so later normalization has a target.

| Field | Type | Requirement | Writer | Reader | Allowed values / notes |
| --- | --- | --- | --- | --- | --- |
| `runId` | string | required | ingest/job trigger path | runs, lineage | unique execution identifier |
| `pipeline` | string | required | run creator | runs, run detail | e.g. `SUNO_HARVEST`, `CATALOG_REBUILD`, `YT_UPLOAD` |
| `sourceId` | string | optional but recommended | run creator | runs, source detail | null for system-wide jobs if needed |
| `status` | string | required | run execution path | dashboard, runs, issues | `queued`, `running`, `ready`, `partial`, `failed` |
| `startedAt` | timestamp-iso | required | run execution path | runs, run detail | start timestamp |
| `completedAt` | timestamp-iso | optional | run completion path | runs, run detail | canonical run end field |
| `counts` | object | optional | run execution path | runs, run detail | counts payload by stage/result |
| `errorCount` | integer | optional | run execution path | dashboard, runs, issues | aggregate error count |
| `artifactRefs` | object-ref[] | optional | run execution path | run detail | references to generated artifacts |
| `logRefs` | object-ref[] | optional | run execution path | run detail | references to logs or log URLs |

## 3. Item

### Authoritative storage

Firestore `sunoSongs`

### Notes

1. This is the authoritative indexed item object.
2. Nested `media.*` and `gcs.*` are canonical.
3. Top-level media aliases may exist, but they are compatibility only.
4. `media.*` is the canonical source/media truth.
5. `gcs.*` is canonical only for harvest-managed storage presence and storage-backed completeness semantics.
6. This object now carries `Creation Layer` and `Asset Layer` authority, plus mirrored `Distribution Layer` outcome fields.

| Field | Type | Requirement | Writer | Reader | Allowed values / notes |
| --- | --- | --- | --- | --- | --- |
| `songKey` | string | required | Harvest | vault, export, queue, uploader | document identifier |
| `sourceId` | string | required | Harvest | export, queue, lineage | e.g. `suno_unshakableechos2341` |
| `sourcePlatform` | string | optional but recommended | Harvest | export, filters, diagnostics | `suno` |
| `handle` | string | required | Harvest | vault, export, filters | source handle |
| `title` | string | required | Harvest | vault, export, uploader | normalized title |
| `rawTitle` | string | optional | Harvest | diagnostics, normalization review | preserve source title if normalization differs |
| `status` | string | required | Harvest | vault, export, issues | `active`, `removed_from_suno`, or approved future values |
| `isRemoved` | boolean | optional | Harvest | vault, issues, diagnostics | mirror of removed state for clarity |
| `removedAt` | timestamp-iso | optional | Harvest | vault, issues, diagnostics | when removal inferred |
| `createdAt` | timestamp-iso | required | Harvest | vault, export, sort | source-created time |
| `importedAt` | timestamp-iso | required | Harvest | ops, diagnostics | when indexed/upserted |
| `firstSeenAt` | timestamp-iso | optional but recommended | Harvest | diagnostics, analytics | first discovery time |
| `lastSeenAt` | timestamp-iso | required | Harvest | freshness, export, diagnostics | latest successful sighting time |
| `harvestedAt` | timestamp-iso | optional | Harvest | diagnostics, ops | harvest event timestamp if distinct |
| `indexedAt` | timestamp-iso | optional | Harvest | diagnostics, ops | indexing/upsert completion timestamp if distinct |
| `tags` | string[] | optional | Harvest | export, filters, uploader metadata | normalized tag list |
| `displayTags` | string[] | optional | Harvest | export, filters, UX | display-friendly tags from source |
| `prompt` | string | optional | Harvest | export, uploader metadata | generation prompt |
| `lyrics` | string | optional | Harvest | vault, export, search | full lyric or lyric-like source text |
| `lyricsStatus` | string | optional | Harvest | vault, export, diagnostics | `OK`, `MISSING`, `ERROR`, `PARTIAL` |
| `lyricsSource` | string | optional | Harvest | diagnostics, trust | e.g. `SUNO_STUDIO_API` |
| `lyricsRetrievedAt` | timestamp-iso | optional | Harvest | diagnostics, trust | when lyrics were last fetched |
| `modelName` | string | optional | Harvest | export, metadata | source model/version |
| `modelMajorVersion` | string | optional | Harvest | export, metadata | normalized major version if available |
| `isInstrumental` | boolean | optional | Harvest | export, metadata | normalized boolean |
| `description` | string | optional | Harvest | export, UX, publishing | source-side description text |
| `caption` | string | optional | Harvest | export, UX, publishing | source-side caption text |
| `negativePrompt` | string | optional | Harvest | diagnostics, advanced publishing | source-side negative prompt |
| `explicit` | boolean | optional | Harvest | export, policy, publishing | explicit-content flag if available |
| `styles` | string[] | optional, normalized | normalization path | vault, export, search | canonical style list derived from raw source metadata |
| `styleText` | string | optional, normalized | normalization path | vault, export, search | flattened style summary for UX/export |
| `rawMetadataRef` | object-ref | optional | Harvest | diagnostics | reference to raw metadata object |
| `rawPayloadRef` | object-ref | optional | Harvest | diagnostics | reference to raw payload snapshot |
| `artworkUrl` | uri-http | optional | Harvest | diagnostics, UI fallback | only if distinct from stored thumb location |

### Item.media

| Field | Type | Requirement | Writer | Reader | Allowed values / notes |
| --- | --- | --- | --- | --- | --- |
| `media.audioUrl` | uri-gs | required if audio exists | Harvest | export, playback, diagnostics | canonical stored audio location |
| `media.videoUrl` | uri-gs | required if video exists | Harvest | uploader, export, diagnostics | canonical uploader media input |
| `media.thumbUrl` | uri-gs | required if thumb exists | Harvest | export, vault UI | canonical stored thumb location |
| `media.audioExt` | string | optional | Harvest | uploader, diagnostics | `mp3`, `m4a` |

### Item.gcs

| Field | Type | Requirement | Writer | Reader | Allowed values / notes |
| --- | --- | --- | --- | --- | --- |
| `gcs.audio` | boolean | required | Harvest | completeness logic | storage presence flag |
| `gcs.video` | boolean | required | Harvest | completeness logic | storage presence flag |
| `gcs.thumb` | boolean | required | Harvest | completeness logic | storage presence flag |
| `gcsLyricsTxt` | uri-http | optional | artifact generation path | vault, portability | portable text lyrics artifact |
| `gcsLyricsJson` | uri-http | optional | artifact generation path | vault, automation | structured lyrics artifact |
| `gcsLyricsVtt` | uri-http | optional | future timed-text path | vault, publishing | timed lyrics/caption artifact when timing exists |

### Mirrored YouTube outcome fields on Item

| Field | Type | Requirement | Writer | Reader | Allowed values / notes |
| --- | --- | --- | --- | --- | --- |
| `ytStatus` | string | mirrored | Publish/Uploader | vault UI, export if mirrored | `queued`, `uploading`, `done`, `error` or approved mapping |
| `ytVideoId` | string | mirrored | Publish/Uploader | vault UI, linkage | YouTube video id |
| `ytCanonicalUrl` | uri-http | mirrored | Publish/Uploader | vault UI, linkage | canonical watch URL |
| `ytStartedAt` | timestamp-iso | mirrored | Publish/Uploader | vault UI, troubleshooting | upload start timestamp |
| `ytUploadedAt` | timestamp-iso | mirrored | Publish/Uploader | vault UI, troubleshooting | upload completion timestamp |
| `ytPublishedAt` | timestamp-iso | mirrored | Publish/Uploader | vault UI, linkage | publish-visible time if distinct |
| `ytError` | string | mirrored | Publish/Uploader | vault UI, troubleshooting | last error summary |
| `ytErrorAt` | timestamp-iso | mirrored | Publish/Uploader | vault UI, troubleshooting | when last error was written |

Retain these mirrored item YouTube lifecycle fields even if the current export or UI reads only a subset. They are publish outcome history on the item, not queue authority.

## 4. Queue Item

### Authoritative storage

Firestore `ytUploadQueue`

### Notes

1. This is the authoritative publish queue.
2. Queue progression belongs here, not on the item.
3. For the live viewer path, `queued` is the canonical initial status.
4. `new` is legacy/internal unless another producer explicitly requires it.

| Field | Type | Requirement | Writer | Reader | Allowed values / notes |
| --- | --- | --- | --- | --- | --- |
| `songKey` | string | required | Queue Endpoint | queue manager, uploader, vault UI | references `sunoSongs` |
| `status` | string | required | Queue Endpoint / Queue Manager / Uploader | vault UI, queue review, ops | canonical lifecycle should center on `queued`, `uploading`, `done`, `error`; keep `new` only if explicitly retained |
| `createdAt` | timestamp-iso | required | Queue Endpoint | queue review, ops | queue record creation time |
| `queuedAt` | timestamp-iso | required | Queue Endpoint | queue review, ops | canonical queue entry time |
| `startedAt` | timestamp-iso | optional | Queue Manager or Uploader | queue review, ops | actual processing start; required once status first becomes `uploading` |
| `uploadedAt` | timestamp-iso | optional | Uploader | queue review, ops | upload completion time |
| `retryCount` | integer | required | Queue Manager | queue review, ops | retry counter |
| `ytVideoId` | string | optional | Uploader | queue review, linkage | resulting YouTube video id |
| `errorMsg` | string | optional | Uploader | queue review, ops | current/last queue error |
| `requestedFrom` | string | optional | Queue Endpoint | ops, diagnostics | origin surface or request source |
| `gcsVideoUrl` | uri-gs | optional, mirrored | Queue Endpoint | uploader fallback, diagnostics | mirrored-only, never canonical authority |

### Queue metadata overrides

| Field | Type | Requirement | Writer | Reader | Allowed values / notes |
| --- | --- | --- | --- | --- | --- |
| `ytDescription` | string | optional | Queue Endpoint or queue editor | Uploader | per-item override |
| `ytPrivacy` | string | optional | Queue Endpoint or queue editor | Uploader | `public`, `unlisted`, `private` |
| `ytLanguage` | string | optional | Queue Endpoint or queue editor | Uploader | language code such as `en` |
| `ytLicense` | string | optional | Queue Endpoint or queue editor | Uploader | e.g. `youtube` |
| `ytCategory` | string | optional | Queue Endpoint or queue editor | Uploader | e.g. `10` |
| `ytAlteredContent` | boolean | optional | Queue Endpoint or queue editor | Uploader | synthetic/altered content flag |
| `ytShortsRemixing` | boolean | optional | Queue Endpoint or queue editor | Uploader | remix permission |

Retain these queue override fields even when some flows do not currently edit all of them. They are queue-owned request metadata, not item truth.

## 5. Interaction Record

### Authoritative storage

Future-state engagement collection keyed by `songKey`

Recommended collection name:

1. `songInteractions`

### Notes

1. This object is the authoritative `Interaction Layer`.
2. Harvest does not own these fields.
3. Distribution does not own these fields beyond publish linkage context.
4. The first implementation wave should define this shell without requiring live sync.

| Field | Type | Requirement | Writer | Reader | Allowed values / notes |
| --- | --- | --- | --- | --- | --- |
| `songKey` | string | required | interaction sync path | vault, analytics, reporting | links back to `sunoSongs` |
| `platform` | string | required | interaction sync path | vault, analytics | e.g. `youtube`, later approved destinations |
| `destinationId` | string | optional | interaction sync path | linkage, analytics | remote platform object id |
| `publishedTo` | string[] | optional | interaction sync path | vault, analytics | destination summary |
| `viewCount` | integer | optional | interaction sync path | vault, analytics | audience views |
| `playCount` | integer | optional | interaction sync path | vault, analytics | full or counted plays |
| `uniqueListeners` | integer | optional | interaction sync path | vault, analytics | distinct listener count where available |
| `commentCount` | integer | optional | interaction sync path | vault, analytics | total comments |
| `likeCount` | integer | optional | interaction sync path | vault, analytics | total likes/favorites |
| `shareCount` | integer | optional | interaction sync path | vault, analytics | total shares where available |
| `lastEngagementSyncAt` | timestamp-iso | optional | interaction sync path | vault, ops, analytics | last successful metrics refresh |
| `snapshots` | object[] | optional | future interaction sync path | analytics | period or platform breakdowns later |

## 6. Export Artifact

### Authoritative storage

1. `gs://aeonimus-workspaces/exports/suno/latest_catalog_wide.csv`
2. `gs://aeonimus-workspaces/exports/suno/latest_catalog_wide.meta.json`

### Notes

1. Export freshness is not item freshness.
2. Export freshness is not run freshness.
3. `generatedAt` in export metadata is the authoritative freshness field.
4. Export row `runId` is context only.

### Export metadata

| Field | Type | Requirement | Writer | Reader | Allowed values / notes |
| --- | --- | --- | --- | --- | --- |
| `generatedAt` | timestamp-iso | required | Export Generator | dashboard, vault freshness, ops | authoritative export freshness |
| `rowCount` | integer | required | Export Generator | ops, diagnostics | exported row count |
| `generator` | string | required | Export Generator | ops, diagnostics | generator identity |
| `artifact` or `artifactPath` | string | optional | Export Generator | ops, diagnostics | exported artifact path |

### Export row/view-model fields

These are valid and useful, but they are export/view-model fields rather than harvest-owned item truth:

1. `account_sourceId`
2. `account_handle`
3. `account_label`
4. `gcs_mp3`
5. `gcs_mp4`
6. `gcs_thumb`
7. `gcs_latest_audio`
8. `gcs_latest_mp4`
9. `gcs_latest_thumb`
10. export row `runId`

## Compatibility aliases

These may still appear in older docs, exports, or transitional code paths, but they are not canonical item truth:

1. top-level `audioUrl`
2. top-level `videoUrl`
3. top-level `thumbUrl`

If present, treat them as compatibility aliases derived from canonical nested `media.*`.

## Practical Defaults To Use Now

1. Prefer storing more structured data over less when it is cheap to store.
2. Do not store extra data without provenance.
3. If a field is raw, mark it raw.
4. If a field is normalized, keep the raw reference if recovery may matter later.
5. If a field is mirrored, do not let it silently become authoritative.
6. Treat `tags`, `displayTags`, and `prompt` as raw creation truth even after style normalization is added.
7. Treat `styles` and `styleText` as normalized UX/search fields, not as replacements for raw source metadata.
8. Keep interaction metrics out of `sunoSongs` unless they are explicitly mirrored and documented as non-authoritative.
