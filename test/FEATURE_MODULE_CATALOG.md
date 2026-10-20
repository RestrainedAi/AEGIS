# AEGIS Feature & Module Catalog

Complete reference: **how each module is supposed to work**, **wireframes** (minimum 3 per module), and **test steps** that prove each behavior.

Executable suites live in `test/features/<feature-id>/`. Run all pre-deploy gates:

```powershell
cd test
npm run test:pre-deploy
```

---

## Module map (code ↔ tests)

| # | Module | Primary code | Test feature ID | MASTER doc |
|---|--------|--------------|-----------------|------------|
| 1 | Harvest & freshness chain | `yt-ingest/catalog_sync_*`, `entrypoint.sh`, Cloud Run `suno-harvest` | `harvest-freshness` | [MASTER.md](./features/harvest-freshness/MASTER.md) |
| 2 | Multi-account SUNO harvest | `add_source_nessihenize.py`, Firestore `sources/*` | `multi-account-harvest` | [MASTER.md](./features/multi-account-harvest/MASTER.md) |
| 3 | Source registry & workspace | Firestore `sources/`, `workspaces/`, `provision_paid_suno_sources.py` | `multi-account-harvest` + MA-03 | [MASTER.md](./features/multi-account-harvest/MASTER.md) |
| 4 | Catalog export & rebuild | `rebuild_catalog.py`, GCS `latest_catalog_wide.*` | `harvest-freshness`, `downloads-export` | HF-03, DE-03 |
| 5 | Vault catalog browser | `suno-viewer/VaultGrid.tsx` | `vault-search-browse` | [MASTER.md](./features/vault-search-browse/MASTER.md) |
| 6 | Search, filter & playback | `search-utils.ts`, `AudioPlayer.tsx` | `vault-search-browse` | VB-01, VB-05 |
| 7 | Downloads & export packaging | `export-utils`, catalog export API | `downloads-export` | [MASTER.md](./features/downloads-export/MASTER.md) |
| 8 | Auth, signup & tier entitlements | `LoginPage`, `SignupPage`, `AuthControls`, `firebaseAuth.tsx` | `auth-signup-tier`, `auth-domain` | [MASTER.md](./features/auth-signup-tier/MASTER.md) |
| 9 | Admin control center | `AdminControlCenter.tsx`, freshness utils | `admin-control-center` | [MASTER.md](./features/admin-control-center/MASTER.md) |
| 10 | YouTube queue & publish | `queue_manager.py`, `youtube_uploader.py`, Vault publish UI | `youtube-bridge` | [MASTER.md](./features/youtube-bridge/MASTER.md) |
| 11 | Domain routing & entry | `App.tsx` routes, `server.js` | `auth-domain` | [MASTER.md](./features/auth-domain/MASTER.md) |
| 12 | Pipeline monitor & alerts | `pipeline_monitor.py`, Cloud Run monitor job | `harvest-freshness`, `admin-control-center` | HF-02, AC-02 |
| 13 | Cross-module regression | orchestrator | `cross-module-regression` | [MASTER.md](./features/cross-module-regression/MASTER.md) |

---

## Module 1: Harvest & Freshness Chain

### How it is supposed to function

1. **Nightly trigger** — Cloud Scheduler runs Cloud Run job `suno-harvest` (~2 AM Chicago).
2. **Source discovery** — `catalog_sync_firestore_multi.py` loads active SUNO handles from Firestore `sources/*` (`harvestEnabled=true`), merges with fallback floor (`unshakableechos2341`, `nessihenize`, `genxdreams`, `gravitystruth`).
3. **Delta detection** — For each handle: fetch live clip IDs from Suno Studio API, compare to Firestore `sunoSongs`, scan GCS `suno/handles/{handle}/` for missing/zero-byte media.
4. **Media harvest** — `download_media_gcs.py` streams new/repair rows to GCS; upserts Firestore via `firestore_upsert.py`.
5. **Metadata enrich** — `enrich_suno_metadata_from_studio_api.py`, `backfill_lyrics_artifacts.py`.
6. **Catalog rebuild** — `rebuild_catalog.py` publishes `latest_catalog_wide.csv` + `.meta.json` to GCS.
7. **Monitor** — `pipeline_monitor.py` post-harvest digest; email only if unhealthy.

**Single Sundrop login, many SUNO handles:** harvest follows Firestore sources, not one hardcoded handle.

