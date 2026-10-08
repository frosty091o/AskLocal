$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot
py -3 scripts/manage.py setup @args
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
