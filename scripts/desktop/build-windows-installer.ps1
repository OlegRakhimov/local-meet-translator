Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Require-Command([string]$Name) {
  $command = Get-Command $Name -ErrorAction SilentlyContinue
  if (-not $command) {
    throw "Required command '$Name' was not found in PATH."
  }
  return $command.Source
}

function Get-JavaHome([string]$JavaCommand) {
  $previousPreference = $ErrorActionPreference
  try {
    $ErrorActionPreference = "Continue"
    $settings = @(& $JavaCommand -XshowSettings:properties --version 2>&1)
    $exitCode = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previousPreference
  }
  if ($exitCode -ne 0) {
    throw "Could not inspect the Java runtime; java exited with code $exitCode."
  }
  $homeLine = @($settings | ForEach-Object { $_.ToString() } | Where-Object { $_ -match '^\s*java\.home\s*=\s*(.+?)\s*$' } | Select-Object -Last 1)
  if ($homeLine.Count -ne 1) {
    throw "Could not determine java.home from the selected Java runtime."
  }
  if ($homeLine[0] -notmatch '^\s*java\.home\s*=\s*(.+?)\s*$') {
    throw "Could not parse java.home from: $($homeLine[0])"
  }
  return $Matches[1]
}

function Invoke-External([string]$Command, [string[]]$Arguments, [string]$WorkingDirectory) {
  Push-Location $WorkingDirectory
  try {
    & $Command @Arguments
    if ($LASTEXITCODE -ne 0) {
      throw "'$Command $($Arguments -join ' ')' failed with exit code $LASTEXITCODE."
    }
  } finally {
    Pop-Location
  }
}

