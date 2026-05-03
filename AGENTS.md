# AGENTS.md

## Cursor Cloud specific instructions

### Architecture overview

This is the **Sundrop Cloud / Aeonimus Vault** — a music catalog management and distribution platform built on GCP. Two main services:

| Service | Location | Dev command | Port |
|---------|----------|-------------|------|
| **suno-viewer** (React+Vite frontend + Express backend) | `suno-viewer/` | `npm run dev` (Vite) / `node server.js` (Express) | 5173 (Vite) / 8080 (Express) |
| **yt-ingest** (sunopipeline-api, Express+TypeScript) | `yt-ingest/` | `npm run build && node dist/index.js` | 8080 (default) |

### Running services locally

- **suno-viewer frontend**: `cd suno-viewer && npm run dev` — starts Vite on port 5173.
- **suno-viewer backend**: `cd suno-viewer && node server.js` — starts Express on port 8080. The Vite dev server proxies `/catalog.csv` to this backend.
- **yt-ingest API**: `cd yt-ingest && npm run build && PORT=8081 node dist/index.js` — builds TypeScript then starts on the given port. Use `DEBUG=app:*` for verbose logging.

### Lint / type-checking

No ESLint is configured. Lint via TypeScript strict mode:
- `cd suno-viewer && npx tsc --noEmit`
- `cd yt-ingest && npx tsc --noEmit`

### Build

- `cd suno-viewer && npm run build` — runs `tsc && vite build`, output in `suno-viewer/dist/`.
- `cd yt-ingest && npm run build` — runs `tsc`, output in `yt-ingest/dist/`.

### Important caveats

- The Express backend (`suno-viewer/server.js`) requires GCP credentials for full functionality (Firestore, GCS, Firebase Auth). Without them, catalog and auth endpoints return 500s, but the server starts and the Vite frontend renders.
- The yt-ingest API uses the `debug` npm package — set `DEBUG=app:*` to see application logs.
- The yt-ingest API's dev script (`npm run dev`) uses `node --watch dist/index.js` — you must run `npm run build` first as it watches the compiled JS, not the TypeScript source.
- Python pipeline scripts (`yt-ingest/*.py`) need `pip install -r yt-ingest/requirements.txt`.
- No test framework is configured; validation is done via TypeScript strict type checking and manual testing.
- The root `package.json` is a legacy file; use the per-project package.json files in `suno-viewer/` and `yt-ingest/`.
