# Conditional post-harvest audio reconciliation

Owner: Harvest task `01a0b137-deed-7ac2-8f0f-14abf26883bf`.

Thomas requested replacing the standalone 30-minute screenshot recovery loop
with a conditional final Harvest step. The Codex automation
`verify-screenshot-songs-after-nightly-harvest` was deleted September 22.

## Sequence and boundaries

1. Existing Harvest discovers/downloads and publishes the catalog.
2. Existing publication contract checks pass.
3. `post_harvest_audio_gaps.py` inspects object metadata for the 15 known gaps.
4. Unchanged generation, size and expected duration: skip download and decode.
5. Changed small/missing object: retain blocked state without downloading it.
6. Changed substantive object: download the exact generation, check duration,
   fully decode audio and hash it. Persist evidence once for that generation.
7. Existing post-harvest monitoring records operational failures. Inspection
   failure retains prior evidence and does not launch/replay Harvest.

There is no separate schedule, browser automation, source-acquisition retry,
Firestore mutation, native-encoding certification or local-library write.
The ordinary Harvest remains responsible for acquisition; externally obtained
exports still go through the established ingestion owner. Unchanged blocked
source downloads are not retried by this step.

The seed fixture comes from the September22 exact-UUID cloud evaluation under
`C:/Users/blahn/SUNO YouTube Pipeline/screenshot-reconciliation-20260922`.
All119 screenshot identities/full-length local alternatives were already verified.
The15 native-MP3 preservation gaps remain distinct from playable replacement audio.

## Runtime and state

The helper explicitly uses Cloud Run metadata credentials, not personal ADC.
It checks only known gaps (15 metadata reads per successful publication), and
downloads at most64MiB per changed asset. Decoder calls have bounded timeouts.
Evidence persists at
`gs://aeonimus-workspaces/exports/suno/recovery/post-harvest-audio-gaps.json`
with a GCS generation-match write precondition. Local job output is
`post_harvest_audio_gaps_status.json`. Neither artifact proves Vault UI playback.
Repeated corrupt generations are skipped after their first completed validation;
service errors do not advance the saved generation.

## Validation and release status

Five focused unit tests pass: unchanged truncation, changed valid generation
checked once across runs, changed corrupt generation checked once, service error
retaining prior evidence, missing file avoiding download.

Prepared in the active checkout; NOT deployed. Current production image observed
September22 is `harvest-job@sha256:c772cc43eb965fa17e8d1b96109c66d546d343b9c79296ad47050d071c767de2`,
using `cloud-run-jobs@stable-framing-482501-t9.iam.gserviceaccount.com`.
The newest completed nightly run was `suno-harvest-qxz6f` (07:25:36Z); no running
execution was listed during this change. The active checkout contains extensive
unrelated modifications, so do not deploy its full contents as this bounded change.
Release should overlay only this helper/fixture, ffmpeg runtime dependency and
entrypoint hook onto a verified deployed base, then run the helper alone and
confirm unchanged fixtures cause zero audio downloads. Do not trigger a second
full harvest to verify this change. Restore the prior image digest on regression.

## September23 scope correction and delivery acceptance

Thomas requires standalone sundrop.music to own BOTH conditional gap reconciliation and the local E: mirror. The local owner reports deletion of update-vanessa-suno-master-library; the screenshot half-hour automation was already deleted. No replacement periodic agent task is authorized.

Required delivery: durable Harvest completion record keyed by run ID; a Windows machine-auth consumer retains pending completions while this PC is unavailable; exactly-once observable integration through idempotent run-ID handling and the existing exclusive evidence lock; additive full mirror/version/hash/catalog/evidence updates; explicit one-off entry point through the same sync path; result paths/status returned to the originating project and Steward. Cloud cannot directly write E:. check_daily.py only detects differences and is not a complete sync runner. Keep310gap rows unresolved until individually verified.

Implementation status: the15-gap cloud helper is local/tested and not deployed. Completion delivery, Windows consumer, full mirror runner and one-off end-to-end acceptance are NOT implemented/verified. Harvest task01a0b137-deed-7ac2-8f0f-14abf26883bf coordinates this expanded work; local-library task01a0a158-3b0a-7760-88e9-cbe86118582d retains local evidence writing until an explicit handoff. Direct Node filesystem/process access works despite shell bridge failure.
