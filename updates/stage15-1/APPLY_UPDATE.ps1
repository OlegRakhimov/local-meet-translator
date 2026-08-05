param(
    [Parameter(Mandatory = $true)]
    [string]$ProjectPath
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'
$Utf8NoBom = New-Object System.Text.UTF8Encoding($false)

function Resolve-ProjectFile {
    param([Parameter(Mandatory = $true)][string]$RelativePath)
    return Join-Path $ProjectPath ($RelativePath -replace '/', '\')
}

function Read-ProjectText {
    param([Parameter(Mandatory = $true)][string]$RelativePath)
    $Path = Resolve-ProjectFile $RelativePath
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        throw "Required file is missing: $RelativePath"
    }
    return ([System.IO.File]::ReadAllText($Path)).Replace("`r`n", "`n").Replace("`r", "`n")
}

function Write-ProjectText {
    param(
        [Parameter(Mandatory = $true)][string]$RelativePath,
        [Parameter(Mandatory = $true)][string]$Content
    )
    $Path = Resolve-ProjectFile $RelativePath
    $Directory = Split-Path -Parent $Path
    if (-not (Test-Path -LiteralPath $Directory -PathType Container)) {
        New-Item -ItemType Directory -Path $Directory -Force | Out-Null
    }
    $Normalized = $Content.Replace("`r`n", "`n").Replace("`r", "`n")
    [System.IO.File]::WriteAllText($Path, $Normalized, $Utf8NoBom)
}

function Replace-ExactOnce {
    param(
        [Parameter(Mandatory = $true)][string]$RelativePath,
        [Parameter(Mandatory = $true)][string]$Old,
        [Parameter(Mandatory = $true)][string]$New
    )
    $Text = Read-ProjectText $RelativePath
    if ($Text.Contains($New) -and -not $Text.Contains($Old)) {
        Write-Host "Already patched: $RelativePath" -ForegroundColor DarkGray
        return
    }
    $Index = $Text.IndexOf($Old, [System.StringComparison]::Ordinal)
    if ($Index -lt 0) {
        throw "Patch anchor was not found in $RelativePath"
    }
    $Second = $Text.IndexOf($Old, $Index + $Old.Length, [System.StringComparison]::Ordinal)
    if ($Second -ge 0) {
        throw "Patch anchor occurs more than once in $RelativePath"
    }
    $Result = $Text.Substring(0, $Index) + $New + $Text.Substring($Index + $Old.Length)
    Write-ProjectText $RelativePath $Result
}

function Replace-AllExact {
    param(
        [Parameter(Mandatory = $true)][string]$RelativePath,
        [Parameter(Mandatory = $true)][string]$Old,
        [Parameter(Mandatory = $true)][string]$New
    )
    $Text = Read-ProjectText $RelativePath
    if (-not $Text.Contains($Old)) {
        if ($Text.Contains($New)) {
            Write-Host "Already patched: $RelativePath" -ForegroundColor DarkGray
            return
        }
        throw "Patch anchor was not found in $RelativePath"
    }
    Write-ProjectText $RelativePath ($Text.Replace($Old, $New))
}

function Replace-RegexOnce {
    param(
        [Parameter(Mandatory = $true)][string]$RelativePath,
        [Parameter(Mandatory = $true)][string]$Pattern,
        [Parameter(Mandatory = $true)][string]$Replacement
    )
    $Text = Read-ProjectText $RelativePath
    $Regex = New-Object System.Text.RegularExpressions.Regex(
        $Pattern,
        [System.Text.RegularExpressions.RegexOptions]::Singleline
    )
    $Matches = $Regex.Matches($Text)
    if ($Matches.Count -ne 1) {
        throw "Expected exactly one regex match in $RelativePath, found $($Matches.Count)."
    }
    $Evaluator = [System.Text.RegularExpressions.MatchEvaluator]{
        param($Match)
        return $Replacement
    }
    Write-ProjectText $RelativePath ($Regex.Replace($Text, $Evaluator, 1))
}

if (-not (Test-Path -LiteralPath $ProjectPath -PathType Container)) {
    throw "Project directory does not exist: $ProjectPath"
}

$PackagePath = Resolve-ProjectFile 'desktop-app/package.json'
$Package = Get-Content -LiteralPath $PackagePath -Raw | ConvertFrom-Json
if ($Package.version -eq '1.0.27') {
    Write-Host 'Stage 15.1 already appears to be applied. Run VERIFY_UPDATE.ps1.' -ForegroundColor Yellow
    exit 0
}
if ($Package.version -ne '1.0.26') {
    throw "Stage 15.1 requires desktop source version 1.0.26. Current version: $($Package.version)"
}

foreach ($ManifestRelative in @('chrome-extension/manifest.json', 'edge-extension/manifest.json')) {
    $Manifest = Get-Content -LiteralPath (Resolve-ProjectFile $ManifestRelative) -Raw | ConvertFrom-Json
    if ($Manifest.version -ne '1.7.4') {
        throw "Stage 15.1 requires $ManifestRelative version 1.7.4. Current version: $($Manifest.version)"
    }
}

$ChangedFiles = @(
    'desktop-app/package.json',
    'desktop-app/package-lock.json',
    'desktop-app/src/index.html',
    'desktop-app/src/renderer.js',
    'desktop-app/src/i18n.js',
    'desktop-app/src/main.js',
    'desktop-app/src/preload.js',
    'desktop-app/src/main/answer-library-store.js',
    'desktop-app/src/main/answer-matcher.js',
    'desktop-app/test/learning-aids.test.js',
    'chrome-extension/manifest.json',
    'chrome-extension/offscreen.js',
    'edge-extension/manifest.json',
    'edge-extension/offscreen.js',
    'local-meet-bridge/src/main/java/local/meettranslator/BridgeServer.java',
    'local-meet-bridge/src/main/java/local/meettranslator/model/InterviewLearningAidsRequest.java',
    'local-meet-bridge/src/main/java/local/meettranslator/openai/AiClient.java',
    'local-meet-bridge/src/main/java/local/meettranslator/openai/OpenAiClient.java',
    'local-meet-bridge/src/main/java/local/meettranslator/openai/EnglishExpectedRecognition.java',
    'scripts/tests/validate-stage15-1-transcript-learning-aids.js'
)

$BackupRoot = Join-Path $env:USERPROFILE ('Downloads\LocalMeetTranslatorBackups\stage15-1-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
New-Item -ItemType Directory -Path $BackupRoot -Force | Out-Null
foreach ($RelativePath in $ChangedFiles) {
    $Source = Resolve-ProjectFile $RelativePath
    if (-not (Test-Path -LiteralPath $Source -PathType Leaf)) { continue }
    $Destination = Join-Path $BackupRoot ($RelativePath -replace '/', '\')
    New-Item -ItemType Directory -Path (Split-Path -Parent $Destination) -Force | Out-Null
    Copy-Item -LiteralPath $Source -Destination $Destination -Force
}
@(
    'Stage 15.1 backup',
    "Created: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')",
    "Project: $ProjectPath",
    'Baseline desktop: 1.0.26',
    'Baseline Chromium extensions: 1.7.4'
) | Set-Content -LiteralPath (Join-Path $BackupRoot 'BACKUP_INFO.txt') -Encoding UTF8
Write-Host "Backup created: $BackupRoot" -ForegroundColor Cyan

Replace-ExactOnce 'desktop-app/package.json' '"version": "1.0.26"' '"version": "1.0.27"'
Replace-ExactOnce 'desktop-app/package.json' 'node ../scripts/tests/validate-stage15-contextual-utterance-dispatcher.js"' 'node ../scripts/tests/validate-stage15-contextual-utterance-dispatcher.js && node ../scripts/tests/validate-stage15-1-transcript-learning-aids.js"'
Replace-AllExact 'desktop-app/package-lock.json' '"version": "1.0.26"' '"version": "1.0.27"'
Replace-ExactOnce 'chrome-extension/manifest.json' '"version": "1.7.4"' '"version": "1.7.5"'
Replace-ExactOnce 'edge-extension/manifest.json' '"version": "1.7.4"' '"version": "1.7.5"'

$LevelMeter = @'
function createLevelMeter(stream) {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return null;

    const ctx = new AudioCtx();
    const src = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    src.connect(analyser);

    const buf = new Uint8Array(analyser.fftSize);
    let rms = 0;
    let peak = 0;
    let windowPeak = 0;
    let windowSum = 0;
    let windowSamples = 0;
    let windowSpeechSamples = 0;

    const timer = setInterval(() => {
      try {
        analyser.getByteTimeDomainData(buf);
        let sum = 0;
        for (let i = 0; i < buf.length; i++) {
          const v = (buf[i] - 128) / 128;
          sum += v * v;
        }
        rms = Math.sqrt(sum / buf.length);
        peak = Math.max(rms, peak * 0.85);
        windowPeak = Math.max(windowPeak, rms);
        windowSum += rms;
        windowSamples += 1;
        if (rms >= VAD_THRESHOLD) windowSpeechSamples += 1;
      } catch (_) {
        // ignore
      }
    }, 200);

    return {
      getRms: () => rms,
      getPeak: () => peak,
      consumeWindowStats: () => {
        const samples = windowSamples;
        const stats = {
          peak: windowPeak,
          average: samples ? windowSum / samples : 0,
          samples,
          speechSamples: windowSpeechSamples,
          speechRatio: samples ? windowSpeechSamples / samples : 0
        };
        peak = 0;
        windowPeak = 0;
        windowSum = 0;
        windowSamples = 0;
        windowSpeechSamples = 0;
        return stats;
      },
      stop: () => {
        try { clearInterval(timer); } catch (_) {}
        try { src.disconnect(); } catch (_) {}
        try { analyser.disconnect(); } catch (_) {}
        try { ctx.close(); } catch (_) {}
      }
    };
  } catch (_) {
    return null;
  }
}

function createTabAudioMonitor
'@

$OldVad = @'
const VAD_ENABLED = true;
const VAD_THRESHOLD = 0.015; // RMS in [0..1] (heuristic) for incoming tab audio
const MIN_AUDIO_BLOB_BYTES = 900;
'@
$NewVad = @'
const VAD_ENABLED = true;
const VAD_THRESHOLD = 0.010;
const TAB_MIN_AVERAGE_RMS = 0.0025;
const TAB_MIN_SPEECH_RATIO = 0.06;
const MIN_AUDIO_BLOB_BYTES = 900;
'@
$OldTabGate = @'
    if (VAD_ENABLED && tabMeter && tabMeter.getPeak() < VAD_THRESHOLD) {
      // Skip likely silence chunks to reduce random hallucinations.
      return;
    }
'@
$NewTabGate = @'
    if (VAD_ENABLED && tabMeter) {
      const stats = typeof tabMeter.consumeWindowStats === "function"
        ? tabMeter.consumeWindowStats()
        : { peak: tabMeter.getPeak(), average: tabMeter.getRms(), samples: 1, speechRatio: tabMeter.getPeak() >= VAD_THRESHOLD ? 1 : 0 };
      const silent = stats.samples < 2
        || stats.peak < VAD_THRESHOLD
        || (stats.average < TAB_MIN_AVERAGE_RMS && stats.speechRatio < TAB_MIN_SPEECH_RATIO);
      if (silent) {
        status("run", "Transcript guard", "[TRANSCRIPT DROPPED] silence detected");
        return;
      }
    }
'@
$OldResponseMetadata = @'
    if (data.transcriptionRetried) {
      status("run", "English expected", "Automatic strict-English retry was used for this audio chunk.");
    }
'@
$NewResponseMetadata = @'
    if (data.transcriptDropped) {
      const reason = String(data.dropReason || "").toLowerCase();
      const message = reason === "prompt-echo"
        ? "[TRANSCRIPT DROPPED] prompt echo detected"
        : "[TRANSCRIPT DROPPED] no speech detected";
      status("run", "Transcript guard", message);
      return null;
    }
    if (data.transcriptionRetried) {
      status("run", "English expected", "Automatic strict-English retry was used for this audio chunk.");
    }
'@

foreach ($Runtime in @('chrome-extension/offscreen.js', 'edge-extension/offscreen.js')) {
    Replace-ExactOnce $Runtime $OldVad $NewVad
    Replace-RegexOnce $Runtime 'function createLevelMeter\(stream\) \{.*?\n\}\n\s*function createTabAudioMonitor' $LevelMeter
    Replace-ExactOnce $Runtime $OldTabGate $NewTabGate
    Replace-ExactOnce $Runtime $OldResponseMetadata $NewResponseMetadata
}

$EnglishRecognition = @'
package local.meettranslator.openai;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Objects;
import java.util.Set;

public final class EnglishExpectedRecognition {
    public static final String MODE = "en-expected";
    public static final String RETRY_MODE = "en-retry";
    public static final String TECHNICAL_TRANSCRIPTION_VOCABULARY =
            "Java, Kotlin, Android, API, REST, JWT, SQL, PostgreSQL, Docker, algorithm, complexity";

    private static final Set<String> VOCABULARY_TOKENS = Set.of(
            "java", "kotlin", "android", "api", "rest", "jwt", "sql", "postgresql", "docker", "algorithm", "complexity"
    );
    private static final Set<String> PROMPT_META_TOKENS = Set.of(
            "english", "software", "engineering", "interview", "preserve", "terms", "transcribe", "exactly"
    );

    private EnglishExpectedRecognition() {
    }

    public static boolean isExpectedMode(String sourceLang) {
        return MODE.equals(normalize(sourceLang));
    }

    public static boolean isRetryMode(String sourceLang) {
        return RETRY_MODE.equals(normalize(sourceLang));
    }

    public static String translationSourceLanguage(String sourceLang) {
        return isExpectedMode(sourceLang) || isRetryMode(sourceLang) ? "en" : Objects.requireNonNullElse(sourceLang, "auto");
    }

    public static boolean shouldRetry(String transcript) {
        String text = Objects.requireNonNullElse(transcript, "").trim();
        if (text.isBlank()) return true;
        if (isPromptEcho(text)) return true;

        int letters = 0;
        int latinLetters = 0;
        int nonLatinLetters = 0;
        int replacementCharacters = 0;
        for (int index = 0; index < text.length();) {
            int codePoint = text.codePointAt(index);
            index += Character.charCount(codePoint);
            if (codePoint == 0xfffd) replacementCharacters += 1;
            if (!Character.isLetter(codePoint)) continue;
            letters += 1;
            if (Character.UnicodeScript.of(codePoint) == Character.UnicodeScript.LATIN) latinLetters += 1;
            else nonLatinLetters += 1;
        }

        if (replacementCharacters > 0) return true;
        if (letters == 0) return text.length() > 4;
        if (nonLatinLetters >= 2 && nonLatinLetters * 5 >= letters) return true;
        return latinLetters * 100 < letters * 78;
    }

    public static String chooseBetterCandidate(String automaticTranscript, String strictEnglishTranscript) {
        String automatic = Objects.requireNonNullElse(automaticTranscript, "").trim();
        String strict = Objects.requireNonNullElse(strictEnglishTranscript, "").trim();
        boolean automaticEcho = isPromptEcho(automatic);
        boolean strictEcho = isPromptEcho(strict);
        if (automaticEcho && strictEcho) return "";
        if (automaticEcho) return strict;
        if (strictEcho) return automatic;
        if (strict.isBlank()) return automatic;
        if (automatic.isBlank()) return strict;
        int automaticScore = englishScore(automatic);
        int strictScore = englishScore(strict);
        return strictScore >= automaticScore ? strict : automatic;
    }

    public static boolean isPromptEcho(String transcript) {
        String normalized = normalizeWords(transcript);
        if (normalized.isBlank()) return false;
        if (normalized.contains("english software engineering interview")) return true;
        if (normalized.contains("preserve java kotlin android api sql")) return true;
        if (normalized.contains("transcribe exactly in english")) return true;
        if (normalized.contains("интервью по программной инженерии")) return true;
        if (normalized.contains("сохраните термины java kotlin android")) return true;
        if (normalized.contains("транскрибируйте точно на английском")) return true;

        List<String> tokens = wordTokens(normalized);
        if (tokens.isEmpty()) return false;
        Set<String> unique = new HashSet<>(tokens);
        int vocabularyMatches = 0;
        int metaMatches = 0;
        for (String token : unique) {
            if (VOCABULARY_TOKENS.contains(token)) vocabularyMatches += 1;
            if (PROMPT_META_TOKENS.contains(token)) metaMatches += 1;
        }
        if (metaMatches >= 3 && unique.size() <= 24) return true;
        return unique.size() >= 5
                && unique.size() <= VOCABULARY_TOKENS.size() + 3
                && vocabularyMatches >= 5
                && vocabularyMatches * 100 >= unique.size() * 75;
    }

    static int englishScore(String text) {
        int score = 0;
        int letters = 0;
        int latin = 0;
        int nonLatin = 0;
        int words = 0;
        boolean insideWord = false;
        for (int index = 0; index < text.length();) {
            int codePoint = text.codePointAt(index);
            index += Character.charCount(codePoint);
            if (Character.isLetter(codePoint)) {
                letters += 1;
                if (!insideWord) words += 1;
                insideWord = true;
                if (Character.UnicodeScript.of(codePoint) == Character.UnicodeScript.LATIN) latin += 1;
                else nonLatin += 1;
            } else {
                insideWord = false;
                if (codePoint == 0xfffd) score -= 30;
            }
        }
        score += latin * 3;
        score -= nonLatin * 9;
        score += Math.min(words, 20) * 2;
        if (letters > 0 && latin * 100 >= letters * 90) score += 20;
        return score;
    }

    private static List<String> wordTokens(String normalized) {
        List<String> result = new ArrayList<>();
        for (String token : normalized.split("\\s+")) {
            if (!token.isBlank()) result.add(token);
        }
        return result;
    }

    private static String normalizeWords(String value) {
        return normalize(value)
                .replaceAll("[^\\p{L}\\p{N}]+", " ")
                .replaceAll("\\s+", " ")
                .trim();
    }

    private static String normalize(String value) {
        return Objects.requireNonNullElse(value, "").trim().toLowerCase(Locale.ROOT);
    }
}
'@
Write-ProjectText 'local-meet-bridge/src/main/java/local/meettranslator/openai/EnglishExpectedRecognition.java' $EnglishRecognition

$LearningRequest = @'
package local.meettranslator.model;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import local.meettranslator.http.ApiException;

public record InterviewLearningAidsRequest(
        String question,
        String answer,
        String firstSentence,
        ArrayNode existingKeywords,
        ArrayNode existingUsefulPhrases,
        String languageLevel
) {
    private static final ObjectMapper MAPPER = new ObjectMapper();

    public static InterviewLearningAidsRequest from(JsonNode json) {
        if (json == null || !json.isObject()) {
            throw new ApiException(400, "invalid_request", "Request body must be a JSON object.");
        }
        return new InterviewLearningAidsRequest(
                JsonContract.requiredText(json, "question", 4_000),
                JsonContract.text(json, "answer", "", 30_000),
                JsonContract.text(json, "firstSentence", "", 3_000),
                stringArrayCopy(json.get("existingKeywords"), "existingKeywords", 80, 20_000),
                stringArrayCopy(json.get("existingUsefulPhrases"), "existingUsefulPhrases", 80, 30_000),
                JsonContract.text(json, "languageLevel", "B1", 16)
        );
    }

    private static ArrayNode stringArrayCopy(JsonNode value, String field, int maxItems, int maxSerializedLength) {
        ArrayNode result = MAPPER.createArrayNode();
        if (value == null || value.isNull()) return result;
        if (!value.isArray()) throw invalid(field, "must be an array");
        if (value.size() > maxItems) throw invalid(field, "contains too many items");
        if (value.toString().length() > maxSerializedLength) throw invalid(field, "is too large");
        for (JsonNode item : value) {
            if (!item.isTextual()) throw invalid(field, "must contain strings only");
            String text = item.asText().trim();
            if (!text.isBlank()) result.add(text);
        }
        return result;
    }

    private static ApiException invalid(String field, String detail) {
        return new ApiException(400, "invalid_request", field + " " + detail);
    }
}
'@
Write-ProjectText 'local-meet-bridge/src/main/java/local/meettranslator/model/InterviewLearningAidsRequest.java' $LearningRequest

Replace-ExactOnce 'local-meet-bridge/src/main/java/local/meettranslator/openai/AiClient.java' 'import local.meettranslator.model.InterviewSuggestionRequest;
import local.meettranslator.model.InterviewUtteranceClassificationRequest;' 'import local.meettranslator.model.InterviewLearningAidsRequest;
import local.meettranslator.model.InterviewSuggestionRequest;
import local.meettranslator.model.InterviewUtteranceClassificationRequest;'
Replace-ExactOnce 'local-meet-bridge/src/main/java/local/meettranslator/openai/AiClient.java' '    JsonNode suggestInterviewAnswer(RequestContext context, InterviewSuggestionRequest request) throws IOException;

    JsonNode classifyInterviewUtterance' '    JsonNode suggestInterviewAnswer(RequestContext context, InterviewSuggestionRequest request) throws IOException;

    JsonNode generateInterviewLearningAids(RequestContext context, InterviewLearningAidsRequest request) throws IOException;

    JsonNode classifyInterviewUtterance'

Replace-ExactOnce 'local-meet-bridge/src/main/java/local/meettranslator/openai/OpenAiClient.java' 'import local.meettranslator.model.InterviewSuggestionRequest;
import local.meettranslator.model.InterviewUtteranceClassificationRequest;' 'import local.meettranslator.model.InterviewLearningAidsRequest;
import local.meettranslator.model.InterviewSuggestionRequest;
import local.meettranslator.model.InterviewUtteranceClassificationRequest;'
Replace-ExactOnce 'local-meet-bridge/src/main/java/local/meettranslator/openai/OpenAiClient.java' '            writePart(output, boundary, "prompt", "English software engineering interview. Preserve Java, Kotlin, Android, API, SQL, algorithm and complexity terms. Transcribe exactly in English.");' '            writePart(output, boundary, "prompt", EnglishExpectedRecognition.TECHNICAL_TRANSCRIPTION_VOCABULARY);'

$LearningAidsMethod = @'
    @Override
    public JsonNode generateInterviewLearningAids(RequestContext context, InterviewLearningAidsRequest request) throws IOException {
        var body = MAPPER.createObjectNode()
                .put("model", config.textModel())
                .put("instructions", "Create compact learning aids for one reviewed interview question. Preserve reviewed factual content. Do not invent candidate experience. Return English technical terms and reusable English speaking phrases with Russian translations. Phrases must be scaffolding, not a replacement full answer. Return no prose outside the required JSON schema.")
                .put("input", buildLearningAidsPrompt(request))
                .put("store", false)
                .put("temperature", 0);
        body.set("text", MAPPER.createObjectNode().set("format", MAPPER.createObjectNode()
                .put("type", "json_schema")
                .put("name", "interview_learning_aids")
                .put("strict", true)
                .set("schema", buildLearningAidsSchema())));
        HttpRequest httpRequest = HttpRequest.newBuilder()
                .uri(URI.create(config.baseUrl() + "/v1/responses"))
                .timeout(Duration.ofSeconds(75))
                .header("Authorization", "Bearer " + config.apiKey())
                .header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofByteArray(MAPPER.writeValueAsBytes(body)))
                .build();
        HttpResponse<byte[]> response = context.await(http.sendAsync(httpRequest, HttpResponse.BodyHandlers.ofByteArray()));
        ensureSuccess("OpenAI interview learning aids", response);
        String output = extractOutputText(MAPPER.readTree(response.body()));
        if (output.isBlank()) throw new IOException("OpenAI learning aids returned no output text");
        JsonNode learningAids;
        try {
            learningAids = MAPPER.readTree(output);
        } catch (Exception cause) {
            throw new IOException("OpenAI learning aids returned invalid structured JSON", cause);
        }
        return validateLearningAids(learningAids);
    }

    private static String buildLearningAidsPrompt(InterviewLearningAidsRequest request) throws IOException {
        var context = MAPPER.createObjectNode();
        context.put("question", request.question());
        context.put("reviewedAnswer", request.answer());
        context.put("existingFirstSentence", request.firstSentence());
        context.put("languageLevel", request.languageLevel());
        context.set("existingKeywords", request.existingKeywords());
        context.set("existingUsefulPhrases", request.existingUsefulPhrases());
        return "Generate missing or improved study metadata.\n"
                + "Rules:\n"
                + "1. keywords: 5 to 10 question-specific technical concepts. Format each as 'English term — Russian translation'.\n"
                + "2. usefulPhrases: 4 to 8 reusable English sentence starters or linking phrases for answering this exact question. Format each as 'English phrase — Russian translation'.\n"
                + "3. firstSentence: one natural English opening sentence for the requested level. Keep a reviewed existing first sentence when it is already good.\n"
                + "4. Do not copy the complete answer into usefulPhrases.\n"
                + "5. Do not add unsupported personal claims.\n\n"
                + "Context JSON:\n" + MAPPER.writeValueAsString(context);
    }

    private static JsonNode buildLearningAidsSchema() {
        var properties = MAPPER.createObjectNode();
        properties.set("keywords", stringArraySchema(10));
        properties.set("usefulPhrases", stringArraySchema(8));
        properties.set("firstSentence", MAPPER.createObjectNode().put("type", "string"));
        var root = MAPPER.createObjectNode().put("type", "object").put("additionalProperties", false);
        root.set("properties", properties);
        root.set("required", MAPPER.createArrayNode().add("keywords").add("usefulPhrases").add("firstSentence"));
        return root;
    }

    private static JsonNode validateLearningAids(JsonNode learningAids) throws IOException {
        if (learningAids == null || !learningAids.isObject()) throw new IOException("Learning aids must be a JSON object");
        if (!learningAids.path("keywords").isArray()) throw new IOException("Learning aids keywords are invalid");
        if (!learningAids.path("usefulPhrases").isArray()) throw new IOException("Learning aids usefulPhrases are invalid");
        if (!learningAids.path("firstSentence").isTextual()) throw new IOException("Learning aids firstSentence is invalid");
        return learningAids;
    }

'@
Replace-ExactOnce 'local-meet-bridge/src/main/java/local/meettranslator/openai/OpenAiClient.java' '    @Override
    public JsonNode classifyInterviewUtterance' ($LearningAidsMethod + '    @Override
    public JsonNode classifyInterviewUtterance')

Replace-ExactOnce 'local-meet-bridge/src/main/java/local/meettranslator/BridgeServer.java' 'import local.meettranslator.model.TranscribeAndTranslateRequest;
import local.meettranslator.model.InterviewSuggestionRequest;' 'import local.meettranslator.model.TranscribeAndTranslateRequest;
import local.meettranslator.model.InterviewLearningAidsRequest;
import local.meettranslator.model.InterviewSuggestionRequest;'

$TranscribeRoute = @'
        server.createContext("/transcribe-and-translate", exchange -> HttpSupport.handle(exchange, "POST", config.authToken(), requestRegistry, (ex, context) -> {
            TranscribeAndTranslateRequest request = TranscribeAndTranslateRequest.from(HttpSupport.readJsonBody(ex, 12_000_000));
            boolean englishExpected = EnglishExpectedRecognition.isExpectedMode(request.sourceLang());
            boolean transcriptionRetried = false;
            boolean promptEchoDetected = false;
            boolean transcriptDropped = false;
            String dropReason = "";
            String transcript;
            try {
                String firstPassLanguage = englishExpected ? "auto" : request.sourceLang();
                transcript = aiClient.transcribe(context, request.audio(), request.audioMime(), firstPassLanguage);
                promptEchoDetected = EnglishExpectedRecognition.isPromptEcho(transcript);
                if (englishExpected && EnglishExpectedRecognition.shouldRetry(transcript)) {
                    transcriptionRetried = true;
                    try {
                        String strictEnglish = aiClient.transcribe(context, request.audio(), request.audioMime(), EnglishExpectedRecognition.RETRY_MODE);
                        promptEchoDetected = promptEchoDetected || EnglishExpectedRecognition.isPromptEcho(strictEnglish);
                        transcript = EnglishExpectedRecognition.chooseBetterCandidate(transcript, strictEnglish);
                    } catch (IOException retryFailure) {
                        if (transcript == null || transcript.isBlank()) throw retryFailure;
                    }
                }
            } catch (IOException cause) {
                throw HttpSupport.upstream("openai_transcription_failed", cause);
            }
            if (EnglishExpectedRecognition.isPromptEcho(transcript)
                    || ((transcript == null || transcript.isBlank()) && promptEchoDetected)) {
                transcript = "";
                transcriptDropped = true;
                dropReason = "prompt-echo";
            }
            String translation = "";
            String translationSourceLanguage = EnglishExpectedRecognition.translationSourceLanguage(request.sourceLang());
            if (transcript != null && !transcript.isBlank()) {
                try {
                    translation = aiClient.translateText(context, translationSourceLanguage, request.targetLang(), transcript);
                } catch (IOException cause) {
                    throw HttpSupport.upstream("openai_translation_failed", cause);
                }
            }
            HttpSupport.writeJson(ex, 200, HttpSupport.MAPPER.createObjectNode()
                    .put("audioMime", request.audioMime())
                    .put("sourceLang", request.sourceLang())
                    .put("effectiveSourceLang", translationSourceLanguage)
                    .put("recognitionMode", englishExpected ? EnglishExpectedRecognition.MODE : request.sourceLang())
                    .put("transcriptionRetried", transcriptionRetried)
                    .put("transcriptDropped", transcriptDropped)
                    .put("dropReason", dropReason)
                    .put("targetLang", request.targetLang())
                    .put("transcript", Objects.requireNonNullElse(transcript, ""))
                    .put("translation", translation), context.requestId());
        }));
'@
Replace-RegexOnce 'local-meet-bridge/src/main/java/local/meettranslator/BridgeServer.java' '        server\.createContext\("/transcribe-and-translate".*?\n        \}\)\);\n\n(?=        server\.createContext\("/interview/suggest-answer")' ($TranscribeRoute + "`n")

$LearningRoute = @'
        server.createContext("/interview/generate-learning-aids", exchange -> HttpSupport.handle(exchange, "POST", config.authToken(), requestRegistry, (ex, context) -> {
            InterviewLearningAidsRequest request = InterviewLearningAidsRequest.from(HttpSupport.readJsonBody(ex, 1_500_000));
            com.fasterxml.jackson.databind.JsonNode learningAids;
            try {
                learningAids = aiClient.generateInterviewLearningAids(context, request);
            } catch (IOException cause) {
                throw HttpSupport.upstream("openai_interview_learning_aids_failed", cause);
            }
            HttpSupport.writeJson(ex, 200, HttpSupport.MAPPER.createObjectNode()
                    .put("ok", true)
                    .set("learningAids", learningAids), context.requestId());
        }));

'@
Replace-ExactOnce 'local-meet-bridge/src/main/java/local/meettranslator/BridgeServer.java' '        server.createContext("/interview/suggest-answer"' ($LearningRoute + '        server.createContext("/interview/suggest-answer"')

Replace-ExactOnce 'desktop-app/src/main/answer-library-store.js' 'const SCHEMA_VERSION = 1;' 'const SCHEMA_VERSION = 2;'
Replace-ExactOnce 'desktop-app/src/main/answer-library-store.js' '    keywords: uniqueLines(source.keywords, 80),
    groundingFacts:' '    keywords: uniqueLines(source.keywords, 80),
    usefulPhrases: uniqueLines(source.usefulPhrases, 80),
    groundingFacts:'

Replace-ExactOnce 'desktop-app/src/main/answer-matcher.js' 'function overlapScore(queryTokens, candidateTokens) {' 'function englishSide(value) {
  return String(value || "").split(/\s+(?:—|–|-)\s+/)[0].trim();
}

