# SUNO Metadata Expansion And Text Enrichment Plan

Date: 2026-04-03

## Why This Matters

Two outside references are worth using right now:

1. `C:\Users\blahn\OneDrive\Desktop\SUNO-media-player\gummydrops`
2. the YouTube transcript MCP patterns shown in Docker Desktop

They are valuable for different reasons:

- the media player shows a richer metadata model and stronger text/media handling patterns
- the YouTube transcript MCP confirms a clean acquisition pattern for transcript, timed transcript, and video info

Together they make a strong case for expanding the `sunoSongs` data model and pushing text enrichment higher in priority.

Vanessa wants transcript/lyrics coverage for all SUNO songs in the Vault as soon as possible.

## Current AEGIS Reality

The current SUNO enrichment path already exists and is useful:

- [enrich_suno_metadata_from_studio_api.py](C:/Users/blahn/OneDrive/Desktop/SUNO%20YouTube%20Pipeline/enviroment/AEGIS/yt-ingest/enrich_suno_metadata_from_studio_api.py)

It already backfills when missing:

- `title`
- `createdAt`
- `modelName`
- `prompt`
- `tags`
- `isInstrumental`
- `artworkUrl`
- `rawPayloadRef`
- `rawMetadataRef`

The current schema already has room for text:

- [schema.ts](C:/Users/blahn/OneDrive/Desktop/SUNO%20YouTube%20Pipeline/enviroment/AEGIS/yt-ingest/schema.ts)

Relevant fields:

- `text.transcript`
- `text.prompt`
- `text.lyrics`
- `captions.*`

The YouTube playlist lane already has a transcript/captions implementation:

- [index.ts](C:/Users/blahn/OneDrive/Desktop/SUNO%20YouTube%20Pipeline/enviroment/AEGIS/yt-ingest/index.ts)
- [enqueue_captions.py](C:/Users/blahn/OneDrive/Desktop/SUNO%20YouTube%20Pipeline/enviroment/AEGIS/yt-ingest/enqueue_captions.py)

That is important because it means the system already understands the pattern:

- fetch text
- persist files
- track status
- expose refs

What is still missing is a full SUNO text enrichment lane.

## What The Media Player Is Teaching Us

Reference files worth learning from:

- [media_info.dart](C:/Users/blahn/OneDrive/Desktop/SUNO-media-player/gummydrops/lib/class/media_info.dart)
- [lyrics.dart](C:/Users/blahn/OneDrive/Desktop/SUNO-media-player/gummydrops/lib/class/lyrics.dart)
- [lyrics_controller.dart](C:/Users/blahn/OneDrive/Desktop/SUNO-media-player/gummydrops/lib/controller/lyrics_controller.dart)
- [yt_video_info_controller.dart](C:/Users/blahn/OneDrive/Desktop/SUNO-media-player/gummydrops/lib/youtube/controller/info_controllers/yt_video_info_controller.dart)

Useful metadata ideas from `media_info.dart`:

- `description`
- `synopsis`
- `genre`
- `mood`
- `comment`
- `lyrics`
- `lyricist`
- `language`
- `label`
- `composer`
- `albumArtist`
- `country`
- `track`
- `trackTotal`
- `disc`
- `discTotal`

Useful text-handling ideas from `lyrics.dart` and `lyrics_controller.dart`:

- distinguish synced vs plain lyrics
- distinguish embedded vs cached vs internet-derived text
- keep provenance on where text came from
- store whether lyrics are available at all
- prefer cheap local/cache hits before new network calls

Useful YouTube handling ideas from the media player:

- rich video info fetch
- thumbnail handling
- queue/history patterns
- resilient info retrieval with fallbacks

## What The YouTube Transcript MCP Validates

The transcript MCP shape is simple and useful:

- `get_transcript`
- `get_timed_transcript`
- `get_video_info`

That validates a clean pattern for playlist/video intake:

- plain transcript
- timed transcript
- video metadata

We should mirror that spirit in our own data model:

- plain text
- timed text when available
- provenance
- status

## Recommended Metadata Expansion For `sunoSongs`

These fields are worth adding or formalizing.

### Core Text Fields

- `text.lyrics`
- `text.transcript`
- `text.prompt`
- `text.captionPreview`

### Text Provenance Fields

- `textSource`
- `lyricsSource`
- `transcriptSource`
- `textRetrievedAt`
- `lyricsRetrievedAt`
- `transcriptRetrievedAt`

### Text Status Fields

- `lyricsStatus`
- `transcriptStatus`
- `textConfidence`
- `timedTextAvailable`

Recommended enum values:

- `MISSING`
- `OK`
- `ERROR`
- `PARTIAL`
- `NOT_APPLICABLE`

### Rich Creative Metadata

- `genre`
- `mood`
- `language`
- `description`
- `synopsis`
- `lyricist`
- `composer`
- `label`
- `comment`

### Existing Fields To Keep Using

- `prompt`
- `tags`
- `modelName`
- `artworkUrl`
- `rawPayloadRef`
- `rawMetadataRef`

