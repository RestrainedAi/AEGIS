# Feature Master Test: Harvest and Freshness Chain

- **Feature ID:** `harvest-freshness`
- **Module:** `yt-ingest`
- **Scope tickets:** AEGIS-006, AEGIS-009
- **Wireframe / UX ref:** `docs/codex/AEGIS_TEST_MATRIX_2026-05-04.md#harvest-and-freshness-chain`
- **Deploy phase:** pre-deploy (HF-05 optional GCP runtime verify)

## Scope under test

- Multi-handle catalog sync source registry + fallback floor
- Pipeline monitor healthy/stale/partial classifications
- SUNO export contract (`rebuild_catalog` mapping)
- Admin export freshness helpers
- Cloud Run `suno-harvest` runtime shape (optional)

## Todo order (run before deploy)

| Step | ID | Automated |
|------|-----|-----------|
| 1 | HF-01 | `unittest test_catalog_sync_sources.py` |
| 2 | HF-02 | `validate_pipeline_monitor_status.py` |
| 3 | HF-03 | `validate_suno_export_contract.py` |
| 4 | HF-04 | `freshness-utils.test.js` |
| 5 | HF-05 | `verify_harvest_runtime.ps1` (optional, GCP) |

## Triggers

On pass → enqueues **`multi-account-harvest`** (see `config/suite-order.json`).

## Run

```powershell
cd test
npm run test:harvest
```

Machine-readable steps: [suite.json](./suite.json)