### Wireframe 1: Nightly harvest operator flow (order)

```text
┌─────────────────────────────────────────────────────────────┐
│ Cloud Scheduler  suno-harvest-nightly                       │
└───────────────────────────┬─────────────────────────────────┘
                            ▼
┌─────────────────────────────────────────────────────────────┐
│ Cloud Run Job  suno-harvest                                 │
│  [1] catalog_sync (all active sources)                      │
│  [2] download_media_gcs (delta_manifest.csv)                │
│  [3] enrich + lyrics backfill                               │
│  [4] rebuild_catalog → GCS export                           │
│  [5] pipeline_monitor post-harvest                          │
└───────────────────────────┬─────────────────────────────────┘
                            ▼
              Pass → Vault shows fresh catalog
              Fail → alert email + operator investigates
```

**Action order:** Schedule fire → delta scan → media download → rebuild export → monitor.

### Wireframe 2: Per-handle delta decision (inside Step 1)

```text
For each handle in registry + fallback:
┌──────────────┐    ┌──────────────┐    ┌──────────────┐
│ Suno API     │ vs │ Firestore    │ vs │ GCS listing  │
│ live clips   │    │ sunoSongs    │    │ mp3/mp4/jpg  │
└──────┬───────┘    └──────┬───────┘    └──────┬───────┘
       │                   │                   │
       └─────────┬─────────┴─────────┬─────────┘
                 ▼                   ▼
           new clip rows      missing_gcs rows
           metadata_repair    removed_from_suno
                 │                   │
                 └─────────┬─────────┘
                           ▼
                  delta_manifest.csv
```

**Action order:** Fetch live → query Firestore → list GCS → emit delta rows.

### Wireframe 3: Freshness contract (Vault trust)

```text
┌──────────────── Admin / Vault shell ─────────────────┐
│  Catalog freshness:  generatedAt  rowCount  artifact │
│  Status:  [ healthy | stale | mismatch | partial ] │
└──────────────────────────┬───────────────────────────┘
                           │
     local rebuild meta  ==  GCS published meta
                           │
                           ▼
              User trusts "newest song" in Vault grid
```

**Action order:** Rebuild writes meta → publish to GCS → UI reads meta → classify healthy/stale.

### Wireframe 4: Partial harvest continue path

```text
media download errors (exit != 0)
        │
        ▼
  log partial_harvest
        │
        ▼
  STILL run enrich + rebuild_catalog + monitor
        │
        ▼
  email: partial only if other signals unhealthy
```

### Test traceability

| Behavior | Test step |
|----------|-----------|
| Source merge + fallback floor | HF-01 |
| Monitor healthy/stale/partial/queue classifiers | HF-02 |
| Export row contract from Firestore docs | HF-03 |
| Admin freshness helper states | HF-04 |
| Cloud Run job env/runtime shape | HF-05 (optional GCP) |
| Manual: newest songs after harvest | VB-05, XR-04 (manual) |

---

## Module 2: Multi-Account SUNO Harvest (@nessihenize)

### How it is supposed to function

1. **Second SUNO profile** — `@nessihenize` (AEONIMUS) harvested alongside `@unshakableechos2341`.
2. **Same Sundrop workspace** — `studio-unshakableechos2341`; one Google login (`nessihenize@gmail.com`).
3. **Distinct account label** — export/Vault filter `vanessa_secondary` (primary = `vanessa_primary`).
4. **Firestore source** — `sources/suno_nessihenize`, seeded from `vanessa_primary` settings via `add_source_nessihenize.py`.
5. **Scoped catch-up** — `HARVEST_HANDLES=nessihenize` or `--handles nessihenize` for one-time backfill.
6. **Nightly** — included automatically when source is active in registry.

### Wireframe 1: Account topology

```text
        Sundrop login (1)
               │
               ▼
    workspace: studio-unshakableechos2341
          /                    \
         ▼                      ▼
  suno_unshakableechos2341   suno_nessihenize
  label: vanessa_primary     label: vanessa_secondary
  handle: unshakableechos2341 handle: nessihenize
```

### Wireframe 2: Provision + first harvest order

```text
[1] add_source_nessihenize.py  → Firestore source doc
[2] catalog_sync --handles nessihenize  → 15 new delta rows
[3] download_media_gcs  → GCS + Firestore upsert
[4] rebuild_catalog  → export includes both labels
[5] Vault filter "vanessa_secondary"  → AEONIMUS songs visible
```

