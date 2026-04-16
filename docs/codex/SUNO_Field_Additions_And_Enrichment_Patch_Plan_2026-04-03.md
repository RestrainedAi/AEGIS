# SUNO Field Additions And Enrichment Patch Plan

Date: 2026-04-03

Primary implementation anchor:

- [enrich_suno_metadata_from_studio_api.py](C:/Users/blahn/OneDrive/Desktop/SUNO%20YouTube%20Pipeline/enviroment/AEGIS/yt-ingest/enrich_suno_metadata_from_studio_api.py)

Contract anchor:

- [schema.ts](C:/Users/blahn/OneDrive/Desktop/SUNO%20YouTube%20Pipeline/enviroment/AEGIS/yt-ingest/schema.ts)

## Goal

Define the exact field additions we want on `sunoSongs`, and the exact patch plan for extending the current Studio API enrichment pass.

This is intentionally implementation-oriented.

## Current Enrichment Coverage

The current script already backfills when missing:

- `title`
- `createdAt`
- `modelName`
- `prompt`
- `tags`
- `isInstrumental`
- `artworkUrl`
- `rawPayloadRef`
- `rawMetadataRef`

## Exact Field Additions

### 1. Top-Level Creative Metadata

These should remain top-level because they are simple catalog fields and match the existing pattern.

- `description: string`
- `caption: string`
- `negativePrompt: string`
- `modelMajorVersion: string`
- `explicit: boolean`
- `displayTags: string[]`

Why:

- these are directly useful for Vault display, search, and publishing
- the sample SUNO payload already contains them or their equivalents

### 2. Text Object Expansion

The existing `text` object in [schema.ts](C:/Users/blahn/OneDrive/Desktop/SUNO%20YouTube%20Pipeline/enviroment/AEGIS/yt-ingest/schema.ts) should expand to:

- `text.prompt`
- `text.lyrics`
- `text.transcript`
- `text.captionPreview`

Recommended meanings:

- `text.prompt` = native SUNO generation prompt
- `text.lyrics` = native lyric text from SUNO, if available
- `text.transcript` = text derived from audio/transcription fallback
- `text.captionPreview` = short native caption/teaser text

### 3. Text Status And Provenance

Add these top-level fields:

- `lyricsStatus: "OK" | "MISSING" | "ERROR" | "PARTIAL"`
- `transcriptStatus: "OK" | "MISSING" | "ERROR" | "PARTIAL"`
- `lyricsSource: "SUNO_STUDIO_API" | "AUDIO_TRANSCRIBE" | "MANUAL" | "UNKNOWN"`
- `transcriptSource: "SUNO_STUDIO_API" | "AUDIO_TRANSCRIBE" | "MANUAL" | "UNKNOWN"`
- `textRetrievedAt: string`
- `lyricsRetrievedAt: string`
- `transcriptRetrievedAt: string`

Why:

- we need to distinguish native SUNO text from derived transcript fallback
- we need to remove ambiguity in the Vault

### 4. Text File Refs

Add these top-level refs:

- `gcsLyricsTxt: string`
- `gcsTranscriptTxt: string`
- `gcsCaptionsVtt: string`

Why:

- these match the existing playlist-lane file-ref style
- they let us store large text out-of-band if needed

### 5. Optional Rich Metadata

Worth adding if the payload or enrichment source yields them later:

- `genre: string`
- `mood: string`
- `language: string`
- `synopsis: string`
- `lyricist: string`
- `composer: string`
- `label: string`
- `comment: string`

These are important, but they are second-wave compared with the text/status fields above.

## Mapping From Current SUNO Payload

The current sample payload already supports:

- `metadata.prompt` -> `text.prompt` and legacy `prompt`
- `metadata.tags` -> keep as raw style text if useful
- `metadata.negative_tags` -> `negativePrompt`
- `caption` -> `caption` and `text.captionPreview`
- `description` -> `description`
- `display_tags` -> `displayTags` array and existing `tags`
- `model_name` -> `modelName`
- `major_model_version` -> `modelMajorVersion`
- `explicit` -> `explicit`
- `image_url` / `image_large_url` -> `artworkUrl`

## Exact Patch Plan For The Enrichment Script

### Phase 1: Extend field extraction

In `build_patch(doc, clip)`:

Add extraction helpers for:

- `clip_caption = sanitize_text(clip.get("caption"))`
- `clip_description = sanitize_text(clip.get("description"))`
- `clip_negative_prompt = sanitize_text(metadata.get("negative_tags"))`
- `clip_major_model_version = sanitize_text(clip.get("major_model_version"))`
- `clip_display_tags = split_display_tags(clip.get("display_tags"))`
- `clip_explicit = clip.get("explicit")`

### Phase 2: Patch new simple fields when missing

Add missing-only patches for:

- `caption`
- `description`
- `negativePrompt`
- `modelMajorVersion`
- `explicit`
- `displayTags`

### Phase 3: Start writing the text object cleanly

Because Firestore REST patches nested maps awkwardly, use explicit map writes for `text`.

Recommended write behavior:

- if no `text` map exists, create it
- if `text.prompt` missing and native prompt exists, set it
- if `text.captionPreview` missing and caption exists, set it
- do not fabricate `text.lyrics`
- do not fabricate `text.transcript`

### Phase 4: Write status fields

Recommended behavior on every considered SUNO song:

- if native lyrics are found:
  - `lyricsStatus = OK`
  - `lyricsSource = SUNO_STUDIO_API`
  - `lyricsRetrievedAt = now`
- if native lyrics are absent:
  - `lyricsStatus = MISSING`

For transcripts in this script:

- do not generate transcript here
- only initialize:
  - `transcriptStatus = MISSING`
  - when no transcript exists yet

That keeps the Studio API pass cheap and honest.

### Phase 5: Preserve existing values

Do not overwrite:

- existing `text.lyrics`
- existing `text.transcript`
- existing `lyricsStatus=OK`
- existing `transcriptStatus=OK`

This script should enrich density, not erase downstream work.

## Recommended Implementation Order

### Today

1. Extend the Studio API enrichment script with the new native fields.
2. Run dry-run on a small sample.
3. Apply to Vanessa songs first.
4. Apply to the full collection if the sample looks clean.

### Immediately after

5. Report coverage:
   - native prompt coverage
   - caption coverage
   - description coverage
   - native lyrics coverage
   - transcript-missing count

### Second pass

6. Build transcript fallback job only for rows still missing native lyrics.

## Safe Rules

- Native SUNO text first.
- Transcription second.
- Missing should be explicit.
- Never confuse transcript with native lyrics.
- Preserve previous enrichment and publishing fields.

## Smallest Useful Code Change

If we want to move fast, the minimum worthwhile patch is:

1. add:
   - `caption`
   - `description`
   - `negativePrompt`
   - `modelMajorVersion`
   - `displayTags`
   - `explicit`
2. add:
   - `lyricsStatus`
   - `transcriptStatus`
3. add:
   - `text.prompt`
   - `text.captionPreview`

That alone would materially improve the Vault and prepare the collection for transcript fallback.
