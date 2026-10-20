# AEGIS Harvest Deploy Runbook

Purpose: one operational playbook for verifying, redeploying, and manually executing the `suno-harvest` Cloud Run job with the current low-cost operating rules.

Scope: `SUNO Harvest` only.

## Rule Zero

Manual harvest runs are expensive. Do not trigger one unless there is a specific question the existing verification record cannot answer.

Use this order:

1. verify live job shape
2. inspect recent execution status/logs
3. inspect export freshness / Vault freshness
4. redeploy only if runtime drift or code drift justifies it
5. manually execute only if a run is the smallest high-signal test left

## Expected Runtime Shape

### Feature owner and release evidence

Apply [Development DNA](DEVELOPMENT_PRINCIPLES.md) under the existing harvest workstream owner. The feature owner coordinates source, storage, runtime, and verification specialists when the change spans those concerns; designate one writer per shared file/contract before parallel work.

Before release, record the active checkout, local change boundary, deployed image/revision, acceptance criteria, relevant pre-deploy checks, and any skipped/manual/unexecuted checks in the [feature brief](templates/FEATURE_BRIEF.md). Use the [existing test framework](../../test/README.md); a passing report with skipped checks does not establish those outcomes.

After release, verify the deployed artifact and the intended stored/export/customer result. Classify partial source coverage separately from runtime failure. Route failed checks back to their owner with evidence and bounded retries; record an external blocker and resumption condition when retrying cannot help. Honor Rule Zero: another manual harvest is justified only by a specific unanswered acceptance check. Do not close a recovery merely because a job exited successfully.

The identities below describe runtime service identity. An operator's `gcloud` login authorizes administration; it is not a daily authentication dependency for the scheduled service.

Job:

- `suno-harvest`

Runtime service account:

- `cloud-run-jobs@stable-framing-482501-t9.iam.gserviceaccount.com`

Expected env vars:

1. `PROJECT=stable-framing-482501-t9`
2. `WORK_DIR=/app`
3. `SUNO_MEDIA_BUCKET=gs://aeonimus-suno-media`
4. `WORKSPACES_BUCKET=gs://aeonimus-workspaces`
5. `HARVEST_MODE=delta`

`HARVEST_HANDLE` and `HARVEST_HANDLES` must be absent from the deployed job.
The Firestore `sources` registry is the only authority for the nightly account
scope. A targeted handle filter is allowed only for an explicit recovery run.

Expected secret binding:

1. `MONITOR_CONFIG=pipeline-monitor-config:latest`

## Windows Read-Only Verify

Use this from PowerShell on the workstation:

```powershell
powershell -ExecutionPolicy Bypass -File "C:\Users\blahn\OneDrive\Desktop\SUNO YouTube Pipeline\enviroment\AEGIS\yt-ingest\verify_harvest_runtime.ps1"
```

This verifies:

1. `gcloud` auth is active in PowerShell
2. `pipeline-monitor-config` exists
3. runtime service account matches expected value
4. env vars are separate and correct
5. `MONITOR_CONFIG` secret binding is correct
6. latest execution snapshot is visible

Use this when you want a cheap “is the deployed job still shaped correctly?” answer without building or updating anything.

## Cloud Shell Read-Only Verify

Use this in Cloud Shell or any bash shell where:

```bash
gcloud auth print-access-token
```

already succeeds.

Commands:

```bash
cd ~/yt-ingest
bash -n ./redeploy_harvest.sh
VERIFY_ONLY=true ./redeploy_harvest.sh
```

This verifies the same runtime shape through the authoritative deploy script without building a new image or updating the job.

## Cloud Shell Redeploy Without Extra Harvest Run

Use this when:

1. local harvest/export code changed meaningfully
2. the nightly job should be re-stamped from the current repo
3. you want a clean redeploy but do not want to spend Cloud Run time on an extra immediate manual run

Commands:

