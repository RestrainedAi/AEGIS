## AEGIS SUNO Normalization Backfill Plan V1

### Baseline

Live read-only `sunoSongs` audit results from the saved 100-doc sample:

- Nested `media.*` present on `100/100`
- Nested `gcs.*` present on `100/100`
- Top-level `audioUrl` / `videoUrl` / `thumbUrl` present on `0/100`
- Missing on `0/100` sampled docs:
  - `sourcePlatform`
  - `lastSeenAt`
  - `indexedAt`
  - `harvestedAt`
  - `firstSeenAt`
  - `isRemoved`
  - `rawMetadataRef`
  - `rawPayloadRef`
  - `artworkUrl`

Implication: the live collection is already normalized for canonical media/storage shape. The remaining work is a narrow freshness/normalization backfill, not a media migration.

### Objective

Bring existing `sunoSongs` documents up to the locked contract using only deterministic values already present on each document or in Firestore document metadata.

### In Scope

Backfill only these fields when missing:

- `sourcePlatform`
- `indexedAt`
- `harvestedAt`
- `firstSeenAt`
- `lastSeenAt`
- `isRemoved`

### Out of Scope

Do not invent or guess:

- `rawMetadataRef`
- `rawPayloadRef`
- `artworkUrl`

Do not rewrite canonical nested `media.*` or `gcs.*` unless a later audit proves they are missing or malformed.

### Deterministic Derivation Rules

- `sourcePlatform`: set to `"suno"` when missing
- `indexedAt`: first available of `importedAt`, `updatedAt`, Firestore `createTime`, `createdAt`
- `harvestedAt`: first available of `indexedAt`, `importedAt`, Firestore `createTime`, `createdAt`
- `firstSeenAt`: first available of `importedAt`, Firestore `createTime`, `createdAt`
- `lastSeenAt`: first available of `importedAt`, `indexedAt`, Firestore `createTime`, `createdAt`
- `isRemoved`: `true` when `status == "removed_from_suno"` or `removedAt` exists, else `false`

### Execution Order

1. Dry-run the normalization script against live `sunoSongs`
2. Review counts and patch examples
3. Apply the normalization patch
4. Re-run the dry-run to confirm near-zero remaining patch candidates
5. Re-run the saved local export validator to confirm no mapping regressions

### Implementation Artifact

Normalization script:

- [normalize_suno_songs_contract.py](C:/Users/blahn/OneDrive/Desktop/SUNO%20YouTube%20Pipeline/enviroment/AEGIS/yt-ingest/normalize_suno_songs_contract.py)

Export validator:

- [validate_suno_export_contract.py](C:/Users/blahn/OneDrive/Desktop/SUNO%20YouTube%20Pipeline/enviroment/AEGIS/yt-ingest/validate_suno_export_contract.py)

Audit artifacts:

- [sunoSongs_audit_sample_10.json](C:/Users/blahn/OneDrive/Desktop/SUNO%20YouTube%20Pipeline/enviroment/AEGIS/yt-ingest/sunoSongs_audit_sample_10.json)
- [sunoSongs_audit_summary_100.json](C:/Users/blahn/OneDrive/Desktop/SUNO%20YouTube%20Pipeline/enviroment/AEGIS/yt-ingest/sunoSongs_audit_summary_100.json)

### Safety Notes

- Default mode must remain dry-run.
- No Cloud Run harvest execution is required for this backfill.
- No Firestore collection, index, or rules change is required before this pass.
- Provenance fields should remain blank until a later source-backed or artifact-backed repair path is approved.

### Completion Status

Executed on live `sunoSongs` with the dry-run-first flow described above.

Result:

- normalization converged successfully
- final verification: `1911` scanned docs
- final dry-run result: zero remaining patch candidates
- export contract validator still passed after the normalization pass

Remaining intentionally unfilled fields:

- `rawMetadataRef`
- `rawPayloadRef`
- `artworkUrl`

These require a later artifact-backed or source-backed repair path and were not guessed.
