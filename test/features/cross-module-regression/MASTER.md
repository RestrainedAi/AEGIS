# Feature Master Test: Cross-Module Regression

- **Feature ID:** `cross-module-regression`
- **Module:** orchestrator (calls other suites)
- **Scope tickets:** AEGIS test matrix cross-module section
- **Wireframe / UX ref:** `docs/codex/AEGIS_TEST_MATRIX_2026-05-04.md#cross-module-regression-after-domain-change`
- **Deploy phase:** **post-deploy**

## Scope under test

Re-validates core local gates, then requires live cross-module smoke:

- Harvest → catalog freshness → vault
- Downloads / export on new domains
- YouTube queue/publish path

## Todo order

| Step | ID | Action |
|------|-----|--------|
| 1 | XR-01 | Re-run `harvest-freshness` suite |
| 2 | XR-02 | Re-run `vault-search-browse` suite |
| 3 | XR-03 | Re-run `downloads-export` suite |
| 4 | XR-04 | Manual cross-module checklist |

## Depends on

`auth-domain` (master order)

## Run

```powershell
cd test
npm run test:regression
node runners/run-feature-suite.mjs cross-module-regression --phase post-deploy --include-manual
```

Steps: [suite.json](./suite.json)
