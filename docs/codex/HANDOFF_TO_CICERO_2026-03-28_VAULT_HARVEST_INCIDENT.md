# Handoff To Cicero (Vault Harvest Incident Recovery) - 2026-03-28

Audience: next operator
Author: Codex agent (this thread)
Goal: capture the exact cause and fix for the SUNO Vault stale-catalog incident

## Executive Summary

1. The public Vault at `https://music.aeonimus.info/vault` was stale because the live operational path had drifted, not because the frontend was caching old data.
2. The live export artifact had been stuck at the older March catalog state until a corrected manual harvest was executed.
3. The active Cloud Run Job `suno-harvest` was running, but its deploy/update path had become unsafe:
   - runtime identity had drifted between the compute default service account and the shared Cloud Run jobs service account
   - a later live update collapsed all job env vars into a single `PROJECT` value
4. After fixing the live job config and executing a clean manual run, the Vault updated again.

## Root Cause

### Primary operational issue

The live `suno-harvest` Cloud Run Job had configuration drift.

Observed on the live job:

1. `serviceAccountName` was inconsistent across executions
2. the most recent job generation had malformed env vars:
   - `PROJECT="stable-framing-482501-t9 WORK_DIR=/app SUNO_MEDIA_BUCKET=... HARVEST_MODE=delta"`

This malformed env config came from a manual PowerShell-based `gcloud run jobs update` invocation where the comma-separated `--set-env-vars` payload was not preserved correctly.

### Secondary issue

The local workstation could not use normal `gcloud` refresh flow reliably because interactive auth kept failing in non-interactive execution.

That was resolved by switching to service-account impersonation using:

- `aegis-deployer@stable-framing-482501-t9.iam.gserviceaccount.com`

## What Was Verified Live

Using impersonated `gcloud` against project `stable-framing-482501-t9`:

1. Cloud Run Jobs:
   - `suno-harvest`
   - `yt-upload-job`
   - `pipeline-monitor-daily`
2. Cloud Scheduler jobs:
   - `suno-harvest-nightly`
   - `yt-upload-daily`
   - legacy ingest schedulers still exist
3. Domain mappings:
   - `music.aeonimus.info` -> `suno-viewer`
   - `vault.aeonimus.info` -> `suno-viewer`

## What The Harvest Logs Showed

### Before fix

1. successful runs existed on March 23 through March 28
2. latest runs were spending most of their time on legacy `missing_gcs` work
3. one recent successful run showed:
   - `unshakableechos2341: 124 delta rows (new=3, missing_gcs=121)`
   - `genxdreams: 34 delta rows (new=0, missing_gcs=34)`

### After fix

Manual execution:

- `suno-harvest-8g8jn`

Completed successfully:

- `2026-03-29T01:35:58Z`

Important log lines:

1. `Written 1902 rows -> latest_catalog_wide.csv`
2. `Newest: 2026-03-28  They Step Closer`
3. `Catalog updated: exports/suno/latest_catalog_wide.csv`

Result:

1. the public Vault updated again
2. newest visible item reflected March 28 data

### Latest confirmed healthy execution

Manual execution:

- `suno-harvest-64mgh`

Completed successfully:

- `2026-03-30T10:47:09Z`

Important log lines:

1. `Hard errors: 0`
2. `Written 1912 rows -> latest_catalog_wide.csv`
3. `Newest: 2026-03-30  Decode Their Playbook`
4. `Uploading to gs://aeonimus-workspaces/exports/suno/latest_catalog_wide.csv...`
5. `Uploading to gs://aeonimus-workspaces/exports/suno/latest_catalog_wide.meta.json...`
6. `[monitor] Pipeline healthy - skipping digest email (daily-digest will send it)`
7. `Container called exit(0)`

Result:

1. media repair phase remained noisy, but completed without hard errors
2. Step 4 rebuild/export completed cleanly
3. Step 5 monitor completed cleanly and treated the run as healthy
4. current runtime baseline remained healthy after the deploy-path hygiene work

## Local Code Changes Made During Incident

### Auth hardening for Cloud Run-safe token acquisition

Files:

1. `yt-ingest/gcp_access_token.py`
2. `yt-ingest/catalog_sync_firestore_multi.py`
3. `yt-ingest/rebuild_catalog.py`
4. `yt-ingest/repair_suno_metadata.py`
5. `yt-ingest/backfill_titles_from_studio_api.py`
6. `yt-ingest/Dockerfile.harvest`

Purpose:

1. stop relying on fragile local-only `gcloud` token behavior inside Cloud Run jobs
2. use metadata server / ADC first with local fallback only when needed

### Harvest redeploy hardening

File:

1. `yt-ingest/redeploy_harvest.sh`

Changes:

1. pins runtime service account:
   - `cloud-run-jobs@stable-framing-482501-t9.iam.gserviceaccount.com`
