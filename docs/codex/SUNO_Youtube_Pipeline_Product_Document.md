# AEGIS Product Document

## Product

AEGIS: SUNO YouTube Pipeline

## Executive Description

AEGIS is a media ingestion, cataloging, and publishing platform designed to discover, preserve, structure, review, and optionally distribute AI-generated music assets sourced from SUNO and related YouTube workflows.

The product functions as a content operations system. Its purpose is not only to download media, but to maintain a repeatable operational pipeline for:

- source monitoring
- delta detection
- media capture
- metadata indexing
- catalog export
- playback and review
- downstream YouTube publishing

The repository suggests the product is evolving from a script-driven utility into a more formal platform that combines a backend API, cloud job infrastructure, storage conventions, and a user-facing vault.

## Product Purpose

The platform exists to:

1. Collect content from SUNO profiles and YouTube sources
2. Preserve media and metadata in cloud storage and Firestore
3. Give operators a usable catalog for review and playback
4. Enable repeatable downstream publishing workflows
5. Reduce manual effort across ingest, synchronization, and publishing

## Primary Users

### Content Operations

Needs reliable daily ingestion, sync visibility, and rerun capability.

### Creative and Editorial Teams

Need a browsable audio vault with playback and filtering.

### Publishing Operators

Need a controlled path to push selected assets to YouTube.

### Technical Operators

Need visibility into jobs, artifacts, and cloud deployment state.

## Core Product Goals

1. Continuously sync new and changed SUNO content
2. Preserve canonical media assets in GCS
3. Index usable metadata in Firestore
4. Expose a searchable viewer experience
5. Support downstream YouTube distribution
6. Run on scheduled, repeatable cloud infrastructure

## Non-Goals For Current State

1. Full editorial workflow management
2. Multi-user authentication and permissions maturity
3. Rights management
4. Analytics and business reporting
5. End-user consumer product features beyond basic catalog browsing

## Feature Buckets

### 1. Source Management

Features:

- SUNO handle registration
- YouTube playlist registration
- source identity normalization
- source metadata storage
- source crawl tracking

### 2. Ingestion Orchestration

Features:

- manual trigger endpoints
- scheduled ingestion jobs
- run creation and status tracking
- queue-based async expansion for YouTube

### 3. Delta Detection

Features:

- compare live source state to Firestore state
- identify new clips
- identify removed clips
- identify missing GCS media

### 4. Media Capture and Preservation

Features:

- direct URL download
- Playwright media interception fallback
- canonical GCS storage layout
- idempotent uploads

### 5. Metadata Indexing

Features:

- Firestore `sunoSongs` indexing
- unified item modeling in newer API code
- source and run document persistence
- asset status storage

### 6. Catalog Export

Features:

- wide CSV generation from Firestore
- GCS upload of viewer-facing catalog
- patching of removed clip status

### 7. Catalog Viewer

Features:

- grid-based browsing
- search
- account filter
- sort options
- playback
- removed-content visibility controls

### 8. YouTube Distribution

Features:

- queue creation for selected clips
- Cloud Run upload worker
- resumable YouTube upload
- Firestore write-back of upload results

### 9. Operations and Scheduling

Features:

- Cloud Scheduler jobs
- Cloud Run services
- Cloud Run jobs
- run logs and health checks

### 10. Admin and Auditability

Features:

- run records
- queue states
- upload status fields
- artifact traceability

## Key Product Gaps

1. The SUNO API path and Python harvest path are both present, but only one should be the operational authority.
2. Catalog rebuild is not clearly automated after harvest.
3. The UI-to-YouTube queue handoff is documented as a patch, but not present in the codebase.
4. Queue storage reuses the `items` collection name, which conflicts with other backend usage.
5. Secrets and generated artifacts are in the repository.

## Product Recommendation

The following recommendation describes the proposed future-state operating backbone based on the strongest current implementation observed in the repo.

The product should converge on one operational backbone:

1. SUNO harvest into GCS
2. Firestore indexing into `sunoSongs`
3. catalog rebuild from Firestore
4. viewer consumption of exported CSV
5. explicit queue collection for YouTube publishing
6. scheduled upload job execution

That path is the cleanest route from current state to a production-safe system.
