param(
    [Parameter(Mandatory = $true)]
    [string]$ProjectPath
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

function Require-File {
    param([Parameter(Mandatory = $true)][string]$RelativePath)
    $Path = Join-Path $ProjectPath ($RelativePath -replace '/', '\')
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        throw "Required file is missing: $RelativePath"
    }
    return $Path
}

function Require-Text {
    param(
        [Parameter(Mandatory = $true)][string]$RelativePath,
        [Parameter(Mandatory = $true)][string[]]$Needles
    )
    $Text = [System.IO.File]::ReadAllText((Require-File $RelativePath))
    foreach ($Needle in $Needles) {
        if (-not $Text.Contains($Needle)) {
            throw "Validation failed: $RelativePath does not contain: $Needle"
        }
    }
}

if (-not (Test-Path -LiteralPath $ProjectPath -PathType Container)) {
    throw "Project directory does not exist: $ProjectPath"
}

$Package = Get-Content -LiteralPath (Require-File 'desktop-app/package.json') -Raw | ConvertFrom-Json
if ($Package.version -ne '1.0.27') {
    throw "Expected desktop source 1.0.27, found $($Package.version)"
}
if (-not $Package.scripts.'test:architecture'.Contains('validate-stage15-1-transcript-learning-aids.js')) {
    throw 'Stage 15.1 validator is not wired into npm test.'
}

foreach ($ManifestRelative in @('chrome-extension/manifest.json', 'edge-extension/manifest.json')) {
    $Manifest = Get-Content -LiteralPath (Require-File $ManifestRelative) -Raw | ConvertFrom-Json
    if ($Manifest.version -ne '1.7.5') {
        throw "Expected $ManifestRelative version 1.7.5, found $($Manifest.version)"
    }
}

Require-Text 'chrome-extension/offscreen.js' @(
    'consumeWindowStats',
    '[TRANSCRIPT DROPPED] silence detected',
    '[TRANSCRIPT DROPPED] prompt echo detected',
    'data.transcriptDropped'
)
Require-Text 'edge-extension/offscreen.js' @(
    'consumeWindowStats',
    '[TRANSCRIPT DROPPED] silence detected',
    '[TRANSCRIPT DROPPED] prompt echo detected',
    'data.transcriptDropped'
)
Require-Text 'local-meet-bridge/src/main/java/local/meettranslator/openai/EnglishExpectedRecognition.java' @(
    'TECHNICAL_TRANSCRIPTION_VOCABULARY',
    'isPromptEcho'
)
Require-Text 'local-meet-bridge/src/main/java/local/meettranslator/BridgeServer.java' @(
    'transcriptDropped',
    '/interview/generate-learning-aids'
)
Require-Text 'local-meet-bridge/src/main/java/local/meettranslator/openai/OpenAiClient.java' @(
    'generateInterviewLearningAids',
    'TECHNICAL_TRANSCRIPTION_VOCABULARY'
)
Require-Text 'desktop-app/src/main/answer-library-store.js' @('usefulPhrases')
Require-Text 'desktop-app/src/index.html' @(
    'id="answerUsefulPhrases"',
    'id="generateAnswerLearningAids"',
    'id="generateMissingLearningAids"',
    'id="trainerKeywordList"',
    'id="trainerUsefulPhraseList"',
    'guideTranscriptGuardTitle',
    'guideLearningAidsTitle',
    'guideClassifierTitle'
)
Require-Text 'desktop-app/src/renderer.js' @(
    'generateMissingLearningAidsForLibrary',
    'renderTrainerLearningAids'
)
Require-File 'desktop-app/test/learning-aids.test.js' | Out-Null
Require-File 'scripts/tests/validate-stage15-1-transcript-learning-aids.js' | Out-Null

$OldPrompt = 'English software engineering interview. Preserve Java, Kotlin, Android, API, SQL, algorithm and complexity terms. Transcribe exactly in English.'
$OpenAiText = [System.IO.File]::ReadAllText((Require-File 'local-meet-bridge/src/main/java/local/meettranslator/openai/OpenAiClient.java'))
if ($OpenAiText.Contains($OldPrompt)) {
    throw 'Old natural-language transcription prompt is still present.'
}

Write-Host 'Static Stage 15.1 validation: OK' -ForegroundColor Green

Push-Location $ProjectPath
try {
    Write-Host 'Running desktop Node.js tests...'
    Push-Location (Join-Path $ProjectPath 'desktop-app')
    try {
        & npm.cmd test
        if ($LASTEXITCODE -ne 0) { throw "npm test failed with exit code $LASTEXITCODE" }
    } finally {
        Pop-Location
    }

    Write-Host 'Running Java bridge Maven tests...'
    Push-Location (Join-Path $ProjectPath 'local-meet-bridge')
    try {
        & mvn.cmd test
        if ($LASTEXITCODE -ne 0) { throw "mvn test failed with exit code $LASTEXITCODE" }
    } finally {
        Pop-Location
    }

    Write-Host 'Checking Git whitespace...'
    & git diff --check
    if ($LASTEXITCODE -ne 0) { throw "git diff --check failed with exit code $LASTEXITCODE" }
} finally {
    Pop-Location
}

Write-Host ''
Write-Host 'Stage 15.1 verification completed successfully.' -ForegroundColor Green
