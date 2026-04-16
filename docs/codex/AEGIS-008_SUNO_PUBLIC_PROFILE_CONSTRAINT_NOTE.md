# AEGIS-008 SUNO Public Profile Constraint Note

## Summary

AEGIS should treat SUNO profile harvesting as a public-web integration constraint, not as a stable first-class platform API.

For product, design, and engineering purposes, the working assumption should be:

1. There is no supported official public API for listing a user's full SUNO profile catalog.
2. Only songs that are published publicly on a SUNO profile are discoverable through the current harvest model.
3. Profile-wide discovery is inherently dependent on public page parsing, embedded app payload extraction, or other unofficial behavior that may drift.

This makes SUNO harvesting a fragile external dependency rather than a guaranteed system-of-record feed.

## Product Implications

AEGIS should assume that SUNO source coverage is:

1. Public-only
2. Potentially incomplete
3. Vulnerable to page-structure changes
4. Subject to silent drift when SUNO changes its frontend or internal request behavior

The product should not promise complete profile visibility unless the content is published and discoverable through the public profile surface.

## UX Implications

The UI should make this constraint legible where it matters.

Recommended design guidance:

1. Source health should distinguish between:
   - successful harvest
   - stale source
   - partial discovery risk
   - source unreachable
2. Catalog freshness should show last successful harvest and last successful export publish separately.
3. Issue states should allow operators to recognize:
   - missing assets
   - removed-from-source items
   - source drift or harvest degradation
   - catalog freshness lag
4. Source detail and admin-facing help text should clearly state that AEGIS can only harvest content visible on public SUNO profile surfaces.
5. Product copy should avoid language that implies complete account visibility when the source is SUNO.

## Engineering Implications

The ingest layer should be designed defensively.

Recommended engineering assumptions:

1. Public profile harvesting may break without notice.
2. Partial harvest success must not block downstream catalog rebuild and publish.
3. Drift detection and monitoring are first-class requirements.
4. Removed, stale, and incomplete states must be modeled explicitly.
5. Harvest logic should preserve raw artifacts when possible for debugging changes in upstream behavior.

## Operational Implications

Operators should be able to answer:

1. Did the source harvest run?
2. Did it discover anything new?
3. Did it fail completely, or only partially?
4. Did the catalog rebuild publish after harvest?
5. Is the vault stale because SUNO discovery failed, media capture failed, or export publish failed?

This means AEGIS monitoring should treat harvest freshness and catalog freshness as separate operational signals.

## Recommendation

This constraint should be treated as a future-state product assumption and included in:

1. UX requirements
2. source-management copy
3. issue-state design
4. monitoring requirements
5. operator-facing runbooks

Until SUNO exposes a sanctioned catalog API, AEGIS should continue to model SUNO harvesting as a best-effort public-content acquisition workflow.
