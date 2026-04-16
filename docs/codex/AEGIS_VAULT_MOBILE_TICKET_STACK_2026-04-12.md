# AEGIS Vault Mobile Ticket Stack — 2026-04-12

## Purpose

Create a real Jira home for the approved mobile Vault references instead of leaving them as screenshot-only direction.

The mobile Vault work should stay under the existing Vault UX lane and should use the same live routes where possible:

- `/vault`
- `/vault?view=catalog` or equivalent catalog view on the same Vault surface
- mobile publish flow attached to Vault actions

No separate mobile-only domain or duplicate app shell is required at this stage.

## Ticket Structure

### `AEGIS-MOBILE-001`
Implement mobile Vault browse layout on the main `/vault` route.

Owns:

- compact mobile Vault browse layout
- mobile header and account context
- dense relic rows instead of full desktop cards
- lower-page machine status block
- bottom navigation pattern where appropriate

### `AEGIS-MOBILE-002`
Add Sovereign Catalog mobile view with dense list controls.

Owns:

- mobile version of the condensed catalog/list mode
- metadata-first rows
- publish-relevant actions
- pagination support
- item-count selector with at least 50 items per page supported

### `AEGIS-MOBILE-003`
Implement mobile publish and release configuration flow.

Owns:

- selected-song summary
- title override
- destination playlist
- description template
- privacy level
- release-oriented mobile action layout

### `AEGIS-MOBILE-004`
Define shared mobile navigation and action patterns for Vault surfaces.

Owns:

- shared mobile shell decisions
- bottom nav consistency
- header/menu behavior
- browse/catalog/publish action placement
- clear operator-only vs creator-safe controls

## Notes

- These tickets are Vault-specific.
- Homepage mobile work stays in the homepage/design lane and should not be mixed into these tickets.
- Control Center mobile and Signup mobile can be added later as separate tickets once the Vault mobile language is stable.
