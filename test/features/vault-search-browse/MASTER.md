# Feature Master Test: Vault Search and Browse

- **Feature ID:** `vault-search-browse`
- **Module:** `suno-viewer`
- **Scope tickets:** Search stack, EPIC-12 UX handoff
- **Wireframe / UX ref:** `docs/design/aegis-design-board-page-map-v1.md`
- **Deploy phase:** pre-deploy (+ VB-05 manual post-deploy)

## Scope under test

- Search tokenization and account-scoped matching
- Full viewer unit suite + production build
- Express server parse integrity
- Live vault browse smoke (manual)

## Todo order (run before deploy)

| Step | ID | Automated |
|------|-----|-----------|
| 1 | VB-01 | `search-utils.test.js` |
| 2 | VB-02 | `npm test` (suno-viewer) |
| 3 | VB-03 | `npm run build` |
| 4 | VB-04 | `node --check server.js` |
| 5 | VB-05 | Manual vault browse checklist |

## Run

```powershell
cd test
npm run test:vault
```

Steps: [suite.json](./suite.json)
