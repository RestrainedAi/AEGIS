# AEGIS Jira Two-Stream Work Plan

## Purpose

This note reorganizes the current AEGIS work into the two active delivery streams the project is now operating against:

1. `SUNO Harvest`
2. `Vault to YouTube`

The goal is to make Jira planning, agent assignment, and design-to-engineering execution cleaner by separating ingest and preservation work from downstream publishing work.

This document is meant to complement the existing backlog docs, not replace them.

## June 14, 2026 status snapshot

The dated status sections below retain their original evidence and chronology. They are not a live status refresh as of September 20, 2026. Use the [master authority map](AEGIS_MASTER_SOURCE_OF_TRUTH.md) and [delivery board](../board/README.md) for current ownership and recorded delivery state; verify runtime state before operational decisions.

### Current feature planning rules (September 20, 2026)

Apply [Development DNA](DEVELOPMENT_PRINCIPLES.md) within both streams. Every feature has one accountable owner; large features use focused specialist tasks with single-writer boundaries. Identify the current agent filling the named workstream role rather than assuming historical agent names are still running.

Before execution, attach a [feature brief](templates/FEATURE_BRIEF.md) to the existing work item: customer outcome, acceptance checks, owner, specialist outputs, dependencies, evidence, and next action. Sequence dependencies, branch on observed results, and loop failed checks back to the responsible specialist. Integrate and verify the complete feature before marking it done. A Jira-ready plan does not establish that an external Jira issue was created or updated.

Current truth after the June 14 recovery and hardening pass:

1. The live Vault freshness incident is no longer just an operator memory item.
2. The harvest path was patched so zero-row delta manifests no longer skip metadata enrichment and `rebuild_catalog.py`.
3. The viewer/admin layer now surfaces explicit catalog freshness states:
   - `healthy`
   - `stale`
   - `mismatch`
   - `source_ahead`
   - `unavailable`
4. `/api/admin/overview` now compares newest Firestore song time against newest served export time, which directly covers the June 14 drift pattern where the Vault looked healthy enough until someone noticed the newest visible song date was wrong.
5. A residual lyrics-repair bug was then found while checking the post-fix Vault surface:
   - the SUNO repair path was reading `metadata.prompt` as the primary lyrics source
   - archived clip payload samples in-repo show a separate top-level `lyrics` field that can be populated even when prompt is empty
   - local fixes now prefer `clip.lyrics`, then `metadata.lyrics`, then `metadata.prompt`
   - the Cloud Run entrypoint now also runs `backfill_lyrics_artifacts.py --missing-only` after enrichment and before export rebuild
6. The remaining open auth trust gap is still the real-browser verification tracked in Jira `DEV-72`.

Immediate active order:

1. Run the next authenticated harvest/repair pass and confirm the residual missing-lyrics pocket clears.
2. Observe the next scheduled harvest and confirm freshness stays healthy without manual rebuild.
3. Close `DEV-72` with real browser verification for signed-in `/login -> /vault` and the no-account fallback branch.
4. Return to the next live search improvements after those trust checks are closed.

## June 15, 2026 addendum

One more layer of truth was established after the June 14 note above:

1. the local lyrics-source bug fix was not the whole story
2. a narrow viewer-side suppression patch was shipped for stale duplicate lyricless rows that were shadowed by better siblings
3. that patch was deployed live on Cloud Run revision `suno-viewer-00183-f55`
4. live Firestore verification after deploy shows the residual missing-lyrics pocket is now explicitly bounded at `64` records total
5. the remaining blocker is upstream SUNO clip-detail `403 Forbidden` responses on those unrepaired rows, not the old `metadata.prompt` parsing bug

Operationally, that changes the follow-up framing:

1. we should still watch the next scheduled harvest for freshness drift
2. but residual lyrics verification is now partly a source-availability question, not only a pipeline-correctness question
3. a separate product/ops decision is needed on how to present genuinely unrecoverable lyrics gaps to end users

## June 15, 2026 verification narrowing

The next trust checks also became more specific after live browser and export verification:

1. signed-in `/login -> /vault` is now proven on `sundrop.music`
2. `sundrop.cloud/login` is serving the intended stripped-down two-option page:
   - `GOOGLE LOGIN`
   - `BETA SIGNUP`