function overlapScore(queryTokens, candidateTokens) {'
$OldScore = @'
  const keywordTokens = meaningfulTokens(Array.isArray(entry.keywords) ? entry.keywords.join(' ') : entry.keywords || '');
  const intentTokens = meaningfulTokens(entry.intent || '');
  let score = overlapScore(queryTokens, savedTokens) * 0.68;
  score += overlapScore(queryTokens, keywordTokens) * 0.22;
  score += overlapScore(queryTokens, intentTokens) * 0.1;
'@
$NewScore = @'
  const keywordTokens = meaningfulTokens((Array.isArray(entry.keywords) ? entry.keywords : [entry.keywords || '']).map(englishSide).join(' '));
  const phraseTokens = meaningfulTokens((Array.isArray(entry.usefulPhrases) ? entry.usefulPhrases : [entry.usefulPhrases || '']).map(englishSide).join(' '));
  const intentTokens = meaningfulTokens(entry.intent || '');
  let score = overlapScore(queryTokens, savedTokens) * 0.62;
  score += overlapScore(queryTokens, keywordTokens) * 0.22;
  score += overlapScore(queryTokens, phraseTokens) * 0.08;
  score += overlapScore(queryTokens, intentTokens) * 0.08;
'@
Replace-ExactOnce 'desktop-app/src/main/answer-matcher.js' $OldScore $NewScore
Replace-ExactOnce 'desktop-app/src/main/answer-matcher.js' '  const keywords = Array.isArray(entry.keywords) ? entry.keywords.filter(Boolean).slice(0, 6) : [];
  const facts' '  const keywords = Array.isArray(entry.keywords) ? entry.keywords.filter(Boolean).map(englishSide).slice(0, 6) : [];
  const usefulPhrases = Array.isArray(entry.usefulPhrases) ? entry.usefulPhrases.filter(Boolean).map(englishSide).slice(0, 3) : [];
  const facts'
Replace-ExactOnce 'desktop-app/src/main/answer-matcher.js' '    keyPoints: keywords,' '    keyPoints: [...keywords, ...usefulPhrases],'
Replace-ExactOnce 'desktop-app/src/main/answer-matcher.js' '  meaningfulTokens,' '  meaningfulTokens,
  englishSide,'

Replace-ExactOnce 'desktop-app/src/preload.js' '  answerLibrarySave: (library) => ipcRenderer.invoke(''answer-library:save'', library || {}),' '  answerLibrarySave: (library) => ipcRenderer.invoke(''answer-library:save'', library || {}),
  answerLibraryGenerateLearningAids: (entry) => ipcRenderer.invoke(''answer-library:generate-learning-aids'', entry || {}),'

$MainLearningHandler = @'
ipcMain.handle('answer-library:generate-learning-aids', async (_event, entry) => {
  const bridge = await ensureBridgeForAssistant();
  if (!bridge.ok) return { ok: false, error: bridge.message || 'Bridge is not available.' };
  const response = await requestJsonPost(
    `http://127.0.0.1:${bridge.settings.LOCAL_MEET_TRANSLATOR_PORT}/interview/generate-learning-aids`,
    bridge.settings.LOCAL_MEET_TRANSLATOR_TOKEN,
    {
      question: String(entry?.question || '').trim(),
      answer: String(entry?.answer || '').trim(),
      firstSentence: String(entry?.firstSentence || '').trim(),
      existingKeywords: Array.isArray(entry?.keywords) ? entry.keywords : [],
      existingUsefulPhrases: Array.isArray(entry?.usefulPhrases) ? entry.usefulPhrases : [],
      languageLevel: String(entry?.level || 'B1').trim() || 'B1'
    },
    85_000
  );
  if (!response.ok || !response.json?.learningAids) {
    return { ok: false, error: response.json?.message || response.body || `Learning aids request failed with HTTP ${response.status}.`, requestId: response.requestId };
  }
  return { ok: true, learningAids: response.json.learningAids, requestId: response.requestId };
});
'@
Replace-ExactOnce 'desktop-app/src/main.js' 'ipcMain.handle(''answer-library:save'', (_event, library) => answerLibraryStore.save(library || {}));
ipcMain.handle(''answer-library:reset''' ('ipcMain.handle(''answer-library:save'', (_event, library) => answerLibraryStore.save(library || {}));' + "`n" + $MainLearningHandler + 'ipcMain.handle(''answer-library:reset''')

$OldAnswerSidebar = '<button id="importAnswerLibrary" type="button" class="secondary" data-i18n="importAnswerLibrary">Import JSON</button>'
$NewAnswerSidebar = '<button id="generateMissingLearningAids" type="button" class="secondary" data-i18n="generateMissingLearningAids">Add keywords and phrases to missing questions</button>' + "`n" + '            ' + $OldAnswerSidebar
Replace-ExactOnce 'desktop-app/src/index.html' $OldAnswerSidebar $NewAnswerSidebar

$OldAnswerMetadata = @'
          <div class="grid">
            <label><span data-i18n="answerKeywords">Keywords, one per line</span><textarea id="answerKeywords" rows="7"></textarea></label>
            <label><span data-i18n="answerGroundingFacts">Confirmed facts used, one per line</span><textarea id="answerGroundingFacts" rows="7"></textarea></label>
          </div>
'@
$NewAnswerMetadata = @'
          <div class="grid">
            <label><span data-i18n="answerKeywords">Keywords, one per line</span><textarea id="answerKeywords" rows="7"></textarea></label>
            <label><span data-i18n="answerUsefulPhrases">Useful phrases, one per line</span><textarea id="answerUsefulPhrases" rows="7" placeholder="The main difference is... — Главное различие заключается в..."></textarea></label>
            <label><span data-i18n="answerGroundingFacts">Confirmed facts used, one per line</span><textarea id="answerGroundingFacts" rows="7"></textarea></label>
          </div>
          <p class="hint" data-i18n="learningAidsHint">Keywords and useful phrases are study aids. Generation preserves your reviewed answer and may use the OpenAI API.</p>
          <p id="answerLearningAidsStatus" class="hint"></p>
'@
Replace-ExactOnce 'desktop-app/src/index.html' $OldAnswerMetadata $NewAnswerMetadata
Replace-ExactOnce 'desktop-app/src/index.html' '<button id="saveAnswerEntry" type="button" data-i18n="saveAnswer">Save answer</button>' '<button id="generateAnswerLearningAids" type="button" class="secondary" data-i18n="generateLearningAids">Generate missing aids</button>
            <button id="regenerateAnswerLearningAids" type="button" class="secondary" data-i18n="regenerateLearningAids">Regenerate aids</button>
            <button id="saveAnswerEntry" type="button" data-i18n="saveAnswer">Save answer</button>'

$TrainerAids = @'
          <div id="trainerLearningAids" class="trainerReferencePanel" hidden>
            <div><span class="eyebrow" data-i18n="trainerKeywords">Keywords</span><div id="trainerKeywordList" class="keywordChips"></div></div>
            <div><span class="eyebrow" data-i18n="trainerUsefulPhrases">Useful phrases</span><ul id="trainerUsefulPhraseList"></ul></div>
          </div>
'@
Replace-ExactOnce 'desktop-app/src/index.html' '          <div class="trainerQuestionBox"><p id="trainerQuestionText" data-i18n="trainerNoQuestion">Start a session to receive a question.</p></div>
          <label><span data-i18n="trainerPracticeAnswer">' ('          <div class="trainerQuestionBox"><p id="trainerQuestionText" data-i18n="trainerNoQuestion">Start a session to receive a question.</p></div>' + "`n" + $TrainerAids + '          <label><span data-i18n="trainerPracticeAnswer">')

$GuideCards = @'
          <details class="guideCard"><summary data-i18n="guideTranscriptGuardTitle">English expected and transcript protection</summary><p data-i18n="guideTranscriptGuardText">English expected first uses automatic recognition, retries suspicious text as English, rejects silent chunks before the network request, and blocks prompt echoes before translation. Dropped text never reaches subtitles, history, Coding Focus or the classifier.</p></details>
          <details class="guideCard"><summary data-i18n="guideLearningAidsTitle">Keywords and useful phrases</summary><p data-i18n="guideLearningAidsText">Each Answer Library question may contain a first sentence, English keywords with Russian translations, and reusable English phrases with Russian translations. Generate missing aids for one question or fill all incomplete questions. Reviewed answers are preserved.</p></details>
          <details class="guideCard"><summary data-i18n="guideClassifierTitle">Coding Focus and contextual replies</summary><p data-i18n="guideClassifierText">Remarks only enter the feed. Follow-up questions receive a separate answer. Recommendations are offered, direct requests and constraints revise the solution, corrections replace earlier inputs, and new tasks wait for confirmation.</p></details>
'@
Replace-ExactOnce 'desktop-app/src/index.html' '          <details class="guideCard"><summary data-i18n="guideVoiceTitle">' ($GuideCards + '          <details class="guideCard"><summary data-i18n="guideVoiceTitle">')

Replace-ExactOnce 'desktop-app/src/renderer.js' '    keywords: [],
    groundingFacts:' '    keywords: [],
    usefulPhrases: [],
    groundingFacts:'
Replace-ExactOnce 'desktop-app/src/renderer.js' '    keywords: splitProfileLines(val(''answerKeywords'')),
    groundingFacts:' '    keywords: splitProfileLines(val(''answerKeywords'')),
    usefulPhrases: splitProfileLines(val(''answerUsefulPhrases'')),
    groundingFacts:'
Replace-ExactOnce 'desktop-app/src/renderer.js' '    $(''answerKeywords'').value = Array.isArray(value.keywords) ? value.keywords.join(''\n'') : String(value.keywords || '''');
    $(''answerGroundingFacts'')' '    $(''answerKeywords'').value = Array.isArray(value.keywords) ? value.keywords.join(''\n'') : String(value.keywords || '''');
    $(''answerUsefulPhrases'').value = Array.isArray(value.usefulPhrases) ? value.usefulPhrases.join(''\n'') : String(value.usefulPhrases || '''');
    $(''answerGroundingFacts'')'

$LearningRendererFunctions = @'
function uniqueLearningAidLines(values) {
  const seen = new Set();
  const result = [];
  for (const raw of Array.isArray(values) ? values : []) {
    const value = String(raw || '').trim();
    const key = value.toLowerCase();
    if (!value || seen.has(key)) continue;
    seen.add(key);
    result.push(value);
  }
  return result;
}

async function requestLearningAids(entry) {
  const result = await window.lmt.answerLibraryGenerateLearningAids(entry || {});
  if (!result?.ok || !result.learningAids) throw new Error(result?.error || t('learningAidsFailed'));
  return result.learningAids;
}

function applyLearningAidsToDraft(aids = {}, overwrite = false) {
  suppressAnswerDirty = true;
  try {
    const generatedKeywords = uniqueLearningAidLines(aids.keywords);
    const generatedPhrases = uniqueLearningAidLines(aids.usefulPhrases);
    if (overwrite || !val('answerKeywords')) $('answerKeywords').value = generatedKeywords.join('\n');
    if (overwrite || !val('answerUsefulPhrases')) $('answerUsefulPhrases').value = generatedPhrases.join('\n');
    if ((overwrite || !val('answerFirstSentence')) && String(aids.firstSentence || '').trim()) {
      $('answerFirstSentence').value = String(aids.firstSentence).trim();
    }
  } finally {
    suppressAnswerDirty = false;
  }
  setAnswerEditorDirty(true);
}

async function generateCurrentAnswerLearningAids(overwrite = false) {
  const draft = answerEntryFromUi();
  if (!draft.question) throw new Error(t('answerQuestionRequired'));
  if (!draft.answer) throw new Error(t('answerTextRequired'));
  if (overwrite && !window.confirm(t('regenerateLearningAidsConfirm'))) return { ok: false, canceled: true };
  if ($('answerLearningAidsStatus')) $('answerLearningAidsStatus').textContent = t('learningAidsGenerating');
  const aids = await requestLearningAids(draft);
  applyLearningAidsToDraft(aids, overwrite);
  if ($('answerLearningAidsStatus')) $('answerLearningAidsStatus').textContent = t('learningAidsGenerated');
  return { ok: true, learningAids: aids };
}

async function generateMissingLearningAidsForLibrary() {
  const entries = Array.isArray(answerLibraryState.entries) ? answerLibraryState.entries : [];
  const targets = entries.filter(entry => entry.question && entry.answer && (
    !Array.isArray(entry.keywords) || !entry.keywords.length
    || !Array.isArray(entry.usefulPhrases) || !entry.usefulPhrases.length
    || !String(entry.firstSentence || '').trim()
  ));
  if (!targets.length) {
    if ($('answerLearningAidsStatus')) $('answerLearningAidsStatus').textContent = t('learningAidsNoneMissing');
    return { ok: true, updated: 0, failed: 0 };
  }
  if (!window.confirm(t('bulkLearningAidsConfirm'))) return { ok: false, canceled: true };
  let updated = 0;
  let failed = 0;
  for (let index = 0; index < targets.length; index += 1) {
    const entry = targets[index];
    if ($('answerLearningAidsStatus')) {
      $('answerLearningAidsStatus').textContent = `${t('learningAidsGenerating')} ${index + 1}/${targets.length}`;
    }
    try {
      const aids = await requestLearningAids(entry);
      if (!Array.isArray(entry.keywords) || !entry.keywords.length) entry.keywords = uniqueLearningAidLines(aids.keywords);
      if (!Array.isArray(entry.usefulPhrases) || !entry.usefulPhrases.length) entry.usefulPhrases = uniqueLearningAidLines(aids.usefulPhrases);
      if (!String(entry.firstSentence || '').trim() && String(aids.firstSentence || '').trim()) entry.firstSentence = String(aids.firstSentence).trim();
      entry.updatedAt = new Date().toISOString();
      updated += 1;
    } catch (error) {
      failed += 1;
      log(`[LEARNING AIDS] ${entry.question}: ${error.message || error}`);
    }
  }
  await persistAnswerLibrary('answerLibrarySaved');
  if ($('answerLearningAidsStatus')) {
    $('answerLearningAidsStatus').textContent = `${t('learningAidsBulkCompleted')} ${updated}; ${t('learningAidsFailedCount')} ${failed}`;
  }
  return { ok: failed === 0, updated, failed };
}

function renderTrainerLearningAids(entry) {
  const panel = $('trainerLearningAids');
  const keywordsRoot = $('trainerKeywordList');
  const phrasesRoot = $('trainerUsefulPhraseList');
  const keywords = Array.isArray(entry?.keywords) ? entry.keywords : [];
  const phrases = Array.isArray(entry?.usefulPhrases) ? entry.usefulPhrases : [];
  if (keywordsRoot) {
    keywordsRoot.innerHTML = '';
    for (const value of keywords) {
      const chip = document.createElement('span');
      chip.className = 'keywordChip';
      chip.textContent = value;
      keywordsRoot.appendChild(chip);
    }
  }
  if (phrasesRoot) {
    phrasesRoot.innerHTML = '';
    for (const value of phrases) {
      const item = document.createElement('li');
      item.textContent = value;
      phrasesRoot.appendChild(item);
    }
  }
  if (panel) panel.hidden = !keywords.length && !phrases.length;
}

'@
Replace-ExactOnce 'desktop-app/src/renderer.js' '

function assistantProtectionSummary' ("`n`n" + $LearningRendererFunctions + 'function assistantProtectionSummary')
Replace-ExactOnce 'desktop-app/src/renderer.js' '    if ($(''trainerReferencePanel'')) $(''trainerReferencePanel'').hidden = true;
    for (const id of [''saveTrainingAttempt''' '    if ($(''trainerReferencePanel'')) $(''trainerReferencePanel'').hidden = true;
    renderTrainerLearningAids(null);
    for (const id of [''saveTrainingAttempt'''
Replace-ExactOnce 'desktop-app/src/renderer.js' '  if ($(''trainerReferenceAnswer'')) $(''trainerReferenceAnswer'').textContent = entry.answer || '''';
  if ($(''trainerReferencePanel''))' '  if ($(''trainerReferenceAnswer'')) $(''trainerReferenceAnswer'').textContent = entry.answer || '''';
  renderTrainerLearningAids(entry);
  if ($(''trainerReferencePanel''))'

$AnswerBindingsOld = @'
  if ($('saveAnswerEntry')) $('saveAnswerEntry').onclick = async () => {
    await runUiAction('Save Answer Library entry clicked.', 'saveAnswerEntry', saveCurrentAnswer);
  };
'@
$AnswerBindingsNew = @'
  if ($('generateAnswerLearningAids')) $('generateAnswerLearningAids').onclick = async () => {
    await runUiAction('Generate missing learning aids clicked.', 'generateAnswerLearningAids', () => generateCurrentAnswerLearningAids(false));
  };
  if ($('regenerateAnswerLearningAids')) $('regenerateAnswerLearningAids').onclick = async () => {
    await runUiAction('Regenerate learning aids clicked.', 'regenerateAnswerLearningAids', () => generateCurrentAnswerLearningAids(true));
  };
  if ($('generateMissingLearningAids')) $('generateMissingLearningAids').onclick = async () => {
    await runUiAction('Generate missing learning aids for library clicked.', 'generateMissingLearningAids', generateMissingLearningAidsForLibrary);
  };
  if ($('saveAnswerEntry')) $('saveAnswerEntry').onclick = async () => {
    await runUiAction('Save Answer Library entry clicked.', 'saveAnswerEntry', saveCurrentAnswer);
  };
'@
Replace-ExactOnce 'desktop-app/src/renderer.js' $AnswerBindingsOld $AnswerBindingsNew

Replace-ExactOnce 'desktop-app/src/i18n.js' '    answerKeywords: "Keywords, one per line",' '    answerKeywords: "Keywords, one per line",
    answerUsefulPhrases: "Useful phrases, one per line",'
Replace-ExactOnce 'desktop-app/src/i18n.js' '    answerLocked: "Lock this reviewed answer against automatic rewriting",' '    answerLocked: "Lock this reviewed answer against automatic rewriting",
    generateLearningAids: "Generate missing aids",
    regenerateLearningAids: "Regenerate aids",
    generateMissingLearningAids: "Add keywords and phrases to missing questions",
    learningAidsHint: "Keywords and useful phrases are study aids. Generation preserves your reviewed answer and may use the OpenAI API.",
    learningAidsGenerating: "Generating learning aids...",
    learningAidsGenerated: "Keywords and useful phrases are ready. Review them and save the answer.",
    learningAidsNoneMissing: "All saved questions already contain learning aids.",
    learningAidsBulkCompleted: "Questions updated:",
    learningAidsFailedCount: "failed:",
    learningAidsFailed: "Learning aids could not be generated.",
    regenerateLearningAidsConfirm: "Replace the current keywords, useful phrases and first sentence with newly generated values?",
    bulkLearningAidsConfirm: "Generate missing keywords and useful phrases for all incomplete questions? This may create OpenAI API charges.",'
Replace-ExactOnce 'desktop-app/src/i18n.js' '    trainerNoQuestion: "Start a session to receive a question.",' '    trainerNoQuestion: "Start a session to receive a question.",
    trainerKeywords: "Keywords",
    trainerUsefulPhrases: "Useful phrases",'
Replace-ExactOnce 'desktop-app/src/i18n.js' '    guideVoiceTitle: "Voice translation to the other participant",' '    guideTranscriptGuardTitle: "English expected and transcript protection",
    guideTranscriptGuardText: "English expected first uses automatic recognition, retries suspicious text as English, rejects silent chunks before the network request, and blocks prompt echoes before translation. Dropped text never reaches subtitles, history, Coding Focus or the classifier. The technical log may show [TRANSCRIPT DROPPED] silence detected or [TRANSCRIPT DROPPED] prompt echo detected.",
    guideLearningAidsTitle: "Keywords and useful phrases",
    guideLearningAidsText: "Each Answer Library question can contain a first sentence, English keywords with Russian translations, and reusable English phrases with Russian translations. Generate missing aids for one question or fill all incomplete questions. Review and save generated metadata; the reviewed answer is not replaced.",
    guideClassifierTitle: "Coding Focus and contextual replies",
    guideClassifierText: "Remarks only enter the feed. Follow-up questions receive a separate answer. Recommendations are offered, direct requests and constraints revise the solution, corrections replace earlier inputs, and new tasks wait for confirmation.",
    guideVoiceTitle: "Voice translation to the other participant",'

Replace-ExactOnce 'desktop-app/src/i18n.js' '    answerKeywords: "Ключевые слова — по одному на строку",' '    answerKeywords: "Ключевые слова — по одному на строку",
    answerUsefulPhrases: "Полезные фразы — по одной на строку",'
Replace-ExactOnce 'desktop-app/src/i18n.js' '    answerLocked: "Запретить автоматическое переформулирование проверенного ответа",' '    answerLocked: "Запретить автоматическое переформулирование проверенного ответа",
    generateLearningAids: "Сгенерировать недостающее",
    regenerateLearningAids: "Перегенерировать подсказки",
    generateMissingLearningAids: "Добавить ключевые слова и фразы ко всем незаполненным вопросам",
    learningAidsHint: "Ключевые слова и полезные фразы — учебные подсказки. Генерация сохраняет проверенный ответ и может использовать OpenAI API.",
    learningAidsGenerating: "Создаю учебные подсказки...",
    learningAidsGenerated: "Ключевые слова и полезные фразы готовы. Проверьте их и сохраните ответ.",
    learningAidsNoneMissing: "Во всех сохранённых вопросах уже есть учебные подсказки.",
    learningAidsBulkCompleted: "Обновлено вопросов:",
    learningAidsFailedCount: "ошибок:",
    learningAidsFailed: "Не удалось создать учебные подсказки.",
    regenerateLearningAidsConfirm: "Заменить текущие ключевые слова, полезные фразы и первую фразу новыми значениями?",
    bulkLearningAidsConfirm: "Создать недостающие ключевые слова и полезные фразы для всех незаполненных вопросов? Это может вызвать расходы OpenAI API.",'
Replace-ExactOnce 'desktop-app/src/i18n.js' '    trainerNoQuestion: "Начни сессию, чтобы получить вопрос.",' '    trainerNoQuestion: "Начни сессию, чтобы получить вопрос.",
    trainerKeywords: "Ключевые слова",
    trainerUsefulPhrases: "Полезные фразы",'
Replace-ExactOnce 'desktop-app/src/i18n.js' '    guideVoiceTitle: "Голосовой перевод собеседнику",' '    guideTranscriptGuardTitle: "English expected и защита расшифровки",
    guideTranscriptGuardText: "English expected сначала использует автоопределение, повторяет подозрительный текст как английский, отбрасывает тихие фрагменты до сетевого запроса и блокирует повтор служебной подсказки до перевода. Отброшенный текст не попадает в субтитры, историю, Coding Focus и классификатор. В техническом логе возможны строки [TRANSCRIPT DROPPED] silence detected и [TRANSCRIPT DROPPED] prompt echo detected.",
    guideLearningAidsTitle: "Ключевые слова и полезные фразы",
    guideLearningAidsText: "Для каждого вопроса Библиотеки ответов можно хранить первую фразу, английские ключевые слова с русским переводом и полезные английские конструкции с русским переводом. Можно дополнить один вопрос или все незаполненные вопросы. Сгенерированные данные нужно проверить и сохранить; проверенный ответ не заменяется.",
    guideClassifierTitle: "Coding Focus и контекстные реплики",
    guideClassifierText: "Комментарии попадают только в ленту. На follow-up создаётся отдельный ответ. Рекомендацию можно принять или отклонить, просьбы и условия изменяют решение, исправления заменяют старые вводные, а новая задача ждёт подтверждения.",
    guideVoiceTitle: "Голосовой перевод собеседнику",'

$LearningTest = @'
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { sanitizeEntry } = require('../src/main/answer-library-store');
const { scoreAnswerEntry, entryToSuggestion } = require('../src/main/answer-matcher');

test('Answer Library preserves bilingual useful phrases', () => {
  const entry = sanitizeEntry({
    question: 'How does the backend verify membership?',
    answer: 'It queries the current membership.',
    keywords: ['membership — членство'],
    usefulPhrases: ['The backend verifies... — Backend проверяет...', 'The backend verifies... — Backend проверяет...']
  });
  assert.deepEqual(entry.usefulPhrases, ['The backend verifies... — Backend проверяет...']);
});

test('learning-aid keywords and phrases support matching and library guidance', () => {
  const entry = sanitizeEntry({
    question: 'How does authorization work?',
    answer: 'The backend checks the database.',
    keywords: ['organization membership — членство в организации'],
    usefulPhrases: ['The backend verifies current membership — Backend проверяет текущее членство']
  });
  assert.ok(scoreAnswerEntry('How is current organization membership verified?', entry) > 0);
  const suggestion = entryToSuggestion(entry, 0.8);
  assert.ok(suggestion.keyPoints.some(value => /backend verifies/i.test(value)));
});
'@
Write-ProjectText 'desktop-app/test/learning-aids.test.js' $LearningTest

$Validator = @'
'use strict';
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..', '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const versionAtLeast = (actual, minimum) => {
  const a = String(actual || '').split('.').map(Number);
  const b = String(minimum || '').split('.').map(Number);
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) > (b[i] || 0);
  }
  return true;
};

const pkg = JSON.parse(read('desktop-app/package.json'));
assert(versionAtLeast(pkg.version, '1.0.27'), `Expected desktop 1.0.27 or newer, got ${pkg.version}`);
assert(pkg.scripts['test:architecture'].includes('validate-stage15-1-transcript-learning-aids.js'), 'Stage 15.1 validator is not wired into npm test.');
for (const extension of ['chrome-extension', 'edge-extension']) {
  const manifest = JSON.parse(read(`${extension}/manifest.json`));
  assert(versionAtLeast(manifest.version, '1.7.5'), `${extension} must be 1.7.5 or newer.`);
  const runtime = read(`${extension}/offscreen.js`);
  assert(runtime.includes('consumeWindowStats'), `${extension} has no per-chunk silence statistics.`);
  assert(runtime.includes('[TRANSCRIPT DROPPED] silence detected'), `${extension} has no silence-drop log.`);
  assert(runtime.includes('[TRANSCRIPT DROPPED] prompt echo detected'), `${extension} has no prompt-echo log.`);
  assert(runtime.includes('data.transcriptDropped'), `${extension} does not stop dropped transcripts.`);
}
const recognition = read('local-meet-bridge/src/main/java/local/meettranslator/openai/EnglishExpectedRecognition.java');
assert(recognition.includes('isPromptEcho'), 'Prompt-echo detector is missing.');
assert(recognition.includes('TECHNICAL_TRANSCRIPTION_VOCABULARY'), 'Safe technical vocabulary prompt is missing.');
const openAi = read('local-meet-bridge/src/main/java/local/meettranslator/openai/OpenAiClient.java');
assert(!openAi.includes('Transcribe exactly in English.'), 'Old natural-language transcription prompt is still present.');
assert(openAi.includes('generateInterviewLearningAids'), 'Learning-aids AI method is missing.');
const bridge = read('local-meet-bridge/src/main/java/local/meettranslator/BridgeServer.java');
assert(bridge.includes('transcriptDropped'), 'Bridge does not expose dropped-transcript metadata.');
assert(bridge.includes('/interview/generate-learning-aids'), 'Learning-aids bridge endpoint is missing.');
const store = read('desktop-app/src/main/answer-library-store.js');
assert(store.includes('usefulPhrases'), 'Answer Library does not persist useful phrases.');
const html = read('desktop-app/src/index.html');
for (const id of ['answerUsefulPhrases','generateAnswerLearningAids','generateMissingLearningAids','trainerKeywordList','trainerUsefulPhraseList']) {
  assert(html.includes(`id="${id}"`), `Missing Stage 15.1 UI control: ${id}`);
}
const renderer = read('desktop-app/src/renderer.js');
assert(renderer.includes('generateMissingLearningAidsForLibrary'), 'Bulk learning-aids flow is missing.');
assert(renderer.includes('renderTrainerLearningAids'), 'Trainer does not render learning aids.');
assert(html.includes('guideTranscriptGuardTitle') && html.includes('guideLearningAidsTitle') && html.includes('guideClassifierTitle'), 'Built-in instructions were not expanded.');
console.log('Stage 15.1 transcript guard and learning aids validation: OK');
'@
Write-ProjectText 'scripts/tests/validate-stage15-1-transcript-learning-aids.js' $Validator

Write-Host ''
Write-Host 'Stage 15.1 update was applied successfully.' -ForegroundColor Green
Write-Host 'Desktop source: 1.0.27'
Write-Host 'Chrome/Edge extension: 1.7.5'
Write-Host "Backup: $BackupRoot"
Write-Host 'Run VERIFY_UPDATE.ps1 before building the installer.'
