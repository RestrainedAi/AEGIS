# AEGIS Test Matrix

## Purpose

This document defines how the main AEGIS modules behave, what must be tested before handoff, and where we still need deeper coverage. The goal is to stop avoidable regressions by making both feature behavior and verification explicit.

## Handoff rule

Before handing changes to the user:

1. Run automated tests for the touched area.
2. Run a production build for the affected app.
3. Run a focused manual smoke test for the feature path.
4. Call out any known gaps clearly if full coverage is not yet available.

## Module Matrix

### Harvest and freshness chain

Purpose:
- Pull latest Suno catalog data.
- Publish canonical `latest_catalog_wide.csv` and matching metadata.
- Keep Vault freshness in sync with the latest successful harvest.

Automated coverage target:
- Canonical publish verification helpers.
- Metadata match checks (`generatedAt`, `rowCount`, artifact path).
- Failure behavior when publish does not refresh the canonical artifact.

Manual smoke test:
- Confirm newest songs appear in Vault after a verified harvest.
- Confirm stale-catalog failures surface clearly instead of silently appearing healthy.

### Vault browsing

Purpose:
- Let the user browse songs in `Vault Grid` and `Music Catalog`.
- Show thumbnails, metadata, lyrics state, and actions.

Automated coverage target:
- Filtering state helpers.
- Selection state helpers.
- Thumbnail URL fallback logic where possible.

Manual smoke test:
- Verify thumbnails render.
- Verify selection counts match visible rows.
- Verify search/filter/page count combinations behave correctly.

### Downloads and export packaging

Purpose:
- Package one song, selected songs, or full catalog exports.
- Produce:
  - ZIP package(s)
  - CSV song manifest
  - JSON export summary

Automated coverage now:
- Persisted artifact presence (`manifestObject`, `summaryObject`).
- Customer CSV shaping without internal YouTube/GCS-only columns.
- Missing-file status reporting.

Automated coverage to add next:
- Ready state vs error state selection logic.
- Expired job behavior.
- ZIP/manifest/summary download endpoint behavior.

Manual smoke test:
- Single song download.
- Selected-song download (24-song page baseline).
- Full catalog export.
- Verify CSV downloads.
- Verify JSON downloads.
- Verify ZIP downloads.
- Verify missing file counts make sense.

### Audio playback

Purpose:
- Desktop and mobile playback from the Vault UI.

Automated coverage target:
- Player utility behavior where practical.

Manual smoke test:
- Desktop Chrome playback.
- Android Chrome playback.
- Play, pause, and scrub behavior.

### Tier gating and signup catalog

Purpose:
- Present the correct tier matrix and enforce plan entitlements.

Automated coverage target:
- Tier catalog parsing.
- Entitlement checks for download center visibility and package actions.

Manual smoke test:
- Verify visible controls match the active tier.
- Verify disabled or hidden actions stay consistent across views.

### Domain cutover and auth entry points

Purpose:
- Keep `sundrop.cloud` and `sundrop.music` serving the same customer-facing app.
- Ensure login, signup, vault entry, and admin routes still resolve after domain changes.
- Ensure customer-facing links and redirects land on the intended domain.

Automated coverage target:
- Route serving coverage for `/`, `/login`, `/signup`, `/vault`, `/privacy`, and `/terms`.
- Config helpers that build public app URLs for email links and redirects.

Manual smoke test:
- Open `https://sundrop.cloud/` and `https://sundrop.music/`.
- Open `/login` and `/signup` on both domains.
- Confirm successful login redirects to `/vault`.
- Confirm unauthenticated `/vault` shows the gated access state rather than a broken route.
- Confirm admin `/control-center` still resolves on the canonical domain.

### Cross-module regression after domain change

Purpose:
- Verify the URL cutover did not break the main music and security workflows connected to the Vault.

Manual smoke test:
- Harvest and freshness pipeline still updates the catalog source.
- Downloads queue, ready packages, and history still behave correctly.
- Export ZIP, CSV, and JSON artifacts still download from the new domains.
- YouTube queue and publish actions still open and submit correctly.
- Email-driven approval or package links resolve to live app routes.

## Current mandatory commands

From:

`C:\Users\blahn\OneDrive\Desktop\SUNO YouTube Pipeline\enviroment\AEGIS\suno-viewer`

Run:

```powershell
npm test
npm run build
node --check server.js
```

## May 13, 2026 regression execution set

Run after domain-cutover changes:

