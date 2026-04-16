# Sundrop Design Conflicts Register v1

Purpose:
- collect conflicting guidance from source docs in one place
- rank the most likely current direction first
- preserve alternatives without losing them
- make it easy to resolve conflicts over time instead of blocking design work

Related source:
- [the-sundrop-codex-v1.md](C:/Users/blahn/OneDrive/Desktop/SUNO%20YouTube%20Pipeline/enviroment/AEGIS/docs/design/the-sundrop-codex-v1.md)

## How To Use This

For each conflict:
- put the most likely current direction first
- keep the competing options directly below it
- mark status clearly
- resolve later when the team has enough context

Suggested status markers:
- `PRIMARY`
- `ALTERNATE`
- `OPEN`
- `RESOLVED`
- `PARKED`

Suggested visual markers for Figma:
- green dot = current likely direction
- amber dot = viable alternate
- red dot = direct conflict / blocked
- gray dot = parked for later

## Working Rule

Do not stop design progress for every unresolved conflict.

Instead:
1. choose the best current direction
2. document the competing options
3. build forward using the `PRIMARY` option
4. revisit the conflict deliberately later

## Conflict Register

### 1. Primary Product Framing

Status:
- `PRIMARY`: `sundrop.music` and `sundrop.cloud` are the two main product surfaces
- `ALTERNATE`: a third explicit product surface may be needed for `YouTube Playlist Harvest`

Why this conflict exists:
- some docs frame the system as a two-part product
- actual project history suggests playlist harvesting is a distinct functional lane

Current recommendation:
- keep the public and design model centered on two surfaces for now
- treat `YouTube Playlist Harvest` as an open architectural branch to be reintegrated intentionally

### 2. Domain Emphasis

Status:
- `PRIMARY`: `sundrop.music` is the artist-facing or brand-forward surface, `sundrop.cloud` is the operational engine
- `ALTERNATE`: `sundrop.cloud` could be the main product identity if the platform leans harder into vault and infrastructure value

Why this conflict exists:
- one set of naming guidance leans music and artist first
- another leans infrastructure, safety, and automation first

Current recommendation:
- keep both domains
- use `sundrop.music` for music-facing storytelling
- use `sundrop.cloud` for system and operations surfaces

### 3. Module Naming

Status:
- `PRIMARY`: use direct functional names in product UI
  - Harvest
  - Vault
  - Queue
  - Publish
- `ALTERNATE`: use branded internal names like `SunVault` and `SunPublish`

Why this conflict exists:
- brand docs explore branded sub-product naming
- operational docs and current app work rely on plain functional names

Current recommendation:
- use functional names in the working product
- reserve branded subnames for future marketing or launch language if they earn their place

### 4. Visual Style Intensity

Status:
- `PRIMARY`: dark cinematic enterprise with disciplined accent color
- `ALTERNATE`: more expressive neon and music-energy styling

Why this conflict exists:
- some guidance pushes dark premium enterprise
- some branding language invites stronger viral/creator energy

Current recommendation:
- use cinematic enterprise as the base system
- allow stronger expression on select music-facing surfaces instead of everywhere

### 5. Typography Personality

Status:
- `PRIMARY`: UI mostly sans serif, serif only for selective emphasis
- `ALTERNATE`: stronger serif presence for identity and atmosphere

Why this conflict exists:
- visual system guidance suggests a cinematic serif accent
- dense operational software works best with cleaner utilitarian typography

Current recommendation:
- keep the app mostly sans serif
- use serif in hero moments, section banners, or curated brand surfaces only

### 6. Design Surface Priority

Status:
- `PRIMARY`: build core operational screens first
  - indexes
  - controls
  - queue and diagnostics
- `ALTERNATE`: build marketing and brand-expression surfaces first

Why this conflict exists:
- design energy naturally drifts toward visible brand work
- project pressure right now is on real operational utility

Current recommendation:
- prioritize operational surfaces first
- let brand styling evolve through those surfaces instead of waiting for a separate polish phase

## Resolution Template

Use this block when adding a new conflict:

```md
### X. Conflict Name

Status:
- `PRIMARY`: ...
- `ALTERNATE`: ...

Why this conflict exists:
- ...

Current recommendation:
- ...

Resolution notes:
- ...
```

## Immediate Next Use

Use this register when:
- consolidating source docs
- shaping Figma pages
- deciding which wording or model wins for now
- flagging architectural uncertainty without stalling progress
