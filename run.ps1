#requires -Version 5
# Dev convenience launcher (runs from source without installing).
$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$app = Join-Path $here "src\claude_usage_dashboard\app.py"
$py = (Get-Command python -ErrorAction SilentlyContinue).Source
if (-not $py) { $py = (Get-Command py -ErrorAction SilentlyContinue).Source }
if (-not $py) { Write-Error "Python not found on PATH."; exit 1 }
& $py $app @args