3. the remaining auth/browser proof gap is now the real no-account Google-login fallback branch, not the signed-in happy path
4. canonical export freshness is currently healthy again:
   - `generatedAt: 2026-06-15T05:15:29Z`
   - `rowCount: 2451`
   - newest item still `2026-06-13T23:20:55.989Z`

## June 15, 2026 late addendum

The trust picture tightened further later the same day:

1. Control Center verification moved from open suspicion to a concrete fix
2. the failing behavior on `sundrop.music/control-center` was caused by:
   - admin resolution tied only to `admins/{uid}` while the live `aegis@aeonimus.ai` login was on a newer Firebase UID than the older admin doc
   - a client race where `AdminControlCenter.tsx` requested `/api/admin/overview` before Firebase auth restoration completed
3. the fix set that shipped live:
   - server fallback to resolve admin docs by email when the direct UID lookup misses
   - client-side wait for auth/session readiness before loading the admin overview
4. rollout:
   - deployed live on revision `suno-viewer-00187-tm9`
   - real browser verification now proves signed-in operator access on `https://sundrop.music/control-center`
5. export freshness also advanced:
   - canonical export metadata now reports `generatedAt: 2026-06-15T08:51:02Z`
   - row count is now `2456`
   - newest served/source song time is `2026-06-14T19:52:17.658Z`
6. residual lyrics pocket improved again:
   - direct Firestore recount shows `47` remaining `lyricsStatus = MISSING` rows
   - a fresh authenticated manual harvest execution `suno-harvest-jx9ln` was started on June 15 and is the next evidence point for whether that pocket shrinks further

## June 15, 2026 end-of-pass addendum

Two more facts became durable by the end of the day:

1. the authenticated manual repair run settled
   - execution `suno-harvest-jx9ln` completed successfully
   - a direct Firestore recount after completion still shows `47` rows with `lyricsStatus = MISSING`
   - the remaining lyrics gap is now a stable residual set after the latest repair pass, not just a still-running-job artifact
2. `AEGIS-SEARCH-004` moved forward live
   - a second relevance tuning pass shipped on revision `suno-viewer-00189-mv2`
   - query handling now:
     - normalizes punctuation-heavy titles more gracefully
     - supports multi-token matches across fields such as account plus lyrics
     - rejects partial multi-token matches that only satisfy part of the query intent
3. practical implication for the next work order
   - no-account fallback proof on the canonical domains still deserves closure
   - residual lyrics work is now a bounded repair/ops lane
   - the next product implementation step after trust checks should continue `AEGIS-SEARCH-002` / `AEGIS-SEARCH-003` mobile treatment and then move toward search-to-action workflow stabilization

## June 16-17, 2026 harvest reliability addendum

Another important distinction became durable during the June 16/17 reliability pass:

1. the nightly harvest did not stop running
2. Cloud Scheduler `suno-harvest-nightly` remained enabled on `0 2 * * * America/Chicago`
3. recent Cloud Run executions still completed successfully and continued rebuilding the canonical export
4. the real gap was in monitoring semantics, not only in scheduling
5. the old post-harvest monitor could still report `healthy` when:

## June 17, 2026 source-selection finding

The next root-cause pass refined the problem one level deeper:

1. the live public Suno profile API for `unshakableechos2341` is already returning newer June 15 songs
2. examples confirmed live during the pass:
   - `Fire Does Not Ask Permission` at `2026-06-15T04:42:36.632Z`
   - `RAMPAGE KILL BILL STYLE` at `2026-06-15T04:26:28.455Z`
3. that means the clip-detail/profile fetch path itself is not the blocker
4. the likely failure lane is source selection before ingest writes:
   - Firestore/export stayed at June 14
   - harvest likely skipped the Vanessa source entirely on affected runs
5. the immediate hardening patch landed in `yt-ingest/catalog_sync_firestore_multi.py`
   - the Firestore registry result is now merged with a minimum fallback floor instead of replacing it
   - the fallback floor now explicitly includes `unshakableechos2341`, `genxdreams`, and `gravitystruth`
   - `delta_report.json` now records `registry_warning` and `fallback_injected`
