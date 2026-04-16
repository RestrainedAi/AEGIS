# Jira Drafts For Metadata Expansion And Transcript Coverage

Date: 2026-04-03

These are Jira-ready drafts based on:

- `C:\Users\blahn\OneDrive\Desktop\SUNO-media-player\gummydrops`
- the YouTube transcript MCP patterns
- the current AEGIS SUNO enrichment path

## 1. Review SUNO-media-player for reusable metadata and lyrics patterns

Title:

`Review SUNO-media-player for reusable metadata and lyrics patterns`

Summary:

Use `C:\Users\blahn\OneDrive\Desktop\SUNO-media-player\gummydrops` as a reference implementation for richer media metadata, lyrics handling, queue ergonomics, and thumbnail/waveform patterns. Extract the useful concepts without trying to adopt the app architecture directly.

What to learn from:

- `lib/class/media_info.dart`
- `lib/class/lyrics.dart`
- `lib/controller/lyrics_controller.dart`
- `lib/youtube/controller/info_controllers/yt_video_info_controller.dart`
- `lib/youtube/class/youtube_id.dart`
- `lib/youtube/class/youtube_id_stats.dart`

Key outputs:

- recommended metadata fields to adopt
- recommended text/lyrics status model
- recommended queue/history/display ideas for Sundrop

## 2. Expand sunoSongs metadata model for richer creative and text fields

Title:

`Expand sunoSongs metadata model for richer creative and text fields`

Summary:

Formalize a richer metadata model for SUNO songs so the Vault can display and filter more than title/media URLs. Start with text, creative descriptors, provenance, and status fields that improve user experience and publishing.

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
- `textRetrievedAt`

## 3. Extend SUNO Studio enrichment to capture all native text fields

Title:

`Extend SUNO Studio enrichment to capture all native text fields`

Summary:

Upgrade the existing SUNO metadata enrichment pass so it captures every native text and metadata field exposed by the Studio clip payload, not just prompt/tags/model/artwork. Write provenance and status fields explicitly.

Current anchor:

- `yt-ingest/enrich_suno_metadata_from_studio_api.py`

Fields already present in sample payloads:

- `prompt`
- `tags`
- `negative_tags`
- `caption`
- `description`
- `display_tags`
- `model_name`
- `major_model_version`
- `image_url`
- `image_large_url`

## 4. Backfill native SUNO metadata across the full collection

Title:

`Backfill native SUNO metadata across all existing sunoSongs`

Summary:

Run the upgraded SUNO enrichment pass across the full collection so existing Vault items gain richer metadata and better downstream publishing context.

Success criteria:

- collection coverage measured
- updated field counts reported
- no placeholder fabrication
- provenance preserved

## 5. Add transcript fallback for SUNO songs missing native lyrics

Title:

`Transcribe SUNO songs missing native lyrics and store transcript refs`

Summary:

Where SUNO does not expose native lyric text, generate transcript coverage from stored audio/video media. Keep transcription provenance explicit and separate from native lyrics.

Priority:

- Vanessa songs first
- then full backlog

## 6. Add Vault support for lyrics and transcript coverage

Title:

`Expose lyrics and transcript coverage in the Vault`

Summary:

Update the Vault so songs can show whether they have native lyrics, transcript fallback, both, or neither. Make this visible enough that operators can tell which songs are ready for publishing and which need enrichment.

Useful UI states:

- `Native Lyrics`
- `Transcript Ready`
- `Needs Text`
- `Text Error`

## 7. Use transcript MCP pattern to standardize text acquisition

Title:

`Standardize text acquisition pattern using transcript and timed-transcript model`

Summary:

Use the same pattern validated by the YouTube transcript MCP server for transcript capture inside Sundrop: plain transcript, timed transcript when available, status, provenance, and retrieval timestamps.

Goal:

- one consistent text-acquisition model across YouTube and SUNO lanes

## 8. Define publish-ready metadata minimum for YouTube

Title:

`Define publish-ready metadata minimum for Vault-to-YouTube`

Summary:

Decide which metadata fields must exist before a SUNO song is considered fully publish-ready for YouTube. At minimum, this should cover title, artwork/media integrity, and the best available text package.

Questions to settle:

- Is prompt enough when lyrics are missing?
- Should transcript fallback be acceptable for description generation?
- When do we block publish versus warn?

## 9. Add local download tracking for SUNO songs

Title:

`Add local download tracking and warnings for SUNO songs`

Summary:

Add first-class local download tracking to `sunoSongs` or a related download object so the Vault can tell whether a song has already been downloaded, how many times, and in what mode. This is required before a true `Download to local` workflow can be trusted.

Suggested fields:

- `localDownloadStatus`
- `localDownloadedAt`
- `localDownloadCount`
- `lastLocalDownloadMode`
- `lastLocalDownloadBatchId`

## 10. Add Vault Download to Local for single and small batch

Title:

`Add Vault Download to Local workflow for single and small batch export`

Summary:

Add a real `Download to local` workflow to the Vault for single-song and small-batch export. Include first-download success, repeat-download warnings, and write-back of local download tracking fields.

Behavior:

- single song download
- selected small-batch download
- warning on repeat download
- no silent duplicate export

## 11. Add large-export guardrails for local download

Title:

`Add large-export guardrails and confirmation flow for local downloads`

Summary:

Define and implement separate handling for large local export requests so the Vault does not blindly fire a large number of repeat downloads. Force explicit confirmation and prepare for manifest/package-oriented export handling.

Suggested thresholds:

- `1` = single
- `2-20` = small batch
- `21+` = large export