### Wireframe 3: Vault multi-account filter

```text
┌ Vault toolbar ─────────────────────────────────────┐
│ Account: [ All | vanessa_primary | vanessa_secondary ] │
│ Search: [________________]   Page 1 of N              │
├────────────────────────────────────────────────────┤
│ [thumb] Song A   vanessa_primary                     │
│ [thumb] Song B   vanessa_secondary  ← nessihenize    │
└────────────────────────────────────────────────────┘
```

### Wireframe 4: Nightly inclusion (no extra scheduler)

```text
suno-harvest-nightly
        │
        ▼
list_active_suno_sources()
        │
        ├── suno_unshakableechos2341  ✓
        ├── suno_nessihenize          ✓
        └── … other active sources
```

### Test traceability

| Behavior | Test step |
|----------|-----------|
| Handle filter / merge unit tests | MA-01 |
| Live Studio API returns clips | MA-02 |
| Firestore source active + harvestEnabled | MA-03 |
| Export alias nessihenize → vanessa_secondary | MA-04 |
| Manual: vault filter shows second account | MA-05 |
| Trigger after harvest-freshness passes | suite-order `triggersOnPass` |

---

## Module 3: Source Registry & Workspace Ownership

### How it is supposed to function

1. **Source doc** — `sources/suno_{handle}` with `platform`, `handle`, `workspaceId`, `planId`, `tierId`, `harvestEnabled`, `status`.
2. **Workspace doc** — `workspaces/{id}` with entitlements, limits, `ownerUid` after claim.
3. **Approval flow** — Signup → admin approves in Control Center → `syncApprovedSunoSource` links handle to workspace.
4. **Harvest authority** — `catalog_sync` reads registry; fallback floor prevents silent coverage shrink.
5. **Reserved provisioning** — `provision_paid_suno_sources.py` seeds studio-tier placeholders before customer claims.

### Wireframe 1: Signup → source assignment

```text
User /signup  →  access request (handle, plan)
        │
        ▼
Admin /control-center  →  Approve + pick plan/tier
        │
        ▼
Firestore patch: sources/suno_{handle}
  workspaceId, ownerUid, harvestEnabled=true
        │
        ▼
Next harvest includes handle
```

### Wireframe 2: Source document fields (operator view)

```text
sources/suno_nessihenize
├── handle: nessihenize
├── accountLabel: vanessa_secondary
├── workspaceId: studio-unshakableechos2341
├── planId: studio-monthly
├── harvestEnabled: true
├── status: active
└── profileUrl: https://suno.com/@nessihenize
```

### Wireframe 3: Registry-driven harvest (not hardcoded list)

```text
catalog_sync_firestore_multi
        │
        ├─► Query sources/* (platform=suno, active, harvestEnabled)
        │
        ├─► merge_tracked_handles(registry, FALLBACK_TRACKED_HANDLES)
        │
        └─► For each handle → compute_handle_delta
```

### Test traceability

| Behavior | Test step |
|----------|-----------|
| Registry merge prefers sourceId over fallback | HF-01, MA-01 |
| nessihenize source doc exists | MA-03 |
| Manual: approve links handle to workspace | AS-03, AC-04 |

---

## Module 4: Catalog Export & Rebuild

### How it is supposed to function

1. **Authority** — Firestore `sunoSongs` is item truth; export is a published view model.
2. **Generator** — `rebuild_catalog.py` queries all songs, maps `HANDLE_ALIAS_MAP`, writes CSV + meta JSON.
3. **Publish** — Upload to `gs://aeonimus-workspaces/exports/suno/latest_catalog_wide.csv` and matching `.meta.json`.
4. **Viewer** — `VaultGrid` loads export CSV (via server/API); freshness from meta `generatedAt` / `rowCount`.
5. **Customer exports** — Separate job packages subset/full catalog without leaking internal GCS/YT columns.

### Wireframe 1: Rebuild publish path

```text
Firestore sunoSongs  ──►  rebuild_catalog.py
                                │
                    ┌───────────┴───────────┐
                    ▼                       ▼
         latest_catalog_wide.csv    latest_catalog_wide.meta.json
                    │                       │
                    └───────────┬───────────┘
                                ▼
                         GCS exports/suno/
                                │
                                ▼
                         VaultGrid loads catalog
```

### Wireframe 2: Export row shape (customer vs internal)

