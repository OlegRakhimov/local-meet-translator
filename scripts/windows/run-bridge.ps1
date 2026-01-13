\
<#
Run the Local Meet Translator bridge on-demand (Windows).

Goals:
- Do NOT hardcode secrets in this script.
- Optionally load secrets from a local .env (ignored by git).
- If OPENAI_API_KEY is missing, prompt you to paste it for this session.

Usage (from repo root):
  powershell -ExecutionPolicy Bypass -File scripts\windows\run-bridge.ps1

Optional parameters:
  -JarPath <path>   (defaults to local-meet-bridge\target\local-meet-bridge-1.0.0.jar)
#>

param(
  [string]$JarPath = "local-meet-bridge\target\local-meet-bridge-1.0.0.jar",
  [string]$EnvFile = ".env"
)

function Write-Info($msg) {
  Write-Host $msg
}

function Load-DotEnv([string]$path) {
  if (-not (Test-Path $path)) { return }

  Write-Info "Loading $path (local only; should be git-ignored)..."
  Get-Content $path | ForEach-Object {
    $line = $_.Trim()
    if ($line.Length -eq 0) { return }
    if ($line.StartsWith("#")) { return }

    # split on first '='
    $idx = $line.IndexOf("=")
    if ($idx -lt 1) { return }

    $name = $line.Substring(0, $idx).Trim()
    $value = $line.Substring($idx + 1).Trim()

    if ($name.Length -eq 0) { return }

    # remove surrounding quotes if present
    if (($value.StartsWith('"') -and $value.EndsWith('"')) -or ($value.StartsWith("'") -and $value.EndsWith("'"))) {
      $value = $value.Substring(1, $value.Length - 2)
    }

    # set env var for this process
    [Environment]::SetEnvironmentVariable($name, $value, "Process")
  }
}

# 1) Load .env if present (optional)
Load-DotEnv $EnvFile

# 2) Ensure OPENAI_API_KEY exists
if (-not $env:OPENAI_API_KEY -or $env:OPENAI_API_KEY.Trim().Length -eq 0) {
  Write-Host "OPENAI_API_KEY is not set."
  $apiKey = Read-Host "Paste your OPENAI_API_KEY for this session"  # not saved to disk by this script
  if (-not $apiKey -or $apiKey.Trim().Length -eq 0) {
    throw "OPENAI_API_KEY is required."
  }
  $env:OPENAI_API_KEY = $apiKey.Trim()
}

# 3) Provide defaults if missing
if (-not $env:LOCAL_MEET_TRANSLATOR_PORT) { $env:LOCAL_MEET_TRANSLATOR_PORT = "8799" }
if (-not $env:LOCAL_MEET_TRANSLATOR_TOKEN -or $env:LOCAL_MEET_TRANSLATOR_TOKEN.Trim().Length -eq 0) {
  $env:LOCAL_MEET_TRANSLATOR_TOKEN = [guid]::NewGuid().ToString("N")
}
if (-not $env:OPENAI_TRANSCRIBE_MODEL) { $env:OPENAI_TRANSCRIBE_MODEL = "whisper-1" }
if (-not $env:OPENAI_TEXT_MODEL) { $env:OPENAI_TEXT_MODEL = "gpt-4o-mini" }
if (-not $env:ENABLE_TTS) { $env:ENABLE_TTS = "false" }

# 4) Basic checks
if (-not (Test-Path $JarPath)) {
  Write-Host "JAR not found: $JarPath"
  Write-Host "Build it first:"
  Write-Host "  cd local-meet-bridge"
  Write-Host "  mvn -q -DskipTests package"
  throw "Missing JAR."
}

# 5) Print connection info for extension
Write-Host ""
Write-Host "Bridge starting..."
Write-Host ("  URL:   http://127.0.0.1:{0}" -f $env:LOCAL_MEET_TRANSLATOR_PORT)
Write-Host ("  TOKEN: {0}" -f $env:LOCAL_MEET_TRANSLATOR_TOKEN)
Write-Host ""
Write-Host "Keep this window open while translating. Close it (or Ctrl+C) to stop."
Write-Host ""

# 6) Run
& java -jar $JarPath
