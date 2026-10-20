# Feature Master Test: Multi-Account SUNO Harvest

- **Feature ID:** `multi-account-harvest`
- **Module:** `yt-ingest` + Firestore sources
- **Scope tickets:** Multi-account onboarding (@nessihenize / `vanessa_secondary`)
- **Wireframe / UX ref:** Sundrop single login, multiple SUNO handles
- **Deploy phase:** pre-deploy (+ MA-05 manual post-deploy)

## Scope under test

- Scoped handle filter (`HARVEST_HANDLES` / `--handles`)
- Live `@nessihenize` clip discovery (Studio API)
- Firestore `sources/suno_nessihenize` provisioning
- Export alias `nessihenize` → `vanessa_secondary`
- Vault filter for second account after harvest

## Todo order (run before deploy)

| Step | ID | Automated |
|------|-----|-----------|
| 1 | MA-01 | Catalog sync filter unit tests |
| 2 | MA-02 | Live clip count for `@nessihenize` |
| 3 | MA-03 | Firestore source verification (GCP) |
| 4 | MA-04 | Export alias map check |
| 5 | MA-06 | Published catalog row count for `vanessa_secondary` (GCP) |
| 6 | MA-05 | Manual multi-account vault smoke |

## Depends on

`harvest-freshness` (master order + trigger)

## Run

```powershell
cd test
npm run test:multi-account
```

Provision helper: `yt-ingest/add_source_nessihenize.py`  
Catch-up script: `yt-ingest/run_nessihenize_catchup_harvest.ps1`

Steps: [suite.json](./suite.json)
