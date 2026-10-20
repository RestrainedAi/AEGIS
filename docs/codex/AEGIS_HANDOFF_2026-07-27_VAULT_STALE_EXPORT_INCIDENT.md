# AEGIS Handoff — July 27, 2026 Vault Stale Export Incident

## Incident Summary

The live Vault/export went stale because the scheduled Cloud Run harvest job stopped starting after the last successful run on Thursday, July 23, 2026.

This was not a viewer-only issue and not only a source-idle issue.

The direct failure was infrastructure-level:

- Cloud Run execution failures on July 24, July 25, and July 26, 2026
- failure reason: `ContainerPermissionDenied`
- missing access: Cloud Run service agent could not read the harvest image from Artifact Registry

Affected principal:

- `service-206866140882@serverless-robot-prod.iam.gserviceaccount.com`

Affected image path:

- `us-central1-docker.pkg.dev/stable-framing-482501-t9/aeonimus-repo/harvest-job:latest`

## Evidence Before Repair

Canonical export metadata before repair:

- `generatedAt: 2026-07-23T08:46:17Z`
- `rowCount: 2586`

Recent scheduled executions observed failed:

- `suno-harvest-zvl5w`
- `suno-harvest-5mhdl`
- `suno-harvest-p979h`

## Repair Performed

Project IAM was updated to restore Artifact Registry read access:

- role granted: `roles/artifactregistry.reader`
- member: `serviceAccount:service-206866140882@serverless-robot-prod.iam.gserviceaccount.com`

Manual recovery execution started:

- `suno-harvest-52p5g`

That execution cleared the old startup failure and resumed real ingest/repair work.

## Export Recovery

Because the repair run has a long media-fix tail, the live export was manually rebuilt from current Firestore state:

- command: `python rebuild_catalog.py`

Canonical export metadata after rebuild:

- `generatedAt: 2026-07-27T03:34:14Z`
- `rowCount: 2601`

Newest visible export row after rebuild:

- `2026-07-26T02:10:05.476Z`
- `One Friend Came`
- `gravitystruth`

## Important Interpretation

The stale Vault symptom here came from two separate truths:

1. scheduled harvest executions were failing before startup
2. export refresh was downstream of a long-running repair pass, so even after Firestore began moving again, the public Vault would not advance until the pipeline reached the rebuild step

That means the product needs two protections:

1. startup failure alerting for scheduled harvest jobs
2. a controlled rebuild-from-Firestore recovery path when Firestore has advanced but a long media repair tail is still running

## Next Required Checks

1. Confirm `suno-harvest-52p5g` completes successfully.
2. Confirm the harvest job performs its own final rebuild without manual help.
3. Add a runtime verifier for Artifact Registry read access on the Cloud Run service agent.
4. Add an operator-safe documented command path for emergency export rebuild.
5. Add alerting for consecutive failed scheduled executions.

## Additional July 27 Downloads Finding

The stuck selected-songs export shown on the Downloads page is not explained by harvest freshness alone.

There is a separate viewer bug in `suno-viewer/src/components/VaultGrid.tsx`:

- when catalog export access disappears or the export endpoints return `401` / `403`
- the UI was clearing the queued jobs list
- but it was **not** clearing the primary `catalogExport` state used to render the main package card

Practical result:

- the page could still show `Packaging in progress`
- an old export card could remain visible for hours
- the same page could simultaneously show an auth/access warning banner

That combination matches the observed `music.aeonimus.info` screenshot and indicates a ghost/stale client-side export state.

Repair implemented locally:

- added `resetCatalogExportState(...)`
- clear `catalogExport`, `catalogExportJobs`, `catalogExportWorking`, and `catalogExportReadyNotice`
- invoke that reset whenever:
  - export access is unavailable
  - `/api/catalog-exports` returns `401` / `403`
  - `/api/catalog-export/:id` returns `401` / `403`

Verification completed locally:

- `npm test` in `suno-viewer` passed
- `npm run build` in `suno-viewer` passed

Deployment status:

- local fix is ready
- both `https://music.aeonimus.info/vault` and `https://sundrop.music/vault` still serve the older viewer build with `Last-Modified: Wed, 24 Jun 2026 14:15:45 GMT`
- live deployment remains blocked until `gcloud` itself is reauthenticated for project `stable-framing-482501-t9`