```text
Customer CSV row:
  songKey, title, tags, lyrics, account_label, audio_url …

Internal-only (must NOT appear in customer export):
  gcs_mp3, gcs_mp4, ytVideoId paths used for ops
```

### Wireframe 3: Zero-row delta still rebuilds

```text
delta_manifest.csv rows = 0
        │
        ▼
SKIP media download
        │
        ▼
STILL run enrich (if present) + rebuild_catalog
        │
        ▼
Published export stays aligned with Firestore
```

### Test traceability

| Behavior | Test step |
|----------|-----------|
| Fixture contract mapping | HF-03, DE-03 |
| Customer CSV shaping | DE-01 |
| Catalog export job helpers | DE-02 |
| Freshness meta classification | HF-04, AC-01 |

---

## Module 5: Vault Catalog Browser

### How it is supposed to function

1. **Route** — Authenticated users open `/vault` (legacy `/vanessa` redirects).
2. **Data** — Paginated grid from published catalog export + protected media URLs.
3. **Song card** — Title, thumb, lyrics state, YouTube badge, selection checkbox, play action.
4. **Views** — Grid modes, lyrics panel, publish modal, queue inspector hooks.
5. **Tier gate** — `vault.browse` entitlement required; unauthenticated users see gated state.

### Wireframe 1: Vault page layout

```text
┌ Header: AuthControls | Sundrop | Control Center link ────────┐
├ Toolbar: Search | Account filter | Select all page | Export ─┤
├──────────────────────────────────────────────────────────────┤
│ ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐                              │
│ │ ▶   │ │ ▶   │ │ ▶   │ │ ▶   │   song cards (paginated)     │
│ │thumb│ │thumb│ │thumb│ │thumb│                              │
│ └─────┘ └─────┘ └─────┘ └─────┘                              │
├ Footer: pagination | selection count | queue banner ──────────┤
└──────────────────────────────────────────────────────────────┘
```

**Action order:** Load catalog → render page → user search/filter → select/play/publish.

### Wireframe 2: Song card actions

```text
┌ Song card ─────────────────────┐
│ [x] Select                     │
│ [thumbnail]                    │
│ Title · account_label          │
│ [Lyrics state badge] [YT badge]│
│ Actions: Play | Publish | …    │
└────────────────────────────────┘
```

**Action order:** Select → optional batch export OR Play OR open YouTube publish modal.

### Wireframe 3: Gated unauthenticated vault

```text
/vault (no session)
        │
        ▼
┌─────────────────────────────┐
│  Sign in to browse the Vault │
│  [ Login ]  [ Signup ]       │
└─────────────────────────────┘
(NOT blank error / NOT silent empty grid)
```

### Wireframe 4: Legacy redirect

```text
GET /vanessa  ──302──►  /vault?…
```

### Test traceability

| Behavior | Test step |
|----------|-----------|
| Search + account scoping | VB-01 |
| All unit tests + build | VB-02, VB-03, VB-04 |
| Manual browse/thumbnails/selection | VB-05 |
| /vault route live | AD-04, AD-06 |

---

## Module 6: Search, Filter & Playback

### How it is supposed to function

1. **Search** — Token match across title, tags, lyrics, handle aliases (`ACCOUNT_ALIASES` in VaultGrid).
2. **Account filter** — `vanessa_primary` matches `unshakableechos2341` rows; `vanessa_secondary` matches `nessihenize`.
3. **Pagination** — Page size consistent with selection/export actions.
4. **Audio** — `AudioPlayer` streams protected URL; desktop + mobile playback paths.

### Wireframe 1: Search + filter interaction order

```text
[1] User types query
[2] Filter narrows visible rows (client-side on loaded page/catalog)
[3] Account filter applied (primary / secondary / all)
[4] Pagination recalculates counts
[5] Selection count reflects visible selected rows only
```

### Wireframe 2: Account alias resolution

```text
User selects filter: vanessa_secondary
        │
        ▼
ACCOUNT_ALIASES.vanessa_secondary =
  [ vanessa_secondary, nessihenize, suno_nessihenize, aeonimus ]
        │
        ▼
Rows match if account_label OR handle in alias set
```

### Wireframe 3: Playback bar

```text
┌ Audio player (sticky) ─────────────────────────────┐
│  ♪ Title          [ ◀◀ ] [ ▶/❚❚ ] [ ▶▶ ]  ━━━●──  │
└──────────────────────────────────────────────────┘
```

