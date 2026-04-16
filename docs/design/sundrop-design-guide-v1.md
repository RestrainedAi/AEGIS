# Sundrop Design Guide v1

This guide consolidates the strongest parts of the four `IMPORTANT_` source docs into one working design reference for product, brand, and Figma decisions.

Note:
- this guide is now subordinate to [the-sundrop-codex-v1.md](C:/Users/blahn/OneDrive/Desktop/SUNO%20YouTube%20Pipeline/enviroment/AEGIS/docs/design/the-sundrop-codex-v1.md)
- use the Codex as the primary master reference when there is overlap

Primary source docs:
- [1_IMPORTANT_sundrop.music and sundrop.cloud Names and Pricing Tiers .docx](C:/Users/blahn/OneDrive/Desktop/SUNO%20YouTube%20Pipeline/enviroment/AEGIS/docs/design/1_IMPORTANT_sundrop.music%20and%20sundrop.cloud%20Names%20and%20Pricing%20Tiers%20.docx)
- [2_IMPORTANTsundrop music cloud Brand Identity.docx](C:/Users/blahn/OneDrive/Desktop/SUNO%20YouTube%20Pipeline/enviroment/AEGIS/docs/design/2_IMPORTANTsundrop%20music%20cloud%20Brand%20Identity.docx)

Supporting source docs:
- [3_IMPORTANT_Executive Development Plan and Architectural Blueprint for Google Cloud SaaS Platform.docx](C:/Users/blahn/OneDrive/Desktop/SUNO%20YouTube%20Pipeline/enviroment/AEGIS/docs/design/3_IMPORTANT_Executive%20Development%20Plan%20and%20Architectural%20Blueprint%20for%20Google%20Cloud%20SaaS%20Platform.docx)
- [4_IMPORTANT_The Visual Design System (The _Aeonimus_ Theme).docx](C:/Users/blahn/OneDrive/Desktop/SUNO%20YouTube%20Pipeline/enviroment/AEGIS/docs/design/4_IMPORTANT_The%20Visual%20Design%20System%20%28The%20_Aeonimus_%20Theme%29.docx)

## Core Product Architecture

The product should be presented as one cohesive ecosystem with multiple surfaces, not as unrelated tools.

Top-level brand:
- `sundrop`

Primary public surfaces:
- `sundrop.music`
- `sundrop.cloud`

Current functional lanes:
- `sundrop.music`
  - SUNO catalog harvesting
  - media capture and storage
  - source freshness and ingestion operations
- `sundrop.cloud`
  - Vault operations
  - queueing and publishing to YouTube
  - operator diagnostics and repair workflows
- `YouTube Playlist Harvest`
  - separate intake stream that still needs to be folded back into the unified product model

## Brand Architecture

The brand should feel like a professional creator platform, not a generic utility and not a soda-adjacent joke.

Brand principles:
- lowercase `sundrop` is the strongest brand form
- the system should feel modern, creator-native, and infrastructure-capable
- the naming should support both emotional appeal and operational clarity

Recommended split:
- `sundrop.music`
  - public-facing, artist-facing, music-facing surface
  - stronger for identity, SEO, and launch storytelling
- `sundrop.cloud`
  - operational, system, vault, and infrastructure-facing surface
  - stronger for storage, reliability, and pipeline positioning

Best-use interpretation:
- `sundrop.music` is the brand-forward face
- `sundrop.cloud` is the app and operations engine

That does not mean the products are unrelated. It means they are two doors into the same system.

## Product Positioning

The clearest value proposition is:
- capture
- preserve
- organize
- publish

Expanded flow:
1. ingest from SUNO and other sources
2. preserve rich media and metadata in the vault
3. review and manage assets
4. route selected assets into YouTube publishing
5. expand later into additional creator workflows

Strong product framing:
- vault for creator output
- operational control over music assets
- automated path from creation to distribution

## Tone and Personality

The product voice should feel:
- intelligent
- cinematic
- sharp
- slightly dramatic
- trustworthy under load

It should not feel:
- bubbly
- playful-default SaaS
- pastel startup
- template-driven

The user should feel like they are inside a command center for media operations.

## Visual System

