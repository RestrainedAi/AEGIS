# AEGIS Project Map

## Product

AEGIS: SUNO YouTube Pipeline

## Purpose

This document translates the master product definition into execution workstreams, epics, milestones, and sequencing.

Planning note:

This project map assumes the recommended future-state operating model described in the repo overview, product document, and production workflow spec. It should be used as a planning baseline after authoritative production paths are confirmed.

## Phase Structure

1. Phase 1: Stabilize
2. Phase 2: Consolidate
3. Phase 3: Scale

## Workstream 1: Production Path Clarity

### Objective

Identify and formalize the authoritative production flows for SUNO, YouTube, catalog export, and viewer delivery.

### Epics

1. Document current active versus legacy paths
2. Define system-of-record collections and artifacts
3. Confirm authoritative catalog export path
4. Publish architecture decision records for production truth

### Milestones

1. SUNO production path confirmed
2. YouTube production path confirmed
3. Export generation path confirmed
4. Legacy path inventory completed

### Dependencies

1. Engineering review of current runtime behavior
2. Cloud environment inspection
3. Firestore and bucket usage validation

## Workstream 2: Configuration and Platform Hardening

### Objective

Standardize environment handling, reduce operational fragility, and improve security posture.

### Epics

1. Normalize environment variables across all ingest paths
2. Remove secrets and sensitive artifacts from source control
3. Clean deployment scripts and environment-specific path assumptions
4. Establish baseline repo hygiene policy

### Milestones

1. Env naming standard approved
2. Checked-in secrets removed and rotated
3. Deployment path assumptions documented and corrected
4. Repo hygiene cleanup baseline completed

### Dependencies

1. Access to cloud credentials and secret stores
2. Agreement on runtime environments
3. Deployment owner alignment

## Workstream 3: Source and Ingestion Model

### Objective

Create a cleaner and more durable source and run model across supported platforms.

### Epics

1. Standardize source registration model
2. Align run lifecycle states across pipelines
3. Define common ingest orchestration contract
4. Improve traceability between source, run, item, and artifacts

### Milestones

1. Unified source contract documented
2. Unified run status model documented
3. Ingestion contract aligned across platforms
4. Traceability model approved

### Dependencies

1. Product agreement on source and run concepts
2. Existing collection analysis
3. Export and viewer data requirements

## Workstream 4: SUNO Pipeline Rationalization

### Objective

Clarify the SUNO ingest and harvest strategy and reduce overlap between API and script-driven paths.

### Epics

1. Compare API-driven and Python harvest workflows
2. Decide future-state SUNO operating model
3. Rationalize duplicate scripts and collections
4. Preserve delta detection and media completeness logic

### Milestones

1. SUNO path comparison complete
2. Future-state SUNO path selected
3. Transition plan for duplicate logic approved
4. Delta workflow preserved in future-state design

### Dependencies

1. Validation of live operational path
2. Firestore and GCS data usage analysis
3. Run success and completeness history

## Workstream 5: YouTube Pipeline Rationalization

### Objective

Unify direct ingest and queued-run YouTube patterns into a clear future-state workflow.

### Epics

1. Compare direct ingest and queued run models
2. Align YouTube data model with unified catalog strategy
3. Standardize caption enrichment workflow
4. Remove environment mismatch between YouTube paths

### Milestones

1. YouTube path comparison complete
2. Future-state YouTube workflow selected
3. Caption enrichment ownership clarified
4. Config mismatch removed

### Dependencies

1. Current run path validation
2. Shared item schema decisions
3. Transcript requirements

## Workstream 6: Unified Catalog and Export Pipeline

### Objective

Create a dependable catalog generation layer that feeds the viewer and future downstream consumers.

### Epics

1. Define canonical catalog schema
2. Make export generation an explicit pipeline stage
3. Publish stable latest-catalog outputs
4. Add validation for export completeness and freshness

### Milestones

1. Canonical export schema approved
2. Export generation owner assigned
3. Stable latest export publication process documented
4. Export validation checks established

