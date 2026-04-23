# AEGIS Local Catalog Export

Date: 2026-04-15

## What shipped

- a first authenticated local catalog export flow is now live in `suno-viewer`
- the Vault can prepare a workspace-scoped export job instead of forcing users to scrape assets manually
- completed exports provide:
  - a manifest CSV download
  - one or more ZIP parts
  - bundled audio, lyrics, and image assets where available
- the Vault now exposes a simple in-app download queue:
  - active packages show a phase label and step count while packaging is in progress
  - ready packages render as a flat list of downloadable items with `type`, `size`, and a single `Download` action per row
  - platform admins can review recent export jobs across workspaces without losing the current package after one refresh
- Downloads now has a first-class shell home in the Vault instead of living as a hidden export panel:
  - a dedicated sidebar destination
  - recent-package context and lightweight sidebar status
  - clearer empty and failure states
- ready-state notification is now visible in-app and the export email is sent when packaging completes
- export filenames are now short, stable, and `songKey`-based so Windows path-length failures are far less likely during unzip/copy workflows
- per-part manifest artifacts now have unique names so extracting multiple ZIP parts into one parent folder no longer causes manifest overwrite collisions

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
  - `manifest/catalog_part_XX.catalog.csv`
  - `manifest/catalog_part_XX.summary.json`
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
- there is now a shell-level `Downloads` destination in the Vault navigation, but it is still a shell section rather than a fully separate routed app surface with durable history
- progress is now clearer than the original `preparing/building/ready` pass, but it is still a coarse step model rather than per-asset live progress
- the first tier-authority pass is now live too:
  - export center visibility gates against `downloads.center`
  - full catalog package creation gates against `downloads.catalog` + `catalog.export.local`
  - single-artifact buttons and batch-selection controls now honor `downloads.single`, `downloads.batch`, and `downloads.max_batch_size`
- the request model is still uneven:
  - full-catalog export is the clearest path today
  - song-by-song and selected-song flows still need a cleaner customer-facing entry pattern
- empty or non-exportable workspaces now fail honestly instead of pretending a zero-byte package was created, but the next pass should keep simplifying the wording and next-step guidance
- the 2026-04-22 through 2026-04-23 cleanup passes also removed the remaining “dishonest” empty-package signals:
  - no duplicate top-level warning strip when the detailed failure card is already visible
  - no fake `0 B` package metrics when nothing was actually packaged
  - no one-option workspace picker in the single-workspace case
  - the full-workspace request path now reads more clearly as `Prepare full catalog package`

## Next recommended follow-up

1. persist export job metadata beyond a single instance so long-running jobs and history survive restarts
2. unify `single song`, `selected songs`, and `full catalog` into one clearer package-request model
3. add explicit export history / retry / expiry messaging in the UI
4. tighten tier gating so local export is product-correct by plan
5. add manifest-only fallback for cases where assets are partially unavailable
6. optionally add alternate grouping presets later if users want artist/date/source-oriented bundle sets instead of pure size sharding
