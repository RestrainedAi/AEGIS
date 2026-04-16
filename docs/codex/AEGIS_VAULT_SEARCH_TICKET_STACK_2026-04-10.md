# AEGIS Vault Search Ticket Stack

## Summary

Open a dedicated Vault search and retrieval lane instead of leaving search scattered inside general UX work.

Recommended epic:
- `EPIC-20`
- Title: `Improve Vault retrieval and search`
- Status: `Ready`
- Priority: `P1`
- Size: `L`
- Owner: `Product + Web App`
- Stream: `Vault UX`

This epic should own the retrieval side of the Vault:
- better search matching
- structured narrowing
- saved retrieval views
- search-to-action workflows

It should stay separate from:
- monetization and entitlement work
- domain migration work
- regression prevention work

## Why This Needs Its Own Epic

The Vault has become a real working surface, but retrieval is still underpowered:
- search is useful but shallow
- filters are limited
- result context is easy to lose
- there is no saved-view concept for repeat workflows

That makes discovery slower than it should be, especially as the catalog grows and more accounts re-enter the Vault.

This is not just polish. Search is operational product value.

## Epic Definition

### Epic summary
Make Vault search strong enough to support discovery, narrowing, review, and publish-adjacent workflows without requiring users to know the underlying catalog schema.

### Epic notes
The search system should support three layers:
1. quick find
2. structured narrowing
3. operator retrieval workflows

The goal is to turn Vault search from a single text box into a true retrieval surface.

## Ticket Stack

### `AEGIS-SEARCH-001`
Expand core Vault search across title, handle, tags, styles, and lyrics.

Scope:
- search title
- search account handle
- search tags
- search display tags
- search styles / styleText
- search lyrics text
- improve placeholder copy and empty-state guidance
- keep visible result counts

Acceptance:
- one search box can find songs by title, handle, tags, styles, and lyrics
- result count updates correctly
- empty states explain what to try next

### `AEGIS-SEARCH-002`
Add structured Vault filters and active-filter chips.

Scope:
- account/source filter
- publish state
- removed from Suno
- lyrics availability
- lyrics artifact availability
- style/tag narrowing
- visible active-filter chips
- one-click clear behavior

Acceptance:
- filters work without clearing the search term
- active filters are visible and removable
- large result sets can be narrowed deliberately

### `AEGIS-SEARCH-003`
Add saved views for common Vault and operator retrieval workflows.

Scope:
- recent additions
- removed from Suno
- has lyrics
- publish-ready
- metadata incomplete
- other repeat operator slices later

Acceptance:
- common retrieval workflows can be reopened without rebuilding filters each time

### `AEGIS-SEARCH-004`
Improve Vault search relevance and match visibility.

Scope:
- stronger ranking
- exact title and exact handle boost
- field-aware relevance
- matched-field visibility where practical

Acceptance:
- users can understand why a result appeared
- exact matches and likely matches surface earlier

### `AEGIS-SEARCH-005`
Support search-to-action workflows in the Vault.

Scope:
- preserve search context across selection
- preserve search context across queue/publish review
- support filtered action sets

Acceptance:
- search remains stable while users act on filtered result groups

## Recommended Order

Start with:
1. `AEGIS-SEARCH-001`
2. `AEGIS-SEARCH-002`

Then follow with:
3. `AEGIS-SEARCH-003`
4. `AEGIS-SEARCH-004`
5. `AEGIS-SEARCH-005`

## Relationship To Current Work

This epic complements, but does not replace:
- `EPIC-16` monetization / entitlements
- `EPIC-17` Control Center / admin work
- `EPIC-18` regression prevention
- `EPIC-19` Sundrop naming and domain migration

It is a dedicated Vault usability and retrieval lane.
