# AEGIS YouTube Ingest Data Formalization Plan

## Purpose

This document is the YouTube-side counterpart to the SUNO harvest data formalization plan.

Its job is to answer:

`What exact YouTube data contract does AEGIS ingest, preserve, index, enrich, and expose downstream?`

This should be finalized before deeper YouTube-side database and ingest-file expansion continues.

## Scope

This plan covers:

1. playlist and source identity
2. video identity
3. channel identity
4. media and artifact references
5. transcript and enrichment fields
6. run lineage fields
7. lifecycle/status fields
8. export or downstream-shared fields

This plan does not cover:

1. SUNO source harvesting
2. YouTube upload queue semantics
3. downloader packaging features

## Priority Epic Cut

The YouTube data-formalization work should start with:

1. `EPIC 5: Rationalize the YouTube Ingest Path`
2. `EPIC 8: Align Uploader With Actual Asset Schema`
3. `EPIC 11: Define Status Taxonomy and Operational UI Model`

Immediate supporting epics:

1. `EPIC 1: Confirm Authoritative Production Paths`
2. `EPIC 13: Establish Monitoring and Operational Visibility`

## Data Domains That Must Be Formalized First

### 1. Source Identity

1. playlist ID
2. source ID
3. platform
4. source label
5. owning channel or uploader

Questions:

1. Which field is canonical for YouTube source identity?
2. How should playlists versus channels be represented?
3. What belongs in `sources` versus item documents?

### 2. Video Identity

1. video ID
2. canonical URL
3. title
4. publishedAt
5. lastSeenAt

Questions:

1. Which field is the canonical item key?
2. How is dedupe handled across playlist and direct ingest paths?

### 3. Media and Artifact Contract

1. thumbnail URLs
2. transcript or caption artifacts
3. raw payload artifacts
4. any locally or remotely preserved media references

Questions:

1. Which artifact fields are canonical?
2. Which are enrichment-only?
3. Which are required for a valid indexed YouTube item?

### 4. Metadata Contract

1. title
2. description
3. publishedAt
4. duration
5. channel title
6. statistics fields if retained

Questions:

1. Which metadata fields are mandatory?
2. Which are optional and should never block indexing?

### 5. Transcript and Enrichment Contract

1. transcript state
2. transcript text reference
3. caption availability
4. enrichment timestamps

Questions:

1. How should transcript presence be represented?
2. What is the canonical transcript status vocabulary?

### 6. Lifecycle and Status Contract

1. ingest status
2. transcript status
3. downstream queue or publish status links where shared

Questions:

1. Which statuses are YouTube-ingest-owned?
2. Which statuses belong only in downstream publishing records?

## First 5 YouTube Data Tickets

1. Define canonical YouTube item schema
2. Define canonical YouTube source and playlist identity model
3. Define transcript and enrichment field contract
4. Define YouTube lifecycle and status contract
5. Define shared versus platform-specific export fields

## Immediate Recommendation

Do the YouTube-side data formalization in parallel with the SUNO-side formalization, then reconcile them into one shared platform contract.