```powershell
npm test
npm run build
node --check server.js
curl.exe -I https://sundrop.cloud/
curl.exe -I https://sundrop.cloud/login
curl.exe -I https://sundrop.cloud/signup
curl.exe -I https://sundrop.cloud/vault
curl.exe -I https://sundrop.music/
curl.exe -I https://sundrop.music/login
curl.exe -I https://sundrop.music/signup
curl.exe -I https://sundrop.music/vault
curl.exe -I https://music.aeonimus.info/
curl.exe -I https://music.aeonimus.info/login
curl.exe -I https://music.aeonimus.info/signup
curl.exe -I https://music.aeonimus.info/vault
```

## May 14, 2026 live-auth execution set

Confirmed in the live signed-in flow on the new domains:

- Login for primary admin account: passed
- Single-song download: passed
- Vault and Music Catalog lyrics state visibility: passed after UI fallback deploy
- `sundrop.music/vault` and `sundrop.cloud/vault`: `200`

Active data-state findings for Vanessa source `suno_unshakableechos2341`:

- Total songs observed: `1,909`
- Songs with lyrics text present: `1,820`
- Songs still marked `lyricsStatus = MISSING`: `89`
- Firestore write probe: passed (`200`)
- Storage upload probe: passed (`200`)

Live behavior change deployed on May 14, 2026:

- `Music Catalog` now falls back to inline lyrics text for:
  - `Lyrics` view
  - `TXT` download
  - synthetic `VTT` download
- This removes the dependency on prebuilt `gcsLyricsTxt` / `gcsLyricsVtt` links for songs that already have inline lyrics in Firestore.

Open repair track:

- The remaining `89` missing-lyrics songs are not currently recoverable from the public Suno clip endpoint because the endpoint is returning `403 Forbidden` for those specific clip ids.
- A fresh harvest was manually started on May 14, 2026 to attempt normal-path recovery for those records.

## May 14, 2026 harvest repair status

In progress:

- Harvest job redeployed with a manifest fix that now:
  - seeds `lyrics` for new songs at first ingest
  - queues `metadata_repair:lyrics` rows for existing songs missing lyrics text
- Live Cloud Run execution:
  - job: `suno-harvest`
  - execution: `suno-harvest-zmjxt`
  - image digest: `sha256:c66e46ac724b923e14b125e043aa6c544733a099dcad634d4b9fc31504c49d0a`
- Live logs confirm the patched path is active:
  - manifest rows generated
  - `METADATA_REPAIR` rows emitted for missing-lyrics clips including Vanessa catalog ids

Expected follow-up after execution completes:

- Recount `lyricsStatus = MISSING` for `suno_unshakableechos2341`
- Verify affected songs show working `Lyrics`, `TXT`, or `VTT` actions where prompt text was recoverable
- Separate true upstream `403` unrecoverables from local ingest misses

## Current known gaps

- No full UI test harness yet for Downloads page state transitions.
- No end-to-end browser automation yet for export completion flow.
- No mobile playback regression suite yet.
- No formal harvest verifier test harness yet beyond operational checks.
- No fully automated authenticated browser regression for Google login, Vault actions, or YouTube publish.

## URL cutover testing still incomplete

- Ready/history behavior for restored downloads after domain cutover in a signed-in session
- Harvest-to-vault freshness verification after the patched harvest job completes
- No-account login fallback and beta-signup branch from the simplified `/login` page

## June 15, 2026 late live-auth execution set

Confirmed in the live browser session:

- `https://sundrop.music/login`:
  - initially shows the clean login shell
  - then resolves through to `/vault` once auth restoration settles
- `https://sundrop.music/control-center`:
  - initially exposed a real regression where signed-in operator access still fell into `Operator sign-in required`
  - root causes were:
    - admin doc lookup bound only to legacy UID
    - client overview fetch firing before Firebase auth restoration completed
  - repaired and redeployed live on revision `suno-viewer-00187-tm9`
  - signed-in admin route now passes live
- `https://sundrop.cloud/login`:
  - still serves the intended stripped-down shell with only:
    - `GOOGLE LOGIN`
    - `BETA SIGNUP`

Current export truth after the same pass:

- canonical export metadata:
  - `generatedAt: 2026-06-15T08:51:02Z`
  - `rowCount: 2456`
- Vault newest visible song:
  - `Jun 14, 2026`
- Control Center freshness readout:
  - newest served/source song time `2026-06-14T19:52:17.658Z`

Residual lyrics state after the same recount:

