# Feature Master Test: YouTube Bridge and OAuth

- **Feature ID:** `youtube-bridge`
- **Module:** `yt-ingest`
- **Scope tickets:** AEGIS-010, AEGIS-011
- **Wireframe / UX ref:** `docs/codex/AEGIS_YOUTUBE_BRIDGE_VALIDATION_2026-04-06.md`
- **Deploy phase:** pre-deploy OAuth preflight (+ YT-02 manual post-deploy)

## Scope under test

- YouTube refresh token scopes (upload + captions)
- Queue-to-publish operator smoke

## Todo order

| Step | ID | Automated |
|------|-----|-----------|
| 1 | YT-01 | `validate_youtube_oauth_scopes.py` (optional GCP) |
| 2 | YT-02 | Manual queue/publish checklist |

## Run

```powershell
cd test
npm run test:youtube
```

Steps: [suite.json](./suite.json)