2. mounts monitor secret:
   - `pipeline-monitor-config`
3. ensures required runtime roles are accounted for
4. writes a dedicated env-vars YAML file and uses:
   - `--env-vars-file`

Reason:

1. avoid future PowerShell / shell parsing regressions with `--set-env-vars`
2. keep the deploy path deterministic
3. verify the deployed job shape immediately after update rather than assuming the update landed correctly

Current verification behavior:

1. confirm required local files include `rebuild_catalog.py`
2. confirm `pipeline-monitor-config` exists before update
3. confirm deployed runtime service account is:
   - `cloud-run-jobs@stable-framing-482501-t9.iam.gserviceaccount.com`
4. confirm these env vars remain separate after update:
   - `PROJECT=stable-framing-482501-t9`
   - `WORK_DIR=/app`
   - `SUNO_MEDIA_BUCKET=gs://aeonimus-suno-media`
   - `WORKSPACES_BUCKET=gs://aeonimus-workspaces`
   - `HARVEST_HANDLE=unshakableechos2341`
   - `HARVEST_MODE=delta`
5. explicitly fail if `PROJECT` appears collapsed with other env vars
6. fail fast if `gcloud` auth is not active in the bash shell running the script

Desktop read-only verification helper:

1. `yt-ingest/verify_harvest_runtime.ps1`

Use that on the Windows workstation when the goal is to verify live job shape cheaply without running Cloud Build or changing the job.

Full operator runbook:

1. `docs/codex/AEGIS_HARVEST_DEPLOY_RUNBOOK.md`

Operator flags for the authoritative redeploy path:

1. `VERIFY_ONLY=true`
   - read-only live shape verification in bash / Cloud Shell
2. `TRIGGER_NOW=n`
   - redeploy without prompting for or triggering an immediate extra harvest run
3. `TRIGGER_NOW=y`
   - redeploy and intentionally trigger one manual harvest run

### Post-harvest monitor hardening

File:

1. `yt-ingest/pipeline_monitor.py`

Changes:

1. healthy `post-harvest` runs now decide whether to skip email before attempting Secret Manager email-config loading
2. console logging is encoding-safe to reduce Unicode-related local/operator log noise
3. every monitor run now writes `pipeline_monitor_status.json` with a machine-readable health verdict and summary stats
4. partial media-harvest failures now surface as an explicit `partial_harvest` Step 5 status instead of looking fully healthy when export rebuild still succeeds

Reason:

1. healthy runs should stay quiet and not emit misleading monitor warnings just because email config is unavailable
2. operator logs should remain readable across environments without changing pipeline semantics
3. Step 5 now leaves behind a concrete status artifact for operators and future dashboard/reporting work
4. rebuilt-but-imperfect runs now have an explicit ops signal instead of being hidden behind a successful export

## Current Expected Runtime Shape

### Harvest job

Job:

- `suno-harvest`

Runtime service account:

- `cloud-run-jobs@stable-framing-482501-t9.iam.gserviceaccount.com`

Expected env vars:

1. `PROJECT=stable-framing-482501-t9`
2. `WORK_DIR=/app`
3. `SUNO_MEDIA_BUCKET=gs://aeonimus-suno-media`
4. `WORKSPACES_BUCKET=gs://aeonimus-workspaces`
5. `HARVEST_HANDLE=unshakableechos2341`
6. `HARVEST_MODE=delta`

Expected secret:

1. `MONITOR_CONFIG=pipeline-monitor-config:latest`

## Follow-Up Recommendations

1. let the next scheduled nightly harvest run without manual intervention and confirm it still updates the Vault
2. normalize `suno-viewer` off the compute default service account later
3. treat `yt-ingest/redeploy_harvest.sh` as the authoritative harvest redeploy path unless/until a replacement path is documented with equivalent verification
4. keep using service-account impersonation for admin operations from this workstation
5. investigate whether additional SUNO handles should be tracked beyond:
   - `unshakableechos2341`
   - `genxdreams`

## Operating Constraint For Future Incident Work

Manual SUNO harvest execution should be treated as expensive and deliberate.

Use this order before triggering a run:

1. inspect live Cloud Run job config
2. inspect the most recent execution logs
3. inspect export freshness and metadata artifacts
4. inspect digest or monitor outputs
5. run harvest only if those checks do not answer the question

Rules:

1. avoid exploratory reruns
2. define the exact hypothesis before any manual run
3. make each manual run validate as many linked concerns as possible
4. assume Cloud Run time and project resources are limited

## Start Point For Next Session

1. confirm the next `suno-harvest-nightly` execution completes successfully
2. confirm the Vault newest item advances beyond the current March 28 top item
3. if it does not, inspect the execution log for that specific run before changing code again
