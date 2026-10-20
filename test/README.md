# AEGIS Test Suite

Project-level **sequential feature test orchestrator**. Each feature has a **MASTER.md** (human authority) and **suite.json** (machine-runnable steps).

**Full module catalog (function specs + wireframes + test traceability):** [FEATURE_MODULE_CATALOG.md](./FEATURE_MODULE_CATALOG.md)

Follow [Development DNA](../docs/codex/DEVELOPMENT_PRINCIPLES.md) for ownership, focused specialist work, verified handoffs, and acceptance. The [master source of truth](../docs/codex/AEGIS_MASTER_SOURCE_OF_TRUTH.md) and [workstream ownership](../docs/codex/AEGIS_Workstream_Ownership_And_Change_Control.md) remain authoritative.

## Quick start

```powershell
cd test
npm run test:pre-deploy      # before deploy (default gate)
npm run test:post-deploy     # after deploy (live domains)
npm run test:all             # everything in master order
```

Single feature:

```powershell
npm run test:harvest
npm run test:multi-account
npm run test:regression
```

## Documentation

| Doc | Purpose |
|-----|---------|
| [FEATURE_MODULE_CATALOG.md](./FEATURE_MODULE_CATALOG.md) | **Every module**: how it works, wireframes, test mapping |
| [MASTER_TEST_SUITE.md](./MASTER_TEST_SUITE.md) | Global orchestrator, deploy phases, adding Feature B |
| [features/*/MASTER.md](./features/) | Per-feature master test plans |
| [config/suite-order.json](./config/suite-order.json) | Master todo order + triggers |
| [docs/codex/AEGIS_TEST_MATRIX_2026-05-04.md](../docs/codex/AEGIS_TEST_MATRIX_2026-05-04.md) | Narrative matrix / regression history |

## Behavior

1. Steps run **in order** — pass or skip → auto-advance; failed step → log + suggestions + stop.
2. Reports land in `test/reports/<timestamp>/` (JSON + Markdown).
3. **Manual** steps skip unless `--include-manual`; that flag records acknowledgement only. Record actual operator observations separately.
4. **Optional GCP** steps skip if `gcloud auth` is unavailable; optional command/HTTP failures also become skips. A passed suite may contain unverified acceptance checks.
5. One feature can **trigger** another via `triggersOnPass` in `suite-order.json`.

## Legacy unit tests (still used inside suites)

- `suno-viewer/test/*.test.js` — run via `npm test` in suno-viewer or suite steps
- `yt-ingest/test_catalog_sync_sources.py` — harvest source merge/filter
- `yt-ingest/validate_*.py` — local contract validators

## Standard handoff workflow

1. **Sequence:** name one accountable feature owner in the [existing board](../docs/board/README.md) or [feature brief](../docs/codex/templates/FEATURE_BRIEF.md). Define the customer outcome, scope/wireframes, dependencies, and acceptance checks; update `features/<id>/MASTER.md` and `suite.json` before deploy.
2. For a large feature, assign focused specialists bounded outputs, owned files, relevant context/tools, dependencies, and checks. Respect single-writer workstream ownership. The feature owner inspects each handoff and verifies integration; small features may use proportionate self-review, disclosed as such.
3. Run `npm run test:pre-deploy` (or the feature alias with its phase checked). **Conditional:** inspect step results and omitted suites, not just the exit status. Disclose manual acknowledgements, optional failures, phase skips, and unexecuted checks, with reasons and remaining acceptance work.
4. **Loop:** return failures to the responsible owner with evidence and a concrete repair task. Bound retries by attempts/time, repair before resuming dependent tests, and record a blocker plus resumption condition when external change is required. The runner stops on failure; it does not automate repair or persistent follow-up.
5. Once release prerequisites pass and deployment is authorized, verify the active checkout/revision, deploy, run `npm run test:post-deploy`, and verify the applicable customer-facing outcome. An HTTP check or green suite alone does not establish that outcome.
6. Handoff records changed paths, commands/phase/revision, observed results and report links, skipped/unexecuted checks, unresolved issues, dependencies, and the next owner/action. Preserve original evidence. Record **complete**, **partial**, or **blocked** in the existing tracking artifact; unmet required acceptance checks prevent closure.