### Wireframe 4: Mobile playback check (manual)

```text
Android Chrome /vault → tap Play → audio starts → scrub works
```

### Test traceability

| Behavior | Test step |
|----------|-----------|
| search-utils token + account matching | VB-01 |
| Manual desktop/mobile playback | VB-05, XR-04 |

---

## Module 7: Downloads & Export Packaging

### How it is supposed to function

1. **Trigger** — User selects songs or requests full catalog export from Vault/downloads UI.
2. **Job** — Server creates catalog export job; writes manifest, summary, ZIP part objects to GCS.
3. **Artifacts** — Customer gets ZIP(s), CSV manifest, JSON summary without internal ops columns.
4. **States** — queued → running → ready | error | expired; history list for re-download.
5. **Tier** — `catalog.export.local` entitlement gates full vs selected packages.

### Wireframe 1: Selected-song export order

```text
[1] Select N songs on Vault page
[2] Click Export selected
[3] Job queued → progress banner
[4] Status = ready
[5] Download: ZIP | manifest CSV | summary JSON
```

### Wireframe 2: Full catalog export (multi-part)

```text
Request full export
        │
        ▼
Job splits into parts (e.g. 12 × ~1GB ZIPs)
        │
        ▼
Manifest lists part URLs + row counts
        │
        ▼
User downloads each part + summary
```

### Wireframe 3: Missing-file reporting

```text
Export summary JSON
├── rowCount
├── packagedCount
├── missingFiles: [ { songKey, reason } … ]
└── customer sees honest missing count (not silent drop)
```

### Wireframe 4: Downloads history surface

```text
┌ Downloads / ready history ──────────────────────┐
│ Job ID   created   status   [ Download ZIP ]  │
│ Job ID   created   expired  (re-run export)   │
└───────────────────────────────────────────────┘
```

### Test traceability

| Behavior | Test step |
|----------|-----------|
| hasArtifact + customer row shaping | DE-01 |
| Catalog export utils | DE-02 |
| Rebuild/export contract | DE-03 |
| Manual single/selected/full download | DE-04, XR-04 |

---

## Module 8: Auth, Signup & Tier Entitlements

### How it is supposed to function

1. **Login** — `/login` Google OAuth or magic link; session via Firebase + server session API.
2. **Signup** — `/signup` beta/studio request with SUNO handle; creates pending access request.
3. **Approval** — Admin assigns plan (`studio-monthly` → producer entitlements).
4. **Entitlements** — `vault.browse`, `catalog.export.local`, `youtube.publish.enabled` per tier.
5. **Workspace select** — Multi-workspace users pick active workspace in AuthControls.

### Wireframe 1: Login → vault order

```text
/login → Google sign-in → session API 200
        │
        ▼
redirect /vault (if vault.browse)
        │
        ▼
VaultGrid loads with entitled actions visible
```

### Wireframe 2: Signup → approval → entitlements

```text
/signup form (handle, email, plan intent)
        │
        ▼
accessRequests/* pending
        │
        ▼
Admin approve (Control Center)
        │
        ▼
sources/* + users/* updated
        │
        ▼
User re-login → entitlements include vault.browse
```

### Wireframe 3: Tier-gated action visibility

```text
Tier without export.local:
  [ Export selected ] hidden or disabled with explanation

Tier with youtube.publish.enabled:
  [ Publish to YouTube ] visible on song card
```

### Wireframe 4: No-account fallback

```text
Session missing entitlements
        │
        ▼
Clear CTA: request access / contact admin
(NOT operator-only error for customer tier)
```

### Test traceability

| Behavior | Test step |
|----------|-----------|
| Auth pages compile in build | AS-01 |
| /signup route live | AS-02 |
| Manual signup→approve→entitlements | AS-03, AC-04 |
| Login routes + vault gate | AD-02, AD-04, AD-06 |

---

## Module 9: Admin Control Center

### How it is supposed to function

1. **Route** — `/control-center` for platform admin role only.
2. **Overview** — Queue counts, harvest/export freshness, source health summaries.
3. **Access requests** — Approve/deny/reopen with plan, tier, workspace, SUNO handle linkage.
4. **Freshness** — Displays export age vs thresholds (healthy / stale / mismatch).
5. **Operator actions** — Sync settings, trigger diagnostics (read-first; destructive ops gated).

