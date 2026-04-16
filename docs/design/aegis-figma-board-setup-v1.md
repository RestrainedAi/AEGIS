# AEGIS Figma Board Setup v1

## Purpose

This document translates the AEGIS page map and UX requirements into a board-ready structure for Figma, FigJam, or an equivalent design workspace.

It is intended to help the team start visual design work in a structured way without losing alignment to:

1. the future-state AEGIS product model
2. the current engineering constraints
3. the phased rollout order already established in the repo docs

This is the working setup for the first complete design board, not the final visual design system.

Related source docs:

1. `docs/design/aegis-design-board-page-map-v1.md`
2. `docs/design/aegis-ui-ux-strategy-memo.md`
3. `docs/design/aegis-ux-requirements-spec-v1.md`
4. `docs/design/aegis-wireframe-brief-v1.md`
5. `docs/design/aegis-design-engineering-alignment.md`
6. `docs/codex/AEGIS-008_SUNO_PUBLIC_PROFILE_CONSTRAINT_NOTE.md`

## Board Goal

The first board should let the team do four things in one place:

1. see the entire product surface area at a glance
2. understand how the pages connect to each other
3. start designing the highest-priority screens in the right order
4. keep engineering, product, and design aligned on what is future-state versus currently implemented

## Recommended Board Format

Use one master board with eight horizontal sections from left to right:

1. `00 Context`
2. `01 Product Shell`
3. `02 Screen Inventory`
4. `03 User Flows`
5. `04 Low-Fidelity Wireframes`
6. `05 Components and States`
7. `06 High-Fidelity Concepts`
8. `07 Handoff and Open Questions`

If using Figma:

1. Use one page called `AEGIS Design Board v1`
2. Inside that page, create large labeled regions for the eight sections
3. Keep wireframes and high-fidelity work in the same file, but separate them spatially

If using FigJam:

1. Use the board for strategy, flow mapping, and page cards
2. Link each page card to its matching Figma frame once visual design starts

## Section 00: Context

Purpose: anchor the whole board in product truth and known constraints.

Include:

1. Product summary card
2. Object model card
3. Primary navigation card
4. Implementation reality card
5. Constraint card for SUNO harvesting

### Context cards to place

`Product Summary`

1. AEGIS is a media operations console with a catalog layer
2. It supports source monitoring, ingest tracking, asset preservation, and catalog review
3. It is not a consumer music app

`Object Model`

1. Source
2. Run
3. Item
4. Issue
5. Artifact

`Implementation Reality`

1. Catalog is currently export-backed
2. Issues are computed in phase 1
3. Source and run authority is still mixed in parts of the backend
4. Publish is live, but queue cleanup and upload triage still operate as a lightweight contextual ops surface

`Suno Constraint`

1. SUNO harvesting is public-profile only
2. Discovery is best-effort, not guaranteed
3. UI must expose freshness and source-health clearly

## Section 01: Product Shell

Purpose: define the global frame every screen lives inside.

Create one shell frame named:

`Shell / Desktop / Base`

Inside it, establish:

1. left navigation rail
2. top utility bar
3. page title zone
4. page actions zone
5. content canvas
6. global freshness indicator
7. global search slot
8. global alert/banner slot

### Primary nav items

1. Dashboard
2. Sources
3. Runs
4. Catalog
5. Issues

### Utility bar items

1. Search
2. Last catalog update
3. Notifications or recent failures
4. User menu

### Shell variants to show on board

1. `Shell / Ops Mode`
2. `Shell / Catalog Mode`
3. `Shell / Tablet`

Ops mode should feel denser and more scan-driven.

Catalog mode should feel more media-forward and slightly lighter.

## Section 02: Screen Inventory

Purpose: show every page and what it contains before drawing detailed layouts.

Create one card for each screen using the same card template:

1. screen name
2. page type
3. primary user
4. page goal
5. primary modules
6. key actions
7. linked destinations
8. delivery phase
9. implementation note

### Core screen cards

1. `Dashboard`
2. `Sources List`
3. `Source Detail`
4. `Runs List`
5. `Run Detail`
6. `Catalog Browser`
7. `Item Detail`
8. `Issues View`

### Later screen cards

1. `Global Search`
2. `Add Source`
3. `Admin`
4. `Export Management`
5. `Publishing Controls`

### Recommended visual grouping

Group the cards into three clusters:

1. `Operations`
2. `Catalog`
3. `Admin and Future`

## Section 03: User Flows

Purpose: show how people move across the system.

Use flow lanes instead of page stacks. Each lane should map one job-to-be-done from left to right.

### Flow 1: Daily Ops Check

1. Dashboard
2. Runs List
3. Run Detail
4. Issues View
5. Source Detail

### Flow 2: Source Investigation

1. Sources List
2. Source Detail
3. Run History tab
4. Run Detail
5. Items tab
6. Item Detail

### Flow 3: Catalog Review

1. Dashboard or Catalog
2. Catalog Browser
3. Filter state
4. Item Detail
5. Source and Lineage tab
6. Run Detail

### Flow 4: Freshness and Export Triage

1. Dashboard freshness card
2. Issues View
3. Run Detail
4. Catalog Browser with visible last-updated state

### Flow 5: Later Publishing Flow

1. Catalog Browser selection state
2. Item Detail
3. Queue or publish review
4. Admin or uploader-linked surface later

### Flow 6: Queue Cleanup and Publish Triage

1. Catalog Browser
2. Inspect Queue
3. Filter to `Errors`, `Contradictory`, or `Active`
4. Retry or mark-done action
5. Return to Catalog Browser to confirm visible item state

### Flow annotation tags

Add small tags to each flow step:

