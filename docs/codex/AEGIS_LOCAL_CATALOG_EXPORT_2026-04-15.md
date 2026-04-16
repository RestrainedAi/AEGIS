# AEGIS Local Catalog Export

Date: 2026-04-15

## What shipped

- a first authenticated local catalog export flow is now live in `suno-viewer`
- the Vault can prepare a workspace-scoped export job instead of forcing users to scrape assets manually
- completed exports provide:
  - a manifest CSV download
  - one or more ZIP parts
  - bundled audio, lyrics, and image assets where available

## Tier model direction

- this is the first concrete implementation of the Tier 1 local-catalog lane
- Tier 1 is intended to:
  - allow a smaller harvest footprint
  - allow local export/download
  - avoid promising long-term hosted storage as a customer entitlement

## Packaging contract in this first pass

- export jobs are authenticated and scoped to the caller's active workspace
- ZIP parts use a stable `catalog_part_XX.zip` naming scheme
- each part includes:
  - `manifest/catalog.csv`
  - `manifest/summary.json`
  - asset folders such as `audio/`, `lyrics/txt/`, `lyrics/vtt/`, and `images/thumbs/`
- the CSV includes local-path columns so the exported catalog can be browsed outside the platform

## Large catalog handling

- exports now shard automatically by estimated bundle size instead of trying to force one oversized archive
- the current target max is about `1.5 GB` per ZIP part
- this keeps the first implementation in a safer cross-platform zone and avoids relying on a single huge ZIP as the default user experience

## Current caveats

- export job metadata is still instance-local/in-memory
- generated ZIPs are temporary artifacts, not durable user storage
- this is acceptable for the current Tier 1 local-export direction, but not the final durability model for bigger catalogs or resumable history

## Next recommended follow-up

1. persist export job metadata beyond a single instance so long-running jobs and history survive restarts
2. add explicit export history / retry / expiry messaging in the UI
3. tighten tier gating so local export is product-correct by plan
4. add manifest-only fallback for cases where assets are partially unavailable
5. optionally add alternate grouping presets later if users want artist/date/source-oriented bundle sets instead of pure size sharding
