# AEGIS Regression Postmortem And Prevention

Date: 2026-04-08

## Summary

The recent live Vault regression was not a random one-off. It exposed a recurring system pattern:

- source truth remained healthy
- the harvest pipeline looked healthy
- the viewer deploy looked current
- but the product still regressed because the live export contract drifted

The anchor incident was the `catalog.csv` / lyrics disappearance:

- the viewer bundle was current
- the daily health email looked healthy
- the export contract regressed
- rich metadata such as lyrics and styles appeared to vanish from the live Vault
- recovery required both export repair and viewer-side fallback protection

This document defines the root-cause categories behind these regressions and the prevention stack that now lives under `EPIC-18`.

## Why Regressions Keep Happening

### 1. Contract drift

Producer and consumer layers have been allowed to drift independently.

Examples:

- Firestore truth is current
- export artifact shape is stale or malformed
- viewer expects richer columns than the served artifact actually contains

When contract drift is silent, the app can be deployed correctly and still regress at runtime.

### 2. Runtime drift

Checked-in code and production config do not always represent the same reality.

Examples:

- old environment names still live in production
- missing OAuth scopes in production
- stale or malformed GCS objects surviving beside current code

This creates a false sense of progress where implementation is real in the repo but incomplete in production.

### 3. Release drift

A deploy can succeed technically while the dependent data artifact or runtime prerequisite is still wrong.

Examples:

- current viewer bundle + bad export object
- current pipeline health + degraded live feed contract
- current code path + stale runtime configuration

This is the gap between “deploy succeeded” and “product is healthy.”

### 4. Observability drift

Operators have not always had a first-class signal that a product surface is degraded.

Examples:

- lyrics disappeared in the Vault before the admin surface made the cause obvious
- a green health email could coexist with a broken rich-metadata experience

That means user-visible degradation can arrive before operator-visible diagnosis.

## Prevention Stack

### EPIC-18

`EPIC-18` exists to prevent export, contract, and release regressions as a dedicated reliability stream.

This work is intentionally separate from:

- `EPIC-13`
  - monitoring and operational visibility
- `EPIC-14`
  - broader release discipline

`EPIC-18` is the explicit home for the regression pattern itself: why it escaped and how to stop that class of failure from recurring.

### Ticket mapping

- `AEGIS-013`
  - validate export contract before publish and before serve
- `AEGIS-014`
  - expose export health and fallback state in the Control Center
- `AEGIS-015`
  - add post-deploy smoke validation for Vault runtime integrity
- `AEGIS-016`
  - split daily health reporting into subsystem health
- `AEGIS-017`
  - standardize incident and postmortem capture for regressions

## Prevention Rules Going Forward

### 1. Treat `catalog.csv` as a real contract

Required rich-metadata columns must be explicitly protected. At minimum:

- `displayTags`
- `styles`
- `styleText`
- `lyrics`
- `lyricsStatus`
- `gcsLyricsTxt`
- `gcsLyricsJson`
- `gcsLyricsVtt`

If those fields disappear unexpectedly, the export must not be treated as healthy.

### 2. Validate in both producer and consumer paths

Prevention should exist at two layers:

- export producer path
  - validate before publish/upload
- viewer consumer path
  - validate before serve
  - fall back to a known-good snapshot if GCS is malformed

This avoids relying on only one defensive layer.

### 3. Make health visible to operators

The Control Center should show:

- whether the app is serving from `gcs` or fallback
- export freshness
- required-column health
- missing required fields if degraded

This turns silent drift into an operator-visible signal.

### 4. Separate subsystem health in daily reporting

Daily health should no longer collapse everything into a single green pipeline signal.

It should distinguish:

- harvest health
- export contract health
- viewer health
- queue health
- caption health
- auth/admin health

### 5. Require post-deploy runtime proof

A deploy should not be considered complete until live checks confirm:

- `catalog.csv` header is healthy
- a known lyric-bearing song still renders lyrics
- styles still render
- auth/session still works
- publish controls remain correctly gated

### 6. Capture incidents consistently

Each future regression should leave behind one structured incident note covering:

- symptom
- user-visible impact
- technical trigger
- why it escaped
- immediate fix
- prevention follow-up
- linked tickets

That turns regressions into durable operational memory instead of scattered recovery notes.

## Board Intent

The board move is deliberate:

- `EPIC-13` remains monitoring-focused
- `EPIC-14` remains release-discipline focused
- `EPIC-18` becomes the dedicated home for regression prevention

That separation keeps this work visible and prevents it from being diluted inside broader engineering hygiene.
