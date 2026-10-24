# Suno community API research — 2026-10-24 (read-only web research)

No Suno calls were made with Thomas's account. Everything here is **unofficial and reverse-engineered**. Suno can break it at any time. Using it can also violate Suno's ToS on automated access, so keep it to backing up our own library only.

## The big news: Suno changed downloads on Aug 29, 2026
- r/SunoExplorer, "Change in the download mechanism" (Aug 28, 2026 US time): direct `cdn1.suno.ai` MP3 links now return **403 "MissingKey: Missing Key-Pair-Id query parameter or cookie value"**. That error comes from CloudFront signed URLs. Suno's MP3 downloads now work like WAV: **you request a download link for the track first**. Public playback is delivered encoded and turned into a Blob in the browser. https://www.reddit.com/r/SunoExplorer/comments/1w15di8/change_in_the_download_mechanism/
- Chan Meng's blog, "Suno Closed Its Public MP3" (daily monitoring):
  - Aug 29: cdn1 starts answering 403.
  - Aug 30: every clip's `audio_url` becomes the literal string `https://studio-api.prod.suno.com/api/forbidden`.
  - Sep 5: the MP3 entry disappears from the clip's `media_urls` manifest.
  - https://chanmeng.org/blog/suno-public-mp3-closed
- SWAVD (a downloader) shipped a fix for this the same day: https://github.com/AliensDontCare/SWAVD/releases/tag/1.44 (not inspected yet; it's the best lead on the new signed-download endpoint).
- **This probably explains problems 1 and 2.** Our "stub/placeholder" audio is most likely the `/api/forbidden` response, a silent streaming placeholder, or an expiring audiopipe link. Our 403s are the new signed-URL requirement, not a per-account ban.