- direct Firestore count of `lyricsStatus = MISSING`: `47`
- a fresh authenticated manual harvest execution `suno-harvest-jx9ln` was started to test whether the remaining older rows shrink further

Additional Vault retrieval rollout on the same day:

- desktop Vault quick views now render live:
  - `Newest arrivals`
  - `Publish ready`
  - `Has lyrics`
  - `Missing lyrics`
  - `Published`
- live verification after deploy on revision `suno-viewer-00188-cbm` confirmed the quick-view rail is visible in the production Vault shell

## Locked execution order

Agreed on May 14, 2026. Execute in this order unless a new blocker forces reprioritization:

1. Ship lyric-search support in the main Vault retrieval box
2. Finish remaining domain-cutover regression checks
3. Verify the harvest has fully settled and measure the residual missing-lyrics set
4. Test Vanessa / non-admin login flow
5. Test `/control-center` on the new domains
6. Test selected-songs export on the new domains
7. Test full-catalog export on the new domains
8. Test YouTube publish on the new domains
9. Return to search upgrades:
   - `AEGIS-SEARCH-001` finish any remaining core-search gaps
   - `AEGIS-SEARCH-004` relevance and match visibility
   - `AEGIS-SEARCH-002` structured filters and active-filter chips

Why this order:

- Item 1 is the one immediate tactical retrieval need.
- Items 2 through 8 are stability and trust checks after the domain cutover and harvest fixes.

## May 15, 2026 authenticated regression results

Verified with authenticated API sessions on `https://sundrop.cloud`:

- Vanessa Google-linked account `nessihenize@gmail.com` resolves as:
  - authenticated
  - approved
  - active workspace: `studio-unshakableechos2341`
  - role: `admin`
- Root cause fixed:
  - legacy workspace plan `studio-monthly` was not mapping to the `producer` tier entitlements
  - this left approved non-admin sessions without `vault.browse` or export rights
  - live fix deployed so `studio-monthly` now inherits the correct `producer-monthly` entitlements
- After the fix, Vanessa session now exposes:
  - `vault.browse: true`
  - `catalog.export.local: true`
  - `youtube.publish.enabled: true`

Verified pass:

- `GET /api/auth/session` as Vanessa: `200`
- `GET /api/catalog-exports` as Vanessa: `200`
- `GET /api/admin/overview` as platform admin: `200`
- Selected-songs export as Vanessa:
  - request accepted
  - completed `ready`
  - manifest download `200`
  - summary download `200`
  - produced `1` ZIP part
- Full-catalog export as Vanessa:
  - request accepted
  - completed `ready`
  - manifest endpoint returned `200`
  - ZIP part endpoint returned `200`
  - produced `12` ZIP parts on the stabilized `1.0 GB` part profile
- YouTube publish safe-path check:
  - `POST /api/queue-for-youtube` for an already-published song returned:
    - `created: false`
    - `shouldTriggerUpload: false`
    - `status: done`
  - `POST /api/trigger-upload-job` returned a valid Cloud Run execution while queue counts remained unchanged

Known remaining gaps after May 15 pass:

- Vanessa live browser click-through on `sundrop.cloud` is still not directly browser-tested from this shell
- YouTube publish has only been verified on the safe already-published and empty-queue trigger paths
- A brand-new unpublished song has not been queued from this shell yet to avoid accidental live upload side effects
- The broader search upgrades should land after the critical signed-in flows are proven stable again.

## May 17, 2026 mobile + publish regression closure

Verified after the mobile playback fixes and uploader sanitization pass:

- Mobile phone playback on the new domains: passed
  - user confirmed live handheld playback now works on phone after:
    - native mobile `<audio>` fallback in the Vault player
    - handheld grid-card play behavior no longer depending on desktop focus expansion
- Full YouTube publish regression on the new domains: passed
  - real unpublished song queued from the live Vault flow:
    - `songKey`: `c9c95102-c209-43df-896d-2d7e18a789bc`
    - title: `DIRECTIVE: DEPLOY THE SOVEREIGN OPERATING SYSTEM (SOS)`
  - initial failure reproduced:
    - queue item: `n6KEwj9Q7sMGdEoak8WL`
    - error: YouTube initiation `400 invalidDescription`
  - root cause fixed:
    - uploader metadata now normalizes YouTube-bound title, tags, and description text
    - fallback retry path now uses a strict plain-text description when YouTube rejects the richer version
  - verified success after redeploying `yt-upload-job`:
    - execution: `yt-upload-job-46bhj`
    - queue item transitioned to `done`
    - `ytVideoId`: `NcA3X4JuL94`
    - canonical URL written back
    - synthetic lyrics captions uploaded successfully
  - app-facing queue API also reflects the success:
    - `GET /api/queue-items?limit=10` on `https://sundrop.music` returned `200`
    - queue item `n6KEwj9Q7sMGdEoak8WL` appears as `done` with `ytVideoId=NcA3X4JuL94`

