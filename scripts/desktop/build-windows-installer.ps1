Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\.." )).Path
Set-Location (Join-Path $RepoRoot "desktop-app")
if (-not (Test-Path "node_modules")) { npm install }
npm run package:win
