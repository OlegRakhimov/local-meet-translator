param(
    [Parameter(Mandatory = $true)]
    [string]$ProjectPath
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

$ScriptPath = Join-Path $PSScriptRoot 'APPLY_UPDATE.ps1'
if (-not (Test-Path -LiteralPath $ScriptPath -PathType Leaf)) {
    throw "APPLY_UPDATE.ps1 was not found: $ScriptPath"
}

$Utf8 = New-Object System.Text.UTF8Encoding($false, $true)
$Source = [System.IO.File]::ReadAllText($ScriptPath, $Utf8)
$ScriptBlock = [ScriptBlock]::Create($Source)
& $ScriptBlock -ProjectPath $ProjectPath

if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
}
