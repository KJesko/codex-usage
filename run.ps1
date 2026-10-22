#requires -Version 5
# Source launcher: isolated Python environment and one small timezone dependency.
$ErrorActionPreference = 'Stop'
$projectDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$venvPython = Join-Path $projectDir '.venv\Scripts\python.exe'
if (-not (Test-Path -LiteralPath $venvPython)) {
    $systemPython = Get-Command python -ErrorAction SilentlyContinue
    $pythonArgs = @()
    $validPython = $false
    if ($systemPython) {
        & $systemPython.Source -c "import sys; sys.exit(0 if sys.version_info >= (3,10) else 1)"
        $validPython = $LASTEXITCODE -eq 0
    }
    if (-not $validPython) {
        $systemPython = Get-Command py -ErrorAction SilentlyContinue
        $pythonArgs = @('-3')
        if ($systemPython) {
            & $systemPython.Source @pythonArgs -c "import sys; sys.exit(0 if sys.version_info >= (3,10) else 1)"
            $validPython = $LASTEXITCODE -eq 0
        }
    }
    if (-not $validPython) { throw 'Python 3.10+ is required. Install Python from python.org, reopen this terminal, then retry. Both python and py -3 are supported.' }
    & $systemPython.Source @pythonArgs -m venv (Join-Path $projectDir '.venv')
    if ($LASTEXITCODE -ne 0) { throw 'Cannot create the local Python environment.' }
}
& $venvPython -c "import sys; sys.exit(0 if sys.version_info >= (3,10) else 1)"
if ($LASTEXITCODE -ne 0) { throw 'The existing .venv requires Python 3.10+. Recreate .venv with a supported Python version.' }
& $venvPython -c "import importlib.util, sys; sys.exit(0 if importlib.util.find_spec('tzdata') else 1)"
if ($LASTEXITCODE -ne 0) {
    & $venvPython -m pip install -r (Join-Path $projectDir 'requirements.txt')
    if ($LASTEXITCODE -ne 0) { throw 'Could not install timezone data.' }
}
& $venvPython (Join-Path $projectDir 'codex_usage.py') @args
exit $LASTEXITCODE
