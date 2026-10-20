$ErrorActionPreference = 'Stop'

$Project = 'stable-framing-482501-t9'
$Region = 'us-central1'
$JobName = 'suno-harvest'
$ExpectedServiceAccount = "cloud-run-jobs@$Project.iam.gserviceaccount.com"
$ProjectNumber = (gcloud projects describe $Project --format 'value(projectNumber)').Trim()
$ExpectedServiceAgent = "service-$ProjectNumber@serverless-robot-prod.iam.gserviceaccount.com"
$ExpectedEnv = @{
    PROJECT = $Project
    WORK_DIR = '/app'
    SUNO_MEDIA_BUCKET = 'gs://aeonimus-suno-media'
    WORKSPACES_BUCKET = 'gs://aeonimus-workspaces'
    HARVEST_MODE = 'delta'
}

Write-Host '======================================================'
Write-Host ' HARVEST RUNTIME VERIFY (READ ONLY)'
Write-Host " Project: $Project"
Write-Host " Region:  $Region"
Write-Host " Job:     $JobName"
Write-Host '======================================================'

Write-Host ''
Write-Host '[0/4] Checking gcloud auth in PowerShell...'
$null = gcloud auth print-access-token
Write-Host '  OK gcloud auth is active'

Write-Host ''
Write-Host '[1/4] Checking monitor secret exists...'
$null = gcloud secrets describe pipeline-monitor-config --project $Project --format 'value(name)'
Write-Host '  OK pipeline-monitor-config exists'

Write-Host ''
Write-Host '[2/4] Verifying Cloud Run service agent can read Artifact Registry...'
$projectPolicy = gcloud projects get-iam-policy $Project --format json | ConvertFrom-Json
$artifactReaderBinding = $projectPolicy.bindings | Where-Object { $_.role -eq 'roles/artifactregistry.reader' } | Select-Object -First 1
if ($null -eq $artifactReaderBinding -or -not ($artifactReaderBinding.members -contains "serviceAccount:$ExpectedServiceAgent")) {
    throw "Cloud Run service agent missing Artifact Registry reader role: $ExpectedServiceAgent"
}
Write-Host "  OK Artifact Registry reader verified for $ExpectedServiceAgent"

Write-Host ''
Write-Host '[3/4] Reading Cloud Run job config...'
$job = gcloud run jobs describe $JobName --project $Project --region $Region --format json | ConvertFrom-Json
$spec = $job.spec.template.spec.template.spec
$container = $spec.containers[0]
$envMap = @{}
foreach ($envVar in $container.env) {
    if ($envVar.name) {
        if ($null -ne $envVar.value) {
            $envMap[$envVar.name] = $envVar.value
        } else {
            $envMap[$envVar.name] = $envVar
        }
    }
}

if ($spec.serviceAccountName -ne $ExpectedServiceAccount) {
    throw "Unexpected service account: $($spec.serviceAccountName)"
}

foreach ($pair in $ExpectedEnv.GetEnumerator()) {
    if (-not $envMap.ContainsKey($pair.Key)) {
        throw "Missing env var: $($pair.Key)"
    }
    if ($envMap[$pair.Key] -ne $pair.Value) {
        throw "Env var $($pair.Key) expected '$($pair.Value)' got '$($envMap[$pair.Key])'"
    }
}

$projectValue = [string]$envMap['PROJECT']
if ($projectValue -match 'WORK_DIR=' -or $projectValue -match 'HARVEST_MODE=') {
    throw 'PROJECT env appears collapsed with other env vars'
}

$monitorRef = $container.env | Where-Object { $_.name -eq 'MONITOR_CONFIG' } | Select-Object -First 1
if ($null -eq $monitorRef) {
    throw 'MONITOR_CONFIG env binding missing'
}

$secretName = $monitorRef.valueFrom.secretKeyRef.name
$secretKey = $monitorRef.valueFrom.secretKeyRef.key
if ($secretName -ne 'pipeline-monitor-config' -or $secretKey -ne 'latest') {
    throw "Unexpected MONITOR_CONFIG binding: ${secretName}:${secretKey}"
}

Write-Host '  OK runtime service account verified'
Write-Host '  OK expected env vars verified'
Write-Host '  OK MONITOR_CONFIG secret binding verified'

Write-Host ''
Write-Host '[4/4] Latest execution snapshot...'
$latest = $job.status.latestCreatedExecution
if ($null -ne $latest) {
    Write-Host "  Latest execution: $($latest.name)"
    Write-Host "  Status:           $($latest.completionStatus)"
    Write-Host "  Created:          $($latest.creationTimestamp)"
    Write-Host "  Completed:        $($latest.completionTimestamp)"
} else {
    Write-Host '  No latest execution metadata found'
}

Write-Host ''
Write-Host '======================================================'
Write-Host ' VERIFY COMPLETE'
Write-Host '======================================================'
