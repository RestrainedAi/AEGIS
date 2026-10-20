# AEGIS Delivery Board

This folder contains a lightweight repo-native kanban board for tracking AEGIS work without external tooling.

## Files

- `index.html`
  - The board UI.
- `tasks.json`
  - The task data source.

## Open It

Open [index.html](index.html) directly, or serve the folder locally with a static server if you want cleaner browser behavior. Verify the active checkout before editing board data.

Example:

```powershell
cd "C:\Users\blahn\OneDrive\Desktop\SUNO YouTube Pipeline\enviroment\AEGIS\docs\board"
python -m http.server 8088
```

Then visit [http://localhost:8088](http://localhost:8088).

## Initial Status Convention

- `Backlog`: planned, not started
- `Ready`: approved and ready to start
- `In Progress`: actively being worked
- `Review`: repo shows implementation and/or notes, but still needs validation
- `Done`: complete and validated
- `Blocked`: cannot proceed without an external dependency or decision

## Current Data Source

The initial board is seeded from:

- `docs/codex/SUNO_Youtube_Pipeline_First_Wave_Ticket_Board.md`
- `docs/codex/SUNO_Youtube_Pipeline_Implementation_Epics_and_Tickets.md`
- `docs/codex/AEGIS-001...AEGIS-007` notes

Update `tasks.json` as the source of truth for board state until a fuller delivery system replaces it.

## Feature ownership and evidence

Apply [Development DNA](../codex/DEVELOPMENT_PRINCIPLES.md). Each feature has one accountable owner. Large features have bounded specialist tasks beneath that owner; existing workstream and single-writer boundaries still apply.

Use the existing `owner`, `notes`, and `sources` fields to identify the accountable role, actual current agent assignment, dependencies, acceptance evidence, and next action. Link a [feature brief](../codex/templates/FEATURE_BRIEF.md) from `sources` for detailed assignments and handoffs. Department labels alone do not identify the current accountable agent; record that mapping when work starts. Do not add an unsupported board status or imply these notes create running agents.

- **Sequence:** name the owner and acceptance checks, order dependencies, then assign independent specialist work.
- **Conditional:** keep unfinished implementation `In Progress`, completed implementation awaiting checks `Review`, and work waiting on a specific external dependency `Blocked`.
- **Loop:** route failed acceptance checks back to their owner with evidence, a bounded retry/repair plan, and a resumption condition. Preserve completed work.

`Partial` is an outcome described in notes and the brief, not a new board status. `Done` requires the integrated feature's required acceptance checks to pass; a specialist handoff or successful job alone is insufficient. Disclose skipped, manual, or unexecuted checks and do not close tickets merely because documentation was updated.
