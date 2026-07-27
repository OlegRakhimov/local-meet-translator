param(
    [Parameter(Mandatory = $true)]
    [string]$ProjectPath
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

$TestPath = Join-Path $ProjectPath 'local-meet-bridge\src\test\java\local\meettranslator\BridgeServerTest.java'
if (-not (Test-Path -LiteralPath $TestPath -PathType Leaf)) {
    throw "BridgeServerTest.java was not found: $TestPath"
}

$Utf8NoBom = New-Object System.Text.UTF8Encoding($false)
$Text = [System.IO.File]::ReadAllText($TestPath).Replace("`r`n", "`n").Replace("`r", "`n")

if ($Text.Contains('generateInterviewLearningAids(')) {
    Write-Host 'BridgeServerTest FakeAiClient already contains generateInterviewLearningAids.' -ForegroundColor Yellow
    exit 0
}

$ClassIndex = $Text.IndexOf('class FakeAiClient', [System.StringComparison]::Ordinal)
if ($ClassIndex -lt 0) {
    throw 'FakeAiClient class was not found in BridgeServerTest.java.'
}

$MethodIndex = $Text.IndexOf('public JsonNode classifyInterviewUtterance', $ClassIndex, [System.StringComparison]::Ordinal)
if ($MethodIndex -lt 0) {
    throw 'classifyInterviewUtterance method was not found after FakeAiClient.'
}

$OverrideIndex = $Text.LastIndexOf('@Override', $MethodIndex, [System.StringComparison]::Ordinal)
if ($OverrideIndex -lt $ClassIndex) {
    throw 'The @Override anchor for classifyInterviewUtterance was not found.'
}

$LineStart = $Text.LastIndexOf("`n", $OverrideIndex)
if ($LineStart -lt 0) { $LineStart = 0 } else { $LineStart += 1 }

$Method = @'
        @Override
        public com.fasterxml.jackson.databind.JsonNode generateInterviewLearningAids(
                local.meettranslator.http.RequestContext context,
                local.meettranslator.model.InterviewLearningAidsRequest request
        ) {
            var result = new com.fasterxml.jackson.databind.ObjectMapper().createObjectNode();
            result.putArray("keywords").add("backend");
            result.putArray("usefulPhrases").add("The main point is...");
            result.put("firstSentence", "The main point is...");
            return result;
        }

'@
$Method = $Method.Replace("`r`n", "`n").Replace("`r", "`n")
$Updated = $Text.Substring(0, $LineStart) + $Method + $Text.Substring($LineStart)
[System.IO.File]::WriteAllText($TestPath, $Updated, $Utf8NoBom)

Write-Host 'BridgeServerTest FakeAiClient was updated successfully.' -ForegroundColor Green
