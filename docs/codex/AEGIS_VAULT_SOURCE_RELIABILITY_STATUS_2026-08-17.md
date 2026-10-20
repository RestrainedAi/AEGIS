# AEGIS Vault Source Reliability Status - 2026-08-17

## Executive Summary

Vault freshness is now treated as a source-authority problem, not merely an
export timestamp problem. A successful CSV rebuild cannot certify that a
customer's newest private Suno songs were available to the harvest.

## Current Operating State

- Active nightly sources: `unshakableechos2341`, `nessihenize`, and
  `gravitystruth`.
- Archived source: `genxdreams`; history and media remain retained, while new
  collection is disabled until an explicit reactivation.
- Source failures are fail-closed: they do not mark songs removed.
- Public profile snapshots may be published only when readable. A private or
  link-only library without supported authorization is reported as partial.
- A readable public profile is not removal authority. Only a source explicitly
  configured as `owned_library` or `official_export` with
  `authorityStatus=verified` may mark a song `removed_from_suno`.

## Completed Hardening

- Removed persistent single-account harvest configuration from deployment.
- Made the Firestore source registry the only default harvest scope.
- Made an unreadable or empty source registry fail before any inferred harvest.
- Added source-read failure protection for removal updates.
- Added a removal-authority gate: public-only snapshots can repair or publish
  verified rows but cannot infer that absent private songs were deleted.
- Persisted source health fields (`ingestionMode`, `authorityStatus`,
  `lastSourceSnapshotAt`, and `lastSourceError`) on each active source during
  harvest.
- Added catalog contract validation after rebuild and before completed-run
  certification.
- Preserved historical GenX records and restored verified mistakenly removed
  Vanessa primary records.
- Deferred optional MP4 repair work so historical zero-byte video objects cannot
  hold up a fresh catalog publication. Audio, artwork, lyrics, and catalog rows
  remain the required customer package inputs.
- Changed safe partial-source outcomes to publish the validated catalog without
  retrying the entire Cloud Run job. Hard catalog and storage failures still
  fail the run.

## P0 Remaining Work

1. Surface the already-persisted per-account authorization, source mode,
   latest-authoritative item, source-scan, and partial/blocked state in Vault
   and Control Center.
2. Build a supported, consented private-library source connector or official
   export import. Do not use passwords, cookies, or browser-session scraping.
3. Run the active-account public-source harvest nightly with no handle filter,
   then verify each published account slice.
4. Complete signed-in customer checks for the durable, account-scoped export
   job for both Vanessa accounts, including a real browser download of every
   resulting package part.
5. Add alerts for stuck package work and show account freshness/package state
   in Vault and Control Center.

## August 17-18 Live Recovery Verification

- Deployment generation `36` was stopped after its public-only
  `unshakableechos2341` scan attempted to mark five absent clips removed. The
  records were restored and public-only scans no longer have removal authority.
- Generation `39` deployed image
  `sha256:e70fed02d2541ec2a18a048191475691490134f053e6064b129067332d580fe1`.
- All-account execution `suno-harvest-67wdf` started at
  `2026-08-18T00:54:27Z` and completed successfully at `2026-08-18T01:01:34Z`
  with no retry.
- The run rebuilt the published catalog, passed its catalog contract check and
  published-storage contract check, and reported `catalog_age_hours=0.0` with
  `queue_errors=0`.
- The active public sources remain correctly reported as partial where a
  supported private-library connection is absent. That is source visibility,
  not catalog-publication failure.

## Release Gate

Do not claim that every customer account is current until every active account
has an authoritative source path. A readable public snapshot is valid but must
be labelled `partial_source` when private-library authority is unavailable.

## August 18 Downloader Follow-up

- Viewer revision `suno-viewer-00212-7zs` is serving all traffic with durable
  account-scoped package recovery and a ten-day package window.
- Records written during the earlier one-day window are upgraded to the
  ten-day window when read, provided their customer window has not already
  ended. This prevents a ready package from being hidden merely because the
  customer returns the next day.
- The service runtime has the required package-storage access. The local
  deployment identity does not have direct object-list permission on
  `aeonimus-workspaces`; local storage inspection is therefore not a substitute
  for the signed-in Vault acceptance run.
- Required customer acceptance remains unchanged: create and download separate
  full packages for `unshakableechos2341` and `nessihenize`, including each ZIP
  part and both package summaries.
