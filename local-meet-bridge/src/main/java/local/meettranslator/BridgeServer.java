package local.meettranslator;

import com.sun.net.httpserver.HttpServer;
import local.meettranslator.config.BridgeConfig;
import local.meettranslator.http.ApiException;
import local.meettranslator.http.HttpSupport;
import local.meettranslator.http.RequestRegistry;
import local.meettranslator.model.TranscribeAndTranslateRequest;
import local.meettranslator.model.InterviewLearningAidsRequest;
import local.meettranslator.model.InterviewSuggestionRequest;
import local.meettranslator.model.InterviewUtteranceClassificationRequest;
import local.meettranslator.model.TranslateTextRequest;
import local.meettranslator.model.TtsRequest;
import local.meettranslator.openai.AiClient;
import local.meettranslator.openai.EnglishExpectedRecognition;
import local.meettranslator.openai.OpenAiClient;
import local.meettranslator.voice.VoiceConversionClient;

import java.io.IOException;
import java.net.InetSocketAddress;
import java.util.Base64;
import java.util.Locale;
import java.util.Objects;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public final class BridgeServer implements AutoCloseable {
    private final BridgeConfig config;
    private final AiClient aiClient;
    private final VoiceConversionClient voiceConversionClient;
    private final RequestRegistry requestRegistry;
    private HttpServer server;
    private ExecutorService executor;

    public BridgeServer(BridgeConfig config) {
        this(config, new OpenAiClient(config), config.voiceConversionEnabled()
                ? new VoiceConversionClient(config.voiceConversionUrl(), config.voiceConversionToken(), config.voiceConversionTimeoutMs())
                : null, new RequestRegistry());
    }

    public BridgeServer(
            BridgeConfig config,
            AiClient aiClient,
            VoiceConversionClient voiceConversionClient,
            RequestRegistry requestRegistry
    ) {
        this.config = Objects.requireNonNull(config, "config");
        this.aiClient = Objects.requireNonNull(aiClient, "aiClient");
        this.voiceConversionClient = voiceConversionClient;
        this.requestRegistry = Objects.requireNonNull(requestRegistry, "requestRegistry");
    }

    public synchronized int start() throws IOException {
        if (server != null) return port();
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", config.port()), 0);
        registerRoutes();
        executor = Executors.newFixedThreadPool(Math.max(4, Runtime.getRuntime().availableProcessors()));
        server.setExecutor(executor);
        server.start();
        System.out.println("Local Meet Translator bridge started");
        System.out.println("  URL:   http://127.0.0.1:" + port());
        System.out.println("  TTS:   " + (config.ttsEnabled() ? "enabled model=" + config.ttsModel() + " voice=" + config.ttsVoice() : "disabled"));
        System.out.println("  Voice conversion: " + (config.voiceConversionEnabled() ? "enabled" : "disabled"));
        return port();
    }

    public synchronized int port() {
        return server == null ? config.port() : server.getAddress().getPort();
    }

    public synchronized void stop() {
        if (server != null) {
            server.stop(0);
            server = null;
        }
        if (executor != null) {
            executor.shutdownNow();
            executor = null;
        }
    }

    @Override
    public void close() {
        stop();
    }

    private void registerRoutes() {
        server.createContext("/health", exchange -> HttpSupport.handle(exchange, "GET", config.authToken(), requestRegistry, (ex, context) ->
                HttpSupport.writeJson(ex, 200, HttpSupport.MAPPER.createObjectNode()
                        .put("ok", true)
                        .put("service", "local-meet-translator-bridge")
                        .put("architectureVersion", 1)
                        .put("activeRequests", requestRegistry.activeCount()), context.requestId())));

        server.createContext("/voice/health", exchange -> HttpSupport.handle(exchange, "GET", config.authToken(), requestRegistry, (ex, context) -> {
            boolean enabled = config.voiceConversionEnabled() && voiceConversionClient != null;
            boolean reachable = false;
            String error = "";
            if (enabled) {
                try {
                    reachable = voiceConversionClient.ping(context);
                } catch (Exception cause) {
                    error = HttpSupport.safeMessage(cause);
                }
            }
            var response = HttpSupport.MAPPER.createObjectNode()
                    .put("ok", true)
                    .put("enabled", enabled)
                    .put("reachable", reachable);
            if (!error.isBlank()) response.put("error", error);
            HttpSupport.writeJson(ex, 200, response, context.requestId());
        }));

        server.createContext("/translate-text", exchange -> HttpSupport.handle(exchange, "POST", config.authToken(), requestRegistry, (ex, context) -> {
            TranslateTextRequest request = TranslateTextRequest.from(HttpSupport.readJsonBody(ex, 1_000_000));
            String translation;
            try {
                translation = aiClient.translateText(context, request.sourceLang(), request.targetLang(), request.text());
            } catch (IOException cause) {
                throw HttpSupport.upstream("openai_translation_failed", cause);
            }
            HttpSupport.writeJson(ex, 200, HttpSupport.MAPPER.createObjectNode()
                    .put("sourceLang", request.sourceLang())
                    .put("targetLang", request.targetLang())
                    .put("translation", translation), context.requestId());
        }));

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
        server.createContext("/interview/suggest-answer", exchange -> HttpSupport.handle(exchange, "POST", config.authToken(), requestRegistry, (ex, context) -> {
            InterviewSuggestionRequest request = InterviewSuggestionRequest.from(HttpSupport.readJsonBody(ex, 1_500_000));
            com.fasterxml.jackson.databind.JsonNode suggestion;
            try {
                suggestion = aiClient.suggestInterviewAnswer(context, request);
            } catch (IOException cause) {
                throw HttpSupport.upstream("openai_interview_suggestion_failed", cause);
            }
            HttpSupport.writeJson(ex, 200, HttpSupport.MAPPER.createObjectNode()
                    .put("ok", true)
                    .set("suggestion", suggestion), context.requestId());
        }));

        server.createContext("/interview/classify-utterance", exchange -> HttpSupport.handle(exchange, "POST", config.authToken(), requestRegistry, (ex, context) -> {
            InterviewUtteranceClassificationRequest request = InterviewUtteranceClassificationRequest.from(HttpSupport.readJsonBody(ex, 1_500_000));
            com.fasterxml.jackson.databind.JsonNode classification;
            try {
                classification = aiClient.classifyInterviewUtterance(context, request);
            } catch (IOException cause) {
                throw HttpSupport.upstream("openai_interview_utterance_classification_failed", cause);
            }
            HttpSupport.writeJson(ex, 200, HttpSupport.MAPPER.createObjectNode()
                    .put("ok", true)
                    .set("classification", classification), context.requestId());
        }));

        server.createContext("/tts", exchange -> HttpSupport.handle(exchange, "POST", config.authToken(), requestRegistry, (ex, context) -> {
            if (!aiClient.isTtsEnabled()) throw new ApiException(403, "tts_disabled", "TTS is disabled. Set ENABLE_TTS=true and restart.");
            TtsRequest request = TtsRequest.from(HttpSupport.readJsonBody(ex, 1_500_000));
            boolean convert = request.voiceConversion().requested();
            if (convert && (!config.voiceConversionEnabled() || voiceConversionClient == null)) {
                throw new ApiException(403, "voice_conversion_disabled", "Voice conversion is disabled. Set ENABLE_VOICE_CONVERSION=true and restart the bridge.");
            }
            String effectiveFormat = convert ? "wav" : blankToNull(request.responseFormat());
            byte[] audio;
            try {
                audio = aiClient.ttsAudio(
                        context,
                        request.text(),
                        blankToNull(request.voice()),
                        blankToNull(request.model()),
                        effectiveFormat,
                        blankToNull(request.instructions()),
                        request.speed()
                );
            } catch (IOException cause) {
                throw HttpSupport.upstream("openai_tts_failed", cause);
            }
            String format = effectiveFormat == null ? aiClient.defaultTtsFormat() : effectiveFormat;
            if (convert) {
                try {
                    audio = voiceConversionClient.convertWav(context, audio, request.voiceConversion().modelTag());
                } catch (Exception cause) {
                    if (!config.voiceConversionFallback()) throw HttpSupport.upstream("voice_conversion_failed", cause);
                }
                format = "wav";
            }
            HttpSupport.writeJson(ex, 200, HttpSupport.MAPPER.createObjectNode()
                    .put("audioMime", audioMime(format))
                    .put("audioBase64", Base64.getEncoder().encodeToString(audio)), context.requestId());
        }));

        server.createContext("/requests/cancel", exchange -> HttpSupport.handle(exchange, "POST", config.authToken(), requestRegistry, (ex, context) -> {
            String targetRequestId = local.meettranslator.model.JsonContract.requiredText(HttpSupport.readJsonBody(ex, 64_000), "requestId", 120);
            boolean cancelled = requestRegistry.cancel(targetRequestId);
            HttpSupport.writeJson(ex, 200, HttpSupport.MAPPER.createObjectNode()
                    .put("ok", true)
                    .put("requestId", targetRequestId)
                    .put("cancelled", cancelled), context.requestId());
        }));
    }

    private static String blankToNull(String value) {
        return value == null || value.isBlank() ? null : value.trim();
    }

    private static String audioMime(String format) {
        String normalized = Objects.requireNonNullElse(format, "").trim().toLowerCase(Locale.ROOT);
        return switch (normalized) {
            case "mp3" -> "audio/mpeg";
            case "wav" -> "audio/wav";
            case "flac" -> "audio/flac";
            case "aac" -> "audio/aac";
            case "opus" -> "audio/opus";
            case "pcm" -> "audio/pcm";
            default -> "application/octet-stream";
        };
    }
}
