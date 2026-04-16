# AEGIS YouTube Publish Mapping

## Rule

Preserve the original recipe in the Vault. Transform only copies for destination-specific publishing.

The Vault remains the source of truth for original SUNO metadata. YouTube metadata is a derived publish layer.

## Field Mapping

### Title

- Vault truth:
  - `title`
- YouTube publish field:
  - `snippet.title`
- Policy:
  - Use the Vault title as the default publish title.
  - A future queue override may replace the publish copy, but must not overwrite the Vault source title.

### Description

- Vault truth:
  - `description`
  - `caption`
  - `lyrics`
  - `prompt`
- YouTube publish field:
  - `snippet.description`
- Policy:
  - Do not auto-publish the raw SUNO prompt as the YouTube description.
  - Default description should be derived from:
    1. `description` or `caption`
    2. normalized `styles`
    3. a short lyrics excerpt
  - The raw prompt remains preserved only in the Vault unless an operator intentionally promotes it.
  - Lyrics policy for YouTube descriptions should be operator-controlled:
    - `none`
    - `excerpt`
    - `full`
  - This policy affects only the publish copy and must not mutate the Vault lyric record.

### Prompt / Creation Context

- Vault truth:
  - `prompt`
- YouTube publish field:
  - `snippet.description`
- Policy:
  - Prompt context must remain private by default.
  - Prompt exposure should be operator-controlled:
    - `none`
    - `excerpt`
    - `full-note`
  - When exposed, prompt text should appear as a labeled creation note in the description.
  - This policy affects only the publish copy and must not mutate the Vault prompt record.

### Captions / Timed Lyrics

- Vault truth:
  - `gcsLyricsVtt`
  - `lyrics`
- YouTube publish field:
  - caption track via `captions.insert`
- Policy:
  - Prefer `gcsLyricsVtt` as the caption upload artifact when available.
  - If no saved VTT exists but lyrics text exists, a synthetic pacing VTT may be generated for portability.
  - Synthetic pacing must be treated as helper timing, not authoritative SUNO timing.
  - Caption upload is best-effort and must not fail the whole video publish if the caption track upload fails.

### Tags

- Vault truth:
  - `tags`
  - `displayTags`
  - `styles`
  - `styleText`
- YouTube publish field:
  - `snippet.tags`
- Policy:
  - Use normalized publish-safe tags derived from:
    - `styles` / `styleText`
    - account identity
    - title
  - Do not blindly dump raw SUNO tags into YouTube output.
  - Original SUNO tags stay preserved in the Vault without mutation.

### Language / Category / License / AI Disclosure

- Queue overrides:
  - `ytLanguage`
  - `ytCategory`
  - `ytLicense`
  - `ytAlteredContent`
  - `ytShortsRemixing`
  - `ytPrivacy`
- YouTube publish fields:
  - `snippet.defaultLanguage`
  - `snippet.categoryId`
  - `status.license`
  - `status.containsSyntheticMedia`
  - `status.allowShareRemix`
  - `status.privacyStatus`

## Ownership Boundary

- Vault source truth:
  - original SUNO metadata and preserved artifacts
- Queue layer:
  - operator-specific publish overrides
- YouTube publish layer:
  - transformed copy for destination presentation

No YouTube transformation should overwrite:

- `prompt`
- `tags`
- `displayTags`
- `lyrics`
- `styles`
- `styleText`
- `title`

inside the Vault source record.
