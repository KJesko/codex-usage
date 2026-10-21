#requires -Version 5
# Source launcher: isolated Python environment and one small timezone dependency.
$ErrorActionPreference = 'Stop'
$projectDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$venvPython = Join-Path $projectDir '.venv\Scripts\python.exe'
if (-not (Test-Path -LiteralPath $venvPython)) {
    $systemPython = Get-Command python -ErrorAction SilentlyContinue
    if (-not $systemPython) { throw 'Python 3.10+ is required. Install Python and run again.' }
    & $systemPython.Source -m venv (Join-Path $projectDir '.venv')
    if ($LASTEXITCODE -ne 0) { throw 'Cannot create the local Python environment.' }
}
& $venvPython -c "import importlib.util, sys; sys.exit(0 if importlib.util.find_spec('tzdata') else 1)"
if ($LASTEXITCODE -ne 0) {
    & $venvPython -m pip install -r (Join-Path $projectDir 'requirements.txt')
    if ($LASTEXITCODE -ne 0) { throw 'Could not install timezone data.' }
}
& $venvPython (Join-Path $projectDir 'codex_usage.py') @args
exit $LASTEXITCODE
