# The sundrop Codex v1

Purpose:
- keep business decisions, product structure, design direction, and open conflicts in one place
- give everyone one coherent mental model of how the system works
- let business logic drive design while design also pushes back on business decisions where needed
- reduce fragmentation across many partially overlapping notes

Working identity:
- `The sundrop Codex` is the master guide
- it functions as the project's `North Star`
- it also acts as the `Compass` that keeps work aligned and moving in the right direction

Primary source materials folded into this guide:
- [1_IMPORTANT_sundrop.music and sundrop.cloud Names and Pricing Tiers .docx](C:/Users/blahn/OneDrive/Desktop/SUNO%20YouTube%20Pipeline/enviroment/AEGIS/docs/design/1_IMPORTANT_sundrop.music%20and%20sundrop.cloud%20Names%20and%20Pricing%20Tiers%20.docx)
- [2_IMPORTANTsundrop music cloud Brand Identity.docx](C:/Users/blahn/OneDrive/Desktop/SUNO%20YouTube%20Pipeline/enviroment/AEGIS/docs/design/2_IMPORTANTsundrop%20music%20cloud%20Brand%20Identity.docx)
- [3_IMPORTANT_Executive Development Plan and Architectural Blueprint for Google Cloud SaaS Platform.docx](C:/Users/blahn/OneDrive/Desktop/SUNO%20YouTube%20Pipeline/enviroment/AEGIS/docs/design/3_IMPORTANT_Executive%20Development%20Plan%20and%20Architectural%20Blueprint%20for%20Google%20Cloud%20SaaS%20Platform.docx)
- [4_IMPORTANT_The Visual Design System (The _Aeonimus_ Theme).docx](C:/Users/blahn/OneDrive/Desktop/SUNO%20YouTube%20Pipeline/enviroment/AEGIS/docs/design/4_IMPORTANT_The%20Visual%20Design%20System%20%28The%20_Aeonimus_%20Theme%29.docx)

Related working docs:
- [sundrop-design-guide-v1.md](C:/Users/blahn/OneDrive/Desktop/SUNO%20YouTube%20Pipeline/enviroment/AEGIS/docs/design/sundrop-design-guide-v1.md)
- [sundrop-design-conflicts-register-v1.md](C:/Users/blahn/OneDrive/Desktop/SUNO%20YouTube%20Pipeline/enviroment/AEGIS/docs/design/sundrop-design-conflicts-register-v1.md)

## 1. Big Picture

`sundrop` is one integrated creator operations platform.

It is not just:
- a SUNO downloader
- a cloud vault
- a YouTube uploader
- a playlist ingester

It is the system that connects those workflows into one durable pipeline.

Core promise:
1. capture creator output and source media
2. preserve it safely with metadata
3. organize it into a usable catalog
4. route selected items into downstream publishing
5. expand into additional creator-media workflows over time

This means business logic and design logic cannot be separated cleanly. The way the business works changes what must be visible, controllable, and trustworthy in the interface. The interface also reveals missing business rules and weak architectural boundaries.

## 2. Brand and Surface Model

Parent brand:
- `sundrop`

Primary product surfaces:
- `sundrop.music`
- `sundrop.cloud`

Current interpretation:
- `sundrop.music`
  - music-facing
  - harvest-facing
  - source and catalog operations
  - creator-storytelling friendly
- `sundrop.cloud`
  - vault-facing
  - publishing-facing
  - queue, diagnostics, and reliability work
  - infrastructure and operations friendly

This does not make them separate products. It makes them two coordinated surfaces inside one system.

## 3. Product Lanes

Right now the real system has at least three meaningful lanes:

### A. SUNO Harvest

Purpose:
- acquire catalog data from SUNO
- detect deltas
- capture media
- write structured item truth
- keep the vault fresh

Primary surface:
- `sundrop.music`

### B. Vault to YouTube

Purpose:
- present the preserved catalog
- allow selection and queueing
- manage publish readiness
- run YouTube upload operations
- report status, errors, and recovery actions

Primary surface:
- `sundrop.cloud`

### C. YouTube Playlist Harvest

Purpose:
- pull playlist-based content and metadata from YouTube
- support transcript and metadata enrichment workflows
- extend the intake side beyond SUNO-only sources

Current state:
- real but not fully reintegrated into the unified product model yet

Open question:
- should this remain a separate intake lane under `sundrop.cloud`
- or should it evolve into a third explicit product surface later

## 4. Business Logic That Drives Design

These rules are not just backend concerns. They must be visible in the product.

### Source of truth matters

The system depends on authoritative data objects and explicit ownership:
- harvest/item truth
- queue truth
- export freshness truth
- mirrored publish outcome fields

Design implication:
- interfaces must show what is authoritative vs mirrored
- users need to understand whether they are seeing source data, queue data, or published outcome data

### Freshness matters

The vault is only trustworthy if freshness is clear.

Design implication:
- freshness indicators are first-class
- stale states must be visible
- export or source recency should not be hidden behind admin inspection

### Queue state matters

Selection scope and queue scope must not be mixed carelessly.