The strongest visual direction from the source docs is a hybrid of:
- creator-platform energy
- dark enterprise control surfaces
- cinematic contrast

Working style name:
- `Cinematic Enterprise`

Core visual rules:
- dark mode first
- dense but readable information layouts
- bold accent use with discipline
- premium texture over flat generic UI
- modular tiles and panels over long undifferentiated pages

## Color Direction

Recommended palette basis:
- background: Obsidian / near-black
- surfaces: Tungsten / dark graphite panels
- primary CTA accent: Liquid Brass
- utility accents:
  - cyan for active sync and live operational signal
  - crimson for failure and urgent issues
  - magenta or purple accents only where they support the creative/music side, not as the default everywhere

Interpretation for Sundrop:
- `sundrop.music`
  - can lean slightly more expressive and music-forward
  - brass, magenta, deep violet, controlled glow
- `sundrop.cloud`
  - can lean slightly more operational and cool-toned
  - brass for CTAs, cyan and blue for system state, crimson for faults

## Typography

Recommended pairing:
- sans serif for UI/data:
  - `Inter` or `Geist`
- serif for select headers or cinematic emphasis:
  - `Playfair Display`

Usage rule:
- most interface text should remain clean sans serif
- serif should be used sparingly for high-level branding moments, screen titles, or hero-level headings

## Layout System

Preferred structural patterns:
- bento-style dashboards
- strong modular cards
- top command bar instead of oversized headers
- left navigation or compact system nav when needed
- data grids and operator views designed for fast scanning

Information architecture priorities:
- health and freshness first
- queue and issue visibility first-class
- actions close to the data they affect
- repair paths explicit, not hidden

## Screen Families

Current screen families to design around:

`sundrop.music`
- Index
- Main Controls
- Sources
- Source Detail
- Runs
- Run Detail
- Issues
- Item Detail

`sundrop.cloud`
- Index
- Main Controls
- Vault Catalog
- Item Detail
- Queue Inspector
- Publish Review
- Diagnostics
- Repair Flows

Cross-cutting:
- Shared Patterns
- Asset Intake
- Archive

## Interaction Model

The system should make state and consequence very clear.

Important interaction principles:
- statuses must be explicit and visible
- selection scope and global scope must never be mixed ambiguously
- retries should be intentional
- edge cases should surface as named states with recovery guidance
- admin/operator actions should feel safe and deliberate

## Edge-Case Design Requirement

The interface should treat edge cases as first-class operational states, not random bugs.

Examples:
- media repair needed
- zero-byte media
- stale source
- contradictory queue row
- export stale
- uploader error

Design implication:
- each recurring edge case should have:
  - a distinct label
  - a clear severity
  - an owner or lane
  - a next action

## Domain and Navigation Guidance

Use the two domains to clarify mental models:

`sundrop.music`
- ingestion
- source control
- harvest operations
- media preservation

`sundrop.cloud`
- vault
- queue
- YouTube operations
- diagnostics

If the `YouTube Playlist Harvest` stream comes back into active product scope, it should be slotted intentionally rather than quietly bolted on.

Likely options:
- inside `sundrop.cloud` as a new intake lane
- or as a third explicit product surface if it grows large enough

## Practical Figma Guidance

When designing in Figma:
- use `00 Overview` for file rules and orientation
- use `01 Board and IA` for planning and flow thinking
- build actual screens on:
  - `02 sundrop.music`
  - `03 sundrop.cloud`
- use `04 Shared Patterns` for reusable shells and state treatments
- use `05 Asset Intake (Manual)` as staging for manually imported assets

## Current Design Decision Summary

Lock these in for now:
- brand root: `sundrop`
- public/app surfaces:
  - `sundrop.music`
  - `sundrop.cloud`
- visual direction:
  - dark, premium, cinematic enterprise
- layout direction:
  - modular command-center surfaces
- product split:
  - harvest side vs vault/publish side
- open architectural question:
  - where `YouTube Playlist Harvest` fits in the long-term product map

## Next Recommended Use

Use this document as the source for:
- Figma screen expansion
- landing-page language
- page naming
- visual consistency decisions
- screen-family planning

Then let lower-level docs inherit from it rather than re-deciding the same identity and structure each time.