### Wireframe 1: Control Center layout

```text
┌ Admin Control Center ──────────────────────────────────────┐
│ Overview cards: queue | harvest freshness | export age    │
├────────────────────────────────────────────────────────────┤
│ Access requests table                                       │
│  [ Approve ] [ Deny ] [ Reopen ]  per row                   │
├────────────────────────────────────────────────────────────┤
│ Source / export diagnostics (read-only panels)              │
└────────────────────────────────────────────────────────────┘
```

### Wireframe 2: Approve request flow (order)

```text
[1] Open pending request row
[2] Set planId / tierId / workspace / handle
[3] Click Approve
[4] Server writes sources + user entitlements
[5] User's next session reflects new tier
```

### Wireframe 3: Freshness banner states

```text
healthy:   "Export published 2h ago · 2451 rows"
stale:     "Export older than threshold · investigate harvest"
mismatch:  "Meta rowCount ≠ served CSV rows · rebuild needed"
```

### Wireframe 4: Deny / reopen paths

```text
Deny  → request status denied + review notes
Reopen → pending again for re-review
```

### Test traceability

| Behavior | Test step |
|----------|-----------|
| freshness-utils classifications | AC-01 |
| pipeline_monitor summary logic | AC-02 |
| /control-center responds | AC-03 |
| Manual approve/deny/freshness | AC-04, AS-03 |

---

## Module 10: YouTube Queue & Publish Bridge

### How it is supposed to function

1. **Queue** — Vault "Publish" creates/updates `ytUploadQueue` doc via `/api/queue-for-youtube`.
2. **Uploader job** — Cloud Run / scheduled job reads queue, uploads MP4 from GCS, sets captions/metadata.
3. **Idempotency** — Already-published songs return `created: false`, no duplicate upload.
4. **OAuth** — Refresh token in Secret Manager must include upload + caption scopes (AEGIS-011).
5. **State** — Song card shows YT badge from Firestore publish fields.

### Wireframe 1: Publish from Vault order

```text
[1] User opens YT metadata modal on song card
[2] Edit title/description/tags/privacy
[3] Submit queue-for-youtube
[4] Queue doc created (or safe no-op if already published)
[5] Uploader job processes → ytVideoId written back
[6] Badge updates to Published
```

### Wireframe 2: Queue inspector (embedded)

```text
┌ Queue banner in Vault ─────────────────────────┐
│ queued: 3 | uploading: 1 | errors: 1         │
│ [ Inspect queue ] → list contradictory rows    │
└────────────────────────────────────────────────┘
```

### Wireframe 3: Uploader pipeline

```text
ytUploadQueue (new)
        │
        ▼
youtube_uploader.py
  verify gcs mp4 non-zero
        │
        ▼
YouTube Data API upload + captions
        │
        ▼
sunoSongs ytStatus / ytVideoId updated
```

### Wireframe 4: OAuth scope preflight (operator)

```text
validate_youtube_oauth_scopes.py
        │
        ▼
tokeninfo includes youtube.upload + captions
        │
        ▼
safe to run uploader job
```

### Test traceability

| Behavior | Test step |
|----------|-----------|
| OAuth scope preflight | YT-01 |
| Manual queue + duplicate guard | YT-02, XR-04 |
| Export contract includes yt fields for ops | HF-03 |

---

## Module 11: Domain Routing & Public Entry

### How it is supposed to function

1. **Canonical domains** — `sundrop.cloud`, `sundrop.music` serve same app; legacy `music.aeonimus.info` compatibility.
2. **Public routes** — `/`, `/login`, `/signup`, `/vault`, `/privacy`, `/terms`, `/control-center`.
3. **Redirects** — `/vanessa` → `/vault`; signup/login links use canonical URL helpers.
4. **Session cookies** — Work across configured domains per Firebase/hosting setup.

### Wireframe 1: Public route map

```text
/              → landing (marketing)
/login         → LoginPage
/signup        → SignupPage
/vault         → VaultGrid (gated)
/control-center→ AdminControlCenter (admin)
/vanessa       → redirect /vault
```

### Wireframe 2: Dual-domain parity check order

```text
For each route in [ /, /login, /signup, /vault ]:
  HEAD https://sundrop.cloud{route}
  HEAD https://sundrop.music{route}
  expect 200 or expected redirect
```

### Wireframe 3: Post-login redirect