function Remove-DirectoryInside([string]$Parent, [string]$Target) {
  if (-not (Test-Path $Target)) {
    return
  }
  $resolvedParent = (Resolve-Path $Parent).Path
  $resolvedTarget = (Resolve-Path $Target).Path
  if (-not $resolvedTarget.StartsWith($resolvedParent + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to clean an unexpected directory: $resolvedTarget"
  }
  Remove-Item -LiteralPath $resolvedTarget -Recurse -Force
}

function Find-PdfToTextExecutable {
  $candidates = @()
  $chocolateyRoots = @("C:\ProgramData\chocolatey\lib")
  if ($env:ChocolateyInstall) { $chocolateyRoots += (Join-Path $env:ChocolateyInstall "lib") }
  $chocolateyRoots = @($chocolateyRoots | Where-Object { $_ -and (Test-Path $_ -PathType Container) } | Select-Object -Unique)

  foreach ($libraryRoot in $chocolateyRoots) {
    foreach ($packageDir in @(Get-ChildItem -LiteralPath $libraryRoot -Directory -Filter "poppler*" -ErrorAction SilentlyContinue)) {
      $candidates += @(Get-ChildItem -LiteralPath $packageDir.FullName -File -Filter "pdftotext.exe" -Recurse -ErrorAction SilentlyContinue | ForEach-Object { $_.FullName })
    }
  }

  foreach ($programRoot in @("C:\Program Files", "C:\Program Files (x86)")) {
    if (-not (Test-Path $programRoot -PathType Container)) { continue }
    foreach ($popplerDir in @(Get-ChildItem -LiteralPath $programRoot -Directory -Filter "poppler*" -ErrorAction SilentlyContinue)) {
      $candidates += @(Get-ChildItem -LiteralPath $popplerDir.FullName -File -Filter "pdftotext.exe" -Recurse -ErrorAction SilentlyContinue | ForEach-Object { $_.FullName })
    }
  }

  $pathCommand = Get-Command "pdftotext.exe" -ErrorAction SilentlyContinue
  if ($pathCommand -and $pathCommand.Source) { $candidates += $pathCommand.Source }

  foreach ($candidate in @($candidates | Where-Object { $_ } | Select-Object -Unique)) {
    if (-not (Test-Path $candidate -PathType Leaf)) { continue }
    $candidateDirectory = Split-Path -Parent $candidate
    $isChocolateyShim = $candidateDirectory -match '\\chocolatey\\bin$'
    $adjacentDll = @(Get-ChildItem -LiteralPath $candidateDirectory -File -Filter "*.dll" -ErrorAction SilentlyContinue).Count -gt 0
    if (-not $isChocolateyShim -or $adjacentDll) { return (Resolve-Path $candidate).Path }
  }

  throw "Poppler pdftotext.exe was not found. Install a compiled Windows Poppler distribution containing pdftotext.exe and adjacent DLLs."
}

function Stage-PdfToTextRuntime([string]$RepoRoot, [string]$StageDirectory) {
  $sourceExecutable = Find-PdfToTextExecutable
  $sourceDirectory = Split-Path -Parent $sourceExecutable
  New-Item -ItemType Directory -Path $StageDirectory -Force | Out-Null
  foreach ($existing in @(Get-ChildItem -LiteralPath $StageDirectory -Force -ErrorAction SilentlyContinue)) {
    if ($existing.Name -in @(".gitkeep", "README.txt")) { continue }
    Remove-Item -LiteralPath $existing.FullName -Recurse -Force
  }
  Get-ChildItem -LiteralPath $sourceDirectory -Force | Copy-Item -Destination $StageDirectory -Recurse -Force

  $distributionRoot = $sourceDirectory
  $cursor = Get-Item -LiteralPath $sourceDirectory
  for ($depth = 0; $depth -lt 8 -and $cursor; $depth += 1) {
    if ($cursor.Name -like "poppler*") { $distributionRoot = $cursor.FullName; break }
    $cursor = $cursor.Parent
  }
  $licenseDirectory = Join-Path $StageDirectory "licenses"
  New-Item -ItemType Directory -Path $licenseDirectory -Force | Out-Null
  $licenseFiles = @(Get-ChildItem -LiteralPath $distributionRoot -File -Recurse -ErrorAction SilentlyContinue | Where-Object { $_.Name -match '^(COPYING|LICENSE|NOTICE).*$' } | Select-Object -First 20)
  foreach ($license in $licenseFiles) {
    $relativeLicensePath = $license.FullName.Substring($distributionRoot.Length).TrimStart([IO.Path]::DirectorySeparatorChar, [IO.Path]::AltDirectorySeparatorChar)
    $safeName = ($relativeLicensePath -replace '[\\/:*?"<>|]', '_')
    Copy-Item -LiteralPath $license.FullName -Destination (Join-Path $licenseDirectory $safeName) -Force
  }
  if ($licenseFiles.Count -eq 0) {
    Write-Warning "No Poppler license file was found under $distributionRoot. Verify third-party notices before distribution."
  }

  $stagedExecutable = Join-Path $StageDirectory "pdftotext.exe"
  if (-not (Test-Path $stagedExecutable -PathType Leaf)) {
    throw "Poppler staging did not produce pdftotext.exe: $stagedExecutable"
  }
  Invoke-External $stagedExecutable @("-v") $StageDirectory
  return $stagedExecutable
}

$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$BridgeDir = Join-Path $RepoRoot "local-meet-bridge"
$DesktopDir = Join-Path $RepoRoot "desktop-app"
$VoiceDir = Join-Path $RepoRoot "voice-conversion"
$MavenWrapper = Join-Path $BridgeDir "mvnw.cmd"
$BridgeJar = Join-Path $BridgeDir "target\local-meet-bridge.jar"
$JavaRuntimeDir = Join-Path $BridgeDir "target\java-runtime"
$VoiceTargetDir = Join-Path $VoiceDir "target"
$VoiceBuildVenv = Join-Path $VoiceTargetDir "build-venv"
$VoiceExecutable = Join-Path $VoiceTargetDir "local-meet-voice-conversion.exe"
$VoiceBuildRequirements = Join-Path $VoiceDir "requirements-build.lock"
$FirefoxValidator = Join-Path $RepoRoot "scripts\tests\validate-firefox-extension.js"
$ChromiumValidator = Join-Path $RepoRoot "scripts\tests\validate-chromium-extension.js"
$DesktopControlsValidator = Join-Path $RepoRoot "scripts\tests\validate-desktop-controls.js"
$VoiceModeSwitchValidator = Join-Path $RepoRoot "scripts\tests\validate-voice-mode-switch.js"
$FeedbackGuardValidator = Join-Path $RepoRoot "scripts\tests\validate-feedback-guard.js"
$VoicePassthroughValidator = Join-Path $RepoRoot "scripts\tests\validate-voice-conversion-passthrough.py"
$ReleaseReadinessValidator = Join-Path $RepoRoot "scripts\tests\validate-stage10-release-readiness.js"
$DistDir = Join-Path $DesktopDir "dist"
$PdfToolStageDir = Join-Path $RepoRoot "document-tools\poppler"

$Java = Require-Command "java"
$Node = Require-Command "node"
$Npm = Require-Command "npm.cmd"
$Python = Require-Command "python"
$JavaHome = Get-JavaHome $Java
$Jdeps = Join-Path $JavaHome "bin\jdeps.exe"
$Jlink = Join-Path $JavaHome "bin\jlink.exe"

if (-not (Test-Path $Jdeps -PathType Leaf) -or -not (Test-Path $Jlink -PathType Leaf)) {
  throw "A full JDK 21 is required. jdeps or jlink was not found under java.home: $JavaHome"
}

if (-not (Test-Path $MavenWrapper -PathType Leaf)) {
  throw "Maven Wrapper was not found: $MavenWrapper"
}

$javaVersion = (& $Java --version | Select-Object -First 1)
if ($javaVersion -notmatch '\b21\.') {
  throw "Java 21 is required. Detected: $javaVersion"
}

$nodeVersion = (& $Node --version).TrimStart("v")
$nodeMajor = [int]($nodeVersion.Split(".")[0])
if ($nodeMajor -lt 20) {
  throw "Node.js 20 or newer is required. Detected: $nodeVersion"
}


Write-Host "Staging the local PDF text extraction runtime..."
$PdfToTextExecutable = Stage-PdfToTextRuntime $RepoRoot $PdfToolStageDir

Write-Host "Validating dedicated Firefox extension architecture..."
Invoke-External $Node @($FirefoxValidator) $RepoRoot
Write-Host "Validating Chromium extension architecture..."
Invoke-External $Node @($ChromiumValidator) $RepoRoot
Write-Host "Validating desktop controls initialization..."
Invoke-External $Node @($DesktopControlsValidator) $RepoRoot

Write-Host "Validating live subtitles/voice mode switching..."
Invoke-External $Node @($VoiceModeSwitchValidator) $RepoRoot
Write-Host "Validating outgoing feedback guard..."
Invoke-External $Node @($FeedbackGuardValidator) $RepoRoot
Write-Host "Validating Stage 10 release readiness..."
Invoke-External $Node @($ReleaseReadinessValidator) $RepoRoot

$pythonVersion = (& $Python --version).Trim()
if ($pythonVersion -notmatch '^Python 3\.(11|12|13)\.') {
  throw "Python 3.11, 3.12, or 3.13 is required to build the standalone voice service. Detected: $pythonVersion"
}

Write-Host "Building Java bridge with Maven Wrapper..."
Invoke-External $MavenWrapper @("--batch-mode", "--no-transfer-progress", "clean", "verify") $BridgeDir

if (-not (Test-Path $BridgeJar -PathType Leaf)) {
  throw "Maven completed without producing the expected fat JAR: $BridgeJar"
}
if ((Get-Item $BridgeJar).Length -lt 1MB) {
  throw "Bridge JAR is unexpectedly small and probably does not contain its dependencies: $BridgeJar"
}

Write-Host "Creating minimal Java runtime with jdeps and jlink..."
Push-Location $BridgeDir
try {
  $detectedModules = & $Jdeps --multi-release 21 --ignore-missing-deps --recursive --print-module-deps $BridgeJar
  if ($LASTEXITCODE -ne 0) {
    throw "jdeps failed with exit code $LASTEXITCODE."
  }
} finally {
  Pop-Location
}
$moduleLine = @($detectedModules | Where-Object { $_ -match '^[a-zA-Z0-9_.]+(?:,[a-zA-Z0-9_.]+)*$' } | Select-Object -Last 1)
if ($moduleLine.Count -ne 1) {
  throw "jdeps did not return a valid Java module list: $($detectedModules -join ' ')"
}
$javaModules = @(($moduleLine[0] -split ',') + "jdk.crypto.ec" | Sort-Object -Unique) -join ","
Invoke-External $Jlink @(
  "--add-modules", $javaModules,
  "--strip-debug",
  "--no-header-files",
  "--no-man-pages",
  "--compress=zip-6",
  "--output", $JavaRuntimeDir
) $BridgeDir

$BundledJava = Join-Path $JavaRuntimeDir "bin\java.exe"
if (-not (Test-Path $BundledJava -PathType Leaf)) {
  throw "jlink completed without producing the bundled Java executable: $BundledJava"
}
Invoke-External $BundledJava @("--version") $BridgeDir

Write-Host "Building standalone Python voice service..."
Remove-DirectoryInside $VoiceDir $VoiceTargetDir
New-Item -ItemType Directory -Path $VoiceTargetDir | Out-Null
Invoke-External $Python @("-m", "venv", $VoiceBuildVenv) $VoiceDir
$VoiceBuildPython = Join-Path $VoiceBuildVenv "Scripts\python.exe"
Invoke-External $VoiceBuildPython @(
  "-m", "pip", "install",
  "--disable-pip-version-check",
  "--no-input",
  "--requirement", $VoiceBuildRequirements
) $VoiceDir
Write-Host "Validating voice-conversion passthrough mode..."
Invoke-External $VoiceBuildPython @($VoicePassthroughValidator) $RepoRoot
Invoke-External $VoiceBuildPython @(
  "-m", "PyInstaller",
  "--noconfirm",
  "--clean",
  "--onefile",
  "--name", "local-meet-voice-conversion",
  "--collect-submodules", "uvicorn",
  "--distpath", $VoiceTargetDir,
  "--workpath", (Join-Path $VoiceTargetDir "pyinstaller-work"),
  "--specpath", $VoiceTargetDir,
  (Join-Path $VoiceDir "server.py")
) $VoiceDir

if (-not (Test-Path $VoiceExecutable -PathType Leaf)) {
  throw "PyInstaller completed without producing the voice service executable: $VoiceExecutable"
}
if ((Get-Item $VoiceExecutable).Length -lt 5MB) {
  throw "Voice service executable is unexpectedly small: $VoiceExecutable"
}
Invoke-External $VoiceExecutable @("--help") $VoiceDir

Write-Host "Installing locked Electron dependencies..."
Invoke-External $Npm @("ci", "--no-audit", "--no-fund") $DesktopDir
Write-Host "Running the complete desktop unit and architecture test suite..."
Invoke-External $Npm @("test") $DesktopDir

Remove-DirectoryInside $DesktopDir $DistDir

Write-Host "Building Windows installer..."
Invoke-External $Npm @("run", "dist:win") $DesktopDir

$installers = @(Get-ChildItem $DistDir -Filter "*-Setup-x64.exe" -File -ErrorAction SilentlyContinue)
if ($installers.Count -ne 1) {
  throw "Expected exactly one Windows installer in $DistDir, found $($installers.Count)."
}
$PackageJson = Get-Content -LiteralPath (Join-Path $DesktopDir "package.json") -Raw -Encoding UTF8 | ConvertFrom-Json
$ExpectedInstallerName = "Local Meet Translator-$($PackageJson.version)-Setup-x64.exe"
if ($installers[0].Name -ne $ExpectedInstallerName) {
  throw "Unexpected installer name. Expected '$ExpectedInstallerName', found '$($installers[0].Name)'."
}
if ($installers[0].Length -lt 100MB) {
  throw "Windows installer is unexpectedly small: $($installers[0].Length) bytes."
}

$PackagedResources = Join-Path $DistDir "win-unpacked\resources"
$PackagedJar = Join-Path $PackagedResources "local-meet-bridge\target\local-meet-bridge.jar"
$PackagedJava = Join-Path $PackagedResources "java-runtime\bin\java.exe"
$PackagedVoice = Join-Path $PackagedResources "voice-conversion\local-meet-voice-conversion.exe"
$PackagedPdfToText = Join-Path $PackagedResources "document-tools\poppler\pdftotext.exe"
$PackagedFirefox = Join-Path $PackagedResources "browser-extensions\firefox-extension"
foreach ($component in @(
  $PackagedJar,
  $PackagedJava,
  $PackagedVoice,
  $PackagedPdfToText,
  (Join-Path $PackagedFirefox "manifest.json"),
  (Join-Path $PackagedFirefox "background.js"),
  (Join-Path $PackagedFirefox "firefox_audio.js"),
  (Join-Path $PackagedFirefox "firefox_page_bridge.js"),
  (Join-Path $PackagedFirefox "firefox_page_bridge_loader.js")
)) {
  if (-not (Test-Path $component -PathType Leaf)) {
    throw "Packaged runtime component is missing: $component"
  }
}
if ((Get-FileHash $BridgeJar -Algorithm SHA256).Hash -ne (Get-FileHash $PackagedJar -Algorithm SHA256).Hash) {
  throw "The packaged bridge JAR does not match the Maven build output."
}
if ((Get-FileHash $VoiceExecutable -Algorithm SHA256).Hash -ne (Get-FileHash $PackagedVoice -Algorithm SHA256).Hash) {
  throw "The packaged voice service does not match the PyInstaller build output."
}

if ((Get-FileHash $PdfToTextExecutable -Algorithm SHA256).Hash -ne (Get-FileHash $PackagedPdfToText -Algorithm SHA256).Hash) {
  throw "The packaged pdftotext runtime does not match the staged Poppler executable."
}
Invoke-External $PackagedPdfToText @("-v") (Split-Path -Parent $PackagedPdfToText)

$InstallerHash = (Get-FileHash $installers[0].FullName -Algorithm SHA256).Hash.ToLowerInvariant()
$ShaPath = "$($installers[0].FullName).sha256"
"$InstallerHash  $($installers[0].Name)" | Set-Content -LiteralPath $ShaPath -Encoding ASCII
$ReleaseManifestPath = Join-Path $DistDir "RELEASE_MANIFEST.json"
[PSCustomObject]@{
  product = "Local Meet Translator"
  version = [string]$PackageJson.version
  generatedAt = (Get-Date).ToUniversalTime().ToString("o")
  platform = "win32"
  arch = "x64"
  installer = [PSCustomObject]@{
    name = $installers[0].Name
    sizeBytes = $installers[0].Length
    sha256 = $InstallerHash
  }
  components = [PSCustomObject]@{
    bridgeJarSha256 = (Get-FileHash $PackagedJar -Algorithm SHA256).Hash.ToLowerInvariant()
    voiceServiceSha256 = (Get-FileHash $PackagedVoice -Algorithm SHA256).Hash.ToLowerInvariant()
    bundledJava = $true
    chromeExtension = $true
    edgeExtension = $true
    firefoxExtension = $true
    documentImport = [PSCustomObject]@{
      pdf = $true
      docx = $true
      scannedPdfOcr = $false
      pdftotextSha256 = (Get-FileHash $PackagedPdfToText -Algorithm SHA256).Hash.ToLowerInvariant()
      thirdPartyNoticesIncluded = (Test-Path (Join-Path (Split-Path -Parent $PackagedPdfToText) "licenses") -PathType Container)
    }
  }
  safety = [PSCustomObject]@{
    examComplianceMode = $true
    proctoringBypass = $false
  }
  privacy = [PSCustomObject]@{
    rawAudioPersistenceDefault = $false
    diagnosticsExcludeSecrets = $true
    appDataPreservedOnUpdate = $true
  }
} | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $ReleaseManifestPath -Encoding UTF8

Write-Host ""
Write-Host "Full build completed: $($installers[0].FullName)"
Write-Host "SHA-256: $InstallerHash"
Write-Host "Release manifest: $ReleaseManifestPath"