6. a focused regression test now exists in `yt-ingest/test_catalog_sync_sources.py`
7. the remaining required step is operational:
   - redeploy the harvest image
   - run a fresh harvest
   - verify Firestore/export advance to the June 15 Vanessa clips
   - the export had just been rebuilt
   - queue health was green
   - but the newest actual source song in Firestore had not advanced for multiple days
6. live verification during this pass showed:
   - canonical export metadata still fresh on rebuild time
   - latest `sunoSongs.createdAt` still pinned at `2026-06-14T19:52:17.658Z`
   - latest `sunoSongs.lastSeenAt` still advancing into June 17
   - meaning the system was still scanning source but upstream song freshness had gone idle
7. the permanent hardening fix now shipped in `yt-ingest/pipeline_monitor.py`:
   - new `source_idle` status for stale source content age
   - new `source_scan_stale` status for stale scan freshness
   - source freshness included in status summary and digest output
   - post-harvest email suppression only when source freshness, scan freshness, catalog freshness, and queue state are all truly healthy
8. the validator coverage for that classification lives in `yt-ingest/validate_pipeline_monitor_status.py`
9. the hardened harvest image was redeployed live to Cloud Run job generation `21`

Operational implication:

1. our main selling point cannot depend on catalog rebuild time alone
2. we now need to treat these as separate promises:
   - harvest job ran
   - source was scanned recently
   - source content actually advanced recently
   - published Vault export reflects that source state
3. the first two are now much better protected in code, but the product should also eventually expose a clearer freshness banner so a multi-day upstream content drought does not read like a silent platform failure

## June 17, 2026 Vault transparency addendum

The product-side counterpart to the monitor hardening is now live:

1. the Vault itself now explains `source_idle` instead of silently looking stale
2. the same truth was verified on both:
   - `sundrop.cloud/vault`
   - `sundrop.music/vault`
3. the shipped viewer changes:
   - `freshness-utils.js` now emits `source_idle` when export freshness is current but source content age is beyond threshold
   - `server.js` now exposes `/api/vault/freshness` for signed-in Vault users
   - `VaultGrid.tsx` now renders a visible freshness banner showing that the Vault is synced while the source content itself has not advanced recently
4. rollout:
   - tests passed in `suno-viewer/test/freshness-utils.test.js`
   - production build passed
   - Cloud Run viewer deployed on revision `suno-viewer-00192-bm8`
5. live browser verification after deploy confirms:
   - newest visible Vault item remains `Jun 14, 2026`
   - banner text now explicitly states the Vault is synced to source and that source content age is beyond threshold

Practical implication:

1. the current customer-facing symptom is no longer ambiguous
2. if the Vault looks old while that banner is present, the next investigation lane is upstream source generation / ingestion freshness rather than export publishing drift

## June 18, 2026 source-registry drift finding

The next production check closed the gap between suspicion and proof:

1. the stale-account problem was not limited to Vanessa
2. live public Suno verification for `genxdreams` showed newer May songs such as:
   - `Send These Lizards` at `2026-05-01T04:19:47.973Z`
   - `Sold for Roses` at `2026-05-07T16:36:19.107Z`
   - `Greasy Hollow Glow` at `2026-05-21T02:26:07.44Z`
3. the published Vault/export still had `genxdreams` frozen at `2026-04-07T05:39:01.154Z`
4. Firestore `sources` verification then proved the live registry only contained:
   - `unshakableechos2341`
   - `gravitystruth`
   and was missing `genxdreams`
5. that means the real production risk was two-part:
   - registry coverage had drifted
   - the newer harvest image with fallback-floor merging had been built but the Cloud Run job itself had not been updated to use the new spec
6. operational proof:
   - Cloud Build `775a4987-49fe-4018-8b1d-6a5fed38f1f0` produced the hardened harvest image on June 18
   - the live Cloud Run job was still on generation `21` until manually updated
   - the job was then updated to generation `22`
   - a manual execution `suno-harvest-cmldj` was started on the patched image digest `sha256:51006371339b66196c97d9af8923c1d13f122bb86309b2ccf09b493046d71afd`