Design implication:
- user actions and system totals must be visually distinct
- “you selected 8” is not the same as “global queue has 42 done and 2 errors”

### Edge cases matter

The system will continuously surface edge conditions:
- zero-byte media
- contradictory queue rows
- stale source
- failed rebuild
- partial harvest
- uploader errors

Design implication:
- edge cases need named states
- they need visible severity
- they need operator next actions

### Cost matters

Harvest runs cost real money and limited resources matter.

Design implication:
- read-only audits are valuable
- targeted runs are important
- “run everything” should not be the default operator behavior

## 5. Design Direction

Working visual language:
- `Cinematic Enterprise`

What that means:
- dark mode first
- premium control-room feel
- high signal density
- rich contrast
- disciplined accent color
- creator energy without generic neon chaos

The interface should feel like:
- a media intelligence terminal
- a creator operations console
- a high-trust system for valuable digital assets

It should not feel like:
- a throwaway SaaS template
- pastel startup software
- a generic dashboard kit

## 6. Visual System

### Color

Core base:
- Obsidian / near-black background
- dark graphite or tungsten surfaces
- brass for high-value primary actions
- cyan or blue for active/live system signal
- crimson for failure or urgent intervention

Product nuance:
- `sundrop.music`
  - slightly warmer and more expressive
  - more room for music/creator energy
- `sundrop.cloud`
  - slightly cooler and more operational
  - more room for diagnostics and system status

### Typography

Default:
- `Inter` or `Geist` for interface and data

Accent:
- `Playfair Display` sparingly for identity moments, hero moments, or section emphasis

### Layout

Preferred structures:
- bento-style modular dashboards
- command-center bars instead of oversized headers
- strong card grouping
- clear action zones near relevant data
- operator-oriented control surfaces

## 7. Screen Model

### sundrop.music

Core screens:
- Index
- Main Controls
- Sources
- Source Detail
- Runs
- Run Detail
- Issues
- Item Detail

What these screens need to communicate:
- source health
- freshness
- run outcomes
- media quality
- catalog growth
- issue and repair paths

### sundrop.cloud

Core screens:
- Index
- Main Controls
- Vault Catalog
- Item Detail
- Queue Inspector
- Publish Review
- Diagnostics
- Repair Flows

What these screens need to communicate:
- publish readiness
- queue health
- upload outcomes
- contradictions and failures
- repair-needed items
- operator actions

### Shared surfaces

Cross-cutting spaces:
- shared patterns
- planning and IA
- manual asset intake
- archive

## 8. Figma Working Model

Current file organization:
- `00 Overview`
- `01 Board and IA`
- `02 sundrop.music`
- `03 sundrop.cloud`
- `04 Shared Patterns`
- `05 Asset Intake (Manual)`
- `99 Archive`

Usage rules:
- real screens belong on product pages
- planning belongs in `01 Board and IA`
- reusable UI thinking belongs in `04 Shared Patterns`
- manually imported screenshots and assets belong in `05 Asset Intake (Manual)` first
- replaced ideas move to archive instead of disappearing

## 9. Current Business-to-Design Priorities

What should drive design first:

1. trustworthy operational visibility
2. queue and freshness honesty
3. issue and repair flows
4. source and publish controls
5. expressive brand polish after the control surfaces are solid

That means:
- core operator screens first
- pretty marketing expression second

## 10. Open Conflicts

We will keep conflicts inside this unified guide instead of pretending they do not exist.

### Conflict: two surfaces vs three

Most likely current direction:
- keep `sundrop.music` and `sundrop.cloud` as the two main surfaces

Competing direction:
- elevate `YouTube Playlist Harvest` into a third explicit surface

Current working answer:
- keep building around two surfaces
- leave room for playlist harvesting to become more explicit later

### Conflict: functional names vs branded module names

Most likely current direction:
- use functional names in product UI:
  - Harvest
  - Vault
  - Queue
  - Publish

Competing direction:
- use branded subnames:
  - SunVault
  - SunPublish

Current working answer:
- keep the product language functional for now
- reserve branded subnames for marketing if they still feel valuable later

### Conflict: enterprise restraint vs creator energy

Most likely current direction:
- dark, premium, operator-trust-first visual language

Competing direction:
- stronger neon, louder creator expression, more launch-energy aesthetics

Current working answer:
- base system stays restrained
- expressive energy appears selectively on music-facing surfaces

## 11. Design Decision Method

When business and design disagree:
1. pick the most likely current answer
2. document the alternate
3. keep moving
4. revisit intentionally

We should not stop building because the final truth is not known yet.

## 12. What This Guide Is For

Use this as the current master reference for:
- Figma screen planning
- IA decisions
- product naming and framing
- business logic visibility in the UI
- architectural conversations that affect surface design
- future design-system work

Lower-level docs should inherit from this guide instead of re-deciding the same fundamentals over and over.

## 13. Next Evolution

As the product matures, this doc can grow into:
- a true product design guide
- a source-of-truth reference for business logic visibility
- a bridge between Jira, architecture, and Figma

For now, the key is simple:
- one doc
- one flow
- one mental picture
- clear room for unresolved questions without losing momentum
