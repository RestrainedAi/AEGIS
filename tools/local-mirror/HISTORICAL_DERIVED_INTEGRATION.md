# Exact 40 historical listening copies: integration handoff

Owner: Cadence coordinator. Canonical evidence writer/acceptance: Anchor after the
required bounded release; VP independently accepts the outcome. This packet is
prepared code and a procedure, not a live integration or dispatch receipt.

## Inspected scope

Plan: `E:/_Vanessa sux/___Divorce/_SUNO/Vanessa-Vault-decbb81b0b4a344b/runtime/latest20-audit-20261014/cloud-repair-plan.json`.
The plan contains 40 unique songs: 39 `suno_nessihenize`, one
`suno_unshakableechos2341`. All 40 already have `local_folder` values in the master
catalog. Three derived inventory entries already exist within this scope; reuse
verified existing bytes or preserve distinct prior versions, never overwrite them.
At inspection the master held 17,312 historical gap rows, including 136 rows for
these songs. Those inventory totals are distinct from the 33 remaining native audio
gaps in the repair plan. Do not close native MP3 gaps because listening copies exist.
Cloud journals were still advancing during inspection; require all 40 verified
final records rather than using the interim count as completion evidence.

## Gates and authoritative locks

The existing `ANCHOR_ACCEPTANCE_REQUIREMENTS_20261014.json` in that audit directory
records the POC1 general-case/scheduled-trigger pause: no further dispatch/new records
or external action without exact release. The canonical maintenance flag remains
`PAUSED` at `_management/trial_preparation/2026-10-05/search/CATALOG_MAINTENANCE_PAUSED.json`.
Its recorded owner is Relay under VP. Cadence's production repair authority does not
itself release case integration. Coordinator/Steward must obtain the exact bounded
release; Anchor remains read-only until it applies. Do not silently edit either hold.

The installed receiver is selected by
`E:/_Vanessa sux/___Divorce/_SUNO/Vanessa-Vault-decbb81b0b4a344b/runtime/installation.json`:
currently `runtime/versions/20260929-host-visible-hashes`. Changing repository files
does not update that installed runtime. Its shared writer lock is
`runtime/state/receiver.lock` (OS byte-range lock). The engine lock is
`Vanessa-SUNO-Library/Catalog/Maintenance/.local-mirror.lock` (OS byte-range lock).
Coordinate receiver ownership, take those locks through existing implementations,
and never clear a live lease or create a second scheduler. The local sync API
`http://127.0.0.1:8766/sync` requests a full current catalog; it is **not** the bounded
40-song procedure below.

Only Anchor acquires `_catalog/evidence/.evidence.lock` through `evidence_catalog.lock`
after release. Cadence does not acquire it for staging and never edits canonical
SQLite, baseline IDs, acknowledgments, frozen indexes, or evidence-register.csv.

## Ordered procedure after release and owner authorization

1. Coordinator finishes the exact 40 cloud journals, rebuilds/freezes the authoritative
   catalog, and independently verifies customer playback/derived labels. No new source
   harvest is required by this procedure. Verify the repaired catalog preserves native
   `gcs_mp3`, selects distinct `gcs_latest_audio`, and supplies `audio_asset_role`,
   `audio_original_url`, and `audio_provenance_url` for each selected song.
2. Freeze a subset CSV using only the exact plan UUID set; assert 40 distinct rows,
   matching accounts, no extra IDs, and label `derived-from-video`. Retain the complete
   source catalog separately with its hash. Review/promote the tested local engine and
   handoff adapter into the installed receiver version before any receiver uses the
   new catalog. Preserve the prior installed runtime.
3. Under the coordinated receiver single-writer boundary, call the existing Python
   API `sync_catalog(master_root, frozen_subset_bytes, unique_run_id, machine_transport)`.
   This merges the 40 records with the existing master rows, keeps all historical gaps,
   reuses existing song folders, preserves originals, and writes listening copies as
   `derived_mp3_from_video` beneath `Derived/` (or a preserved version path). It stores
   the generation/hash-verified provenance sidecar separately. This call mutates the
   master, so do not execute it before the release above.
4. Inspect the result: exactly the intended derivative set acquired or unchanged;
   native/source-video hashes and generations match provenance; no malformed provenance,
   unexpected account/song, baseline mutation, or unresolved acquisition failure is
   silently accepted. Inventory/receipt totals and the 33 unresolved native gaps stay
   separate. Open local index search and sample exact derivative/native links.
5. After dispatch is permitted, call existing `evidence_handoff.publish(root, result,
   outbox)` with outbox `_management/handoffs/suno_evidence`. It publishes immutable
   `suno-evidence-handoff/1`: derivative role, `native_original=false`, `derived_from`
   relationship to preserved local video, separate original MP3, sidecar, and immutable
   before/staged catalogs. Do not call publish while the no-dispatch hold applies.
6. Supply Anchor the exact packet hash plus plan/journal/source-video generation
   receipts, actual transformation command/tool version and full-decode receipts.
   The cloud sidecar alone does not contain every transformation/decoder acceptance
   detail. Reconcile the two duration discrepancies identified in Anchor's requirement
   packet separately. No evidence ID is invented by Cadence.
7. Anchor verifies disk sizes/hashes and parent mapping, applies its authorized bounded
   canonical transaction, reads mappings back, checks protected rows and exports, then
   issues the numbered acknowledgment. `read_ack()` must return `ACCEPTED` for the
   exact immutable packet; `STAGED`, `RECEIVED`, and `DEFERRED_HOLD` remain unfinished.
   Coordinator passes the exact mapping/receipt to Steward/VP for their separate
   relevance/use and independent acceptance checkpoints.

## Prepared code and verification

`local_mirror.py` rejects unlabeled derived selections, replaced native aliases,
malformed/mismatched sidecars and parent/derived hashes or generations. Derivative
bytes are never given a native inventory kind. `evidence_handoff.py` rejects a derived
source presented as native and checks preserved originals/parent linkage.
`test_derived_delivery.py` covers separate originals and derivative paths, retained
native gaps, immutable handoff relationships, repeat sync, malformed provenance,
changed derivative bytes and native-role mislabeling. All fixtures use temporary
libraries and fake transport; no cloud, master, hold, or canonical evidence changes.