7. live execution logs from that patched run now prove the intended repair path:
   - `genxdreams: 32 delta rows (new=19, missing_gcs=9, metadata_repairs=4)`
   - multiple GenX songs are being upserted and stored under `gs://aeonimus-suno-media/suno/handles/genxdreams/...`
   - direct Firestore spot-check already confirms `f7ea9223-02d8-4b6b-a2e0-24f2d05b2bf6 / Sold for Roses / 2026-05-07T16:36:19.107Z`

## July 27, 2026 harvest outage and export recovery

Another reliability incident was confirmed and partially repaired on Monday, July 27, 2026.

Current truth:

1. the Vault/export had gone stale again, this time because the scheduled harvest job stopped starting at all after July 23, 2026
2. recent scheduled executions on July 24, July 25, and July 26 failed before container startup
3. the concrete Cloud Run failure reason was:
   - `ContainerPermissionDenied`
   - Cloud Run service agent `service-206866140882@serverless-robot-prod.iam.gserviceaccount.com` could not read image `us-central1-docker.pkg.dev/stable-framing-482501-t9/aeonimus-repo/harvest-job:latest`
4. the authoritative stale export evidence before repair was:
   - `generatedAt: 2026-07-23T08:46:17Z`
   - `rowCount: 2586`
5. the immediate infrastructure repair was applied at the project IAM layer:
   - granted `roles/artifactregistry.reader` to `service-206866140882@serverless-robot-prod.iam.gserviceaccount.com`
6. a manual recovery execution was then started:
   - `suno-harvest-52p5g`
7. that run cleared the old startup failure and resumed real harvest work, including new deltas for:
   - `gravitystruth`
   - `nessihenize`
   - large repair backlog on `unshakableechos2341`
8. because that repair run has a long media-fix tail, the live export was also manually rebuilt from current Firestore state with:
   - `python rebuild_catalog.py`
9. canonical export metadata after that forced rebuild advanced to:
   - `generatedAt: 2026-07-27T03:34:14Z`
   - `rowCount: 2601`
10. the newest served item in the rebuilt export is now:
   - `2026-07-26T02:10:05.476Z`
   - `One Friend Came`
   - account `gravitystruth`

Operational implication:

1. this was not just another source-idle or viewer-cache incident
2. the production weak point was Cloud Run image-read permission drift
3. a healthy post-harvest/export design still needs a second guardrail so the Vault can be refreshed from Firestore even when a long media-repair tail is still running

Immediate next hardening order:

1. verify `suno-harvest-52p5g` completes successfully and confirm it performs its own final rebuild cleanly
2. add an explicit preflight/runtime verification that the Cloud Run service agent still has Artifact Registry read permission
3. add a documented emergency rebuild step for `latest_catalog_wide.*` from Firestore when harvest media repair is still running but Firestore is already advanced
4. add an alert path for consecutive scheduled harvest startup failures, not only stale export age

Practical implication:

1. the permanent fix is not just "run harvest again"
2. we need both:
   - fallback-floor source selection in code
   - a deployment discipline that updates the Cloud Run job after every successful harvest image build
3. follow-up verification still required:
   - wait for `suno-harvest-cmldj` to complete
   - confirm the canonical export and visible Vault advance for `genxdreams`
   - decide whether `sources` registry drift itself should become an explicit monitor/alarm condition

Primary sources:

1. `docs/board/tasks.json`
2. `docs/codex/SUNO_Youtube_Pipeline_First_Wave_Ticket_Board.md`
3. `docs/codex/SUNO_Youtube_Pipeline_Implementation_Epics_and_Tickets.md`
4. `docs/codex/SUNO_SUNO_To_YouTube_Production_Workflow_Spec.md`
5. `docs/design/aegis-design-board-page-map-v1.md`

## Stream 1: SUNO Harvest

### Mission

Keep the SUNO acquisition, preservation, and vault freshness path healthy and trustworthy.

### Scope

This stream owns:

1. source discovery from SUNO public profiles
2. delta detection
3. media capture and repair
4. Firestore indexing
5. catalog export generation
6. vault freshness
7. harvest monitoring, digesting, and incident visibility

### User-facing outcomes

1. The vault updates when new public SUNO songs are published.
2. Missing media and stale sources are visible quickly.
3. Operators can tell whether the problem is harvest, media capture, or export publish.

