# AEGIS Vault Stability Toolbox And CSV Transition — 2026-04-14

## Product Call

Do not bog down beta by ripping out the CSV path immediately.

Instead:
- keep CSV during beta as a simple export/fallback mechanism
- use the fact that we now know its common failure modes
- add operator-friendly diagnostics and first-line repair actions
- plan the post-beta shift away from CSV-primary serving

This keeps troubleshooting simpler during beta while still treating the current architecture as transitional.

## Why CSV Still Works For Beta

CSV currently helps because it:
- keeps the serving contract simple
- gives us one artifact to inspect quickly
- makes fallback behavior easier to reason about
- reduces the number of moving live read paths while beta onboarding is still hardening

That simplicity has real operational value during beta.

## Why CSV Should Not Stay Primary Forever

CSV remains a recurring break point for:
- freshness drift
- fallback precedence mistakes
- contract-column regressions
- bulk snapshot serving when only partial deltas changed
- awkward security/access evolution

So the right posture is:
- **beta:** tolerate CSV-primary with stronger tooling
- **after beta is moving or complete:** transition Vault serving to API-backed truth and keep CSV as export/fallback

## Near-Term Stabilization Move

### Add a Vault diagnostic toolbox

Place it near or behind:
- `Inspect Queue`

This should be an operator/admin surface, not a public user feature.

### What the toolbox should run

At minimum:
1. current serving source
   - GCS or fallback
2. export freshness
   - generated timestamp
   - row count
   - newest song timestamp
3. contract health
   - required columns present/missing
4. media health sample
   - thumb/audio/lyrics artifact availability
5. queue/publish posture
   - whether publish-ready actions are safe

### Output style

It should give a short report, not a wall of logs.

Example shape:
- `Serving source: GCS`
- `Catalog age: 14h`
- `Newest song: 2026-04-12`
- `Required columns: OK`
- `Lyrics TXT availability: degraded`
- `Fallback snapshot: stale`

## First-Line Fix Buttons

Keep these small and explicit.

### Fix 1
- `Refresh export source`

Intent:
- re-check and pull the latest healthy export artifact

### Fix 2
- `Rebuild fallback snapshot`

Intent:
- refresh the baked/local fallback from the latest known-good catalog

### Fix 3
- `Re-publish latest catalog artifact`

Intent:
- push the newest rebuilt catalog + meta into the serving location again when the export exists but the serving artifact drifted

Optional later:
- `Run full catalog health sweep`
- `Repair missing lyric/media artifacts`

## Guardrails

These fix buttons should:
- be admin-only
- show what they are about to do
- record a timestamped result
- avoid destructive actions
- avoid mutating source-of-truth song data silently

## Post-Beta Transition

After beta:
- move live Vault reads to an authenticated typed API/read model
- keep CSV as export/cache/fallback only
- preserve the toolbox, because it will still be useful even after CSV is demoted

## Tickets Opened

- `AEGIS-027` — Plan post-beta Vault serving transition away from CSV-primary
- `AEGIS-028` — Add Vault diagnostic toolbox with operator-run checks and one-click common fixes
