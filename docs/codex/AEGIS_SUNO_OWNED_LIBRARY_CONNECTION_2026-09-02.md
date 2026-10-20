# SUNO Owned Library Connection Recovery

## Current State

- `genxdreams` is archived. Its retained Vault history stays available, but it is not harvested.
- `gravitystruth`, `vanessa_primary`, and `vanessa_secondary` are active.
- The nightly job and catalog publication are running.
- All active sources currently use `public_profile`, which is a partial source mode.
- Public profile results currently end on July 26 for `gravitystruth`, August 19 for `vanessa_primary`, and August 27 for `vanessa_secondary`.

## Why The Vault Cannot Advance

SUNO can keep newly created songs private or link-only. Those songs do not appear in a public profile snapshot. The current harvest can only read the public profile endpoint, so it cannot discover or verify songs that remain inside an owned SUNO Library.

The Vault must show this condition as `partial_source`, not as a fully current catalog.

## Required Connection Contract

Each active source is fully current only when it has one of these connection modes:

1. `owned_library`: a customer-authorized SUNO Library feed that returns the account's complete song list.
2. `official_export`: an AEGIS import label for a customer-authorized SUNO Library snapshot. It is not a claim that SUNO provides a formal metadata-export API.

For either mode, the connection must provide a complete snapshot, a successful timestamp, and an account identity match before `authorityStatus` is set to `verified`.

## Snapshot File Contract

The importer accepts one JSON file per SUNO account. It never combines account files.

```json
{
  "schemaVersion": 1,
  "sourceHandle": "nessihenize",
  "generatedAt": "2026-09-03T12:00:00Z",
  "clips": [
    {
      "id": "SUNO clip UUID",
      "title": "Song title",
      "createdAt": "2026-09-03T11:30:00Z",
      "audioUrl": "direct downloadable audio URL",
      "imageUrl": "optional image URL",
      "videoUrl": "optional video URL",
      "tags": "optional tags",
      "prompt": "optional prompt",
      "lyrics": "optional lyrics"
    }
  ]
}
```

Validation rejects the entire file unless the source handle matches the intended account, every song ID is unique and well-formed, every song has a creation timestamp, and every song has a direct audio URL. The first successful run imports new songs and confirms the snapshot, but does not make removal changes. A later successful snapshot is required before removal handling can activate.

The local staging command is intentionally dry-run by default. Its `--execute` mode uploads only a validated snapshot and records it against the named source:

```powershell
python stage_suno_owned_library_snapshot.py --source-id suno_nessihenize --handle nessihenize --snapshot path-to-secondary-snapshot.json --execute
```

Use a separate file and command for `unshakableechos2341` (Vanessa Primary). The account names shown to customers remain the real SUNO names, while the internal source IDs only identify the stored connection.

## Recovery Sequence

1. Connect `vanessa_primary` to an owned-library feed or import its official export manifest.
2. Connect `vanessa_secondary` separately using the same contract.
3. Verify the newest SUNO-library song identifier and creation time for each account before publishing.
4. Run harvest for each connected account individually.
5. Rebuild and publish the shared catalog only after both account runs complete.
6. Prepare account-scoped download packages after the catalog contains the newly imported rows.

## Safety Rules

- A public profile snapshot never authorizes removal changes.
- A failed or incomplete source snapshot never marks songs removed.
- A successful job only means the readable source was processed; it does not mean private-library coverage exists.
- Never combine Vanessa's two account packages. Each export remains account-scoped.