### Operating constraint

SUNO harvest execution must be treated as an expensive operational action.

Planning and execution assumptions:

1. Harvest runs take significant time and consume real Google Cloud resources.
2. Server resources should be assumed limited unless explicitly expanded.
3. Manual harvest runs should be rare, hypothesis-driven, and high-signal.
4. The team should prefer dry checks, config inspection, log review, digest review, and export inspection before triggering a run.
5. Each manual run should be designed to answer multiple validation questions at once.

Working rule:

1. Do not trigger a manual harvest run without a stated hypothesis, validation target, and expected operational value.

Validation order for this stream:

1. inspect live config
2. inspect latest logs
3. inspect export freshness
4. inspect digest and monitor evidence
5. trigger a harvest only if the earlier evidence is insufficient

### Jira epic grouping

Recommended epics under `SUNO Harvest`:

1. `Harvest Reliability`
2. `Catalog Rebuild and Freshness`
3. `Harvest Monitoring and Alerts`
4. `Harvest UX and Visibility`

### Existing tickets that belong here

#### Core stability

1. `AEGIS-001` Confirm authoritative catalog export generator
2. `AEGIS-006` Decide and implement post-harvest catalog rebuild orchestration
3. `AEGIS-008` Document canonical ops entry points
4. `AEGIS-009` Add minimal export freshness visibility
5. `EPIC-13` Establish monitoring and operational visibility
6. `EPIC-14` Establish quality and release discipline

#### Design and product surfaces

1. `EPIC-11` Define status taxonomy and operational UI model
2. `EPIC-12` Deliver UX handoff for core product surfaces

#### Likely net-new child tickets

1. Separate harvest freshness from export freshness in operator-facing UI
2. Add explicit `partial harvest` handling so export rebuild still runs
3. Create issue rules for stale source, missing media, removed item, and failed rebuild
4. Add runbook and recovery notes for digest alert follow-up
5. Add safe cleanup/lifecycle policy for zero-byte and stale media artifacts later

### Recommended Jira issue types

1. Epic
2. Story
3. Task
4. Bug

### Suggested first working order

1. Lock the production harvest path and recovery path
2. Make freshness and failures visible in the product shell
3. Finish the dashboard, runs, and issues experience for this stream

### Current active sub-order inside this stream

After the June 14 fixes, the immediate SUNO Harvest order is:

1. verify the next scheduled `suno-harvest` run keeps the catalog current without intervention
2. keep the new admin freshness signals honest against real production behavior
3. decide whether the same freshness status should surface outside the admin control center

### Execution style for this stream

The SUNO Harvest stream should optimize for:

1. low-run-count validation
2. high-signal checks
3. dry-run or inspect-first workflows
4. minimal exploratory execution
5. recovery procedures that avoid repeated reruns

## Stream 2: Vault to YouTube

### Mission

Turn the vault into a reliable staging and handoff surface for YouTube publishing.

### Scope

This stream owns:

1. publish readiness states
2. queue creation from the vault
3. queue schema and lifecycle
4. uploader input contract
5. YouTube auth and execution reliability
6. queue and upload status visibility in the UI

### User-facing outcomes

1. A user can select an item in the vault and queue it for YouTube safely.
2. Queue records are distinct from catalog records.
3. Users can see whether an item is queued, uploaded, failed, or blocked.

### Jira epic grouping

Recommended epics under `Vault to YouTube`:

1. `Queue Model and Contract`
2. `Vault Publish Handoff`
3. `Uploader Reliability`
4. `Publish UX and Status Visibility`

### Existing tickets that belong here

#### Core publishing path

1. `AEGIS-002` Standardize YouTube API environment naming
2. `AEGIS-003` Define dedicated `ytUploadQueue` schema
3. `AEGIS-004` Update queue manager to use `ytUploadQueue`
4. `AEGIS-005` Align YouTube uploader with real SUNO media schema
5. `AEGIS-010` Implement viewer-to-queue publish action

#### Product and design support

1. `EPIC-11` Define status taxonomy and operational UI model
2. `EPIC-12` Deliver UX handoff for core product surfaces

### Likely net-new child tickets

