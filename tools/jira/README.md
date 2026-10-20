


# Jira planning import

Apply [Development DNA](../../docs/codex/DEVELOPMENT_PRINCIPLES.md) and [workstream ownership](../../docs/codex/AEGIS_Workstream_Ownership_And_Change_Control.md). Each feature needs one accountable owner, bounded specialist tasks for large features, dependency order, and observable acceptance checks. Link the [feature brief](../../docs/codex/templates/FEATURE_BRIEF.md) when planning text needs more detail than the issue fields support.

Local plans and dry-run output do not prove that Jira issues exist. Preserve the dry-run-first workflow, use existing user authorization for external writes, and record actual created/updated issue identifiers and results after an authorized import. Do not infer that this tool instantiates agents or transfers all planning fields; inspect its payload and verify the imported issue.

Notes:
- Do not commit tokens to git.
- Do not paste tokens into chat.

## Run (Dry Run First)

From the verified active repo root (`C:\Users\blahn\OneDrive\Desktop\SUNO YouTube Pipeline\enviroment\AEGIS`):

```powershell
python tools/jira/seed_jira_from_docs.py --dry-run
```

If the preview looks right, run it for real:

```powershell
python tools/jira/seed_jira_from_docs.py
```

## Idempotency

The script is conservative:
- It searches by exact summary match in the target project and skips issues that already exist.
