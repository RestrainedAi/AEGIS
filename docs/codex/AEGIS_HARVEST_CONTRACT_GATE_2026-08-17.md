# Harvest Contract Gate - 2026-08-17

## Purpose

Prevent a Cloud Run harvest from reporting success when the catalog artifact
served by Vault is missing required columns, has a different row count, or has
not actually reached GCS.

## Deployed Change

- Harvest image digest: `sha256:e70fed02d2541ec2a18a048191475691490134f053e6064b129067332d580fe1`
- Cloud Build: `2a685953-ec8a-443c-a782-3744a26dfa5a`
- Cloud Run job: `suno-harvest`, generation 39, `us-central1`
- Runtime service account: `cloud-run-jobs@stable-framing-482501-t9.iam.gserviceaccount.com`

The image now includes the lyrics artifact backfill, the fixture-based export
contract check, the published-GCS contract check, and the fixture required by
the test. The entrypoint runs both validations immediately after each catalog
rebuild. A failure exits the job, which invokes the existing monitor alert
trap. It cannot be reported as a successful harvest.

The manifest count is now parsed with Python's CSV reader. Lyrics and prompts
can contain embedded newlines, so the prior shell line count could report
thousands of "rows" for a manifest that actually had a few hundred records.

## Source Registry Correction

`genxdreams` was subsequently reclassified as an archived former customer.
Its historical catalog and media are preserved, while `isActive=false`,
`harvestEnabled=false`, and `status=archived` exclude it from new collection.

The normal nightly scope is now the authoritative active registry only:

- `unshakableechos2341`
- `nessihenize`
- `gravitystruth`

The harvest no longer injects a fallback account list. An empty or unreadable
registry fails closed before any source mutation, so a customer lifecycle
change cannot be bypassed by deployment configuration.

## Current Verification Run

All-account execution `suno-harvest-67wdf` completed successfully in seven
minutes on August 18. The run used the active Firestore registry only, rebuilt
the catalog, passed the catalog contract check, passed the published-storage
contract check, and exited without a retry. Optional historical MP4 repair is
now deferred from the critical publication path, so that backlog cannot block
customer catalog freshness.

## Remaining Risk

The run identified legacy zero-byte media objects. Those remain an asset-repair
backlog and are no longer allowed to delay catalog publication. The catalog
publish gate prevents a completed run from serving a mismatched export, but it
does not hide unavailable upstream media.

Public Suno profiles are not authoritative for private or link-only libraries.
Until an account is connected through a supported consented source, its public
snapshot may publish but must be reported as partial rather than current.
