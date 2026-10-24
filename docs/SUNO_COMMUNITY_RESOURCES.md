# Suno community resources (unofficial)

Suno has no official API. These are community projects and guides, gathered 2026-10-24. The GitHub repos were confirmed; the Reddit, blog and SWAVD links came from search results and were not opened. All are unofficial and can break at any time. Use them only for backing up our own library.

## Code projects
| Name | Link | What it is | Last active |
|---|---|---|---|
| rs-suno (suno-core) | https://github.com/teh-hippo/rs-suno | Rust library mirror: MP3/FLAC/WAV, stems, lineage, lyrics, 429 backoff. Best reference. MIT. | 2026-10-24 |
| suno-archiver | https://github.com/closestfriend/suno-archiver | Python personal backup: metadata, WAV, all workspaces, JWT refresh, `doctor` check. MIT. | 2026-10-03 |
| suno-cli | https://github.com/paperfoot/suno-cli | Rust CLI. Its API_INTELLIGENCE.md is the best endpoint write-up. MIT. | 2026-09-28 |
| SunoHarvester | https://github.com/hartmark/SunoHarvester | Python + Playwright: downloads through the real browser UI. MIT. | 2026-05-02 |
| Suno-Harvester | https://github.com/brice1988/Suno-Harvester | Attaches to logged-in Chrome and captures feed traffic. | unknown |
| SWAVD 1.44 | https://github.com/AliensDontCare/SWAVD/releases/tag/1.44 | Downloader fixed for the Aug 29, 2026 download change. | Aug 2026 |
| gcui-art/suno-api | https://github.com/gcui-art/suno-api | Well-known TS API wrapper, mostly for generation. LGPL. Stale. | 2026-03-06 |
| SunoAI-API/Suno-API | https://github.com/SunoAI-API/Suno-API | Older Python wrapper. Stale. | 2025-04-26 |

## Guides and discussion
| Name | Link | What it is |
|---|---|---|
| r/SunoExplorer: download mechanism change | https://www.reddit.com/r/SunoExplorer/comments/1w15di8/change_in_the_download_mechanism/ | Explains the Aug 29, 2026 switch to signed download links (cause of 403s). |
| Chan Meng: "Suno Closed Its Public MP3" | https://chanmeng.org/blog/suno-public-mp3-closed | Day-by-day log of how Suno shut public MP3 links. |
| r/SunoAI | https://www.reddit.com/r/SunoAI/ | Main Suno community subreddit. |

## Avoid
Paid "Suno API" resellers (suno-api.io, OmnAPI): generation only, run through other people's accounts.

Full research and fix plan: SUNO_COMMUNITY_API_RESEARCH_2026-10-24.md
