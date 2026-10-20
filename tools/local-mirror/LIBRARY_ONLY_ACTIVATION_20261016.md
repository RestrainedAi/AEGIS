# Library-only receiver activation

Prepared, not activated. Thomas released the E: catalog/library update hold for
the two Vanessa accounts. Evidence registration and tagging remain outside this
release. Do not edit the global case hold or use integrate_derived40 (it publishes
an evidence handoff).

Verified installed task: `Sundrop local receipt receiver`, running
`C:\Python314\pythonw.exe` with runtime version
`20261015-derived-provenance-held/launch_receiver.py watch` and `--observe-only`.
PID observed during this review: 13224; re-resolve the exact process before any stop.
Runtime is `E:/_Vanessa sux/___Divorce/_SUNO/Vanessa-Vault-decbb81b0b4a344b/runtime`.
The existing task's logon trigger and settings must be preserved.

## Activation sequence (coordinator, after current sync is terminal)

1. Confirm the coordinator's sole current library sync has committed and verified
   its catalog. Obtain `catalogGeneratedAt` from that same pinned cloud catalog's
   verified publication metadata. Do not substitute download time or wall clock.
2. Save task XML/actions, installation.json, exact running process command,
   global hold SHA256, and a SQLite backup of state/queue.sqlite3 with integrity
   check. Stop only the exact observer task/process and temporarily disable its
   task while installing. Do not reset or delete the queue.
3. Create a new version directory `20261016-library-only` (fail if already
   present with differing bytes). Copy these reviewed repository modules:
   receiver.py, receiver_hold.py, launch_receiver.py, local_mirror.py,
   metadata_prefetch.py, evidence_handoff.py, tagging_callback.py. Save SHA256
   manifest. Do not modify the prior version or authentication directory.
4. With no sync/receiver writer active, acquire state/receiver.lock using
   local_mirror.MirrorLock. In one SQLite transaction set settings key
   `catalog_watermark` to the verified current `catalogGeneratedAt`, only if it
   is greater than or equal to the existing value, and set `catalog_sha256` to
   that same accepted frozen CSV hash in the same transaction. Record before/after values and source
   catalog generation/hash in the activation receipt. Preserve every existing
   event. Existing awaiting_evidence/awaiting_steward rows are not processing
   candidates and must remain unchanged. Inspect any preexisting blocked event:
   it deliberately prevents subsequent processing and requires explicit
   reconciliation, not blanket status reset.
5. Change only task action/installation watch and request arguments to the new
   launch_receiver.py and replace `--observe-only` with `--library-only`.
   Retain --root, --state, --auth-dir, interval/port and original trigger/settings.
   Remove --evidence-outbox and --tagging-adapter from the action as defense in
   depth. Library-only also suppresses both even if stale flags remain.
   Set installation operating_mode to `library_only_evidence_held`.
6. Release the receiver lock, enable the same scheduled task and start it.
   Confirm actual process command includes --library-only and excludes
   --observe-only. Verify hold-status.json reports library_only, library writes
   allowed, case writes false, evidence_dispatch false, tagging_dispatch false.
   The local API supports only library sync requests in this process.
7. Inspect queue progress and resulting receipt. Verified older publications
   receive superseded_library_catalog without touching library files; successful
   current/new publications receive library_synced_evidence_held.
   Exact timestamp-and-hash matches receive already_verified_library_catalog
   without requesting the catalog body or repeating media validation. Equal
   timestamps with different hashes still process. Only zero-download-failure
   successful library results establish a verified hash. Retryable
   failures still retry; unresolved source gaps are retained and not called
   complete source coverage. Verify current catalog does not regress, historical
   evidence queue rows remain unchanged, and no evidence/tagging dispatch occurs.
   Save receipt, module hashes, task/process command and preserved global-hold
   hash; update project ledger.

No separate daily local timer is needed: the resident watcher checks the small
completion index every 300 seconds and reacts after each published harvest
receipt, including offline catch-up. Daily freshness depends on daily upstream
harvest publication; this mode does not initiate a harvest.

## Rollback

Stop only the new receiver and restore the prior observer task action and
installation.json with --observe-only. Restart that observer. Preserve all queue,
receipt, library and version artifacts; do not restore an older queue/database or
overwrite committed library files. Reconcile any in-progress engine journal
before retrying writes.

## Verification

`python -m unittest discover -s tools/local-mirror -q`: 58 tests pass.
New tests exercise suppressed publish/tagging/acknowledgments, immutable old
evidence queue rows, successful watermark advancement, older-receipt skip without
library writes, unchanged global hold, and observer precedence over library-only.
