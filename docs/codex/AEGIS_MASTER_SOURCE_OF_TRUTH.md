# AEGIS Master Source Of Truth

## Purpose

This is the central front door for the current AEGIS and Sundrop operating truth.

This file is not meant to duplicate every detailed contract, runbook, or policy note.
It exists to answer one question quickly:

`Which document wins for this topic right now?`

If a scratch note, chat summary, old handoff, or partial runbook disagrees with the authority map below, this file decides which underlying document is authoritative until this file is updated.

## Current Operating Note

Some values in this file are intentionally temporary.

They are still authoritative now because they reflect the current real operating split, even if we expect them to change later during:

- domain swaps
- product renaming cleanup
- post-beta platform hardening
- infrastructure consolidation

Temporary does not mean optional.

## Current Identity Split

### Google Cloud

Use this identity for Google Cloud administration and infrastructure work:

- `aegis@aeonimus.ai`

This includes:

- `gcloud auth`
- Cloud Run
- Cloud Build
- GCS
- Firestore
- IAM
- Artifact Registry
- domain and platform infrastructure administration

### YouTube API

Use this identity for YouTube API and YouTube-connected operational work:

- `aeonimusai@gmail.com`

This includes:

- YouTube Data API use
- YouTube publishing/auth flows
- YouTube channel-connected runtime work
- YouTube-specific troubleshooting where the platform identity is not the controlling identity

### Working Rule

Do not assume the same identity should be used for both cloud infrastructure and YouTube operations.

The current active split is:

1. Google Cloud = `aegis@aeonimus.ai`
2. YouTube API = `aeonimusai@gmail.com`

## Current Domain Intent

The intended canonical Sundrop domain family is:

- `sundrop.music`
- `sundrop.cloud`
- `sundrop.me`

Until the domain swap is formally completed, treat the current identity and environment values in this file as the temporary operating truth.

### Domain Use Intent

#### `sundrop.music`

Intended for:

- source-side tools
- harvest-side tools
- SUNO-side collection workflows

#### `sundrop.cloud`

Intended for:

- authenticated cloud product
- Vault
- signup
- login
- Control Center
- admin/operator surfaces
- publish operations

#### `sundrop.me`

Reserved for personal or brand-adjacent use as the broader domain plan evolves.

Do not assume `sundrop.me` has the same operational role as `sundrop.cloud`.

## Authority Map

### 1. Product naming and domain policy

Authoritative file:

- `AEGIS_SUNDROP_NAMING_AND_DOMAIN_POLICY_2026-04-09.md`

Use it for:

- product naming
- domain-family intent
- brand-facing naming rules
- migration order for domain and naming cleanup

### 2. Identity split and current operator identities

Authoritative file:

- this file

Use it for:

- Google Cloud identity
- YouTube API identity
- temporary current-state identity truth during transition

### 3. Layer ownership model

Authoritative file:

- `AEGIS_LAYER_MODEL.md`

Use it for:

- creation layer
- asset layer
- distribution layer
- interaction layer
- operations layer

### 4. Field ownership by object

Authoritative file:

- `AEGIS_Authoritative_Fields_By_Object.md`

Use it for:

- which object owns which class of fields
- who is allowed to write those fields
- who reads them downstream

### 5. Typed field definitions and schema-aware implementation

Authoritative file:

- `AEGIS_Typed_Field_Dictionary.md`

Use it for:

- field names
- types
- required vs optional guidance
- implementation-facing contract details

### 6. YouTube environment variable naming

Authoritative file:

- `AEGIS-002_YOUTUBE_ENV_STANDARD.md`

Use it for:

- canonical YouTube env var names
- temporary env var aliases
- migration expectation for YouTube runtime configuration

### 7. Workstream ownership and change control

Authoritative file:

- `AEGIS_Workstream_Ownership_And_Change_Control.md`

Use it for:

- single-writer rules
- workstream ownership boundaries
- who owns shared surfaces

### 8. Harvest runtime and export operations

Primary operational runbook:

- `AEGIS_HARVEST_DEPLOY_RUNBOOK.md`

Supporting export/runtime references:

- `AEGIS_EXPORT_RUNTIME_VALIDATION_2026-04-06.md`
- `AEGIS_RUNTIME_VALIDATION_2026-04-07.md`
- `AEGIS_SUNO_HARVEST_CONTRACT_BRIEF.md`

Use these for:

- harvest deploy/run flow
- export expectations
- runtime validation checks
- troubleshooting harvest freshness and export issues

### 9. Vault stability and CSV transition planning

Authoritative planning note:

- `AEGIS_VAULT_STABILITY_TOOLBOX_AND_CSV_TRANSITION_2026-04-14.md`

Use it for:

- CSV reliability concerns
- post-beta transition away from CSV-primary serving
- diagnostic toolbox planning

### 10. Edge-case handling framework

Authoritative file:

- `AEGIS_Edge_Case_Handling_Framework.md`

Use it for:

- edge-case family structure
- rule framing for incomplete or anomalous items
- future anomaly handling policy

## Fast Lookup

If the question is:

- `Which account should I use for Google Cloud?`
  - this file
- `Which account should I use for YouTube API work?`
  - this file
- `Which domain is Sundrop Cloud supposed to use?`
  - this file first, then `AEGIS_SUNDROP_NAMING_AND_DOMAIN_POLICY_2026-04-09.md`
- `Which layer owns this field?`
  - `AEGIS_LAYER_MODEL.md`
- `Which object owns this field?`
  - `AEGIS_Authoritative_Fields_By_Object.md`
- `What is the exact typed field contract?`
  - `AEGIS_Typed_Field_Dictionary.md`
- `What is the canonical YouTube env var?`
  - `AEGIS-002_YOUTUBE_ENV_STANDARD.md`
- `Who is allowed to change this shared surface?`
  - `AEGIS_Workstream_Ownership_And_Change_Control.md`
- `How should we think about CSV reliability and post-beta serving?`
  - `AEGIS_VAULT_STABILITY_TOOLBOX_AND_CSV_TRANSITION_2026-04-14.md`

## Change-Control Rule

When one of these truths changes:

1. update the specialized authoritative document first if needed
2. update this master file second
3. only then update task notes, runbooks, or handoff summaries that depend on it

This file exists so we stop losing time to identity drift, policy drift, and multiple competing "truth" notes.
