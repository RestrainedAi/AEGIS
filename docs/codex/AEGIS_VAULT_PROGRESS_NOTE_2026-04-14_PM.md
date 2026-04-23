# AEGIS Vault Progress Note

Date: 2026-04-14

## What was fixed in this stretch

- the post-auth black-screen Vault crash was fixed by restoring stable React hook order in the desktop Vault interaction path
- protected thumbnail/media link behavior was cleaned up so the Vault no longer floods the console with repeated `401` thumb requests during normal authenticated use
- the auth bootstrap was tightened so the client waits for Firebase token resolution before loading `/api/auth/session`, reducing one avoidable early guest-session round trip

## What was deployed

- `suno-viewer-00109-b22`
  - protected thumb/object URL cleanup
- `suno-viewer-00110-8kv`
  - auth bootstrap/session startup cleanup
- `suno-viewer-00111-jtb`
  - favicon route hygiene pass
- `suno-viewer-00112-sff`
  - first catalog fetch now reuses the already-resolved auth token from context instead of triggering another token lookup path
- `suno-viewer-00113-h2v`
  - Vault catalog loading now keys off actual browse access signals instead of the whole session object, reducing avoidable refetch churn during authenticated startup
- `suno-viewer-00115-q69`
  - protected auth-control actions now reuse the already-resolved auth token for workspace selection and access-request mutations instead of forcing another token lookup path
- `suno-viewer-00116-nwd`
  - stale startup session/catalog requests now abort cleanly during auth or browse-state transitions instead of continuing unnecessary background work
- `suno-viewer-00117-t9g`
  - metadata-service access tokens used by `/api/auth/session` are now cached in-process until near expiry, trimming repeat metadata hops on the server side
- `suno-viewer-00118-trb`
  - `/api/auth/session` now exposes timing headers so authenticated DevTools traces can separate server-side session cost from total network time
- `suno-viewer-00120-5vd`
  - first authenticated local catalog export flow with manifest CSV download, asset bundling, and automatic multi-zip sharding for larger catalogs
- `suno-viewer-00124-xcr`
  - downloader/export UX pass with active queue visibility, ready-download lists, phase/step messaging, and the new `/api/catalog-exports` job listing endpoint
- `suno-viewer-00125-dnw`
  - shared `artist / creator / producer / executive` tier matrix now drives public signup catalog, admin tier selection defaults, and server-side plan lookup from one source of truth
- `suno-viewer-00126-96l`
  - first authority pass after the matrix refactor: session payload now carries workspace domain posture, string-valued entitlements are preserved, and Vault download/export controls now gate against tier entitlements such as `downloads.center`, `downloads.single`, `downloads.batch`, `downloads.catalog`, and `downloads.max_batch_size`
- `suno-viewer-00127-z2t`
  - Vault Downloads is now promoted from a buried export panel to a first-class shell destination:
    - sidebar includes a dedicated `Downloads` entry when the plan allows a download center
    - the existing export queue and ready-download lists now live under that destination instead of sharing the main archive workspace
    - archive browsing and downloads now have a cleaner separation without changing the underlying export engine
- `suno-viewer-00128-jln`
  - Downloads now has a more intentional empty state, starting an export moves the user into Downloads automatically, and the sidebar shows lightweight package status text
- `suno-viewer-00129-ghm`
  - ready packages now trigger an in-app banner with a direct `Open Downloads` action so the user does not have to hunt for the finished package
- `suno-viewer-00131-6gg`
  - lower sidebar entries now open honest placeholder sections instead of dead clicks
  - songs missing both lyrics and metadata now show explicit `Still processing` / `Needs attention` states with a support path
  - long chip/tag overflow is constrained so rows and cards stop breaking visually
- `suno-viewer-00132-q5m`
  - empty/non-exportable workspace failures in Downloads no longer pretend a package was built and no longer show misleading zero-stat success states
- `suno-viewer-00133-4bs`
  - the admin `Export workspace` picker is now hidden unless there is a real workspace choice to make
- `suno-viewer-00134-5mp`
  - Downloads failure copy was tightened so the empty-export case reads as a guided “no downloadable catalog yet” state instead of a stacked warning wall
- `suno-viewer-00135-45f`
  - Sovereign Catalog now resolves cover thumbnails through the browser-usable path instead of preferring raw `gs://` values, fixing the blank-cover regression in the condensed list view
- `suno-viewer-00132-q5m` through `suno-viewer-00134-5mp`
  - the empty-workspace / non-exportable Downloads path now fails honestly:
    - no fake zero-byte package success state
    - no duplicate warning stack
    - no useless workspace picker when there is only one choice

## 2026-04-23 stability proof

- the 2026-04-22 scheduled `suno-harvest-542gf` run provides the clearest current proof loop we have for the hardened catalog path:
  - it rebuilt `1915` rows into `latest_catalog_wide.csv`
  - it logged `Uploading to gs://aeonimus-workspaces/exports/suno/latest_catalog_wide.csv...`
  - it logged `Uploading to gs://aeonimus-workspaces/exports/suno/latest_catalog_wide.meta.json...`
  - the post-harvest monitor reported `summary status=healthy catalog_age_hours=0.0 queue_errors=0`
  - the container exited `0`
- the same logs still show repeated media retrieval noise during the run:
  - repeated `curl ... 403`
  - empty downloaded temp files for some media objects
  - `Task was destroyed but it is pending!`