### Dependencies

1. Viewer requirements
2. Item model decisions
3. Cloud storage path governance

## Workstream 7: Catalog Experience and UX

### Objective

Translate the platform into a high-trust operational and media-review experience.

### Epics

1. Define information architecture and navigation
2. Design dashboard, sources, runs, catalog, item detail, and issues views
3. Establish reusable component patterns and state model
4. Prepare design-to-engineering handoff package

### Milestones

1. UX framework approved
2. Priority screen set complete
3. State model and component language approved
4. Engineering handoff package ready

### Dependencies

1. Product requirements clarity
2. Data object definitions
3. Designer availability and review cadence

## Workstream 8: Monitoring and Operations Visibility

### Objective

Improve the ability to understand runs, failures, stale sources, and missing assets quickly.

### Epics

1. Standardize run and item status reporting
2. Create issue taxonomy for operational exceptions
3. Expose freshness and completeness metrics
4. Define future admin and alerting direction

### Milestones

1. Status taxonomy approved
2. Operational issue categories defined
3. Dashboard metric set approved
4. Monitoring backlog created

### Dependencies

1. Data model clarity
2. UX framework
3. Run and artifact lineage consistency

## Workstream 9: Quality, Testing, and Release Discipline

### Objective

Improve engineering confidence and reduce regression risk.

### Epics

1. Define minimum automated test strategy
2. Add build, validation, and smoke-check discipline
3. Establish release criteria for production changes
4. Define operational rollback expectations

### Milestones

1. Test strategy approved
2. Baseline validation pipeline in place
3. Release checklist approved
4. Rollback and incident handling guidance documented

### Dependencies

1. Agreement on critical flows
2. Build and deploy path clarity
3. Ownership across engineering and ops

## Phase Plan

### Phase 1: Stabilize

Focus:

1. Production path clarity
2. Configuration and secret hygiene
3. Export path identification
4. Baseline operational visibility

Primary workstreams:

1. Production Path Clarity
2. Configuration and Platform Hardening
3. Monitoring and Operations Visibility
4. Quality, Testing, and Release Discipline

Exit criteria:

1. Authoritative paths are documented
2. Critical config inconsistencies are resolved
3. Secret exposure is remediated
4. Export dependency is explicit

### Phase 2: Consolidate

Focus:

1. Source and run model alignment
2. SUNO and YouTube path rationalization
3. Unified catalog and export formalization
4. UX definition and future-state interaction model

Primary workstreams:

1. Source and Ingestion Model
2. SUNO Pipeline Rationalization
3. YouTube Pipeline Rationalization
4. Unified Catalog and Export Pipeline
5. Catalog Experience and UX

Exit criteria:

1. Future-state ingest model is selected
2. Catalog export becomes a formal owned pipeline stage
3. UX system is ready for implementation planning
4. Legacy overlap is reduced with a documented transition plan

### Phase 3: Scale

Focus:

1. Expanded source capacity
2. Better admin and issue management
3. Stronger reliability and governance
4. Engineering maturity for faster iteration

Primary workstreams:

1. Monitoring and Operations Visibility
2. Quality, Testing, and Release Discipline
3. Catalog Experience and UX
4. Platform Hardening follow-through

Exit criteria:

1. Platform supports more sources with less manual intervention
2. Operational visibility is strong enough for routine scale
3. Delivery confidence improves through testing and release discipline
4. Product surfaces are ready for broader internal adoption

## Suggested Ownership Model

1. Product: roadmap, priorities, future-state operating model
2. Platform Engineering: ingest architecture, config, deployment, reliability
3. Data and Backend Engineering: schema, export pipeline, storage contracts
4. Design: IA, workflows, screen system, component language
5. Operations: runtime validation, scheduler and job behavior, incident feedback

## Recommended Immediate Next Actions

1. Approve the Phase 1 stabilization scope
2. Confirm owners for architecture, export pipeline, and runtime operations
3. Create a decision log for authoritative production paths
4. Convert the top workstreams into implementation epics in the delivery system
