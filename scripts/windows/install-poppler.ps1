$ErrorActionPreference = "Stop"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$Headers = @{ "User-Agent" = "LocalMeetTranslatorBuild" }
$Release = Invoke-RestMethod -Uri "https://api.github.com/repos/oschwartz10612/poppler-windows/releases/latest" -Headers $Headers
$Asset = $Release.assets | Where-Object { $_.name -like "Release-*.zip" } | Select-Object -First 1
if (-not $Asset) { throw "Poppler Windows release ZIP was not found." }
$DownloadRoot = if ($env:RUNNER_TEMP) { $env:RUNNER_TEMP } else { $env:TEMP }
$Archive = Join-Path $DownloadRoot $Asset.name
Invoke-WebRequest -Uri $Asset.browser_download_url -OutFile $Archive -Headers $Headers -UseBasicParsing
$InstallRoot = "C:\Program Files\poppler-windows"
if (Test-Path -LiteralPath $InstallRoot) { Remove-Item -LiteralPath $InstallRoot -Recurse -Force }
New-Item -ItemType Directory -Path $InstallRoot -Force | Out-Null
Expand-Archive -LiteralPath $Archive -DestinationPath $InstallRoot -Force
$PdfToText = Get-ChildItem -LiteralPath $InstallRoot -Filter "pdftotext.exe" -File -Recurse | Select-Object -First 1
if (-not $PdfToText) { throw "pdftotext.exe was not found after Poppler extraction." }
Write-Host "Poppler executable: $($PdfToText.FullName)"
& $PdfToText.FullName -v
