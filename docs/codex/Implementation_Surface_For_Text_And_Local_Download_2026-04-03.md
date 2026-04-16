# Implementation Surface For Text And Local Download

Date: 2026-04-03

This is the shortest path from planning to code.

## SUNO Text Coverage

### Primary file to change

- [enrich_suno_metadata_from_studio_api.py](C:/Users/blahn/OneDrive/Desktop/SUNO%20YouTube%20Pipeline/enviroment/AEGIS/yt-ingest/enrich_suno_metadata_from_studio_api.py)

### Contract file to update

- [schema.ts](C:/Users/blahn/OneDrive/Desktop/SUNO%20YouTube%20Pipeline/enviroment/AEGIS/yt-ingest/schema.ts)

### Supporting truth files

- [songs.extracted.json](C:/Users/blahn/OneDrive/Desktop/SUNO%20YouTube%20Pipeline/enviroment/AEGIS/yt-ingest/songs.extracted.json)
- [rebuild_catalog.py](C:/Users/blahn/OneDrive/Desktop/SUNO%20YouTube%20Pipeline/enviroment/AEGIS/yt-ingest/rebuild_catalog.py)

### Why these files

- the enrichment script already writes SUNO-native fields
- `schema.ts` is the right place to formalize the new text/status contract
- `rebuild_catalog.py` will eventually need to expose the new fields downstream

## Vault Download To Local

### Primary backend file to change

- [server.js](C:/Users/blahn/OneDrive/Desktop/SUNO%20YouTube%20Pipeline/enviroment/AEGIS/suno-viewer/server.js)

### Primary frontend file to change

- [VaultGrid.tsx](C:/Users/blahn/OneDrive/Desktop/SUNO%20YouTube%20Pipeline/enviroment/AEGIS/suno-viewer/src/components/VaultGrid.tsx)

### Frontend types file to change

- [types.ts](C:/Users/blahn/OneDrive/Desktop/SUNO%20YouTube%20Pipeline/enviroment/AEGIS/suno-viewer/src/types.ts)

### Why these files

- `server.js` already owns the app-side workflow endpoints
- `VaultGrid.tsx` already owns song-card actions, batch actions, warnings, and operator UI
- `types.ts` is the clean place to expose new download-related item fields to the UI

## Recommended Next Edit Order

### 1. Schema and enrichment first

Edit:

- `yt-ingest/schema.ts`
- `yt-ingest/enrich_suno_metadata_from_studio_api.py`

Add:

- text/status/provenance fields
- native-field capture
- missing-state writes

### 2. Vault types second

Edit:

- `suno-viewer/src/types.ts`

Add:

- text coverage fields
- local download tracking fields

### 3. Backend endpoint layer third

Edit:

- `suno-viewer/server.js`

Add:

- `/api/download-to-local`
- optional `/api/download-selection`
- Firestore write-back for local download state

### 4. UI last

Edit:

- `suno-viewer/src/components/VaultGrid.tsx`

Add:

- single-song `Download to local`
- `Download selected`
- repeat-download warnings
- large-export guardrail modal
- download-state pill/badge

## Same-Day Realistic Slice

If we want real progress today, the smallest worthwhile scope is:

1. enrich native SUNO text coverage into the database
2. add local download tracking fields
3. add single-song `Download to local`
4. add small-batch `Download selected`
5. warn on re-download

What can wait:

- perfect bulk packaging
- zip bundle generation
- advanced download history

## Bottom Line

If we want to move immediately, the first code edits should start here:

1. [enrich_suno_metadata_from_studio_api.py](C:/Users/blahn/OneDrive/Desktop/SUNO%20YouTube%20Pipeline/enviroment/AEGIS/yt-ingest/enrich_suno_metadata_from_studio_api.py)
2. [schema.ts](C:/Users/blahn/OneDrive/Desktop/SUNO%20YouTube%20Pipeline/enviroment/AEGIS/yt-ingest/schema.ts)
3. [types.ts](C:/Users/blahn/OneDrive/Desktop/SUNO%20YouTube%20Pipeline/enviroment/AEGIS/suno-viewer/src/types.ts)
4. [server.js](C:/Users/blahn/OneDrive/Desktop/SUNO%20YouTube%20Pipeline/enviroment/AEGIS/suno-viewer/server.js)
5. [VaultGrid.tsx](C:/Users/blahn/OneDrive/Desktop/SUNO%20YouTube%20Pipeline/enviroment/AEGIS/suno-viewer/src/components/VaultGrid.tsx)