```bash
cd ~/yt-ingest
bash -n ./redeploy_harvest.sh
VERIFY_ONLY=true ./redeploy_harvest.sh
TRIGGER_NOW=n ./redeploy_harvest.sh
```

Expected outcome:

1. Cloud Build rebuilds the image
2. Cloud Run job is updated
3. deploy script verifies the post-update runtime shape
4. no immediate manual harvest run is triggered

## Cloud Shell Redeploy And Immediate Manual Run

Use this only when the redeploy itself is not enough and one high-signal validation run is justified.

Commands:

```bash
cd ~/yt-ingest
bash -n ./redeploy_harvest.sh
VERIFY_ONLY=true ./redeploy_harvest.sh
TRIGGER_NOW=y ./redeploy_harvest.sh
```

Use this only when the manual run is expected to answer a concrete question such as:

1. does the current image rebuild/export successfully
2. does the deployed job write the expected export artifacts
3. does Vault freshness advance after the current fix

## Success Signals

For a healthy run, look for:

1. `STEP 5` rebuild completes
2. `Written ... rows -> latest_catalog_wide.csv`
3. upload of:
   - `latest_catalog_wide.csv`
   - `latest_catalog_wide.meta.json`
4. `STEP 5b` catalog and published-storage contract checks pass
5. execution completion / exit `0`
6. Vault freshness advances or remains current
7. Step 6 writes `pipeline_monitor_status.json`

## Step 5 Status Artifact

`pipeline_monitor.py` now writes:

1. `pipeline_monitor_status.json`

Expected use:

1. quick machine-readable verdict for the most recent monitor pass
2. easier operator review after noisy runs
3. future dashboard/ops surfacing without depending on email delivery

Expected status values:

1. `healthy`
2. `partial_harvest`
3. `stale`
4. `queue_errors`
5. `failure`

`partial_harvest` means media harvesting had hard errors, but the catalog export was still rebuilt from successfully synced items.

## Noise Versus Failure

These log lines are noisy but not necessarily fatal:

1. `MISSING_GCS`
2. `video not captured`
3. `thumb not captured`
4. `Task was destroyed but it is pending!`

These can be nonfatal execution warnings, but missing required media or unresolved source coverage still means feature acceptance is incomplete. Record the affected items, responsible owner, and next recovery action. A successful export or exit zero does not prove the missing artifacts were recovered.

Fatal indicators are things like:

1. traceback in `rebuild_catalog.py`
2. export upload never happens
3. Cloud Run execution status is failed
4. container exits nonzero

## August 18 Baseline

Generation `39` was the August 18 harvest baseline. Execution `suno-harvest-67wdf`
completed successfully in approximately seven minutes, with no retry, after
the optional-MP4 repair policy was enabled. It passed both contract checks and
reported a fresh published catalog. Retain this dated evidence for comparison;
verify the current deployed generation and latest accepted evidence before
making a release decision. This documentation update does not revalidate live state.

## Current Operator Split

Use:

1. `verify_harvest_runtime.ps1`
   - cheap workstation verification
2. `redeploy_harvest.sh`
   - authoritative Cloud Shell / bash redeploy path

Do not treat ad hoc inline `gcloud run jobs update --set-env-vars ...` commands as authoritative for this job.

## Active Source Lifecycle

The scheduler harvests only source records where `platform=suno`, `isActive`
and `harvestEnabled` are true, and `status` is not `inactive`, `disabled`, or
`archived`. An unavailable or empty registry is a hard failure: the job must
not infer a fallback account list. This preserves archived customer history
without accidentally restarting collection for a former customer.

For an account whose public profile is readable but whose private or link-only
library is not connected through an approved provider, publish only the
authoritative public snapshot and report the account as `partial_source`.
Do not infer removal from that profile: removal mutation requires both
`ingestionMode=owned_library` or `official_export` and
`authorityStatus=verified` on the source document. If any active source read
fails, defer all removal mutations for the run.
