# Local mirror engine

`sync_catalog(root, catalog_bytes, run_id, transport)` consumes frozen Vault CSV
bytes. `transport.inspect(url)` returns `{generation, size, md5}` and
`transport.fetch(url, generation)` returns `(bytes, response_headers)`. The built-in
`SecureGcsTransport(allowed_buckets, token_provider)` requires an explicitly
configured machine-token callable, uses only canonical GCS URLs, rejects redirects,
and never discovers personal credentials. The owning scheduler supplies the frozen
catalog and unique run ID after harvest completion.
Ordinary receipt/index GET uses `transport(url)`. A 401 refreshes the machine token
once through `token_provider(True)`; repeated 401, 403, or unavailable token provider
stops the whole run with a sanitized machine-authentication blocker.

Two established source IDs are selected, including hidden rows. Existing song folder
paths are reused. New songs use a stable songKey directory. Changed assets go into
`Versions/<run_id>`; existing files and derivative inventory records are retained.
Every download requires Content-Length and GCS MD5, plus local SHA256 readback.
Objects without GCS MD5 remain failures for manual review. Byte integrity does not
establish playable or complete media. Historical gap rows are deliberately retained,
even when new native bytes arrive; the content-validation owner resolves those gaps.
Distinct optional `gcs_latest_audio`, `gcs_latest_mp4`, and `gcs_latest_thumb` references
are preserved too; empty optional references do not create gaps. External-only URLs
are reported with absent native references, not downloaded by this cloud transport.
Missing/corrupt local baselines are reported and recovered into a version directory;
corrupt originals and old inventory rows remain preserved.

Authenticated HEAD requests discover object generation, size and MD5. The engine
fully hashes each existing local inventory asset and checks its recorded SHA256 and
size. Matching cloud MD5 and size skip the object body, including first baseline
adoption. Changed content is downloaded with generation and ifGenerationMatch query
constraints and the response generation/size/MD5 must match the inspected object.
`Catalog/local-mirror-source-state.json` durably records successful URL generations,
local paths, SHA256, size and MD5. Failures never advance that object's state.

The engine holds an exclusive local lock for the entire run, preserves frozen input,
maintains durable per-asset receipts, stages generated catalogs/index, and verifies
backups before replacing each generated file atomically. Replacement of the full
set is **not** a filesystem transaction. An interrupted commit returns `interrupted`
with `retryable=true`; a hard kill may leave `committing`. The next invocation verifies
every target equals its recorded before or staged hash, verifies backups/staged bytes
and saved native files, and finishes only the remaining replacements. Unknown edits
return `blocked` with a conflict path and require inspected reconciliation. Precommit
restart with the same frozen input and run ID rehashes and reuses saved native assets.
Partial/corrupt writes are preserved and block for inspection. The kernel-held lock
releases when the process dies; its marker file stays in place.
All participating local writers must honor this lock; historical scripts do not.
Unchanged/absent/error observations checkpoint every 100 results or 10 seconds,
whichever comes first; acquisition write intent and saved native bytes always force
a durable checkpoint. `progress.json` is a compact status at each checkpoint. A crash
may repeat up to one observation batch but does not discard saved acquisition intent.
Before download and native write, available disk must cover the object plus a 10 GiB
reserve (override with keyword `min_free_bytes`). Insufficient reserve blocks the run
before fetching the body. Referenced-object 404s remain unresolved permanent failures;
only timeout, 429 and 5xx failures contribute to `retryable_failure_count`.

`evidence-handoff.json` records acquired hashes, immutable staged generated paths and
hashes, and backup location.
Canonical evidence SQLite and the evidence register are never written. Existing
`verification.json` remains unchanged; this run's receipt is the only new verification
claim. The generated index provides search, links latest inventory assets, and labels derivatives.
Older index/catalog bytes are preserved in run backups.

The transport loads one object into memory, with a default 512 MiB maximum and
90-second request timeout. Runs perform one metadata request per referenced object
and only download bytes differing from the verified local baseline. Full local
readback still costs disk I/O. There is no polling,
cloud mutation, source deletion propagation, media derivation, or scheduler here.

Run offline checks: `python -m unittest discover -s tools/local-mirror -v`.
Production downloads, actual master mutation, machine authentication, evidence
registration, and customer-facing production behavior require separate verification.
# Evidence tagging callback

The receiver accepts `--tagging-adapter` pointing to the existing Divorce
`_management/evidence_tagging/enqueue_intake.py`. After publishing a verified
handoff it invokes the adapter with priority 5, verifies the returned queue's
manifest hash and item count, and saves `tagging-callback.json` beside the
handoff. Repeated publication reuses this receipt. Failed callbacks remain
visible in receiver status and retry during acknowledgment checks without
repeating acquisition. Tagging enqueue does not constitute canonical acceptance.

September 28 verification: 34 local tests passed; the actual 16-item handoff
returned `already_queued`. The upgraded hidden receiver responded HTTP 200 and
recorded the callback. Task Scheduler startup remains unverified after an
invalid-directory error; the current process was started directly.
