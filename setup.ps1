$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot
py -3 scripts/manage.py setup
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
