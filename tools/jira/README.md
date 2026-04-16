


Notes:
- Do not commit tokens to git.
- Do not paste tokens into chat.

## Run (Dry Run First)

From repo root (`D:\_ Ai Apps GPTs Automations\SUNO YouTube Pipeline\enviroment`):

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

