$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
$desktopPython = Join-Path $PSScriptRoot '.venv/Scripts/python.exe'
if (-not (Test-Path -LiteralPath $desktopPython)) {
    python -m venv .venv
    if ($LASTEXITCODE -ne 0) { throw 'Could not create Python environment.' }
}
& $desktopPython -m pip install -r requirements-desktop.txt
if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed.' }
& $desktopPython scripts/prepare_desktop.py
if ($LASTEXITCODE -ne 0) { throw 'Resource preparation failed.' }
& $desktopPython -m unittest discover -s tests -v
if ($LASTEXITCODE -ne 0) { throw 'Tests failed.' }
& $desktopPython -m PyInstaller --noconfirm --clean CodexUsage.spec
if ($LASTEXITCODE -ne 0) { throw 'Executable build failed.' }
$desktopExe = Join-Path $PSScriptRoot 'dist/CodexUsage.exe'
$desktopTest = Join-Path $PSScriptRoot 'build/desktop-self-test.json'
$desktopArgs = '--self-test "' + $desktopTest + '"'
$desktopProcess = Start-Process -FilePath $desktopExe -ArgumentList $desktopArgs -WindowStyle Hidden -PassThru
if (-not $desktopProcess.WaitForExit(60000)) {
    Stop-Process -Id $desktopProcess.Id -Force
    throw 'Packaged executable self-test timed out. Check for a startup error dialog.'
}
$desktopProcess.Refresh()
if ($desktopProcess.ExitCode -ne 0) { throw 'Packaged executable self-test failed.' }
Copy-Item -LiteralPath LICENSE, NOTICE, build/THIRD-PARTY-LICENSES.txt -Destination dist
(Get-FileHash -LiteralPath $desktopExe -Algorithm SHA256).Hash | Set-Content dist/CodexUsage.sha256
Get-FileHash -LiteralPath $desktopExe -Algorithm SHA256 | Format-List
Write-Host "Ready: $desktopExe"
