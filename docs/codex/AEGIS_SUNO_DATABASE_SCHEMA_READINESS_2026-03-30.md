# AEGIS SUNO Database / Schema Readiness - 2026-03-30

## Purpose

This note assesses the current SUNO stored-data situation after the contract-lock phase.

It answers:

1. what schema/storage work is already effectively done
2. what is still missing in stored `sunoSongs` data
3. the safest backfill/normalization path
4. whether Firestore collection/index/rules changes are still needed now

Operating constraint:

1. inspect-first
2. low-cost
3. avoid unnecessary Cloud Run runs

## 1. What Is Already Done

### Contract and write-shape progress

Done:

1. `sunoSongs` is locked as the authoritative SUNO item store.
2. `firestore_upsert.py` now writes the normalized harvest-owned field families:
   - `sourceId`
   - `sourcePlatform`
   - `handle`
   - `status`
   - `importedAt`
   - `indexedAt`
   - `harvestedAt`
   - `lastSeenAt`
   - nested `media.*`
   - nested `gcs.*`
3. Export generation is aligned to canonical nested `media.*` and uses top-level aliases as fallback only.
4. A cheap local export validator now exists:
   - `yt-ingest/validate_suno_export_contract.py`
   - `yt-ingest/fixtures/suno_export_contract_fixture.json`

### Existing normalization / repair utilities already present

Available:

1. `yt-ingest/backfill_firestore_from_gcs.py`
   - can reconstruct basic `sunoSongs` docs from GCS media presence
   - currently writes an older minimal shape
2. `yt-ingest/repair_suno_metadata.py`
   - can patch missing title / createdAt from manifest or Studio API
3. `yt-ingest/mark_removed_clips.py`
   - can mark removed items and move media to a removed path
4. `yt-ingest/patch_handles.py`
5. `yt-ingest/patch_catalog_status.py`

### Firestore config already in place

Current collections/config relevant to SUNO:

1. collection in active use: `sunoSongs`
2. rules allow:
   - public read on `sunoSongs`
   - admin-only writes
3. indexes already exist for:
   - `sourceId + importedAt`
   - `handle + importedAt`
   - `status + importedAt`

## 2. What Is Still Missing

### Stored-data gaps likely present in existing `sunoSongs`

Based on current code history and utility scripts, existing records are likely mixed across generations.

Most likely missing or inconsistent on older records:

1. `sourcePlatform`
2. `lastSeenAt`
3. `indexedAt`
4. `harvestedAt`
5. `firstSeenAt`
6. `isRemoved`
7. provenance-explicit fields:
   - `rawTitle`
   - `rawMetadataRef`
   - `rawPayloadRef`
   - `artworkUrl`

Likely inconsistencies:

1. some older records may still depend on top-level media aliases rather than nested `media.*`
2. some repair/backfill paths still shell out to `gcloud` auth directly and write older field shapes
3. removal state may exist as `status=removed_from_suno` without the newer mirror field `isRemoved`

### Evidence that stored/exported data is mixed

The local checked-in `yt-ingest/latest_catalog_wide.csv` still shows an older row shape in the sample inspected:

1. sparse media/export fields on older rows
2. missing newer export columns in that local artifact sample

Interpretation:

1. local CSV artifacts should not be treated as authoritative evidence of fully normalized stored data
2. `sunoSongs` likely contains a mix of older and newer shapes that the current export generator is compensating for

## 3. Safest Backfill / Normalization Plan

### Goal

Normalize existing `sunoSongs` documents to the locked contract without triggering a broad harvest run.

### Recommended order

#### Phase A: read-only audit

Do first:

1. sample current `sunoSongs` docs directly
2. count how many docs are missing:
   - `sourcePlatform`
   - `lastSeenAt`
   - nested `media.*`
   - `indexedAt`
   - `harvestedAt`
   - `firstSeenAt`
3. verify how many removed docs are missing `isRemoved`

This should be done through low-cost Firestore reads only.

#### Phase B: cheap deterministic normalization

Backfill only fields that can be inferred safely without external re-harvest:

