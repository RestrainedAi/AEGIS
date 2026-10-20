# Receiver promotion: observer-only under the unchanged case hold

Prepared for Cadence coordinator; not yet activated by this specialist.

## Verified state

- Authoritative scheduled task: `Sundrop local receipt receiver`; prior live PID 12784
  launched `runtime/versions/20260929-host-visible-hashes/launch_receiver.py watch`.
- That exact task is now **Disabled** and PID 12784 is absent. No receiver pythonw
  process remained in the post-stop check.
- Preserved task XML, installation JSON, command/PID record, and consistent read-only
  SQLite backup under `runtime/promotion-20261015-derived-hold/`. SQLite quick_check
  passed; all 23 queue events were awaiting_evidence; no pending/running acquisition.
- Candidate: `runtime/versions/20261015-derived-provenance-held/`. All seven runtime
  file hashes are recorded in `promotion-20261015-derived-hold/candidate-manifest.json`.
- Changes versus the installed version: local_mirror.py +85/-7 lines;
  evidence_handoff.py +28/-5; launch_receiver.py +3; added receiver_hold.py.
  receiver.py, metadata_prefetch.py, tagging_callback.py are byte-identical.
- Candidate test suite: 48 passed. Tests use temporary fixtures/fake transport.
  The suite also needs repository yt-ingest/tools helper modules on PYTHONPATH.
- Candidate launcher `once --observe-only` was run against the real root/state.
  It exited 0 and wrote only runtime observation/log output. `state/hold-status.json`
  confirms case_writes_allowed=false, receiver_processing=false,
  evidence_dispatch=false, sync_api_enabled=false. Case hold remains PAUSED.

## Why watcher activation is safe only in observer mode

The new launcher evaluates the hold before importing receiver/auth/queue code.
`--observe-only` is permanent for that process lifetime. It writes a compact
hold-status.json once a minute; it does not discover receipts, open/migrate the queue,
download media, integrate the master, dispatch handoffs, refresh acknowledgments,
invoke tagging, or open the sync HTTP API. Even changing the hold file cannot release
that process. Hold-file errors/missing status fail closed. A normal held watch also
stays an observer until a separate explicit restart. `receiver.py` remains a lower-
level implementation; use the guarded launcher for operational invocation.

## Coordinator execution after reviewing the hash manifest

The existing installer is for a new installation, not this upgrade. Do not run it.
The following is the narrow action switch; it preserves existing task triggers,
credentials, settings, queue and previous runtime. No cloud command is involved.

```powershell
$runtime = 'E:\_Vanessa sux\___Divorce\_SUNO\Vanessa-Vault-decbb81b0b4a344b\runtime'
$snapshot = Join-Path $runtime 'promotion-20261015-derived-hold'
$candidate = Join-Path $runtime 'versions\20261015-derived-provenance-held'
$manifest = Get-Content -LiteralPath (Join-Path $snapshot 'candidate-manifest.json') -Raw | ConvertFrom-Json
foreach ($entry in $manifest.files) {
  if ((Get-FileHash -LiteralPath $entry.candidate -Algorithm SHA256).Hash.ToLowerInvariant() -ne $entry.sha256) { throw 'Candidate changed after review' }
}
$task = Get-ScheduledTask -TaskName 'Sundrop local receipt receiver'
if ($task.State -ne 'Disabled') { throw 'Reconcile receiver state before promotion' }
$config = Get-Content -LiteralPath (Join-Path $snapshot 'installation-before.json') -Raw | ConvertFrom-Json
$watch = $config.watch_arguments.Replace($config.version, $candidate) + ' --observe-only'
$action = New-ScheduledTaskAction -Execute $task.Actions[0].Execute -Argument $watch -WorkingDirectory $task.Actions[0].WorkingDirectory
Set-ScheduledTask -TaskName $task.TaskName -Action $action | Out-Null
$config.version = $candidate
$config.watch_arguments = $watch
$config.request_arguments = $config.request_arguments.Replace($manifest.before_version, $candidate).Replace('\receiver.py"', '\launch_receiver.py"') + ' --observe-only'
$config | Add-Member -NotePropertyName operating_mode -NotePropertyValue 'observe_only_case_hold' -Force
$config | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $runtime 'installation.json') -Encoding utf8
Enable-ScheduledTask -TaskName $task.TaskName | Out-Null
Start-ScheduledTask -TaskName $task.TaskName
```

Afterward verify the new pythonw command includes the exact candidate path and
`--observe-only`, the task is Running, and hold-status.json advances with all three
write/dispatch/API booleans false. Record the actual process, task action, candidate
hashes and hold observation in the existing promotion snapshot. Do not claim master
integration from this observer startup. Do not send a `/sync` request.

## Rollback and activation boundary

If observer startup fails, stop/disable only this task. Preserve its logs and candidate.
The original version, `task-before.xml`, `installation-before.json`, and queue snapshot
remain available. Restore action/config if needed while keeping the task Disabled;
**never restart the old unguarded receiver under PAUSED**. Queue restoration is not
needed for code rollback and must not overwrite newer state.

Full case processing requires separate exact authorization/release for the master,
dispatch, canonical integration and current POC hold. Removing `--observe-only` or
marking a hold RELEASED is outside this promotion. Anchor remains the sole canonical
writer; its numbered acceptance is still required. No hold file was modified here.
