param(
 [string]$Python='C:\Python314\python.exe',
 [string]$InstallRoot='E:\_Vanessa sux\___Divorce\_SUNO\Vanessa-Vault-decbb81b0b4a344b\runtime',
 [string]$Library='E:\_Vanessa sux\___Divorce\_SUNO\Vanessa-SUNO-Library',
 [string]$AuthDir='E:\_Vanessa sux\___Divorce\_SUNO\Vanessa-Vault-decbb81b0b4a344b',
 [string]$Outbox='E:\_Vanessa sux\___Divorce\_management\handoffs\suno_evidence'
)
$ErrorActionPreference='Stop'
if(Get-ScheduledTask -TaskName 'Sundrop local receipt receiver' -ErrorAction SilentlyContinue){throw 'Receiver already installed. Verify it is idle and use a separately reviewed version upgrade; do not replace a running writer.'}
if(-not (Test-Path -LiteralPath $Python)){throw 'Python runtime missing'}
if(-not (Test-Path -LiteralPath $Library)){throw 'Master library unavailable'}
if(-not (Test-Path -LiteralPath "$AuthDir\sundrop_storage_auth.py")){throw 'Canonical machine auth helper missing'}
New-Item -ItemType Directory -Path $InstallRoot -Force | Out-Null
$taskAcl=Get-Acl -LiteralPath $InstallRoot
$taskAcl.SetAccessRuleProtection($true,$false)
$taskSid=[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
foreach($taskPrincipal in @($taskSid,'S-1-5-18')){
 $taskRule=[System.Security.AccessControl.FileSystemAccessRule]::new([System.Security.Principal.SecurityIdentifier]::new($taskPrincipal),'FullControl','ContainerInherit,ObjectInherit','None','Allow')
 $taskAcl.AddAccessRule($taskRule)
}
Set-Acl -LiteralPath $InstallRoot -AclObject $taskAcl
$taskVersion=Join-Path $InstallRoot ('versions\'+(Get-Date -Format 'yyyyMMddTHHmmss'))
New-Item -ItemType Directory -Path $taskVersion | Out-Null
foreach($taskName in @('receiver.py','local_mirror.py','evidence_handoff.py','metadata_prefetch.py','tagging_callback.py','launch_receiver.py','receiver_hold.py')){
 Copy-Item -LiteralPath (Join-Path $PSScriptRoot $taskName) -Destination (Join-Path $taskVersion $taskName)
 if((Get-FileHash -LiteralPath (Join-Path $PSScriptRoot $taskName)).Hash -ne (Get-FileHash -LiteralPath (Join-Path $taskVersion $taskName)).Hash){throw 'Install copy hash mismatch'}
}
$taskState=Join-Path $InstallRoot 'state'
New-Item -ItemType Directory -Path $taskState -Force | Out-Null
$taskArgs='"'+$taskVersion+'\launch_receiver.py" watch --root "'+$Library+'" --state "'+$taskState+'" --auth-dir "'+$AuthDir+'" --evidence-outbox "'+$Outbox+'"'
$taskTagging=Join-Path (Split-Path (Split-Path $Outbox)) 'evidence_tagging\enqueue_intake.py'
if(-not (Test-Path -LiteralPath $taskTagging)){throw 'Tagging adapter missing'}
$taskArgs+=' --tagging-adapter "'+$taskTagging+'"'
$taskPythonw=Join-Path (Split-Path $Python) 'pythonw.exe'
if(-not (Test-Path -LiteralPath $taskPythonw)){throw 'pythonw required for hidden resident receiver'}
$taskAction=New-ScheduledTaskAction -Execute $taskPythonw -Argument $taskArgs -WorkingDirectory 'C:\Windows'
$taskTrigger=New-ScheduledTaskTrigger -AtLogOn -User ([System.Security.Principal.WindowsIdentity]::GetCurrent().Name)
$taskSettings=New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
Register-ScheduledTask -TaskName 'Sundrop local receipt receiver' -Action $taskAction -Trigger $taskTrigger -Settings $taskSettings -Description 'Resident receipt consumer at sign-in. No daily harvest/download schedule.' -Force | Out-Null
$taskRequestArgs='"'+$taskVersion+'\receiver.py" request --root "'+$Library+'" --state "'+$taskState+'" --auth-dir "'+$AuthDir+'"'
$taskConfig=@{python=$Python;version=$taskVersion;state=$taskState;library=$Library;auth_dir=$AuthDir;outbox=$Outbox;watch_arguments=$taskArgs;request_arguments=$taskRequestArgs;api='http://127.0.0.1:8766';credential='state/api-token';schedule='AtLogOn resident; no daily timer'}
$taskConfig | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $InstallRoot 'installation.json') -Encoding utf8
Start-ScheduledTask -TaskName 'Sundrop local receipt receiver'
Write-Output ('Installed resident receiver: '+$taskVersion)
