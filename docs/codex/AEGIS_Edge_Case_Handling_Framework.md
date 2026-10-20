# AEGIS Edge Case Handling Framework

## Purpose

This note defines how AEGIS should handle recurring operational edge cases across:

1. `SUNO Harvest`
2. `Vault to YouTube`
3. shared catalog, queue, and operator workflows

The goal is to treat edge cases as first-class product and operations concerns, not as one-off surprises.

## Core Principle

An edge case is not just a bug.

In AEGIS, an edge case is a named operational condition with:

1. a detection point
2. a containment strategy
3. a recovery path
4. an owner
5. a user-facing or operator-facing interpretation

If the same kind of failure happens more than once, it should usually be promoted into:

1. a named issue type
2. a Jira ticket or linked runbook
3. an explicit UI state or operator surface when appropriate

## The Five-Step Model

### Owner, conditional decision, and recovery loop

Apply [Development DNA](DEVELOPMENT_PRINCIPLES.md): the accountable feature owner assigns a focused specialist to investigate each bounded failure class and a designated writer to change the affected surface. Hand over source observations, relevant constraints, contradictory evidence, and acceptance checks; do not transmit an assumed root cause as fact.

Classify success, partial success, retryable failure, unavailable source, and external blocker explicitly. Preserve successful results and original data while isolating failed items. Set retry/time limits and backoff; record a resumption condition instead of repeatedly retrying unchanged failures. Closure requires verifying the recovered data/artifact in the integrated product path, with unresolved items and skipped checks disclosed in the [feature brief](templates/FEATURE_BRIEF.md).

### 1. Detect early

Catch the condition as close to the source of truth as possible.

Examples:

1. detect zero-byte media before attempting upload
2. detect stale exports before the vault appears broken
3. detect missing media while indexing or rebuilding, not only in the UI

### 2. Classify explicitly

Do not leave failures as vague “error” states when they can be named.

Examples:

1. `MEDIA_ZERO_BYTE`
2. `MEDIA_MISSING`
3. `SOURCE_STALE`
4. `QUEUE_CONTRADICTORY`
5. `UPLOAD_DUPLICATE`
6. `EXPORT_STALE`
7. `REMOVED_FROM_SOURCE`

Classification should answer:

1. what failed
2. where it failed
3. whether retry is valid
4. whether repair is required

### 3. Contain locally

An edge case should affect the smallest possible scope.

Preferred pattern:

1. fail one item, not the whole batch
2. keep the rest of the run or queue moving
3. avoid poisoning the happy path for unaffected items
4. preserve evidence for diagnosis

### 4. Recover cheaply

Default recovery should minimize cost and avoid broad reruns.

Preferred order:

1. inspect existing stored data
2. inspect logs and queue state
3. retry one item if valid
4. run a repair script if available
5. re-harvest or re-download only when earlier steps cannot solve it

### 5. Productize repeated cases

If the same edge case repeats, it deserves one or more of:

1. a guardrail in code
2. a clearer error message
3. a queue or issue state
4. a runbook
5. a Jira follow-up ticket
6. an operator-facing UI affordance

## AEGIS Handling Rules

### Rule 1: Prefer specific failure messages

Bad:

1. `Upload failed`

Better:

1. `Upload blocked: source video is zero bytes`
2. `Upload blocked: media artifact missing from GCS`
3. `Catalog stale: latest export older than expected threshold`

### Rule 2: Distinguish retryable from repair-required

Every edge case should answer:

1. retry now
2. wait and re-check
3. repair media or metadata
4. re-run harvest
5. operator intervention required

### Rule 3: Prefer additive state over destructive cleanup

When in doubt:

1. annotate state
2. preserve evidence
3. add a repair path

Do not delete information prematurely unless the lifecycle is already well understood.

### Rule 4: Keep provenance explicit

When an issue is derived from other data, store or expose enough context to explain:

1. where the value came from
2. when it was last seen
3. what component wrote it

### Rule 5: Edge cases should map to ownership

Ownership follows the current workstream model:

1. `Epicurus` owns harvest/schema/media-index integrity surfaces
2. `Confucius` owns vault, queue, uploader, and operator-visible publishing surfaces
3. shared edge cases are coordinated by the main agent

## Current Example Cases

### 1. Zero-byte media artifact

Observed behavior:

1. GCS MP4 exists
2. object size is `0`
3. uploader downloads `0 bytes`
4. YouTube returns a low-signal chunk upload error

Correct handling:

1. detect before upload
2. classify as media integrity failure
3. fail item cleanly
4. give operator repair guidance
5. avoid blind queue retry

### 2. Contradictory queue row

Observed behavior:

1. queue row may show `error`
2. item may still have `ytVideoId` or other success evidence

Correct handling:

1. expose contradictory state clearly
2. let operators reconcile the row
3. do not silently overwrite evidence

### 3. Stale vault export

Observed behavior:

1. harvest may run
2. vault remains old because export publish did not happen

Correct handling:

1. distinguish export freshness from item freshness
2. surface it in UI and monitoring
3. make recovery runbook explicit

## Recommended Issue Taxonomy

This should eventually feed `Issues View`, queue inspection, and run diagnosis.

Suggested first issue families:

1. `MEDIA_ZERO_BYTE`
2. `MEDIA_MISSING`
3. `MEDIA_PARTIAL_CAPTURE`
4. `SOURCE_STALE`
5. `SOURCE_UNREACHABLE`
6. `RUN_FAILED`
7. `RUN_PARTIAL`
8. `EXPORT_STALE`
9. `QUEUE_CONTRADICTORY`
10. `UPLOAD_FAILED`
11. `UPLOAD_BLOCKED_DUPLICATE`
12. `REMOVED_FROM_SOURCE`

## Decision Standard

When a new edge case appears, the decision sequence should be:

1. Is it isolated or systemic?
2. Is it retryable or repair-required?
3. Can we classify it with an existing type?
4. Does it need a guardrail, a UI state, or both?
5. Does it need a Jira ticket and runbook entry?

## Bottom Line

AEGIS should not aim to eliminate edge cases.

It should aim to:

1. detect them early
2. classify them clearly
3. contain them cheaply
4. recover from them predictably
5. turn repeated cases into durable product behavior
