# Feature Master Test: Downloads and Export Packaging

- **Feature ID:** `downloads-export`
- **Module:** `suno-viewer` + `yt-ingest` contract
- **Scope tickets:** AEGIS-001, AEGIS-009
- **Wireframe / UX ref:** `docs/codex/AEGIS_EXPORT_RUNTIME_VALIDATION_2026-04-06.md`
- **Deploy phase:** pre-deploy (+ DE-04 manual post-deploy)

## Scope under test

- Customer-facing export CSV shaping (no internal GCS/YT columns)
- Catalog export job artifact helpers
- Rebuild/export contract alignment
- Live ZIP/CSV/JSON download smoke (manual)

## Todo order (run before deploy)

| Step | ID | Automated |
|------|-----|-----------|
| 1 | DE-01 | `export-utils.test.js` |
| 2 | DE-02 | `catalog-export-utils.test.js` |
| 3 | DE-03 | `validate_suno_export_contract.py` |
| 4 | DE-04 | Manual export packaging checklist |

## Run

```powershell
cd test
npm run test:export
```

Steps: [suite.json](./suite.json)
