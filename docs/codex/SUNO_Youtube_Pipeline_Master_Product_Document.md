# AEGIS Master Product Document

## Document Control

- Product: AEGIS: SUNO YouTube Pipeline
- Document Type: Master Product, PRD, and UX Handoff
- Status: Working Draft
- Purpose: Consolidated single-source document for product, strategy, UX, and future project mapping

## 1. Executive Summary

AEGIS is a cloud-based media ingestion, preservation, and catalog operations platform for content sourced from SUNO and YouTube. It is designed to discover new content, capture media and metadata, normalize it into a unified catalog, preserve operational lineage, and publish the resulting catalog into a usable browsing and playback experience.

The product addresses a practical operations problem: source content is fragmented, changes quickly, and is difficult to preserve and manage manually. AEGIS creates a system for source onboarding, ingest execution, media preservation, transcript capture, run monitoring, catalog export, and catalog consumption.

Today, the product exists as an operational but partially fragmented platform made up of:

1. A TypeScript and Node ingest API
2. A Python-based SUNO harvesting and delta-sync pipeline
3. A React-based catalog viewer
4. Cloud-based storage, queueing, scheduling, and metadata persistence

The next product phase is to consolidate these capabilities into a clearer, more scalable platform with explicit production paths, stronger governance, and better design consistency.

## 2. Product Vision

Create the authoritative platform for AI-generated music and related media ingestion, preservation, catalog management, and operational visibility across SUNO and YouTube.

## 3. Business Objective

Reduce manual content operations effort, improve reliability of media preservation, create trust in the catalog as a source of truth, and establish a scalable foundation for future publishing, analytics, and asset lifecycle workflows.

## 4. Strategic Goals

1. Automate recurring content discovery and ingestion from supported platforms.
2. Preserve source media and metadata before it changes or disappears.
3. Normalize multi-platform content into a unified catalog structure.
4. Provide operational visibility into freshness, run outcomes, asset completeness, and failures.
5. Deliver a usable catalog experience for internal stakeholders.
6. Prepare the platform for future scale, governance, and downstream workflow expansion.

## 5. Product Scope

### In Scope

1. Source registration and tracking
2. SUNO ingestion workflows
3. YouTube ingestion workflows
4. Metadata normalization
5. Media preservation in cloud storage
6. Transcript capture and text enrichment
7. Delta detection and incremental sync
8. Catalog generation and export
9. Catalog browsing and playback
10. Run tracking, logging, and operational visibility
11. Platform hardening and configuration discipline

### Out of Scope

1. Rights and licensing management
2. Editorial calendar workflows
3. Monetization tooling
4. Consumer recommendation systems
5. Full enterprise permissioning model
6. Advanced BI analytics in the current phase

## 6. Feature Buckets

1. Source Management
2. Ingestion Orchestration
3. SUNO Content Acquisition
4. YouTube Content Acquisition
5. Unified Catalog Data Model
6. Media Preservation and Storage
7. Transcript and Text Enrichment
8. Delta Detection and Sync Management
9. Catalog Export and Delivery
10. Catalog Experience
11. Operations and Monitoring
12. Platform Governance and Hardening

## 7. Functional Requirements

The platform must support:

1. Source registration and source health tracking
2. Manual and scheduled ingest execution
3. SUNO page ingestion and parsing
4. YouTube playlist ingestion and caption enrichment
5. Media artifact preservation
6. Delta detection for missing or changed content
7. Catalog export to stable downstream outputs
8. Viewer browsing, filtering, sorting, and playback
9. Monitoring, auditability, and traceability

## 8. Success Metrics

1. Ingest success rate
2. Catalog freshness
3. Asset completeness
4. Transcript coverage
5. Manual intervention reduction
6. Duplication reduction across legacy and newer paths

## 9. Risks and Constraints

1. Parallel architectures may create operational confusion
2. Configuration mismatches may break isolated paths
3. Export generation is critical to viewer delivery
4. Hard-coded deployment assumptions reduce portability
5. Limited testing increases runtime regression risk

## 10. Release Strategy

### Phase 1: Stabilize

1. Confirm authoritative production paths
2. Standardize configuration and environment handling
3. Document export and data model dependencies
4. Remove operational risks such as checked-in secrets

### Phase 2: Consolidate

1. Reduce duplicate ingest paths
2. Align run and item models
3. Formalize catalog export generation
4. Improve operator controls and visibility

### Phase 3: Scale

1. Support more sources and higher ingest frequency
2. Expand admin tooling and reporting
3. Harden reliability and release discipline

## 11. UX Design Brief

The future-state product should support:

1. Dashboard for operational overview
2. Sources list and source detail
3. Runs list and run detail
4. Catalog browser
5. Item detail
6. Issues view

Primary navigation should include:

1. Dashboard
2. Sources
3. Runs
4. Catalog
5. Issues

The design should feel:

1. Professional
2. High-trust
3. Operationally capable
4. Content-aware, not sterile
5. Structured and scalable

## 12. Recommended Next Deliverables

1. Architecture decision record for authoritative production paths
2. Data model rationalization plan
3. UX requirements specification for engineering handoff
4. Implementation-ready epics and tickets derived from the project map
5. Final board and stakeholder review package