1. Add queue state badges to Catalog Browser and Item Detail
2. Add item-level publish readiness checks before queue submission
3. Create queue review and upload history views
4. Clarify duplicate-submission prevention rules in UI and backend
5. Add uploader failure reason surfacing in operator-facing screens

### Recommended Jira issue types

1. Epic
2. Story
3. Task
4. Bug

### Suggested first working order

1. Lock queue schema and queue lifecycle
2. Validate the end-to-end vault publish handoff
3. Make queue and upload state visible in the vault UI
4. Tackle uploader auth and execution issues as a separate reliability lane

### Current active sub-order inside this stream

The highest-priority live work still open in this stream is:

1. close `DEV-72` auth regression verification on the canonical domains
2. once auth trust is closed, return to `AEGIS-SEARCH-004` live relevance tuning
3. then continue `AEGIS-SEARCH-002` structured filter expansion

## Shared Layer

Some work spans both streams and should either live in shared epics or be linked across tickets.

### Shared concerns

1. status taxonomy
2. dashboard shell
3. issues model
4. item detail lineage
5. release discipline
6. monitoring standards

### Shared design surfaces

1. `Dashboard`
2. `Catalog Browser`
3. `Item Detail`
4. `Issues View`

### Shared implementation surfaces

1. `suno-viewer`
2. Firestore `sunoSongs`
3. export freshness metadata
4. queue and uploader status mapping

## Recommended Jira Structure

### Option A: Two epics with child stories

Use:

1. `SUNO Harvest`
2. `Vault to YouTube`

And group the current work as child stories/tasks beneath those two umbrella epics.

This is the fastest structure if Jira is still being normalized.

### Option B: Two initiatives with multiple epics

Use:

1. Initiative: `SUNO Harvest`
2. Initiative: `Vault to YouTube`

Under them, create the recommended epics listed above.

This is the better long-term structure if Jira will hold the project for a while.

## Recommended Agent Assignment

### Agent 1: SUNO Harvest Lead

Owns:

1. harvest reliability
2. export rebuild
3. freshness visibility
4. incidents and monitoring

### Agent 2: Vault to YouTube Lead

Owns:

1. queue model
2. publish handoff
3. uploader contract
4. queue and upload state in the UI

## Immediate Next Step

If moving this into Jira now, the cleanest first move is:

1. create the two stream epics
2. move or relabel the existing AEGIS tickets under the correct stream
3. add net-new child stories only where the stream still has gaps
4. assign one working agent per stream

That gives the team a clear split between:

1. `Can the vault stay fresh?`
2. `Can the vault publish to YouTube?`

## August 17, 2026 Reliability Addendum

The current P0 order is source authority, safe nightly publication, and durable
account-scoped exports. `genxdreams` is archived as a non-paying customer:
retain its history and media, but never poll it unless explicitly reactivated.

The active source registry is the nightly authority. A registry read failure is
not permission to fall back to a hard-coded account list. Each active account
must independently report `healthy`, `partial_source`, or `blocked_source`.
Only authoritative source snapshots may change removal state or certify the
Vault as current.

Private or link-only Suno libraries require a supported consented connection.
No password, cookie, or browser-session extraction is an acceptable product
integration. Until supported access exists, publish the readable public slice
and show a partial status.

## August 18, 2026 Buildout Update

The nightly active-registry harvest is now deployed on Cloud Run generation
`39`. Run `suno-harvest-67wdf` completed successfully in approximately seven
minutes with no retry. It rebuilt the catalog and passed both the catalog and
published-storage contract checks. The active nightly source set remains:

1. `unshakableechos2341`
2. `nessihenize`
3. `gravitystruth`

`genxdreams` remains archived. Its history and media are retained, while new
collection is disabled until an explicit reactivation.

Current P0 delivery order:

1. `AEGIS-HARVEST-003`: display account-level source health and partial status.
2. `AEGIS-D006`: complete signed-in full-export acceptance checks for both
   Vanessa accounts, including every package part.
3. `AEGIS-REL-001`: add stuck-package and account-level operational alerts.
4. `AEGIS-AUTH-001`: deploy and verify the user-controlled session duration:
   72 hours through 31 days, default 10 days.
5. Add a supported private-library connection or official export import for
   any source whose public profile does not expose its newest library items.