## May 17, 2026 public browser auth-surface regression

Verified through a real browser snapshot flow on both primary domains:

- `https://sundrop.cloud/login`: passed
  - stripped login page renders with `Google Login` and `Beta Signup`
- `https://sundrop.music/login`: passed
  - stripped login page renders with `Google Login` and `Beta Signup`
- `https://sundrop.cloud/signup`: passed
  - beta-signup route renders the onboarding/request surface
- `https://sundrop.music/signup`: passed
  - beta-signup route renders the onboarding/request surface
- signed-out `https://sundrop.cloud/vault`: passed
  - shows the gated `Sign in required` boundary with `Login Here`, `Beta Signup`, and Google sign-in CTA
- signed-out `https://sundrop.music/vault`: passed
  - shows the same gated `Sign in required` boundary
- login-button handoff on both `/login` pages: passed
  - `Google Login` opens the Firebase auth handler and then Google Accounts
  - `sundrop.cloud` preserves `redirectUrl=https://sundrop.cloud/login`
  - `sundrop.music` preserves `redirectUrl=https://sundrop.music/login`

Remaining browser-side auth gap:

- a real signed-in browser click-through from `/login` into `/vault` is still not directly automated from this shell because it depends on a live Google-auth browser session rather than the API-token path used for backend verification

## June 14, 2026 login fallback polish

Shipped a focused auth UX improvement on revision `suno-viewer-00181-clg`:

- `/login` still stays intentionally minimal with `Google Login` and `Beta Signup`
- when a Google identity exists but no active workspace/account is available, the login page no longer leaves the user with a silent dead-end feel
- the login surface now explains the current state for:
  - pending beta request
  - denied request
  - withdrawn request
  - no account found for this Google login
- the intended next actions remain explicit:
  - `Google Login Again`
  - `Beta Signup`

What is still not fully closed:

- real alternate-account browser verification of the no-account branch
- real signed-in browser click-through from `/login` into `/vault`

Tracking:

- Jira: `DEV-72` `Close auth regression gap for login-to-vault and no-account fallback`

## June 14, 2026 harvest freshness visibility pass

Shipped a focused reliability follow-up after the stale-catalog incident:

- added a tested `summarizeExportFreshness` helper in the viewer runtime
- `/api/admin/overview` now returns `exportFreshness` alongside the raw export metadata
- the Control Center `Export freshness` panel now shows an explicit status instead of only a timestamp
- freshness states now distinguish:
  - `healthy`
  - `stale`
  - `mismatch`
  - `source_ahead`
  - `unavailable`

Automated verification:

- `npm test`: passed
- `npm run build`: passed
- `node --check server.js`: passed

What this closes:

- stale export age is now a first-class admin signal in the live product
- metadata-vs-served row-count drift is now surfaced clearly instead of hiding behind a plausible timestamp
- newest Firestore song state can now be compared directly against newest served export state in the admin overview

What still remains:

- a stronger cross-check against newest Firestore song state if export drift ever reappears while timestamps still look fresh
- live confirmation from the next scheduled harvest cycle that the zero-delta rebuild fix keeps the freshness panel healthy without manual intervention

## May 17, 2026 downloads ready-history and export endpoint regression

Authenticated regression checks on the new domains now cover both restored history and fresh export creation:

- existing full-catalog export `6da643bd895b8b8d`: passed
  - `/api/catalog-export/6da643bd895b8b8d/manifest` returned `200`
  - `/api/catalog-export/6da643bd895b8b8d/summary` returned `200`
  - `/api/catalog-export/6da643bd895b8b8d/parts/catalog_part_01.zip` returned `200`
  - `/api/catalog-export/6da643bd895b8b8d/parts/catalog_part_12.zip` returned `200`
- fresh selected-songs export `9a1907147a667431`: passed
  - authenticated create request accepted with `requestScope=selection`
  - ready state returned with `partCount=1`, `totalRows=2`, `totalAssets=6`, `missingAssets=2`
  - manifest endpoint returned `200` with filename `Aeonimus AI-gml-2-song-package.csv`
  - summary endpoint returned `200` with filename `Aeonimus AI-gml-2-song-package-summary.json`
  - ZIP part endpoint returned `200`
