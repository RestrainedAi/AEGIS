# AEGIS Consolidated Data Formalization Ticket Stack

## Purpose

This document merges the three active data-definition tracks into one execution-ordered stack:

1. `SUNO data formalization`
2. `YouTube data formalization`
3. `cross-platform coordination`

This is the recommended approval and execution order before broader database buildout and harvest/ingest file implementation continues.

Primary source docs:

1. `AEGIS_SUNO_HARVEST_DATA_FORMALIZATION_PLAN.md`
2. `AEGIS_YOUTUBE_INGEST_DATA_FORMALIZATION_PLAN.md`
3. `AEGIS_CROSS_PLATFORM_DATA_COORDINATION_PLAN.md`

## Working Principle

The goal is to:

1. formalize platform truth at the edges
2. normalize shared concepts in the middle
3. separate downstream workflow models where needed

Short version:

`combine where it creates leverage, separate where it preserves clarity`

## Phase 1: SUNO Data Formalization

These five tickets should be completed first because the SUNO Harvest stream is already active in production and is the current vault source of truth.

### DF-001

`Define canonical SUNO item schema for sunoSongs`

Goal:

1. finalize the field list for harvested SUNO items
2. mark required vs optional fields
3. define canonical field names vs compatibility aliases

Output:

1. approved `sunoSongs` schema draft
2. field glossary
3. ownership notes for each field family

### DF-002

`Define canonical SUNO media contract`

Goal:

1. formalize nested media fields
2. formalize GCS fields
3. define minimum media completeness for valid indexing

Output:

1. approved SUNO media contract
2. rule set for missing and zero-byte assets
3. distinction between canonical and convenience/export media fields

### DF-003

`Define SUNO timestamp and lineage model`

Goal:

1. define the meaning of each timestamp
2. separate source timestamps from pipeline timestamps
3. define item freshness and export freshness relationship

Output:

1. approved timestamp definitions
2. lineage rules for source -> run -> item -> export

### DF-004

`Define SUNO lifecycle and status contract`

Goal:

1. define harvest-owned status values
2. define removed-item treatment
3. separate harvest status from downstream YouTube state

Output:

1. approved SUNO status model
2. mapping to issue categories

### DF-005

`Define canonical catalog export schema from sunoSongs`

Goal:

1. lock the export field list
2. define validation rules
3. define degraded-but-allowed rows

Output:

1. approved SUNO vault export schema
2. export validation checklist

## Phase 2: YouTube Data Formalization

These five tickets should run next so the YouTube ingest side is formalized before the two systems are coordinated.

### DF-006

`Define canonical YouTube item schema`

Goal:

1. define the field list for indexed YouTube items
2. lock required vs optional fields
3. define canonical item identity

Output:

1. approved YouTube item schema draft

### DF-007

`Define canonical YouTube source and playlist identity model`

Goal:

1. define source identity for playlists, channels, and related source references
2. clarify what belongs in source records vs item records

Output:

1. approved YouTube source identity model

### DF-008

`Define transcript and enrichment field contract`

Goal:

1. define transcript presence, transcript state, and artifact references
2. define which enrichment fields are canonical

Output:

1. approved transcript/enrichment contract

### DF-009

`Define YouTube lifecycle and status contract`

Goal:

1. define YouTube-ingest-owned statuses
2. separate ingest status from downstream publishing workflow status

Output:

1. approved YouTube status model

### DF-010

`Define shared versus platform-specific export fields for YouTube`

Goal:

1. identify which YouTube fields should align with the shared item model
2. identify which remain YouTube-specific

Output:

1. approved YouTube export-facing field map

## Phase 3: Cross-Platform Coordination

These tickets reconcile SUNO and YouTube into one platform shape without flattening away platform-specific truth.

### DF-011

`Define shared canonical item field family across SUNO and YouTube`

Goal:

1. create one shared item field family
2. align naming and semantics where practical

Output:

1. shared canonical item model

### DF-012

`Define platform-specific extension fields for SUNO`

Goal:

1. formalize what remains SUNO-only
2. prevent leakage of platform-specific meaning into shared fields

Output:

1. SUNO extension-field specification

### DF-013

`Define platform-specific extension fields for YouTube`

Goal:

1. formalize what remains YouTube-only
2. keep transcript/playlist/channel semantics clean

Output:

1. YouTube extension-field specification

### DF-014

`Define shared status vocabulary with platform-specific mappings`

Goal:

1. define one shared status family
2. map SUNO and YouTube ingest statuses into it

Output:

1. canonical status vocabulary
2. mapping table by platform

### DF-015

`Define shared source-run-item-lineage model`

Goal:

1. formalize lineage across both platforms
2. define what every run, item, and source record must be able to point to

Output:

1. approved lineage model

### DF-016

`Define ingest-record versus workflow-record ownership boundaries`

Goal:

1. decide what belongs in ingest records
2. decide what belongs in upload queue, publish, and issue models

Output:

1. ownership boundary decision
2. collection responsibility matrix

## Phase 4: Database and File Implementation

Only after `DF-001` through `DF-016` are approved should implementation begin.

### DF-017

`Design target shared database model`

Goal:

1. map schemas to collections
2. define shared and platform-specific storage patterns

Output:

1. target database model
2. collection-to-schema mapping

### DF-018

`Update SUNO Firestore write shape to canonical model`

Goal:

1. align `firestore_upsert.py` and related write paths with approved schema

### DF-019

`Update SUNO harvest manifest and indexing contract`

Goal:

1. align delta and media-harvest files with the approved SUNO contract

### DF-020

`Update YouTube ingest write shape to canonical model`

Goal:

1. align YouTube ingest records with approved schema and shared field family

### DF-021

`Update export generators and validations`

Goal:

1. align export builders with approved field rules
2. add missing-field and degraded-row validation

### DF-022

`Document canonical field usage across backend and UI`

Goal:

1. make engineering, ops, and design all work from the same data contract

## Approval Gates

### Gate A

Approve:

1. `DF-001` through `DF-005`

Meaning:

1. SUNO platform truth is stable enough to proceed

### Gate B

Approve:

1. `DF-006` through `DF-010`

Meaning:

1. YouTube platform truth is stable enough to reconcile

### Gate C

Approve:

1. `DF-011` through `DF-016`

Meaning:

1. cross-platform coordination is settled

### Gate D

Approve:

1. `DF-017` through `DF-022`

Meaning:

1. implementation can proceed without schema churn

## Immediate Recommendation

The next concrete move should be:

1. approve `DF-001` through `DF-005`
2. approve `DF-006` through `DF-010`
3. then I turn those into the target shared database model

That gives the project a stable foundation before database and harvest/ingest implementation expands further.
