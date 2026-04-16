# AEGIS-002 YouTube Environment Standard

## Canonical Variable

The canonical environment variable for YouTube API access is:

- `YOUTUBE_API_KEY`

## Legacy Alias

The legacy alias retained for transition is:

- `YT_API_KEY`

## Runtime Behavior

Current first-wave code resolves YouTube API keys in this order:

1. `YOUTUBE_API_KEY`
2. `YT_API_KEY`

This behavior is implemented in:

1. `yt-ingest/index.ts`
2. `yt-ingest/lib/youtube.ts`

## Reason For Standardization

The codebase previously split between:

1. direct ingest path using `YT_API_KEY`
2. helper-based YouTube path using `YOUTUBE_API_KEY`

That created path-specific breakage risk.

## Migration Guidance

### Use Going Forward

Always set:

- `YOUTUBE_API_KEY`

### Temporary Compatibility

`YT_API_KEY` is still supported during transition but should be removed from active deployment configuration after environment rollout is complete.

## Scope Note

This standard applies to YouTube Data API key usage in the checked-in runtime code.

It does not replace the separate OAuth refresh-token based credential flow used by `youtube_uploader.py` for actual YouTube video uploads.
