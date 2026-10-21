#requires -Version 5
param([switch]$Disable, [switch]$KeepServer, [switch]$Status)
$ErrorActionPreference = 'Stop'
$projectDir = Split-Path -Parent $PSScriptRoot
$taskName = 'CodexUsage-Web-Background'
$stateDir = Join-Path $env:USERPROFILE '.codex-usage\web-service'
$disabledFile = Join-Path $stateDir 'disabled'
$supervisor = Join-Path $PSScriptRoot 'web_supervisor.py'
$python = Join-Path $projectDir '.venv\Scripts\pythonw.exe'
New-Item -ItemType Directory -Path $stateDir -Force | Out-Null
$existing = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if ($existing -and $existing.Actions.Arguments -notcontains ('"'+$supervisor+'"')) {
    throw 'A different task already uses this name. It was not modified.'
}
if ($Status) {
    @{exists=[bool]$existing; enabled=[bool]($existing -and $existing.Settings.Enabled); state=$(if($existing){[string]$existing.State}else{'NotInstalled'})} | ConvertTo-Json -Compress
    exit
}
if ($Disable) {
    if ($existing) { Unregister-ScheduledTask -TaskName $taskName -Confirm:$false }
    if ($KeepServer) { Set-Content -LiteralPath (Join-Path $stateDir 'paused') -Value 'keep current web server' }
    Set-Content -LiteralPath $disabledFile -Value 'disabled'
    Write-Output 'Automatic startup and recovery disabled.'
    exit
}
if (-not (Test-Path -LiteralPath $python)) { throw 'Run run.ps1 first to prepare the Python environment.' }
$userId = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$action = New-ScheduledTaskAction -Execute $python -Argument ('"'+$supervisor+'"') -WorkingDirectory $projectDir
$logon = New-ScheduledTaskTrigger -AtLogOn -User $userId
$recovery = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 1)
$principal = New-ScheduledTaskPrincipal -UserId $userId -LogonType Interactive -RunLevel Limited
$options = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger @($logon,$recovery) -Principal $principal -Settings $options -Description 'Source web dashboard only: start at sign-in; recover supervisor every minute; restart exited server automatically.' -Force | Out-Null
Remove-Item -LiteralPath $disabledFile -ErrorAction SilentlyContinue
Remove-Item -LiteralPath (Join-Path $stateDir 'paused') -ErrorAction SilentlyContinue
Start-ScheduledTask -TaskName $taskName
Write-Output 'Web background service enabled. Starts at sign-in; server restarts after exit; supervisor checked every minute.'
