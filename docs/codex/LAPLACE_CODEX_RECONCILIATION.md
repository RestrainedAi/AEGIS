# Laplace and Codex Reconciliation Notes

## Purpose

This document compares:

1. Laplace's future-state UX documentation in `docs/design/`
2. Codex's repository and workflow findings in `docs/codex/`

The goal is to identify:

- where product and UX thinking align
- where the current codebase cannot yet support the intended experience
- what implementation decisions are required to bridge the gap

## Documents Compared

Laplace:

- `docs/design/aegis-ui-ux-strategy-memo.md`
- `docs/design/aegis-ux-requirements-spec-v1.md`
- `docs/design/aegis-wireframe-brief-v1.md`

Codex:

- `docs/codex/SUNO_Youtube_Pipeline_Repo_Overview.md`
- `docs/codex/SUNO_Youtube_Pipeline_Product_Document.md`
- `docs/codex/SUNO_SUNO_To_YouTube_Production_Workflow_Spec.md`

## High-Level Conclusion

Laplace's design direction is compatible with the platform AEGIS should become.

It is not fully compatible with the codebase as it exists today without an implementation bridge.

In short:

1. Laplace is designing the correct future-state product model.
2. The current repository only partially implements that model.
3. Codex's workflow spec provides the technical bridge required to make the design operable.

## Strong Alignment

### 1. Product model alignment

Laplace recommends the explicit model:

- Source
- Run
- Item
- Issue
- Artifact

This aligns with the clearest long-term direction in the backend:

- `sources`
- `runs`
- `items`
- supporting artifacts in GCS

Even though the repo currently has split data authority, this is the right target model.

### 2. Operations-console framing

Laplace positions AEGIS as a media operations console, not a consumer music app.

This aligns with the codebase reality:

- Cloud Scheduler
- Cloud Run Jobs
- Firestore state
- run artifacts
- ingest and sync workflows

The product should indeed be designed as an operational system with a catalog layer.

### 3. Catalog as a first-class surface

Laplace treats Catalog as a core top-level navigation object.

This aligns with the existing viewer and export path:

- `sunoSongs` -> `rebuild_catalog.py` -> `latest_catalog_wide.csv` -> `suno-viewer`

### 4. Status-centered UX

Laplace's recommended Source, Run, and Item statuses are directionally correct.

This matches the need in the codebase to make:

- harvest state
- queue state
- media completeness
- transcript state
- removal state

visible and actionable.

## Current Mismatch Between UX and Repo Reality

### 1. The repo does not yet support Laplace's full object model cleanly

Problem:

- the repo uses multiple overlapping data models
- `sunoSongs`, `sources`, `runs`, `items`, `yt_runs`, and queue-like `items` all coexist

Impact:

- the UX can present a unified mental model
- but the backend does not yet consistently provide one

Required bridge:

- freeze authoritative collections
- avoid collection reuse for unrelated meanings

### 2. Issues are not yet a first-class backend object

Laplace makes `Issues` a top-level product object.

Current repo reality:

- issues are implied through:
  - missing media
  - removed clips
  - failed runs
  - stale sources
- but there is no unified `issues` collection or service

Implication:

- the Issues screen can be designed now
- but will need either:
  - computed issues from existing data, or
  - a dedicated issue model later

### 3. Sources and Runs are only partially coherent today

Laplace's navigation assumes clean Source and Run surfaces.

Current repo reality:

- newer API path has `sources` and `runs`
- operational SUNO path relies heavily on `sunoSongs` plus scripts
- YouTube queueing and upload are partly separate from the run model

Implication:

- Source and Run UX are valid target surfaces
- but backend normalization is needed before those screens can be fully trustworthy

### 4. Publish actions assumed by the future UX are not fully implemented

Current repo reality:

- there is a documented Publish patch
- there is no real `/api/queue-for-youtube` route
- upload queue storage is not production-safe yet

Implication:

- Laplace's future-state item actions are plausible
- but implementation must first repair the queue architecture

## Design Guidance Confirmed By Repo Findings

The codebase supports these UX decisions:

### 1. Desktop-first operations UI

This is the correct priority. The product is operationally dense and job-driven.

### 2. Dense ops views and richer catalog surfaces

This matches the underlying objects:

- runs, sources, and issues should be table-forward
- catalog and item detail can be more media-forward

### 3. Traceability across Source, Run, Item, and Artifact

This should remain a core UX principle because the repo already stores enough lineage-adjacent data to justify it.

### 4. Status must not rely on color alone

The system has too many operational states for color-only signaling to be safe.

## Technical Constraints Laplace Should Assume

These constraints should shape future design work.

### 1. Viewer data is currently CSV-backed, not live Firestore-backed

Design implication:

- catalog freshness is eventually consistent
- some state may lag behind ingest unless rebuild is automated

### 2. Upload status is likely asynchronous and delayed

Design implication:

- Publish flows should show queued, uploading, done, and error states clearly
- optimistic UI should be minimal and recoverable

### 3. Issues may initially be derived, not stored

Design implication:

- the first Issues screen should likely aggregate computed issue conditions

### 4. Some detail pages may need progressive rollout

Design implication:

- Dashboard, Catalog, Runs, and basic Source views can come first
- deep Source and Item lineage views may need phased implementation

## Recommended Shared Product Position

The design and engineering teams should align on this statement:

AEGIS is a media operations platform with a catalog experience, backed by scheduled ingest, artifact storage, operational run visibility, and downstream publishing workflows.

It is not:

- a consumer streaming app
- a generic admin dashboard
- a single-pipeline codebase today

## Recommended Joint Decisions

### Decision 1

Adopt Laplace's `Source -> Run -> Item -> Issue -> Artifact` product model as the future-state UX model.

### Decision 2

Adopt Codex's SUNO production path as the near-term technical authority:

- harvest
- GCS
- `sunoSongs`
- catalog rebuild
- viewer
- upload queue

### Decision 3

Treat `Issues` as a computed product surface in Phase 1, not a required persisted backend object.

### Decision 4

Do not expose advanced Source and Run UX as fully authoritative until the backend collection model is normalized.

### Decision 5

Prioritize implementation work that unlocks Laplace's UX:

1. dedicated upload queue collection
2. uploader schema fix
3. publish API route
4. catalog rebuild automation

## Recommended Next Shared Deliverables

1. A joint domain model diagram mapping current collections to future UX objects
2. A phased implementation matrix for Dashboard, Catalog, Runs, Sources, and Issues
3. A design-technical contract for the Publish-to-YouTube flow
4. An API and data contract for queue state and item publishing status

## Final Assessment

Laplace is designing the right product.

The codebase is not there yet, but it is close enough that the design work should continue in parallel with backend normalization.

The shortest path to convergence is:

1. stabilize the SUNO production workflow
2. normalize queue and upload architecture
3. automate catalog freshness
4. then let the UX expand across Dashboard, Runs, Catalog, Sources, and Issues on top of a cleaner operational backbone