## Endpoints the community uses (base `https://studio-api-prod.suno.com`; older docs say `studio-api.suno.ai`)
| Purpose | Endpoint | Source |
|---|---|---|
| Auth | Clerk at `https://auth.suno.com`. The long-lived `__client` cookie is exchanged for a JWT that lasts about 1 hour, sent as `Authorization: Bearer`. Also needs `device-id` and `browser-token` headers, plus origin and referer set to suno.com | paperfoot/suno-cli API_INTELLIGENCE.md, rs-suno auth.rs |
| List library | `POST /api/feed/v3` `{"page":0}`, then `next_cursor`, until `has_more=false`. Filters: searchText, trashed, fullSong, stem | rs-suno, suno-cli |
| Workspaces | `GET /api/project/me`, then `/api/project/{id}` (paginated). **`/api/project/default` holds only unassigned clips. One tool missed 58% of a library because of this.** | suno-archiver CHANGELOG |
| One clip | `GET /api/clip/{id}`. Batch `get_songs_by_ids` in **pairs of 2** (asking for 4 or more IDs drops results, SunoAI-API #49) | suno-cli commit 16df38d |
| Lineage | `history` / `concat_history` on the clip, plus a clip-parent path (covers, extends, infill) | rs-suno model.rs |
| WAV | `POST /api/gen/{id}/convert_wav/`, then poll `GET /api/gen/{id}/wav_file/` (404 = still rendering) | rs-suno, suno-archiver |
| Stems (read-only, no credits) | `GET /api/clip/{id}/stems/pages`, then `/api/clip/{id}/stems?page=N`, only when `has_stem` is true | rs-suno docs |
| Timed lyrics | `GET /api/gen/{id}/aligned_lyrics/v2/` (word-level, LRC) | suno-cli |
| Billing | billing info path (plan, WAV entitlement) | rs-suno |
| Generation status | Wait for `status == "complete"`. `streaming` means it's still generating, and the URL then is a temporary stream | gcui-art issue #105, suno-cli |
| MP3 URL (before Aug 29) | prefer `media_urls[content_type=mp3]`, then `audio_url`, then `cdn1.suno.ai/{id}.mp3`. Rewrite expiring `audiopipe.suno.ai` links to cdn1. **Since Aug 29 this needs the signed link** | rs-suno model.rs |

## Projects (last push checked with the GitHub API today; all links resolved)
| Project | Lang | Last push (UTC) | License | Notes |
|---|---|---|---|---|
| [teh-hippo/rs-suno](https://github.com/teh-hippo/rs-suno) / crate suno-core | Rust | 2026-10-24 | MIT | Best reference: rclone-style library mirror (MP3/FLAC/WAV, stems, lineage, lyrics, adaptive 429 backoff, never deletes on a partial listing) |
| [closestfriend/suno-archiver](https://github.com/closestfriend/suno-archiver) | Python (pip) | 2026-10-03 | MIT | Personal backup: metadata JSON, WAV, all workspaces, re-mints JWT and retries once on 401, per-file errors never abort the run, `doctor` command |
| [paperfoot/suno-cli](https://github.com/paperfoot/suno-cli) | Rust | 2026-09-28 | MIT | API_INTELLIGENCE.md is the best endpoint write-up; also checks for captcha first (`/api/c/check`) |
| [hartmark/SunoHarvester](https://github.com/hartmark/SunoHarvester) | Python + Playwright | 2026-05-02 | MIT | Drives the real browser UI to download MP3 and WAV, so it survives API auth changes |
| [brice1988/Suno-Harvester](https://github.com/brice1988/Suno-Harvester) | Python + Playwright CDP | ? | ? | Attaches to logged-in Chrome and captures the feed traffic |
| [gcui-art/suno-api](https://github.com/gcui-art/suno-api) | TS | 2026-03-06 | LGPL-3.0 | Well known, but aimed at generation and stale since March. LGPL |
| [SunoAI-API/Suno-API](https://github.com/SunoAI-API/Suno-API) | Python | 2025-04-26 | MIT | Stale |
| [AliensDontCare/SWAVD](https://github.com/AliensDontCare/SWAVD) | ? | release 1.44, Aug 2026 | ? | Fixed for the Aug 29 change |

Paid third-party "Suno API" resellers (suno-api.io, OmnAPI) are for generation only and proxy through someone else's accounts. **Don't use them** for Thomas's library.

## Ranked things to try
**Problem 2 (403 MP3s) and Problem 1 (placeholder audio). These are probably the same root cause.**
1. Log the exact 403 body. If it says `MissingKey / Key-Pair-Id`, it's the Aug 29 signed-URL change. Then capture, from the browser DevTools Network tab (Thomas's own session, by hand), which request the suno.com **Download → MP3** button makes. Have the harvester call that endpoint for a signed URL and download right away (signed links expire). Check SWAVD 1.44's source for the endpoint name.
2. Treat `audio_url` containing `/api/forbidden`, any `audiopipe.suno.ai` URL, or `status != complete` as "not downloadable yet", **not** as a song. Re-queue it instead of rejecting it as a stub.
3. Fallback: use WAV for those clips (`convert_wav`, then poll `wav_file`). That path still works if the plan includes WAV, and it gives us lossless as a bonus.
4. For the 17 nessihenize songs: check whether that account's plan or JWT is the one in use. A separate Clerk session is needed per account. Also check whether they're trashed or private.
5. Last resort: a Playwright download through the real UI (the SunoHarvester approach).

**Problem 3 (enrichment crash)**
1. Make the script tolerant like rs-suno and suno-archiver: per-clip try/except, missing fields default to empty, never crash the run.
2. Mint a JWT from the `__client` cookie before every batch and retry once on a 401 (JWTs last about an hour, so nightly runs outlive them).
3. Back off on 429 using `Retry-After`. Batch `get_songs_by_ids` in pairs only.
4. Update to `studio-api-prod.suno.com` and `feed/v3`. Older `/api/feed` paths may now return different data.

**Problem 4 (full metadata and bulk export)**
1. List the library from `/api/project/me` plus each workspace, **not** just default, cross-checked with `feed/v3`.
2. Lineage from `history`/`concat_history` (extends, covers, infill). Persona comes from clip metadata.
3. Stems: read-only stems pages, only when `has_stem`. Timed lyrics: `aligned_lyrics/v2`.
4. Consider running rs-suno `suno check --dry-run`, or the suno-archiver `doctor` command, as an independent cross-check of our Vault's completeness. Both are MIT licensed and only read.

## ToS / risk
- All of these endpoints are undocumented. Suno's ToS forbids scraping and automated access. The risk is low when limited to our own account's library at nightly cadence, but the account could still be suspended.
- Never automate generation and never solve captchas. Captcha checks only matter for generation.
- Prefer MIT code to copy from (rs-suno, suno-archiver, suno-cli). gcui-art is LGPL.
