# AEGIS-001 Export Authority Note

## Decision

The authoritative catalog export generator is:

- `yt-ingest/rebuild_catalog.py`

## Evidence

### Generator

`yt-ingest/rebuild_catalog.py`:

1. reads Firestore collection `sunoSongs`
2. builds `latest_catalog_wide.csv`
3. uploads it to:
   - `gs://aeonimus-workspaces/exports/suno/latest_catalog_wide.csv`

### Viewer dependency

`suno-viewer/server.js` serves `/catalog.csv` by downloading:

- `gs://aeonimus-workspaces/exports/suno/latest_catalog_wide.csv`

That means the viewer directly depends on the output artifact produced by `rebuild_catalog.py`.

## Current Refresh Trigger

Before the current first-wave engineering changes, the repo did not show a reliable checked-in orchestration path that guaranteed catalog rebuild after successful harvest.

After the first-wave changes in this branch, both of these scripts explicitly invoke `rebuild_catalog.py` after harvest work:

1. `yt-ingest/daily_suno_job.sh`
2. root `daily_suno_job.sh`

## Current Operational Interpretation

1. `rebuild_catalog.py` is the canonical full export builder
2. the viewer is coupled to its GCS output
3. historical refresh behavior appears to have been partially manual or environment-dependent
4. first-wave changes convert rebuild into an explicit post-harvest stage in the checked-in shell path
5. the current local `C:` workspace copy should be treated as the working source unless stronger contrary evidence appears

## Current Contract Interpretation

The current local `yt-ingest/rebuild_catalog.py` is expected to:

1. consume canonical nested `media.*` first
2. treat top-level media fields as compatibility fallback only
3. emit `gcs_*` and `account_*` fields as export/view-model aliases only
4. treat export row `runId` as context only
5. keep authoritative export freshness in `latest_catalog_wide.meta.json.generatedAt`

## Cheap Local Validation Path

Use:

1. `yt-ingest/validate_suno_export_contract.py`
2. `yt-ingest/fixtures/suno_export_contract_fixture.json`

This validator imports the local `rebuild_catalog.py` mapping functions directly and verifies canonical-media, legacy-fallback, and export-alias behavior without a Cloud Run harvest execution.

## Current Deploy Path Interpretation

The authoritative deploy/update path for the nightly harvest job should now be treated as:

1. `yt-ingest/redeploy_harvest.sh`

That script is expected to:

1. verify the required harvest/export files are present locally, including `rebuild_catalog.py`
2. verify the monitor secret exists before job update
3. build the harvest image through `cloudbuild.harvest.yaml`
4. update `suno-harvest` with:
   - explicit runtime service account
   - explicit single-task runtime shape
   - env vars from a generated YAML file rather than inline shell concatenation
   - mounted `MONITOR_CONFIG` secret
5. verify the deployed job shape after update by checking:
   - runtime service account
   - each expected env var separately
   - that `PROJECT` did not collapse other env vars into one value
6. fail fast if `gcloud` auth is not active in the bash shell that is running the script

## Desktop Verification Path

For this Windows workstation, use:

1. `yt-ingest/verify_harvest_runtime.ps1`

This is a read-only PowerShell verification path for confirming that the deployed `suno-harvest` job still matches the expected runtime shape without invoking Cloud Build or changing the live job.

Use it to verify:

1. active `gcloud` auth in PowerShell
2. `pipeline-monitor-config` presence
3. runtime service account
4. separate env vars
5. `MONITOR_CONFIG` secret binding
6. latest execution snapshot

## Operator Control Notes

`yt-ingest/redeploy_harvest.sh` now supports explicit operator intent through env vars:

1. `VERIFY_ONLY=true`
   - verify live deploy shape without Cloud Build or job update
2. `TRIGGER_NOW=n`
   - redeploy without prompting for or triggering an immediate manual harvest run
3. `TRIGGER_NOW=y`
   - redeploy and immediately execute one manual harvest run

For normal hygiene redeploys after a healthy nightly run, prefer:

1. `TRIGGER_NOW=n ./redeploy_harvest.sh`

Full operator flow reference:

1. `docs/codex/AEGIS_HARVEST_DEPLOY_RUNBOOK.md`

## Operational Guardrail

Do not treat ad hoc manual `gcloud run jobs update --set-env-vars ...` commands as authoritative for this job unless they reproduce the same post-update verification checks now built into `yt-ingest/redeploy_harvest.sh`.

## Follow-On Recommendation

Longer term, the rebuild step and the harvest deploy path should be owned by one explicit production job path rather than duplicated across multiple environment-specific shell scripts.
