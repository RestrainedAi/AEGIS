# AEGIS YouTube API Quota Guardrails — 2026-04-14

## Why This Matters

The default YouTube Data API quota is easy to burn accidentally.

The practical trap is not one dramatic mistake. It is death by workflow:
- expensive search calls where cheaper list calls would work
- repeated metadata updates instead of one consolidated write
- retries that repeat high-cost operations
- uploads triggered without enough local validation first

This should be treated as a bridge reliability issue, not just an ops footnote.

## Working Baseline

Current practical assumptions:
- default project quota starts at `10,000 units/day`
- quota resets at midnight Pacific Time
- bigger quota requires audit and approval

Common relative costs:
- low-cost reads such as `videos.list` and `channels.list`: cheap
- `search.list`: expensive
- writes such as metadata updates: materially more expensive than reads
- `videos.insert`: one of the costliest operations in the bridge
- `thumbnails.set`: non-trivial write cost

Exact Google values can change, so production planning should always check the live quota table before bulk operations.

## Product Rules We Should Adopt

### 1. Prefer quota-cheap read paths

Use playlist-based traversal instead of search wherever we can.

For channel inventory:
- prefer the uploads playlist path
- use `playlistItems.list`
- avoid `search.list` unless the workflow truly requires cross-surface discovery

### 2. Collapse writes into one operation

Do not burn separate update calls for:
- title
- description
- tags
- other metadata fields

The bridge should prepare a final payload and send one update call wherever possible.

### 3. Validate locally before costly calls

Before uploads or metadata writes:
- validate required fields locally
- validate media paths locally
- validate publish payload shape locally
- fail early before any quota-expensive YouTube request is made

### 4. Retry rules must be quota-aware

Retries are not free.

We should distinguish:
- cheap read retries
- expensive write/upload retries

High-cost operations should require:
- bounded retry count
- longer backoff
- visible operator reason

### 5. Surface quota risk in ops/admin UX

Operators should not have to guess whether a bulk action is safe.

The Control Center or publish flow should eventually show:
- estimated quota risk for bulk actions
- whether an action uses search, write, upload, or thumbnail APIs
- when to batch work vs. spread it across days

## First Engineering Moves

### A. Audit current YouTube API call shapes

Map:
- where `search.list` is used
- where repeated metadata writes happen
- where retries could duplicate expensive requests
- where upload pre-validation is weak

### B. Replace avoidable `search.list` usage

Priority:
- channel inventory
- known-channel content traversal
- anything that can use playlist/list endpoints instead

### C. Consolidate publish/update calls

Publishing-related metadata should be assembled once and written once.

### D. Add quota notes to publish/operator workflows

Even a small initial signal helps:
- `low-cost read`
- `metadata write`
- `upload-heavy`

### E. Add a quota-aware runbook

We should document:
- safe daily operating assumptions
- when to avoid bulk uploads
- when to avoid search-heavy jobs
- what to do when quota is near exhaustion

## Ticket Intent

This work is now tracked in:
- `AEGIS-026` — Add YouTube API quota guardrails and quota-safe call strategy

This ticket should stay focused on prevention:
- lower-cost API patterns
- safer retries
- better batching
- operator visibility

It is not just “get more quota.”

## Recommended Start

Start by auditing the current bridge for:
1. `search.list`
2. repeated `videos.update`
3. thumbnail update frequency
4. upload retry behavior

That gives us the fastest real picture of where quota is most likely to get wasted.
