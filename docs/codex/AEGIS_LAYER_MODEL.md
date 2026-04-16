# AEGIS Layer Model

## Summary

AEGIS uses five hard ownership layers:

1. `Creation Layer`
2. `Asset Layer`
3. `Distribution Layer`
4. `Interaction Layer`
5. `Operations Layer`

These are not just UI groupings. They define where truth lives and which system is allowed to write each class of field.

## Product language

1. `Creation Record` = the full set of building blocks from Suno
2. `Portable Assets` = the downloadable usable outputs
3. `Distribution State` = publish workflow and destination state
4. `Interaction Record` = audience response and performance history
5. `Vault Source of Truth` = the combined authoritative view of all four song-facing layers

Core rule:

`If Suno exposes it and it helps explain, reproduce, organize, search, or publish a song, the Vault should preserve it.`

## Canonical mapping

| Layer | Primary authority | Examples |
| --- | --- | --- |
| `Creation Layer` | `sunoSongs` | `prompt`, `lyrics`, `tags`, `displayTags`, `styles`, `modelName` |
| `Asset Layer` | `sunoSongs` plus storage/export artifacts | `media.*`, `gcs.*`, `gcsLyricsTxt`, `gcsLyricsJson`, `gcsLyricsVtt` |
| `Distribution Layer` | `ytUploadQueue` plus mirrored item outcomes | `queuedAt`, `startedAt`, `ytVideoId`, `ytPublishedAt`, `ytError` |
| `Interaction Layer` | future engagement collection keyed by `songKey` | `viewCount`, `playCount`, `uniqueListeners`, `commentCount`, `shareCount` |
| `Operations Layer` | `Source`, `Run`, `Export Artifact` | source health, run evidence, export freshness |

## Song planes

Every song should be understandable through four user-facing planes:

1. `creation`
2. `assets`
3. `distribution`
4. `interaction`

The Vault may show all four together, but ownership must stay separated behind the scenes.

## Implementation defaults

1. Preserve raw creation truth such as `prompt`, `tags`, and `displayTags`.
2. Add normalized UX fields such as `styles` and `styleText` without replacing raw fields.
3. Keep publish workflow authority in `ytUploadQueue`.
4. Keep engagement metrics outside harvest-owned song truth.
5. Treat the first `Interaction Layer` implementation as a schema shell, not a required live sync.