1. `sourcePlatform = "suno"` where absent
2. `lastSeenAt = importedAt` if absent and no better timestamp exists
3. `indexedAt = importedAt` if absent
4. `harvestedAt = indexedAt` or `importedAt` if absent
5. `firstSeenAt = createdAt` if absent, else fallback to `importedAt`
6. `isRemoved = true` where `status = removed_from_suno`
7. `isRemoved = false` where status is active and field absent

This is the safest first normalization pass because it uses only already-stored values.

#### Phase C: nested media normalization

For older records that still rely on top-level aliases:

1. if `media.audioUrl` is missing but top-level `audioUrl` exists, copy into nested `media.audioUrl`
2. if `media.videoUrl` is missing but top-level `videoUrl` exists, copy into nested `media.videoUrl`
3. if `media.thumbUrl` is missing but top-level `thumbUrl` exists, copy into nested `media.thumbUrl`
4. derive `media.audioExt` from nested/top-level audio path if possible

Important rule:

1. do not delete top-level aliases yet
2. only add missing canonical nested fields

#### Phase D: metadata/provenance repair

Only after deterministic normalization:

1. use `repair_suno_metadata.py`-style logic for missing `title` / `createdAt`
2. consider cheap backfill of `rawTitle` only when a distinct source value is available
3. do not invent `rawMetadataRef` / `rawPayloadRef` if no real source reference exists

### What not to do yet

Avoid for now:

1. broad Studio API refetch over the whole library
2. broad media/GCS repair pass
3. aggressive rewrite of older records that already satisfy export needs
4. deleting legacy top-level media fields before all consumers are confirmed migrated

## 4. Firestore Collection / Index / Rules Changes Still Needed?

### Collections

Immediate answer:

1. no new Firestore collection is required for the current SUNO normalization pass

Reason:

1. current active truth already lives in `sunoSongs`
2. `sources` and `runs` remain target-state objects, not immediate storage blockers

### Indexes

Immediate answer:

1. no index change is strictly required for the normalization/backfill pass itself

Current indexes are sufficient for:

1. source/handle/status + importedAt patterns

Potential future additions, but not urgent for this slice:

1. `sourcePlatform + importedAt`
2. `status + lastSeenAt`
3. `handle + lastSeenAt`

These are more likely dashboard/query convenience indexes than normalization blockers.

### Rules

Immediate answer:

1. no Firestore rules change is required for the SUNO normalization pass

Reason:

1. `sunoSongs` already allows public reads and admin-only writes
2. the current work is schema normalization within the existing write model

Longer-term note:

1. if `sources` and `runs` become real first-class collections in the active Python path, rules should be revisited then

## 5. Immediate Recommended Next Move

The next safest schema/database step is:

1. build a read-only `sunoSongs` audit script
2. build a deterministic normalization/backfill script for only:
   - `sourcePlatform`
   - `lastSeenAt`
   - `indexedAt`
   - `harvestedAt`
   - `firstSeenAt`
   - `isRemoved`
   - nested `media.*` backfill from top-level aliases

That gives the project actual stored-data normalization without requiring a harvest run.

## Short Conclusion

The SUNO schema/contract layer is now ahead of the stored data.

What is done:

1. the canonical contract
2. the current writer shape
3. the export mapping
4. the cheap export validator

What is still needed:

1. a low-risk audit of live `sunoSongs`
2. one deterministic normalization pass for older records
3. optional later metadata repair for sparse legacy rows

No new collection, rule, or immediate index change appears required before that normalization pass.

## Completion Update

The live audit and deterministic normalization pass have now been completed.

Observed live baseline from the read-only audit:

1. nested `media.*` present on the sampled live docs
2. nested `gcs.*` present on the sampled live docs
3. top-level media aliases absent on the sampled live docs
4. missing freshness/normalization fields were the real stored-data gap

Normalization result:

1. the one-time deterministic pass completed successfully
2. final verification showed zero remaining normalization patch candidates across `1911` scanned docs
3. no new collection, rule, or index change was needed
4. export validation still passed after the normalization work

Current interpretation:

1. SUNO stored data is now aligned to the locked deterministic schema layer
2. remaining gaps are optional enrichment/provenance fields, not core contract blockers
3. next SUNO work should be hardening and cleanup, not further schema rescue
