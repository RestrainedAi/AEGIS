# AEGIS-005 Uploader Schema Alignment Note

## Problem Confirmed

The uploader previously expected:

1. `gcsPath`, or
2. a fallback object path under `aeonimus-workspaces/media/suno/...`

That did not match the actual SUNO indexing shape written by:

- `yt-ingest/firestore_upsert.py`

which stores media under:

- `media.audioUrl`
- `media.videoUrl`
- `media.thumbUrl`

with `gs://aeonimus-suno-media/...` URIs.

## Resolution Implemented

`yt-ingest/youtube_uploader.py` now:

1. reads `media.videoUrl` first
2. supports explicit `gs://bucket/object` parsing
3. falls back to legacy paths only when the canonical media field is absent

## Validation Path

Targeted syntax validation completed for:

1. `yt-ingest/youtube_uploader.py`
2. `yt-ingest/queue_manager.py`
3. `yt-ingest/rebuild_catalog.py`

Node syntax validation completed for:

1. `suno-viewer/server.js`

## Remaining Follow-Up

The next validation step should be a dry-run against a representative live `sunoSongs` document in the deployment environment to confirm:

1. `media.videoUrl` is present for intended publishable clips
2. object download succeeds against the resolved bucket and object path
3. queue-to-uploader flow behaves correctly end to end
