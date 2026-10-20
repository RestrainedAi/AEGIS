# One-time catch-up harvest for @nessihenize, then rely on nightly suno-harvest.
#
# Prereq (once per session):
#   gcloud auth login
#   gcloud auth application-default login
#   gcloud config set project stable-framing-482501-t9
#
# Usage (from repo root):
#   .\yt-ingest\run_nessihenize_catchup_harvest.ps1
#
# What this does:
#   1. Creates/updates sources/suno_nessihenize (seeded from vanessa_primary)
#   2. Redeploys the harvest Cloud Run job with the latest yt-ingest code
#   3. Executes a scoped harvest for handle nessihenize only (15+ clips catch-up)
#   4. Leaves nightly suno-harvest-nightly on the default all-sources delta path

$ErrorActionPreference = "Stop"

$Project = "stable-framing-482501-t9"
$Region = "us-central1"
$JobName = "suno-harvest"
$YtIngest = $PSScriptRoot

Write-Host "=== Step 1: Provision Firestore source (seeded from vanessa_primary) ==="
Push-Location $YtIngest
python .\add_source_nessihenize.py
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host ""
Write-Host "=== Step 2: Redeploy harvest job image (PowerShell / gcloud) ==="
@"
PROJECT: "$Project"
WORK_DIR: "/app"
SUNO_MEDIA_BUCKET: "gs://aeonimus-suno-media"
WORKSPACES_BUCKET: "gs://aeonimus-workspaces"
HARVEST_MODE: "delta"
"@ | Set-Content -Encoding utf8 (Join-Path $YtIngest ".harvest-job.env.yaml")

gcloud builds submit `
  --config (Join-Path $YtIngest "cloudbuild.harvest.yaml") `
  --project $Project `
  $YtIngest
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

gcloud run jobs update $JobName `
  --image "us-central1-docker.pkg.dev/$Project/aeonimus-repo/harvest-job:latest" `
  --region $Region `
  --project $Project `
  --service-account "cloud-run-jobs@$Project.iam.gserviceaccount.com" `
  --memory "2Gi" `
  --cpu "2" `
  --tasks "1" `
  --parallelism "1" `
  --max-retries "1" `
  --task-timeout "43200s" `
  --env-vars-file (Join-Path $YtIngest ".harvest-job.env.yaml") `
  --set-secrets "MONITOR_CONFIG=pipeline-monitor-config:latest"
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host ""
Write-Host "=== Step 3: Scoped catch-up harvest on Cloud Run (nessihenize only) ==="
gcloud run jobs execute $JobName `
  --project $Project `
  --region $Region `
  --update-env-vars "HARVEST_HANDLES=nessihenize,HARVEST_MODE=delta"

Write-Host ""
Write-Host "Harvest execution started."
Write-Host "Monitor:"
Write-Host "  gcloud run jobs executions list --job $JobName --region $Region --project $Project --limit 3"
Write-Host ""
Write-Host "Nightly scheduler suno-harvest-nightly will include nessihenize automatically"
Write-Host "via sources/suno_nessihenize (harvestEnabled=true) on the default all-handle run."
Pop-Location
