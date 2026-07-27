param(
    [Parameter(Mandatory = $true)]
    [string]$ProjectPath
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

function Read-JsonVersion {
    param([Parameter(Mandatory = $true)][string]$Path)
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        throw "Required JSON file was not found: $Path"
    }
    return (Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json).version
}

function Run-TestStubFix {
    $FixPath = Join-Path $PSScriptRoot 'FIX_TEST_STUB.ps1'
    if (-not (Test-Path -LiteralPath $FixPath -PathType Leaf)) {
        throw "FIX_TEST_STUB.ps1 was not found: $FixPath"
    }
    & $FixPath -ProjectPath $ProjectPath
}

if (-not (Test-Path -LiteralPath $ProjectPath -PathType Container)) {
    throw "Project directory does not exist: $ProjectPath"
}

$PackagePath = Join-Path $ProjectPath 'desktop-app\package.json'
$ChromeManifestPath = Join-Path $ProjectPath 'chrome-extension\manifest.json'
$EdgeManifestPath = Join-Path $ProjectPath 'edge-extension\manifest.json'
$ValidatorPath = Join-Path $ProjectPath 'scripts\tests\validate-stage15-1-transcript-learning-aids.js'

$DesktopVersion = Read-JsonVersion $PackagePath
$ChromeVersion = Read-JsonVersion $ChromeManifestPath
$EdgeVersion = Read-JsonVersion $EdgeManifestPath

$LooksPartiallyApplied = $DesktopVersion -eq '1.0.27' -and
    ($ChromeVersion -eq '1.7.5' -or $EdgeVersion -eq '1.7.5') -and
    -not (Test-Path -LiteralPath $ValidatorPath -PathType Leaf)

if ($LooksPartiallyApplied) {
    Write-Host 'A partial Stage 15.1 run was detected. Restoring the last pre-update backup.' -ForegroundColor Yellow

    $BackupParent = Join-Path $env:USERPROFILE 'Downloads\LocalMeetTranslatorBackups'
    $Backup = Get-ChildItem -LiteralPath $BackupParent -Directory -Filter 'stage15-1-*' -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTime -Descending |
        Where-Object {
            $CandidatePackage = Join-Path $_.FullName 'desktop-app\package.json'
            (Test-Path -LiteralPath $CandidatePackage -PathType Leaf) -and
            ((Get-Content -LiteralPath $CandidatePackage -Raw | ConvertFrom-Json).version -eq '1.0.26')
        } |
        Select-Object -First 1

    if ($null -eq $Backup) {
        throw 'No valid Stage 15.1 pre-update backup with desktop version 1.0.26 was found.'
    }

    Get-ChildItem -LiteralPath $Backup.FullName -File -Recurse |
        Where-Object { $_.Name -ne 'BACKUP_INFO.txt' } |
        ForEach-Object {
            $RelativePath = $_.FullName.Substring($Backup.FullName.Length + 1)
            $Destination = Join-Path $ProjectPath $RelativePath
            $DestinationDirectory = Split-Path -Parent $Destination
            if (-not (Test-Path -LiteralPath $DestinationDirectory -PathType Container)) {
                New-Item -ItemType Directory -Path $DestinationDirectory -Force | Out-Null
            }
            Copy-Item -LiteralPath $_.FullName -Destination $Destination -Force
        }

    foreach ($RelativePath in @(
        'desktop-app\test\learning-aids.test.js',
        'local-meet-bridge\src\main\java\local\meettranslator\model\InterviewLearningAidsRequest.java',
        'scripts\tests\validate-stage15-1-transcript-learning-aids.js'
    )) {
        $Path = Join-Path $ProjectPath $RelativePath
        if (Test-Path -LiteralPath $Path -PathType Leaf) {
            Remove-Item -LiteralPath $Path -Force
        }
    }

    $DesktopVersion = Read-JsonVersion $PackagePath
    $ChromeVersion = Read-JsonVersion $ChromeManifestPath
    $EdgeVersion = Read-JsonVersion $EdgeManifestPath

    if ($DesktopVersion -ne '1.0.26' -or $ChromeVersion -ne '1.7.4' -or $EdgeVersion -ne '1.7.4') {
        throw "Backup restoration did not return the expected baseline. Desktop=$DesktopVersion Chrome=$ChromeVersion Edge=$EdgeVersion"
    }

    Write-Host "Baseline restored from: $($Backup.FullName)" -ForegroundColor Green
}
elseif ($DesktopVersion -eq '1.0.27' -and (Test-Path -LiteralPath $ValidatorPath -PathType Leaf)) {
    Write-Host 'Stage 15.1 is already applied. Completing the bridge test-stub fix.' -ForegroundColor Yellow
    Run-TestStubFix
    exit 0
}
elseif ($DesktopVersion -ne '1.0.26') {
    throw "Stage 15.1 requires desktop source version 1.0.26. Current version: $DesktopVersion"
}

$ScriptPath = Join-Path $PSScriptRoot 'APPLY_UPDATE.ps1'
if (-not (Test-Path -LiteralPath $ScriptPath -PathType Leaf)) {
    throw "APPLY_UPDATE.ps1 was not found: $ScriptPath"
}

$Utf8 = New-Object System.Text.UTF8Encoding($false, $true)
$Source = [System.IO.File]::ReadAllText($ScriptPath, $Utf8)

# Git for Windows may check out this file with CRLF. The updater normalizes project
# files to LF before matching, so its own multiline here-strings must also use LF.
$Source = $Source.Replace("`r`n", "`n").Replace("`r", "`n")

$ScriptBlock = [ScriptBlock]::Create($Source)
& $ScriptBlock -ProjectPath $ProjectPath
Run-TestStubFix
