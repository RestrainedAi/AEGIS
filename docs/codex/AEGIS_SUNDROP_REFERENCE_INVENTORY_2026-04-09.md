# AEGIS Sundrop Reference Inventory

## Summary

This document is the first-pass inventory for `AEGIS-019`.

Revalidated on 2026-05-05 against the current `suno-viewer` app and server code.

It separates remaining `Aeonimus` references into four classes:

- product-facing
- domain/config
- infrastructure/internal
- historical documentation

The purpose is to prevent a dangerous global search-and-replace and instead migrate the active product safely.

## Product-Facing References

These should be renamed now or are already in active rename scope.

Status update as of 2026-05-05:

- shared branding constants are now live
- browser titles and major public-shell naming have been moved to `Sundrop`
- the legacy `/vanessa` surface has been reduced to a compatibility redirect to `/vault`
- the export-ready, beta-approval, and operator-review email links now resolve through canonical cloud-origin config instead of hardcoded legacy product URLs
- no remaining hardcoded `music.aeonimus.info` product links were found in the active `suno-viewer` client code
- remaining work is now concentrated in auth callbacks, authorized-domain rollout, and external routing rather than broad product-copy cleanup

### Live app and shell surfaces

- `suno-viewer/index.html`
  - browser title is now aligned to `Sundrop Vault`
- `suno-viewer/server.js`
  - app shell naming is now driven from shared branding config
  - legacy workspace naming is now `Sundrop Legacy Workspace`
- `suno-viewer/src/components/VaultGrid.tsx`
  - Vault header is now aligned to `Sundrop Vault`
  - old `/vanessa` URL prefilter behavior has been removed
- `suno-viewer/src/components/SignupPage.tsx`
  - signup copy is now aligned to `Sundrop Cloud`
- `suno-viewer/src/App.tsx`
  - public shell is now aligned to `Sundrop Cloud`
  - legacy `/vanessa` browser-title treatment has been removed
- `suno-viewer/src/components/AdminControlCenter.tsx`
  - Control Center is now visually aligned to the dark Sundrop/Vault shell instead of the older cream admin style
- `suno-viewer/branding.config.json`
  - canonical `sundrop.cloud` and `sundrop.music` origins are defined in shared branding config
- `suno-viewer/server.js`
  - customer-facing Vault and Control Center email links now derive from configured cloud origin rather than legacy literals

### User/session/UI keys

- `suno-viewer/src/lib/firebaseAuth.tsx`
  - email-link storage key still used `aeonimus-vault-email-link`
- `suno-viewer/src/components/AudioPlayer.tsx`
  - active-player event key still used `aeonimus:vault-audio-active`

These are internal browser keys, but they were safe to migrate and are now updated as part of the product renaming wave.

## Domain / Config References

These should be abstracted behind shared constants/config before domain cutover.

- canonical product-facing origins now exist in shared config:
  - `sundrop.cloud`
  - `sundrop.music`
- app/server naming is largely driven from shared branding config, but the broader migration still needs:
  - Firebase authorized-domain updates
  - OAuth callback validation
  - email magic-link target validation
  - DNS and reverse-proxy cutover validation
  - explicit rollout proof that `sundrop.music` and `sundrop.cloud` can run in parallel safely

This is the scope of `AEGIS-020` and `AEGIS-022`.

## Infrastructure / Internal References

These should **not** be renamed automatically.

Examples currently in live code/config:

- GCS bucket names such as:
  - `aeonimus-workspaces`
  - `aeonimus-suno-media`
- export and lyric artifact URLs under those buckets
- historical Cloud Run / Artifact Registry naming that still carries `aeonimus`
- approved-identity/bootstrap config values such as:
  - `aeonimusai@gmail.com`

These names may remain temporarily legacy without harming the live product brand.

Any infrastructure rename should be handled later as a dedicated migration with rollback planning.

## Historical Documentation References

These should generally remain historically accurate.

Examples:

- incident notes
- runtime validation notes
- handoff docs
- old workflow specs

If a historical document describes a real past state under `Aeonimus`, keep that reference and optionally annotate that the current naming system is now `Sundrop Music` / `Sundrop Cloud`.

## Immediate Action Set

### Rename now

- user-facing app names
- browser titles
- signup/login wording
- Vault shell wording
- Control Center wording
- browser-side keys that include `Aeonimus`
- shared product/domain constants
- hardcoded customer-facing links in notification emails and download-center copy

### Leave for later

- bucket names
- media object paths
- Artifact Registry paths
- Cloud Run service names
- bootstrap/admin identity values where renaming is not product-facing
- historical docs that record real prior state

## Ticket Mapping

- `AEGIS-019`
  - inventory and classification
- `AEGIS-020`
  - shared product/domain constants
- `AEGIS-021`
  - user-facing product renaming
- `AEGIS-022`
  - hardcoded domain link audit
