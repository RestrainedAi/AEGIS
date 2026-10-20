# Laplace Docs

This folder contains the current AEGIS future-state UX documentation set.

## Feature design handoff

Use [Development DNA](../codex/DEVELOPMENT_PRINCIPLES.md) and a linked [feature brief](../codex/templates/FEATURE_BRIEF.md). A feature has one accountable owner; large features may have separate design, implementation, and verification specialists. Give each the relevant requirements, source artifacts, constraints, and acceptance checks. Preserve the single-writer boundaries in [workstream ownership](../codex/AEGIS_Workstream_Ownership_And_Change_Control.md).

A design handoff includes observable customer behavior, loading/empty/partial/failure states, accessibility requirements, interfaces, and unresolved decisions. The owner sequences dependent work, returns failed checks with evidence, and verifies the integrated customer path. A wireframe, generated screen, or specialist's final message does not by itself establish implemented or tested behavior.

### Design documents

- `aegis-ui-ux-strategy-memo.md`
  - Executive direction, information architecture, navigation model, screen concepts, status model, visual system, and phased delivery guidance.
- `aegis-ux-requirements-spec-v1.md`
  - Screen-by-screen UX requirements for the core product surfaces.
- `aegis-wireframe-brief-v1.md`
  - Low-fidelity wireframe brief for the first eight priority screens.
- `aegis-design-engineering-alignment.md`
  - Reconciliation note capturing backend constraints that affect UX rollout and implementation sequencing.
- `aegis-legacy-extension-design-audit.md`
  - Audit of previously created browser-extension-style designs, identifying which patterns should be reused, reinterpreted, or retired for AEGIS.
- `aegis-component-reuse-map.md`
  - Screen-by-screen map showing how legacy extension patterns translate into the new AEGIS product surfaces.

## Important Constraint Reference

- `../codex/AEGIS-008_SUNO_PUBLIC_PROFILE_CONSTRAINT_NOTE.md`
  - Product and UX constraint note explaining that SUNO profile harvesting is public-only and dependent on fragile public-surface discovery rather than a sanctioned catalog API.

## Product Model

The recommended user-facing system model is:

1. `Source`: where content comes from
2. `Run`: a single ingest or sync job
3. `Item`: a cataloged song, video, or asset
4. `Issue`: a problem affecting freshness, completeness, or usability
5. `Artifact`: supporting evidence produced by the system

## Primary Navigation

1. `Dashboard`
2. `Sources`
3. `Runs`
4. `Catalog`
5. `Issues`

## Recommended Delivery Order

1. Dashboard
2. Runs List
3. Run Detail
4. Catalog Browser
5. Item Detail
6. Sources List
7. Source Detail
8. Issues View
