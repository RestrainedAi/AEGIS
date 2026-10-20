# Feature Master Test: Auth and Domain Cutover

- **Feature ID:** `auth-domain`
- **Module:** `suno-viewer` (live deployment)
- **Scope tickets:** Domain migration, DEV-72 auth regression
- **Wireframe / UX ref:** `docs/codex/AEGIS_SUNDROP_DOMAIN_MIGRATION_TICKET_STACK_2026-04-09.md`
- **Deploy phase:** **post-deploy only**

## Scope under test

- Public route availability on `sundrop.cloud` / `sundrop.music`
- Authenticated login → vault path
- Gated unauthenticated vault access

## Todo order (after deploy)

| Step | ID | Type |
|------|-----|------|
| 1 | AD-01 | HTTP HEAD `/` |
| 2 | AD-02 | HTTP HEAD `/login` |
| 3 | AD-03 | HTTP HEAD `/signup` |
| 4 | AD-04 | HTTP HEAD `/vault` |
| 5 | AD-05 | HTTP HEAD `sundrop.music/vault` |
| 6 | AD-06 | Manual auth checklist |

## Run

```powershell
cd test
npm run test:auth-domain
# equivalent:
node runners/run-feature-suite.mjs auth-domain --phase post-deploy
```

Steps: [suite.json](./suite.json)
