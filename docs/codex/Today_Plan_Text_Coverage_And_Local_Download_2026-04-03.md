# Today Plan: Text Coverage And Local Download

Date: 2026-04-03

## What We Want Today

1. Get transcript / lyrics / VTT solved and represented in the database.
2. Add a real `Download to local` workflow.
3. Prevent reckless repeat downloads.

## Current Truth

### Text coverage

We already have:

- a SUNO metadata enrichment script:
  - [enrich_suno_metadata_from_studio_api.py](C:/Users/blahn/OneDrive/Desktop/SUNO%20YouTube%20Pipeline/enviroment/AEGIS/yt-ingest/enrich_suno_metadata_from_studio_api.py)
- a YouTube transcript/captions path for the playlist lane:
  - [index.ts](C:/Users/blahn/OneDrive/Desktop/SUNO%20YouTube%20Pipeline/enviroment/AEGIS/yt-ingest/index.ts)
  - [enqueue_captions.py](C:/Users/blahn/OneDrive/Desktop/SUNO%20YouTube%20Pipeline/enviroment/AEGIS/yt-ingest/enqueue_captions.py)
- schema room for text:
  - [schema.ts](C:/Users/blahn/OneDrive/Desktop/SUNO%20YouTube%20Pipeline/enviroment/AEGIS/yt-ingest/schema.ts)

What we do not yet have:

- a full SUNO-native lyrics/transcript/VTT enrichment lane

### Download to local

There is no real Vault-side `Download to local` workflow yet.

The current viewer has:

- publish workflow
- queue inspection
- YouTube metadata modal

But not:

- local download action
- local download tracking
- re-download warnings
- bulk packaging logic

Relevant files:

- [server.js](C:/Users/blahn/OneDrive/Desktop/SUNO%20YouTube%20Pipeline/enviroment/AEGIS/suno-viewer/server.js)
- [VaultGrid.tsx](C:/Users/blahn/OneDrive/Desktop/SUNO%20YouTube%20Pipeline/enviroment/AEGIS/suno-viewer/src/components/VaultGrid.tsx)
- [types.ts](C:/Users/blahn/OneDrive/Desktop/SUNO%20YouTube%20Pipeline/enviroment/AEGIS/suno-viewer/src/types.ts)

## Part 1: Solve Transcript / Lyrics / VTT Today

### Recommended field model

For each SUNO song, we should carry:

- `text.lyrics`
- `text.transcript`
- `text.prompt`
- `lyricsStatus`
- `transcriptStatus`
- `lyricsSource`
- `transcriptSource`
- `gcsLyricsTxt`
- `gcsTranscriptTxt`
- `gcsCaptionsVtt`
- `textRetrievedAt`

Status values:

- `OK`
- `MISSING`
- `ERROR`
- `PARTIAL`

### Operational rule

- If SUNO gives us native text, store it as `lyrics`
- If we derive words from audio, store it as `transcript`
- If timed text exists, store the VTT ref
- Do not pretend transcript == lyrics without explicit decision

### Fastest execution order

1. Extend the SUNO Studio enrichment pass to capture every native text field available.
2. Write native text coverage into `sunoSongs`.
3. Mark missing rows explicitly with `lyricsStatus=MISSING`.
4. Run transcript fallback only for the rows still missing native text.
5. Write transcript/VTT refs back into the same collection.

### Same-day success definition

By end of day, every SUNO song should be in one of these states:

- native lyrics present
- transcript fallback present
- explicitly marked missing
- explicitly marked error

No unknown limbo.

## Part 2: Download To Local Today

### Product rule

There are three download modes, and they should not behave the same.

#### A. Single song

Use case:

- quick personal export
- immediate save to local machine

Behavior:

- direct download action
- no heavy warning on first download
- mark the item as downloaded locally

#### B. Few songs

Suggested threshold:

- `2` to `20`

Behavior:

- allow multi-download
- show lightweight warning:
  - `You are downloading multiple songs to local`
- write one batch record and mark each item

#### C. A shitload

Suggested threshold:

- `21+`

Behavior:

- do not fire raw browser downloads blindly
- require explicit confirmation
- prefer package/manifest workflow
- if possible, generate a downloadable manifest or staged bundle instead of dozens of separate clicks

## Local Download Tracking Model

We need to mark local download state, not just perform a file transfer.

Suggested fields on item or a related object:

- `localDownloadStatus`
- `localDownloadedAt`
- `localDownloadCount`
- `lastLocalDownloadMode`
- `lastLocalDownloadBatchId`

Recommended enum values:

- `NEVER`
- `DOWNLOADED`
- `DOWNLOADED_MULTIPLE_TIMES`

### Warning rules

#### First download

- no hard block
- allow action

#### Second download

- show warning:
  - `This song was already downloaded locally on <date>. Download again?`

#### Third+ download

- stronger warning
- require one more confirmation click
- show count

#### Bulk repeat download

- if any item in a batch was already downloaded, warn before continuing
- if most items were already downloaded, push the user toward manifest review instead of brute-force re-download

## Recommended UX

### Song card

Add:

- `Download to local`
- a small state pill:
  - `Never downloaded`
  - `Downloaded`
  - `Downloaded 3x`

### Batch action bar

Add:

- `Download selected`

Before running:

- show count
- show how many are already downloaded
- show whether this is small batch or large export

### Large export mode

If selection exceeds threshold:

- show modal
- default action becomes:
  - `Generate download package/manifest`

## Recommended Implementation Sequence

### Today, highest-value version

1. Add local download tracking fields.
2. Add `Download to local` button for single items.
3. Add `Download selected` for small batches.
4. Add repeat-download warnings.
5. For large selections, block naive multi-download and route to explicit confirmation.

### Next version

6. Add manifest/zip packaging workflow for large exports.
7. Add download history view.
8. Add operator cleanup/reset for false positives.

## Engineering Decision

The safest initial implementation is:

- browser-driven direct downloads for single/small batch
- tracked in Firestore
- warnings on repeat
- large batches routed through a separate, more intentional flow

That gets useful capability today without pretending we already have enterprise-grade packaging.

## Bottom Line

### Today

We should aim to finish:

1. text coverage represented explicitly in the database
2. local download available for single and small-batch use
3. repeat-download warnings and tracking in place

### Today is not the day for

- perfect bulk packaging
- full export management
- pretending transcript and lyrics are the same thing

Today is the day for:

- real coverage
- real download action
- real state tracking
- no ambiguity