- so the current read is:
  - canonical catalog rebuild/publish did complete
  - the freshness chain is in a better place than the earlier stale-Vault incidents
  - media retrieval robustness still needs its own follow-up lane

## Current drift should be sliced intentionally

- Bundle A: harvest hardening
  - `daily_suno_job.sh`
  - `yt-ingest/Dockerfile.harvest`
  - `yt-ingest/daily_suno_job.sh`
  - `yt-ingest/redeploy_harvest.sh`
- Bundle B: Vault + Downloads UX
  - `suno-viewer/server.js`
  - `suno-viewer/src/components/AdminControlCenter.tsx`
  - `suno-viewer/src/components/AuthControls.tsx`
  - `suno-viewer/src/components/SignupPage.tsx`
  - `suno-viewer/src/components/VaultGrid.tsx`
  - `suno-viewer/src/lib/signupCatalog.ts`
  - `suno-viewer/src/types.ts`
  - `suno-viewer/shared/`
  - `tools/export_local_catalog.py`
- Bundle C: docs + board
  - `docs/board/tasks.json`
  - `docs/codex/AEGIS_LOCAL_CATALOG_EXPORT_2026-04-15.md`
  - `docs/codex/AEGIS_VAULT_PROGRESS_NOTE_2026-04-14_PM.md`
- generated export payload deletions under `data/exports/vanessa_unshakableechos2341_2026-04-15/` should be treated as repo cleanup/generation drift, not as part of the product feature bundle

## Current read

### Fixed / materially improved

- Vault rendering after sign-in
- repeated thumb `401` noise
- startup auth/session sequencing
- first catalog fetch token reuse
- Vault catalog load effect dependency churn
- auth-control mutation token reuse
- stale startup request cleanup
- fresh unauthenticated startup traces are down to a single `/api/auth/session` request in browser verification
- server-side metadata access token reuse for session path
- session timing headers available for the next authenticated trace pass
- Tier 1 local catalog export now has a first working implementation in the Vault, including manifest download and sharded ZIP packaging
- local catalog export now has a clearer customer-facing queue/readiness model instead of a single transient export block:
  - active jobs show packaging phase and step labels
  - ready jobs render as a simple downloadable list with type, size, and one download action per item
  - export history can now be fetched from the server while jobs remain alive in the current TTL window
- tier modeling is no longer just descriptive:
  - the live app now resolves public beta lanes from the shared tier matrix
  - session state now includes active-workspace domain posture from the plan
  - Vault download/export affordances now honor the shared tier entitlements instead of relying on isolated one-off checks
- export packaging now avoids the two major Windows pain points found in the Vanessa walkthrough:
  - asset filenames are shortened to stable song-key-based names
  - per-part manifests are uniquely named so extracting multiple ZIPs into one folder no longer overwrites manifest files
- Downloads is now a real place in the Vault shell instead of a hidden operator panel:
  - it has a dedicated sidebar destination
  - it shows queue/readiness state and recent-package context
  - empty and failure states now guide the user instead of implying a broken partial success
- lower-shell polish is improving beta trust too:
  - placeholder sections prevent dead-end clicks
  - missing-asset states now expose a visible support path instead of leaving the user to guess

### Still low-priority / not worth stalling on right now

- root `favicon.ico` 404 may still appear depending on hosting/browser behavior even after the route hygiene pass
- this is cosmetic console noise, not a product-security or protected-media regression
- the latest session timing instrumentation is deployed, but the public route did not surface the timing headers or opt-in debug payload in quick verification yet, so that observability path needs one more focused check before it becomes a reliable operator tool
- local catalog export job metadata is still instance-local and temporary, so this first pass should be treated as working beta functionality rather than durable export history
- Downloads request flow is still heavier on full-catalog packaging than it is on song-level or selected-song requests, so the next UX pass should make it much clearer what scope the user is asking to prepare before they click
- non-interactive `gcloud` inspection in the Codex shell is still inconsistent even after local reauth, so operational proof should continue to prefer captured Cloud Run logs and artifact metadata unless the shell token path is confirmed healthy again

## Board alignment

- `AEGIS-030` can be treated as complete for the main protected-media console flood problem
- `AEGIS-031` is now active and owns the next startup/performance pass
- `AEGIS-029` remains the longer-term auth/session hardening lane after beta-safe work
- `AEGIS-D002` is now active and owns continued downloader/export packaging hardening after the first shipping pass
- `AEGIS-015` and `AEGIS-016` are now active reliability lanes because we are doing real post-deploy/live-product proof work and subsystem health separation, not just talking about them

## Suggested next move

Continue with `AEGIS-031`:

1. verify whether duplicate session fetches are fully gone in authenticated traces
2. profile the next biggest startup/layout cost after auth stabilization
3. make only low-risk startup improvements while Vault behavior is finally stable

For the downloader lane:

1. unify `single song`, `selected songs`, and `full catalog` into one clearer request model so users know what they are packaging before they click
2. decide whether export job metadata should move to Firestore or another durable short-lived job store
3. keep tightening Downloads copy/history behavior so it reads like a customer download center rather than an operator tool
4. decide when to turn domain posture from session metadata into hard `.music` vs `.cloud` enforcement once the two-app cutover details are finalized