1. `Now`
2. `Bridge`
3. `Later`
4. `Computed`
5. `Gated`

## Section 04: Low-Fidelity Wireframes

Purpose: start page layout design without getting blocked by style decisions.

Create one low-fidelity frame per priority screen.

### Recommended first wireframe set

1. `Dashboard / Lo-Fi / Desktop`
2. `Runs List / Lo-Fi / Desktop`
3. `Run Detail / Lo-Fi / Desktop`
4. `Catalog Browser / Lo-Fi / Desktop`
5. `Queue Inspector / Lo-Fi / Desktop`
6. `Item Detail / Lo-Fi / Desktop`
7. `Sources List / Lo-Fi / Desktop`
8. `Source Detail / Lo-Fi / Desktop`
9. `Issues View / Lo-Fi / Desktop`

### Frame contents

Each frame should include:

1. page title
2. section labels
3. module placeholders
4. table/card density guidance
5. major button placement
6. empty-state placeholder
7. loading-state placeholder
8. warning or degraded-state placeholder if relevant

### Page-specific notes

`Dashboard`

1. hero metric strip
2. recent runs block
3. issues block
4. stale sources block
5. latest additions block
6. freshness/export block

`Runs List`

1. dense table first
2. filter row
3. saved views row
4. running/failure banner

`Catalog Browser`

1. search
2. filter area
3. grid/table toggle
4. result cards
5. mini player
6. visible last-updated marker

## Section 05: Components and States

Purpose: establish the reusable building blocks before high-fidelity design spreads too far.

Create a component zone with families, not isolated one-off controls.

### Component families

1. Navigation
2. Metrics
3. Tables and rows
4. Cards
5. Filters and chips
6. Status badges
7. Banners and alerts
8. Media player elements
9. Tabs
10. Drawers and side panels
11. Detail metadata blocks
12. Action buttons

### Must-design status states

`Source Status`

1. Healthy
2. Warning
3. Stale
4. Failed
5. Disabled

`Run Status`

1. Queued
2. Running
3. Ready
4. Partial
5. Failed

`Item Status`

1. Active
2. Incomplete
3. Missing Media
4. Transcript Missing
5. Removed
6. Processing

### Must-design system states

1. Loading
2. Empty
3. Empty filtered
4. Warning
5. Error
6. Degraded data
7. Gated action

### Buttons to explicitly design

1. Primary action button
2. Secondary action button
3. Quiet utility button
4. Filter chip button
5. Play button
6. View detail button
7. Retry or rerun button later
8. Add source button later
9. Publish button gated

## Section 06: High-Fidelity Concepts

Purpose: explore the visual direction after structure is solid.

Do not start with all screens. Start with one operations-heavy screen and one media-heavy screen.

### First high-fidelity targets

1. `Dashboard / Hi-Fi / Desktop`
2. `Catalog Browser / Hi-Fi / Desktop`
3. `Run Detail / Hi-Fi / Desktop` next
4. `Item Detail / Hi-Fi / Desktop` next

### Visual direction targets

1. Calm and trustworthy
2. Precise and structured
3. Media-aware without looking like a consumer streaming app
4. Dense where operations require scanning
5. Richer and more spacious where media review matters

### Visual principles to keep on board

1. Freshness must always be visible
2. Status should use shape, hierarchy, and labeling, not color alone
3. Catalog should feel usable and polished
4. Ops views should prioritize clarity over decoration
5. Buttons should read as deliberate system controls, not generic SaaS defaults

## Section 07: Handoff and Open Questions

Purpose: keep the board implementable and aligned with engineering.

Split this area into two columns:

1. `Handoff Notes`
2. `Open Questions`

### Handoff notes should track

1. page name
2. API/data dependency
3. computed versus authoritative data
4. known engineering caveat
5. phase target

### Open questions should track

1. which controls are read-only in phase 1
2. what source health can be computed accurately now
3. how issue rollups should be derived
4. how publish state should appear before uploader normalization
5. what global search should include in phase 1 versus later

## Suggested Frame Naming Convention

Use a consistent naming pattern:

`[Surface] / [Fidelity] / [Viewport] / [Variant]`

Examples:

1. `Dashboard / Lo-Fi / Desktop / Healthy`
2. `Dashboard / Lo-Fi / Desktop / Incident`
3. `Runs List / Lo-Fi / Desktop / Failed Filter`
4. `Catalog Browser / Hi-Fi / Desktop / Grid`
5. `Item Detail / Hi-Fi / Desktop / Missing Transcript`

## Recommended Build Order

### Pass 1: Architecture

1. Context cards
2. Product shell
3. Screen inventory cards
4. Flow map

### Pass 2: Structural UX

1. Dashboard
2. Runs List
3. Run Detail
4. Catalog Browser
5. Item Detail
6. Sources List
7. Source Detail
8. Issues View

### Pass 3: Component System

1. status badges
2. metric cards
3. filter controls
4. tables and rows
5. catalog cards
6. media controls
7. banners
8. buttons

### Pass 4: High-Fidelity Design

1. Dashboard
2. Catalog Browser
3. Run Detail
4. Item Detail

### Pass 5: Responsive and Edge Cases

1. tablet shell
2. list-to-stack behavior
3. empty states
4. degraded and stale states
5. gated action states

## Practical Starting Checklist

Before drawing polished screens, the board should show:

1. the AEGIS object model
2. the shell and navigation
3. all core screen cards
4. at least four mapped user flows
5. low-fidelity frames for the first eight screens
6. component family area
7. status/state matrix
8. open questions panel

Once those exist, the team can start producing visual designs of pages, buttons, assets, and interaction patterns without drifting away from the product model.
