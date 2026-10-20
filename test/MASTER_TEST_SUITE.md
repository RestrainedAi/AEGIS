# AEGIS Master Test Suite

This is the **top-level orchestrator** for all feature/module test suites in AEGIS.

Use [Development DNA](../docs/codex/DEVELOPMENT_PRINCIPLES.md) and the [handoff workflow](README.md#standard-handoff-workflow) to plan, repair, review, and close work. Product authority remains with the [master source of truth](../docs/codex/AEGIS_MASTER_SOURCE_OF_TRUTH.md); assignments follow [workstream ownership](../docs/codex/AEGIS_Workstream_Ownership_And_Change_Control.md).

## When tests are written

Each feature gets its **MASTER.md** and **suite.json** at the same time as:

1. Scope / ticket definition
2. Wireframe or UX spec finalization
3. Implementation completion (before deploy)

If a feature spans multiple tickets, the feature MASTER doc is the single test authority for that feature.

## Architecture

```text
test/
  MASTER_TEST_SUITE.md          ← you are here
  run-all.mjs                     ← runs all suites in todo/deploy order
  runners/run-feature-suite.mjs   ← runs one feature sequentially
  config/suite-order.json         ← master order + dependencies + triggers
  features/<feature-id>/
    MASTER.md                     ← feature test authority
    suite.json                    ← ordered steps (Test 1 → Test 2 → …)
  reports/                        ← JSON + Markdown run logs (gitignored)
  scripts/                        ← shared verification helpers
```

## Execution rules

1. **Sequential steps** — Step N+1 runs after Step N passes or skips; a failed step stops the suite.
2. **Fail fast** — On failure: log stderr, suggestions, fix commands; stop the suite.
3. **Pass** — Auto-advance to the next step.
4. **Deploy phases**
   - `pre-deploy` — local/unit/build/GCP preflight; run **before** release
   - `post-deploy` — live domain/auth HTTP checks; run **after** deploy
   - `both` — eligible in either phase; `--phase all` includes all phases
5. **Manual steps** — Skipped by default. `--include-manual` immediately records a passed acknowledgement; it does not prompt or execute the checklist. The operator must verify behavior and attach observations separately.
6. **Optional steps** — Optional GCP steps skip if auth is unavailable. Optional command/HTTP failures also report `skipped` and do not fail the suite. Disclose the underlying failure and its acceptance impact.
7. **Cross-suite triggers** — When Feature A passes, `triggersOnPass` can enqueue Feature B (see `multi-account-harvest` after `harvest-freshness`).
8. **Nested suites** — `cross-module-regression` re-invokes other feature suites in order.

## Acceptance and repair contract

**Sequence:** the single accountable feature owner maps required acceptance checks to suite steps and separate customer-path evidence in the feature `MASTER.md`. Record the owner and current specialist assignments in the [board](../docs/board/README.md) or [feature brief](../docs/codex/templates/FEATURE_BRIEF.md), not a competing status ledger. Large features use specialists with bounded outputs, focused context/tools, dependencies, owned files, and explicit handoffs; use fresh or limited context for independent verification where available.

**Conditional:** runner status is step evidence, not feature completion. A suite passes whenever no returned step is failed, even with skips. Phase-excluded suites are logged but omitted from returned reports, and the master runner counts them as satisfied for dependency scheduling. Review the configured contract against actual coverage, including manual acknowledgements, optional failures, and steps never reached after failure. HTTP steps check status codes, not the full customer outcome.

**Loop:** preserve successful work and return failed acceptance checks to the responsible owner with a repair task and evidence. Bound retries by attempts/time and use backoff where appropriate. Repair before rerunning dependent checks; for an external blocker, record its owner, next action, and resumption condition. There is no automatic repair, retry, or persistent follow-up mechanism in this runner.

The receiving feature owner inspects specialist artifacts, verifies integration and applicable customer behavior, and records complete, partial, or blocked status. Handoffs include changed paths, checkout/revision, commands and phase, observed results/report links, manual/optional/skipped/unexecuted checks, unresolved issues, dependencies, and next owner/action. Disclose self-review; use independent verification for large or consequential changes when available. Preserve originals/provenance and keep a recorded disposition for every remaining issue. Required unmet acceptance checks prevent closure even when the runner is green.

## Commands

From `test/`:

```powershell
# Before deploy (default CI gate)
npm run test:pre-deploy

# After deploy to sundrop.cloud / sundrop.music
npm run test:post-deploy

# Full matrix including manual acknowledgement
npm run test:all -- --include-manual

# Single feature
npm run test:harvest
npm run test:multi-account
npm run test:regression
```

Direct:

```powershell
node run-all.mjs --phase pre-deploy
node runners/run-feature-suite.mjs harvest-freshness
node runners/run-feature-suite.mjs auth-domain --phase post-deploy
```

## Master suite order (phase-filtered)

| Order | Feature ID | Deploy phase | Triggers on pass |
|------:|--------------|--------------|------------------|
| 1 | `harvest-freshness` | pre-deploy | `multi-account-harvest` |
| 2 | `vault-search-browse` | pre-deploy | — |
| 3 | `downloads-export` | pre-deploy | — |
| 4 | `multi-account-harvest` | pre-deploy | — |
| 5 | `youtube-bridge` | pre-deploy | — |
| 6 | `auth-signup-tier` | both | — |
| 7 | `admin-control-center` | both | — |
| 8 | `auth-domain` | post-deploy | — |
| 9 | `cross-module-regression` | post-deploy | — |

## Reports

Each non-nested feature run writes:

- `test/reports/<timestamp>/<featureId>.json` — machine-readable step results
- `test/reports/<timestamp>/<featureId>.md` — human-readable summary with failure suggestions

Nested suites do not write standalone report files, even though the parent result carries a `nestedReportPath`. Do not cite that path as an existing artifact without checking it; capture separate verification evidence when detailed nested results are required.

## Feature master documents

| Feature | MASTER doc |
|---------|------------|
| **Full catalog (all modules + wireframes)** | [FEATURE_MODULE_CATALOG.md](FEATURE_MODULE_CATALOG.md) |
| Harvest & freshness | [features/harvest-freshness/MASTER.md](features/harvest-freshness/MASTER.md) |
| Vault search & browse | [features/vault-search-browse/MASTER.md](features/vault-search-browse/MASTER.md) |
| Downloads & export | [features/downloads-export/MASTER.md](features/downloads-export/MASTER.md) |
| Multi-account harvest | [features/multi-account-harvest/MASTER.md](features/multi-account-harvest/MASTER.md) |
| YouTube bridge | [features/youtube-bridge/MASTER.md](features/youtube-bridge/MASTER.md) |
| Auth & signup tiers | [features/auth-signup-tier/MASTER.md](features/auth-signup-tier/MASTER.md) |
| Admin control center | [features/admin-control-center/MASTER.md](features/admin-control-center/MASTER.md) |
| Auth & domains | [features/auth-domain/MASTER.md](features/auth-domain/MASTER.md) |
| Cross-module regression | [features/cross-module-regression/MASTER.md](features/cross-module-regression/MASTER.md) |

## Adding a new feature (Feature B pattern)

1. Create `test/features/<feature-id>/MASTER.md` from the template below.
2. Create `test/features/<feature-id>/suite.json` with ordered steps.
3. Add an entry to `test/config/suite-order.json` in the correct deploy order.
4. Add `npm run test:<alias>` script in `test/package.json` (optional).
5. Run `node runners/run-feature-suite.mjs <feature-id>` and inspect coverage; use bounded repair/retest loops for failures.
6. The accountable owner inspects handoffs and verifies required pre-deploy acceptance, including any manual or skipped checks, before recording deploy readiness. Post-deploy acceptance remains open until verified.

### MASTER.md template (per feature)

```markdown
# Feature Master Test: <Title>

- Feature ID: `<feature-id>`
- Module: `<suno-viewer|yt-ingest|…>`
- Scope tickets: `<AEGIS-xxx>`
- Accountable feature owner and board/brief link: `<owner; path>`
- Specialists, owned outputs, dependencies, handoff checks: `<assignments or bounded self-review>`
- Wireframe / UX ref: `<path>`
- Deploy phase: `pre-deploy` | `post-deploy`

## Scope under test
…

## Todo order (must pass before deploy)
1. Step ID — title
…

## Post-deploy only
…

## Acceptance evidence and handoff
- Required customer outcome and checks: ...
- Checkout/revision, command/phase, observed results and verified report links: ...
- Manual, optional, skipped, unexecuted checks and reasons: ...
- Inspected handoffs, integration/customer verification, review limits: ...
- Complete / partial / blocked; unresolved items, next owner/action: ...

## On failure
See suite.json `onFail.suggestions` and latest report in test/reports/.
Record repair owner, attempt/time bound, blocker and resumption condition; repair before resuming dependent checks.
```

## Legacy matrix

The narrative test matrix remains at `docs/codex/AEGIS_TEST_MATRIX_2026-05-04.md`. This orchestrator is the **executable** counterpart.
