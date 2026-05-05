Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\.." )).Path
Set-Location $RepoRoot

$VoiceDir = Join-Path $RepoRoot "voice-conversion"
$EnvFile  = Join-Path $RepoRoot ".env"

function Load-DotEnv([string]$path) {
  if (-not (Test-Path $path)) { return }
  Write-Host "Loading $path (local only; should be git-ignored)..."
  Get-Content $path | ForEach-Object {
    $line = $_.Trim()
    if ($line.Length -eq 0) { return }
    if ($line.StartsWith("#")) { return }
    $idx = $line.IndexOf("=")
    if ($idx -lt 1) { return }

    $name = $line.Substring(0, $idx).Trim()
    $value = $line.Substring($idx + 1).Trim()

    if (($value.StartsWith('"') -and $value.EndsWith('"')) -or ($value.StartsWith("'") -and $value.EndsWith("'"))) {
      $value = $value.Substring(1, $value.Length - 2)
    }
    [Environment]::SetEnvironmentVariable($name, $value, "Process")
  }
}

Load-DotEnv $EnvFile

if (-not (Test-Path $VoiceDir)) { throw "voice-conversion folder not found: $VoiceDir" }

# Defaults
if (-not $env:VOICE_CONVERSION_HOST -or $env:VOICE_CONVERSION_HOST.Trim().Length -eq 0) { $env:VOICE_CONVERSION_HOST = "127.0.0.1" }
if (-not $env:VOICE_CONVERSION_PORT -or $env:VOICE_CONVERSION_PORT.Trim().Length -eq 0) { $env:VOICE_CONVERSION_PORT = "18799" }

# Ensure Python exists
$py = Get-Command python -ErrorAction SilentlyContinue
if (-not $py) {
  throw "Python not found in PATH. Install Python 3.10+ and retry."
}

Push-Location $VoiceDir

# Create venv (local) for repeatable installs
$VenvDir = Join-Path $VoiceDir ".venv"
$VenvPy  = Join-Path $VenvDir "Scripts\python.exe"

if (-not (Test-Path $VenvPy)) {
  Write-Host "Creating venv (.venv)..."
  & python -m venv .venv
}

Write-Host "Installing dependencies..."
& $VenvPy -m pip install --disable-pip-version-check -q -r requirements.txt

Write-Host ""
Write-Host "Voice conversion service starting..."
Write-Host ("  URL: http://{0}:{1}" -f $env:VOICE_CONVERSION_HOST, $env:VOICE_CONVERSION_PORT)
if ($env:RVC_INFER_CMD -and $env:RVC_INFER_CMD.Trim().Length -gt 0) {
  Write-Host "  Mode: RVC_INFER_CMD enabled"
} else {
  Write-Host "  Mode: passthrough (set RVC_INFER_CMD to enable conversion)"
}
Write-Host "Press Ctrl+C to stop."
Write-Host ""

& $VenvPy -m uvicorn server:app --host $env:VOICE_CONVERSION_HOST --port ([int]$env:VOICE_CONVERSION_PORT)

Pop-Location
