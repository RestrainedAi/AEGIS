# AEGIS-006 Post-Harvest Catalog Rebuild Note

## Decision

For the first coding wave, the selected orchestration mode is:

- inline rebuild after harvest completion

## Reason

This is the lowest-risk additive change because:

1. it does not require introducing a new production job type first
2. it keeps export refresh directly coupled to successful harvest completion
3. it produces an explicit recovery path in the same operational script

## Implementation

Updated scripts:

1. `yt-ingest/daily_suno_job.sh`
2. root `daily_suno_job.sh`

Behavior after change:

1. run delta detection
2. if needed, run media download
3. run `rebuild_catalog.py`
4. fail the job if rebuild fails
5. print export metadata in the summary when available

## Freshness Visibility

`yt-ingest/rebuild_catalog.py` now writes:

1. `latest_catalog_wide.csv`
2. `latest_catalog_wide.meta.json`

and uploads the metadata file to:

- `gs://aeonimus-workspaces/exports/suno/latest_catalog_wide.meta.json`

The metadata includes:

1. `generatedAt`
2. `rowCount`
3. `generator`
4. `artifact`

## Recovery Path

If rebuild fails, the scripts now emit an explicit recovery instruction to rerun:

- `python3 rebuild_catalog.py`

after the export failure is resolved.

## Caveat

This is an additive first-wave solution.

Longer term, the team should still decide whether export rebuild belongs:

1. inline with harvest
2. in a chained Cloud Run job
3. in a separately managed scheduled job

The inline path is appropriate for the first hardening wave but may not be the final operating model.
