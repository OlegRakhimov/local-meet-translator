Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
Set-Location $RepoRoot

$BridgeDir = Join-Path $RepoRoot "local-meet-bridge"
$EnvFile = Join-Path $RepoRoot ".env"

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

if (-not $env:OPENAI_API_KEY -or $env:OPENAI_API_KEY.Trim().Length -eq 0) {
  Write-Host "OPENAI_API_KEY is not set."
  $secure = Read-Host "Paste OPENAI_API_KEY for this session (input hidden)" -AsSecureString
  $plain = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure))
  if (-not $plain -or $plain.Trim().Length -eq 0) { throw "OPENAI_API_KEY is required." }
  $env:OPENAI_API_KEY = $plain.Trim()
}

if (-not $env:LOCAL_MEET_TRANSLATOR_PORT -or $env:LOCAL_MEET_TRANSLATOR_PORT.Trim().Length -eq 0) { $env:LOCAL_MEET_TRANSLATOR_PORT = "8799" }
if (-not $env:LOCAL_MEET_TRANSLATOR_TOKEN -or $env:LOCAL_MEET_TRANSLATOR_TOKEN.Trim().Length -eq 0) { $env:LOCAL_MEET_TRANSLATOR_TOKEN = [guid]::NewGuid().ToString("N") }
if (-not $env:OPENAI_TRANSCRIBE_MODEL -or $env:OPENAI_TRANSCRIBE_MODEL.Trim().Length -eq 0) { $env:OPENAI_TRANSCRIBE_MODEL = "whisper-1" }
if (-not $env:OPENAI_TEXT_MODEL -or $env:OPENAI_TEXT_MODEL.Trim().Length -eq 0) { $env:OPENAI_TEXT_MODEL = "gpt-4o-mini" }
if (-not $env:ENABLE_TTS -or $env:ENABLE_TTS.Trim().Length -eq 0) { $env:ENABLE_TTS = "false" }

if (-not (Test-Path $BridgeDir)) { throw "Bridge folder not found: $BridgeDir" }

Write-Host ""
Write-Host "Bridge starting..."
Write-Host ("  URL:   http://127.0.0.1:{0}" -f $env:LOCAL_MEET_TRANSLATOR_PORT)
Write-Host ("  TOKEN: {0}" -f $env:LOCAL_MEET_TRANSLATOR_TOKEN)
Write-Host ""

Push-Location $BridgeDir
Write-Host "Building (Maven)..."
& mvn -q -DskipTests package
& mvn -q dependency:copy-dependencies -DincludeScope=runtime

Write-Host "Running bridge (classpath with dependencies)..."
Write-Host "Press Ctrl+C to stop."
Write-Host ""

& java -cp "target\classes;target\dependency\*" local.meettranslator.Main
Pop-Location
