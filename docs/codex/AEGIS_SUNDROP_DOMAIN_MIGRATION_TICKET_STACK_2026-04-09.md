# AEGIS Sundrop Domain Migration Ticket Stack

## Summary

This document turns the Sundrop naming and domain migration into executable Jira work.

The migration is intentionally split into:

- policy
- code abstraction
- UX/UI renaming
- integration and callback updates
- dual-domain rollout
- cutover

It does **not** assume an immediate infrastructure rename.

## Epic

### `EPIC-19`

- Title: `Migrate product naming and domain system to Sundrop`
- Status: `Ready`
- Priority: `P0`
- Size: `L`
- Owner: `Platform + Product`
- Stream: `Platform Identity`

### Epic summary

Replace legacy `Aeonimus` product-facing branding with the canonical Sundrop naming system, define the `sundrop.music` and `sundrop.cloud` split, and prepare the code and integration layers for safe parallel-domain rollout and cutover.

## Ticket Stack

### `AEGIS-019`

- Title: `Inventory and classify legacy Aeonimus references`
- Status: `Ready`
- Priority: `P0`
- Size: `M`
- Owner: `Platform`
- Stream: `Platform Identity`

Scope:

- inventory current `Aeonimus` references
- classify each as:
  - product-facing
  - domain/config
  - infrastructure/internal
  - historical docs
- define which ones rename now versus later versus never

Acceptance:

- the repo has a usable inventory of live `Aeonimus` references
- product-facing vs infrastructure references are clearly separated

### `AEGIS-020`

- Title: `Centralize Sundrop product and domain constants`
- Status: `Ready`
- Priority: `P0`
- Size: `M`
- Owner: `Web App`
- Stream: `Platform Identity`

Scope:

- define shared product/domain constants such as:
  - `SUNDROP_MUSIC_ORIGIN`
  - `SUNDROP_CLOUD_ORIGIN`
  - `SUNDROP_MUSIC_NAME`
  - `SUNDROP_CLOUD_NAME`
  - `SUNDROP_VAULT_NAME`
- replace hardcoded product/domain strings in app and server-rendered shell paths

Acceptance:

- product/domain naming is driven by shared constants rather than scattered literals

### `AEGIS-021`

- Title: `Rename product-facing UX to Sundrop branding`
- Status: `Ready`
- Priority: `P0`
- Size: `M`
- Owner: `Web App + Product`
- Stream: `Platform Identity`

Scope:

- update public shell
- update Vault-facing labels
- update signup/login
- update Control Center
- update privacy/terms and user-facing copy

Acceptance:

- live product-facing surfaces no longer present `Aeonimus` as the active brand
- Vault surfaces read as `Sundrop Vault`
- cloud/auth/admin surfaces read as `Sundrop Cloud`

### `AEGIS-022`

- Title: `Audit and replace hardcoded legacy domain links`
- Status: `Ready`
- Priority: `P0`
- Size: `M`
- Owner: `Platform`
- Stream: `Platform Identity`

Scope:

- find hardcoded old-domain links and origins
- update URL builders and deep links
- update generated operator/email/public links to use canonical config instead of literals

Acceptance:

- no critical product paths depend on hardcoded legacy domains

### `AEGIS-023`

- Title: `Prepare auth and callback integrations for dual-domain rollout`
- Status: `Backlog`
- Priority: `P0`
- Size: `L`
- Owner: `Platform + Identity`
- Stream: `Platform Identity`

Scope:

- update Firebase authorized domains
- update OAuth callback assumptions
- update email magic-link targets
- update auth redirect behavior for `sundrop.cloud`
- prepare domain-safe rollout for the split between `sundrop.music` and `sundrop.cloud`

Acceptance:

- auth and callback systems are domain-aware and ready for dual-domain validation

### `AEGIS-024`

- Title: `Stand up and validate Sundrop dual-domain routing`
- Status: `Backlog`
- Priority: `P1`
- Size: `L`
- Owner: `Platform + Ops`
- Stream: `Platform Identity`

Scope:

- stand up `sundrop.music`
- stand up `sundrop.cloud`
- validate harvest on music domain
- validate Vault/publishing/auth/admin on cloud domain

Acceptance:

- both domain families can run in parallel successfully before cutover

### `AEGIS-025`

- Title: `Cut over canonical domains and add legacy redirects`
- Status: `Backlog`
- Priority: `P1`
- Size: `L`
- Owner: `Platform + Ops`
- Stream: `Platform Identity`

Scope:

- switch canonical links to Sundrop domains
- add redirects from legacy domains
- monitor auth, export, queue, email, and publishing behavior during cutover

Acceptance:

- Sundrop domains become canonical product-facing domains
- legacy domains still resolve safely through redirect coverage

## Migration Order

1. `AEGIS-019`
2. `AEGIS-020`
3. `AEGIS-021`
4. `AEGIS-022`
5. `AEGIS-023`
6. `AEGIS-024`
7. `AEGIS-025`

## Sources

- [AEGIS_SUNDROP_NAMING_AND_DOMAIN_POLICY_2026-04-09.md](./AEGIS_SUNDROP_NAMING_AND_DOMAIN_POLICY_2026-04-09.md)
- [AEGIS_AUTH_RUNTIME_FOUNDATION_2026-04-08.md](./AEGIS_AUTH_RUNTIME_FOUNDATION_2026-04-08.md)
- [AEGIS_REGRESSION_POSTMORTEM_AND_PREVENTION_2026-04-08.md](./AEGIS_REGRESSION_POSTMORTEM_AND_PREVENTION_2026-04-08.md)
