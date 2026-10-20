# Vault completeness and recovery contract

The Vault must distinguish a scheduled run completing from all source data and files being present. Google Cloud runtime authentication uses the configured Cloud Run service account; an operator CLI login is not the production authentication mechanism.

## Required recovery behavior

1. Reconcile every configured active public source against retained song identities. Public profile coverage does not establish complete private-library coverage. Retain archived and source-unavailable records.
2. Process each existing song independently. One denied or removed source item must not prevent subsequent songs from being enriched. A urllib HTTP 403 alone does not establish a need for private credentials; the same ordinary public curl client used by profile ingestion can provide a different result.
3. Treat missing fields, failed source requests, missing objects, empty objects, stale text artifacts, and missing references as different conditions. Do not invent source values or count an empty placeholder as recovered media.
4. Fill source-backed missing fields and preserve existing content. Store recovery provenance and source snapshots. Copy and validate recovered media before integrating it. Preserve older lyrics artifact versions.
5. Verify object size and upload checksum. For lyrics, compare stored text with current Firestore lyrics; a URL string is not evidence that the artifact exists or is current. The VTT artifact is explicitly synthetic pacing, not authoritative source timing.
6. Rebuild the catalog only after integration, validate the local and published contract, and compare the retained song identity set. Store an itemized unresolved list instead of declaring full recovery when sources remain unavailable.

## Implemented production safeguards

- `enrich_suno_metadata_from_studio_api.py`: ordinary public-client fallback for denied urllib requests, response identity validation on fallback, continued per-song processing, archived JSON recovery reports under `gs://aeonimus-workspaces/exports/suno/recovery/metadata/`, explicit partial exit code 3.
- `entrypoint.sh`: completed partial metadata sweeps are not immediately replayed; the next scheduled sweep retries source access. Available data still reaches the catalog and the run retains partial status.
- `backfill_lyrics_artifacts.py`: storage inventory and text checksum checks, versioned no-overwrite uploads, checksum verification before reference updates, per-song failure isolation, and archived failure reports.
- `build_manifest_from_studio_api.py`: an explicit empty clips array ends pagination; playlist/user UUIDs cannot become false song IDs.

## Verification and operational limits

September 13 recovery inspected all 2,652 retained song documents, the media bucket, relevant workspace storage, and local SUNO workspaces. The incident directory holds before/after snapshots, source responses, object inventories, per-song recovery results, and catalog validation outputs. The scoped Cloud Run execution `suno-harvest-gbwrt` verifies the formerly denied clip request and service-identity access to its stored metadata; it is not a full scheduled harvest.

Source 404s, still-denied video URLs, and source-absent lyrics/artwork remain explicit unresolved items. Existing optional-video scheduling policy is unchanged; a metadata fix must not be described as recovering source video that still cannot be downloaded. Missing independent transcripts must not be fabricated from lyrics. No source connection or historical/private-library completeness is inferred from the public audit.
