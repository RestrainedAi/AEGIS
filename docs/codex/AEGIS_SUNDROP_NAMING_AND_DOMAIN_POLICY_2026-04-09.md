# AEGIS Sundrop Naming And Domain Policy

## Summary

This document defines the canonical product naming and domain split for the Sundrop system.

The old `Aeonimus` name should now be treated as:

- legacy historical naming in old docs
- legacy infrastructure naming where renaming would create unnecessary operational risk
- not the active product-facing brand

The active system is now split across two product identities and two domain families:

- `Sundrop Music`
- `Sundrop Cloud`

## Canonical Product Map

### Sundrop Music

Use `Sundrop Music` for:

- SUNO harvest tools
- source collection workflows
- YouTube playlist harvesting
- YouTube URL collection tools
- upstream/source-side operational utilities

### Sundrop Cloud

Use `Sundrop Cloud` for:

- Vault access
- publishing
- signup and login
- Control Center
- workspace/admin/operator functions
- platform surfaces around preservation and distribution

### Sundrop Vault

Use `Sundrop Vault` as the preservation/library surface inside `Sundrop Cloud`.

It is not the name for the entire platform. It is the name of the Vault surface within the cloud-side product.

## Canonical Domain Map

### `sundrop.music`

This domain family is for source and harvest operations.

Use `sundrop.music` for:

- SUNO harvest entry points
- playlist harvesting
- URL/source tools
- source-side operational surfaces

### `sundrop.cloud`

This domain family is for the authenticated platform and publishing side.

Use `sundrop.cloud` for:

- Vault
- publishing
- signup
- login
- Control Center
- admin/operator surfaces
- artifact proxy endpoints

## Naming Rules

### Product-facing naming

Product-facing surfaces should use:

- `Sundrop Music`
- `Sundrop Cloud`
- `Sundrop Vault`

Product-facing surfaces should not continue to present:

- `Aeonimus`
- `AEONIMUS Vault`
- `Aeonimus Vault`

unless the reference is explicitly historical.

### Infrastructure naming

Do not blindly rename infrastructure identifiers just because they still include `aeonimus`.

Examples that may remain temporarily legacy-named:

- GCS buckets
- Artifact Registry repos
- Cloud Run services and jobs
- image repository paths
- environment variable names
- existing service accounts

Those should only be renamed through an explicit infrastructure migration project with rollback planning.

### Historical documentation

Do not rewrite historical incident notes into false history.

If a doc describes a real past system state that used `Aeonimus`, preserve the historical reference and, where helpful, add a note that the current product naming is now `Sundrop Music` / `Sundrop Cloud`.

## Change-Control Rule

The domain and naming migration should be executed in this order:

1. freeze naming policy
2. centralize code constants
3. update product-facing copy
4. update domain-dependent code paths
5. update auth and callback integrations
6. stand up new domains in parallel
7. validate both domain families
8. cut over canonical domains and add redirects
9. assess optional infrastructure renames later

## Immediate Enforcement Guidance

### Rename now

Rename now in product-facing UI:

- page titles
- public shell labels
- Vault header labels
- signup/login copy
- Control Center copy
- emails and operator-facing copy

### Do not rename yet

Do not rename yet without explicit migration work:

- buckets like `aeonimus-workspaces`
- media buckets like `aeonimus-suno-media`
- Cloud Run service names
- Artifact Registry paths
- old runtime validation notes

## Canonical One-Line Rule

`Sundrop Music handles harvest and source tooling. Sundrop Cloud handles the Vault, publishing, login, and operator surfaces. Sundrop Vault is the preservation surface inside Sundrop Cloud.`