```text
Successful auth on sundrop.music/login
        │
        ▼
Land on sundrop.music/vault (or cloud — per policy)
        │
        ▼
API calls use same project/session
```

### Test traceability

| Behavior | Test step |
|----------|-----------|
| sundrop.cloud routes | AD-01 – AD-04 |
| sundrop.music /vault | AD-05 |
| Manual authenticated path | AD-06 |

---

## Module 12: Pipeline Monitor & Alerts

### How it is supposed to function

1. **Post-harvest** — `entrypoint.sh` calls `pipeline_monitor.py --mode post-harvest`.
2. **Signals** — Catalog age, source idle, scan stale, queue errors, partial harvest exit code.
3. **Email** — Send digest only when unhealthy (suppress spam on green runs).
4. **Daily digest** — Separate Cloud Run monitor job for morning summary.
5. **Status JSON** — Writes `pipeline_monitor_status.json` for operator tools.

### Wireframe 1: Monitor decision tree

```text
post-harvest monitor
        │
        ├─ catalog stale? ─────────────► email: catalog_stale
        ├─ source idle? ───────────────► email: source_idle
        ├─ queue errors? ──────────────► email: queue_errors
        ├─ partial harvest? ─────────────► email: partial_harvest
        └─ all healthy ────────────────► suppress email
```

### Wireframe 2: Alert vs digest paths

```text
Harvest job exit trap ──► mode=alert (unexpected failure)
Harvest job normal end ──► mode=post-harvest
Scheduler morning ───────► mode=daily-digest
```

### Wireframe 3: Operator response order

```text
[1] Receive email / read monitor status JSON
[2] Identify failing signal (stale vs queue vs partial)
[3] Run targeted fix (rebuild, re-harvest, queue repair)
[4] Re-run test:pre-deploy or harvest-freshness suite
[5] Confirm next nightly green
```

### Test traceability

| Behavior | Test step |
|----------|-----------|
| Status classification unit tests | HF-02, AC-02 |
| Cloud Run monitor secret + job shape | HF-05 |
| Manual: healthy run suppresses email | AC-04 (manual ops) |

---

## Module 13: Cross-Module Regression

### How it is supposed to function

Orchestrator re-runs core pre-deploy suites after deploy, then manual cross-module smoke ensures domain cutover did not break harvest → vault → export → YouTube chain.

### Wireframe 1: Regression suite order

```text
auth-domain (post-deploy HTTP)
        │
        ▼
cross-module-regression
  XR-01 harvest-freshness
  XR-02 vault-search-browse
  XR-03 downloads-export
  XR-04 manual end-to-end checklist
```

### Wireframe 2: End-to-end product path

```text
Suno profile → harvest → export CSV → Vault browse
      → select songs → export ZIP
      → publish YouTube → queue → uploader → live YT
```

### Wireframe 3: Failure stop-the-line

```text
Any XR step fails
        │
        ▼
STOP deploy promotion / roll back
        │
        ▼
Fix module per failure suggestions in test/reports/
        │
        ▼
Re-run npm run test:all
```

### Test traceability

| Behavior | Test step |
|----------|-----------|
| Re-run harvest suite | XR-01 |
| Re-run vault suite | XR-02 |
| Re-run export suite | XR-03 |
| Full-chain manual smoke | XR-04 |

---

## Master run order (matches todo before deploy)

See [config/suite-order.json](./config/suite-order.json):

1. harvest-freshness → triggers multi-account-harvest  
2. vault-search-browse  
3. downloads-export  
4. multi-account-harvest  
5. youtube-bridge  
6. auth-signup-tier  
7. admin-control-center  
8. auth-domain *(post-deploy)*  
9. cross-module-regression *(post-deploy)*  

---

## Adding a new feature (Feature B checklist)

When scope + wireframes + implementation land together:

1. Add a section to **this catalog** (function + ≥3 wireframes + traceability table).
2. Create `test/features/<id>/MASTER.md` + `suite.json` with one step per traced behavior.
3. Register in `suite-order.json` at the correct deploy phase.
4. Run `node runners/run-feature-suite.mjs <id>` until green.
5. Link Figma/wireframe URLs in the feature MASTER doc when available.

Design-board references: `docs/design/aegis-design-board-page-map-v1.md`, `docs/design/aegis-wireframe-brief-v1.md`.

Narrative history: `docs/codex/AEGIS_TEST_MATRIX_2026-05-04.md`.