- ready/history listing via `/api/catalog-exports`: passed
  - response returned `200`
  - ready jobs included both `9a1907147a667431` and `6da643bd895b8b8d`
  - both rows preserved request scope, part counts, and manifest/summary URLs

## May 17, 2026 harvest and publish survivability verification

Verified against the currently published canonical catalog artifacts after the latest scheduled harvest:

- published catalog metadata: passed
  - `generatedAt`: `2026-05-17T08:49:34Z`
  - `rowCount`: `2167`
  - artifact: `gs://aeonimus-workspaces/exports/suno/latest_catalog_wide.csv`
- harvest-to-vault freshness: passed
  - newest rows in the published catalog are current-day `vanessa_primary` songs
  - first published row observed:
    - `songKey`: `3a7b14e4-2960-46f1-874f-aa77675b32c8`
    - title: `AGI_Cryptographic Proofs for AGI`
    - `createdAt`: `2026-05-17T04:09:22.221Z`
- recent scheduled harvest executions: passed
  - `suno-harvest-6zjkz` completed `1 / 1` on `2026-05-17 07:00:05 UTC`
  - `suno-harvest-qlksh` completed `1 / 1` on `2026-05-16 07:00:05 UTC`
- publish-state survivability through harvest: passed
  - previously published song `c9c95102-c209-43df-896d-2d7e18a789bc` still appears in the published canonical catalog
  - preserved fields:
    - `ytStatus=done`
    - `ytVideoId=NcA3X4JuL94`
    - `ytCanonicalUrl=https://www.youtube.com/watch?v=NcA3X4JuL94`
    - `ytPublishedAt=2026-05-17T06:00:41Z`

## May 17, 2026 search relevance visibility pass

Deployed the live search visibility pass and follow-on filter slice through revision `suno-viewer-00179-vpv`:

- lyrics-aware retrieval remains active from `AEGIS-SEARCH-001`
- result match visibility: passed
  - Vault Grid cards now show `Matched on ...` context when a retrieval query is active
  - Music Catalog rows show the same `Matched on ...` context
  - lyrics hits now surface a short excerpt instead of making the user guess why the song appeared
- structured retrieval controls: first slice passed
  - `All lyrics states` filter is now live
  - `All publish states` filter is now live
  - active filter chips now surface query, account, removed, lyrics, and publish narrowing with one-click clear
- production bundle verification: passed
  - `sundrop.music` is serving asset `index-demE1B86.js`
  - `sundrop.cloud` is serving asset `index-demE1B86.js`
  - live JS contains `Matched on`, `All lyrics states`, `All publish states`, `Query:`, `Lyrics: available`, and `Publish: done`
- ranking pass: deployed
  - revision `suno-viewer-00180-ctx`
  - search now sorts by field-aware relevance first when a query is active
  - exact title matches outrank broad lyrics hits
  - exact or prefix account hits outrank style, tag, and lyrics-only matches
  - manual sort remains the tiebreaker inside equal-relevance groups

Remaining `AEGIS-SEARCH-004` work:

- verify ranking behavior against a few real ambiguous queries in the live catalog
- tune weighting if lyric-heavy searches still overpower title/account intent

Remaining `AEGIS-SEARCH-002` work:

- style/tag-specific structured filters
- clearer mobile treatment for the expanded retrieval band
- any persistence or saved-view crossover should stay out of this ticket and remain with `AEGIS-SEARCH-003`

## Next expansion order

1. Run the next authenticated harvest/repair pass and clear the residual missing-lyrics pocket:
    - the repair path should now prefer SUNO `clip.lyrics` over `metadata.prompt`
    - missing lyric cards such as the older June 10 `Omega Kernel` pocket should disappear if SUNO has text available
    - repaired songs should also receive TXT/VTT/JSON artifacts via `backfill_lyrics_artifacts.py --missing-only`
2. Verify the next scheduled harvest stays fresh without manual rebuild:
    - Control Center freshness should remain `healthy`
    - no `source_ahead` drift should appear after the next scheduled cycle
3. Close `DEV-72` auth regression verification:
    - real click-through from `/login` into `/vault`
    - real no-account fallback from login into beta signup
4. Continue live tuning on `AEGIS-SEARCH-004`.
5. Continue `AEGIS-SEARCH-002` beyond the first live filter/chip slice.