## Fastest Path For Vanessa's Songs

The fastest practical path is a two-stage enrichment plan.

### Stage 1: Fill Everything Recoverable From SUNO First

Run the SUNO Studio API enrichment over the full collection and extend it to capture any text/lyrics fields present in the clip payload.

Goal:

- fill `prompt`, `tags`, `modelName`, `artworkUrl`
- fill `text.lyrics` if the payload exposes it
- set `lyricsStatus`
- set provenance refs and timestamps

Why first:

- cheapest
- no audio processing
- highest-confidence SUNO-native data

### Stage 2: Transcribe The Remaining Gaps

For songs with no native lyric text available:

- transcribe the audio from stored media
- write `text.transcript`
- keep `lyricsStatus` and `transcriptStatus` separate

Important distinction:

- native SUNO lyrics are not the same as transcription
- if SUNO gives lyrics, store them as lyrics
- if we derive words from audio, store them as transcript unless we intentionally promote them

## Recommended Execution Order

1. Extend the existing SUNO metadata enrichment script into a richer text-aware pass.
2. Run it against the whole collection.
3. Measure:
   - how many songs now have native text
   - how many still need transcript work
4. Prioritize Vanessa's songs first for any audio transcription fallback.
5. Publish the enriched songs to the Vault immediately as fields arrive.
6. Only then design the more expensive bulk transcription pass for the remainder.

## Proposed Operational Model

### For Native SUNO Text

- source: Studio API clip payload
- storage:
  - `text.lyrics`
  - `lyricsSource=SUNO_STUDIO_API`
  - `lyricsStatus=OK`

### For Derived Audio Text

- source: audio transcription job
- storage:
  - `text.transcript`
  - `transcriptSource=AUDIO_TRANSCRIBE`
  - `transcriptStatus=OK`

### For Missing Cases

- `lyricsStatus=MISSING`
- `transcriptStatus=MISSING`
- retry only after we confirm source/media availability

## Jira-Ready Work Items

These should become real Jira tickets if they do not already exist.

### 1. Expand SUNO metadata model using media-player patterns

Title:

`Expand sunoSongs metadata model for rich text and creative descriptors`

Summary:

Review the metadata patterns surfaced by the `SUNO-media-player` reference app and formalize the subset that improves Vault usefulness without overcomplicating the schema. Start with text, creative descriptors, and provenance fields that directly benefit sorting, search, display, and publishing.

Candidate fields:

- `genre`
- `mood`
- `language`
- `description`
- `synopsis`
- `lyricist`
- `composer`
- `label`
- `comment`
- `lyricsStatus`
- `transcriptStatus`
- `lyricsSource`
- `transcriptSource`

### 2. Extend SUNO Studio API enrichment to capture native text fields

Title:

`Extend SUNO Studio enrichment to capture lyrics and text provenance`

Summary:

Build on the existing Studio API enrichment script so it captures native SUNO text fields when available, writes them into `sunoSongs`, and records status plus provenance rather than only prompt/tags/artwork/model data.

### 3. Backfill native SUNO text across all existing songs

Title:

`Backfill native SUNO lyrics and text across existing sunoSongs`

Summary:

Run the upgraded SUNO enrichment pass against the full collection, measure coverage, and write status fields so the Vault can distinguish songs with native lyrics from songs still awaiting transcript fallback.

### 4. Add audio transcript fallback for songs missing native lyrics

Title:

`Transcribe SUNO songs missing native lyrics and store transcript refs`

Summary:

For songs where the Studio API does not expose native lyrics, run an audio transcription pass against stored media and store transcript text or transcript refs plus clear provenance. Prioritize Vanessa's songs first.

### 5. Add Vault UI support for lyrics and transcript availability

Title:

`Expose lyrics and transcript coverage in the Vault UI`

Summary:

Update Vault surfaces so operators and viewers can see whether a song has native lyrics, transcript fallback, both, or neither. This should support search, display, and future publishing enhancements.

### 6. Review SUNO-media-player for reusable product patterns

Title:

`Review SUNO-media-player for reusable queue, lyrics, and metadata patterns`

Summary:

Treat `C:\Users\blahn\OneDrive\Desktop\SUNO-media-player` as a reference implementation and extract the best ideas for metadata richness, lyrics handling, queue ergonomics, and media-display patterns without adopting its architecture wholesale.

## Recommended Decision

Yes, both outside resources are worth it.

But the immediate value is not "replace our stack."

The immediate value is:

- copy the metadata ideas
- copy the text-handling discipline
- extend the SUNO enrichment lane
- get Vanessa's songs enriched first
- then keep publishing to YouTube from a richer Vault

## Bottom Line

The right near-term move is:

- use the media player as a metadata and lyrics-pattern reference
- use the transcript MCP pattern as validation for structured text acquisition
- run a SUNO-native enrichment pass first
- use transcription only for the remaining gaps

That gets us the fastest path to a richer Vault without forcing the most expensive path first.
