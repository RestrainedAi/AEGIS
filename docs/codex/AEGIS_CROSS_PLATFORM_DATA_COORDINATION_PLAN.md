# AEGIS Cross-Platform Data Coordination Plan

## Purpose

AEGIS needs two things at the same time:

1. clean platform-specific ingest models for SUNO and YouTube
2. one shared platform data model wherever the two streams overlap

The goal is:

`combine where it creates leverage, separate where it preserves clarity`

This note defines that coordination layer.

## Coordination Principle

Do not force SUNO and YouTube into an identical raw-ingest schema.

Instead:

1. preserve platform-specific ingest truth at the edges
2. normalize shared concepts into a common platform model
3. keep downstream-only concerns in their own records when necessary

## Three-Layer Model

### Layer 1: Platform-specific ingest truth

SUNO-specific examples:

1. handle
2. sourceId
3. prompt
4. modelName
5. isInstrumental
6. public-profile discovery state

YouTube-specific examples:

1. playlistId
2. videoId
3. channel metadata
4. transcript availability
5. caption artifacts

Rule:

1. keep these fields separate and explicit

### Layer 2: Shared canonical item model

Shared concepts that should align across SUNO and YouTube:

1. item ID
2. platform
3. source identity
4. title
5. created/published timestamp
6. updated/imported timestamp
7. lastSeenAt
8. lifecycle status
9. media presence flags
10. canonical media pointers where applicable
11. run lineage references

Rule:

1. these fields should share naming, semantics, and status rules as much as possible

### Layer 3: Downstream workflow models

These should usually stay separate from ingest records:

1. upload queue records
2. publish execution records
3. retry and terminal workflow states
4. operational issue rollups

Rule:

1. do not overload ingest records with downstream workflow ownership when a dedicated model is clearer

## Where To Combine

### Shared field families

These should be coordinated across SUNO and YouTube:

1. source reference fields
2. item identity fields
3. timestamps and lineage fields
4. status vocabulary families
5. media presence flags
6. export-facing field names where both platforms participate

## Where To Separate

These should remain platform-specific:

1. SUNO generation metadata
2. SUNO public-profile harvest constraints
3. YouTube transcript and caption semantics
4. YouTube playlist-specific metadata
5. media-capture method details

## Required Coordination Tickets

### Ticket 1

`Define shared canonical item field family across SUNO and YouTube`

### Ticket 2

`Define platform-specific extension fields for SUNO`

### Ticket 3

`Define platform-specific extension fields for YouTube`

### Ticket 4

`Define shared status vocabulary with platform-specific mappings`

### Ticket 5

`Define shared source-run-item-lineage model`

### Ticket 6

`Define which fields belong in ingest records versus queue/workflow records`

## Recommended Working Order

1. finalize SUNO formalization plan
2. finalize YouTube formalization plan
3. reconcile the two into a shared canonical item model
4. map database collections to that coordinated model
5. then update harvest/ingest files

## Build Rule

Do not expand database schemas broadly until the coordination layer is approved.

Otherwise the system risks:

1. duplicate meanings for the same field
2. mismatched status semantics
3. mixed ingest and workflow ownership
4. brittle export contracts

## Immediate Recommendation

Treat the data work as a three-part package:

1. `SUNO data formalization`
2. `YouTube data formalization`
3. `cross-platform coordination`

Only after all three are settled should the next database and ingest-file implementation wave begin.