## June 14, 2026 current blocker note

The remaining auth verification gap is not a backend/API gap anymore.

Current reality:

- the signed-in and no-account branches still need real browser proof on the canonical domains
- a Chrome-session verification attempt was made on June 14, 2026
- the heavy authenticated Vault page repeatedly timed out the browser bridge during deep DOM inspection

Implication:

- `DEV-72` remains open because the last missing proof is live-browser interaction evidence, not missing auth implementation work
- live harvest/runtime verification is also temporarily blocked on expired local `gcloud` reauth, so the lyrics repair code is ready but not yet executed against Cloud Run in this turn

## June 15, 2026 viewer + residual lyrics verification

Completed validation:

1. `suno-viewer`
   - `npm run build`
   - pass
2. `suno-viewer`
   - `npm test`
   - pass
3. viewer deploy
   - Cloud Build image publish
   - pass
4. Cloud Run viewer rollout
   - revision `suno-viewer-00183-f55`
   - pass
5. live shell verification
   - both the Cloud Run URL and `https://sundrop.music/` returned the rebuilt app shell
   - pass

Residual lyrics state after deploy:

1. live Firestore count:
   - `64` residual missing-lyrics rows total
2. handle split:
   - `46` on `unshakableechos2341`
   - `17` on `genxdreams`
   - `1` on `gravitystruth`
3. direct repair attempts against remaining rows:
   - still hitting SUNO clip-detail `403 Forbidden`
4. interpretation:
   - the parser / artifact-backfill bug is fixed
   - at least part of the remaining pocket is now an upstream availability constraint

## June 15, 2026 canonical-domain regression checks

Completed:

1. live Chrome session on `https://sundrop.music/vault`
   - authenticated Vault page loaded
   - pass
2. signed-in route check
   - opening `https://sundrop.music/login` in the live browser session resolved through to `/vault`
   - pass
3. `.cloud` login surface
   - opening `https://sundrop.cloud/login` rendered the clean two-option page with only:
     - `GOOGLE LOGIN`
     - `BETA SIGNUP`
   - pass for login-surface cleanup
   - not yet counted as a no-account fallback proof
4. canonical export artifact freshness
   - `gcloud storage cat gs://aeonimus-workspaces/exports/suno/latest_catalog_wide.meta.json`
   - returned:
     - `generatedAt: 2026-06-15T05:15:29Z`
     - `rowCount: 2451`
   - pass
5. canonical export contract spot-check
   - remote CSV still includes `lyrics`, `lyricsStatus`, and `gcsLyricsTxt`
   - newest row timestamp remains `2026-06-13T23:20:55.989Z`
   - pass

Remaining auth gap:

1. no-account Google-login fallback still needs explicit real-browser proof without relying only on route-level inspection

## June 15, 2026 search filter rollout

Completed:

1. retrieval band enhancement
   - added a dedicated `Filter style or tag` text control to the Vault retrieval row
   - filter matches `displayTags`, `tags`, `styles`, and `styleText`
2. active filter chip coverage
   - style/tag narrowing now appears as its own removable retrieval chip
3. validation
   - `npm run build`
   - pass
   - `npm test`
   - pass
4. live deploy
   - Cloud Run revision `suno-viewer-00184-ghq`
   - pass

## June 15, 2026 late relevance tuning + harvest settlement

Completed:

1. search relevance tuning
   - added a second `AEGIS-SEARCH-004` pass for multi-token intent handling
   - search now:
     - normalizes punctuation-heavy titles more gracefully
     - supports cross-field token coverage such as account plus lyrics
     - rejects misleading partial multi-token hits that only satisfy part of the user query
2. automated verification
   - `npm test`
   - pass
   - `npm run build`
   - pass
   - `node --check server.js`
   - pass
3. live deploy
   - Cloud Run revision `suno-viewer-00189-mv2`
   - pass
4. live shell bundle verification
   - `https://sundrop.music/vault`
   - `https://sundrop.cloud/vault`
   - both serve `index-Cmh9nbaC.js`
   - pass
5. repair harvest settlement
   - manual execution `suno-harvest-jx9ln` completed
   - direct Firestore recount after completion still shows `47` rows with `lyricsStatus = MISSING`

Current interpretation:

- the remaining lyrics gap is now stable after the latest repair run
- the viewer-side missing-lyrics presentation should not be treated as a fresh frontend regression based on this evidence alone
- the next step is deeper residual triage and product handling for the bounded unrepaired set
