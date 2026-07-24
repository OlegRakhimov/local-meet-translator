package local.meettranslator.openai;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import local.meettranslator.config.BridgeConfig;
import local.meettranslator.http.RequestContext;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.time.Duration;
import java.util.Locale;
import java.util.Objects;

public final class OpenAiClient implements AiClient {
    private static final ObjectMapper MAPPER = new ObjectMapper();
    private final BridgeConfig config;
    private final HttpClient http;

    public OpenAiClient(BridgeConfig config) {
        this.config = Objects.requireNonNull(config, "config");
        this.http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(20)).build();
    }

    @Override
    public boolean isTtsEnabled() {
        return config.ttsEnabled();
    }

    @Override
    public String defaultTtsFormat() {
        return config.ttsFormat();
    }

    @Override
    public String transcribe(RequestContext context, byte[] audio, String audioMime, String sourceLang) throws IOException {
        String boundary = "----LocalMeetTranslatorBoundary" + randomToken(12);
        byte[] multipart = buildMultipart(boundary, audio, normalizeTranscribeMime(audioMime), config.transcribeModel(), sourceLang);
        HttpRequest request = HttpRequest.newBuilder()
                .uri(URI.create(config.baseUrl() + "/v1/audio/transcriptions"))
                .timeout(Duration.ofSeconds(120))
                .header("Authorization", "Bearer " + config.apiKey())
                .header("Content-Type", "multipart/form-data; boundary=" + boundary)
                .POST(HttpRequest.BodyPublishers.ofByteArray(multipart))
                .build();
        HttpResponse<byte[]> response = context.await(http.sendAsync(request, HttpResponse.BodyHandlers.ofByteArray()));
        ensureSuccess("OpenAI transcribe", response);
        JsonNode json = MAPPER.readTree(response.body());
        JsonNode text = json.get("text");
        if (text == null || text.isNull()) throw new IOException("OpenAI transcribe response has no text field");
        return text.asText();
    }

    @Override
    public String translateText(RequestContext context, String sourceLang, String targetLang, String text) throws IOException {
        if (text == null || text.isBlank()) return "";
        var body = MAPPER.createObjectNode()
                .put("model", config.textModel())
                .put("input", buildTranslatePrompt(sourceLang, targetLang, text))
                .put("temperature", 0);
        HttpRequest request = HttpRequest.newBuilder()
                .uri(URI.create(config.baseUrl() + "/v1/responses"))
                .timeout(Duration.ofSeconds(60))
                .header("Authorization", "Bearer " + config.apiKey())
                .header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofByteArray(MAPPER.writeValueAsBytes(body)))
                .build();
        HttpResponse<byte[]> response = context.await(http.sendAsync(request, HttpResponse.BodyHandlers.ofByteArray()));
        ensureSuccess("OpenAI responses", response);
        String output = extractOutputText(MAPPER.readTree(response.body()));
        if (output.isBlank()) throw new IOException("OpenAI responses returned no output text");
        return output;
    }

    @Override
    public byte[] ttsAudio(
            RequestContext context,
            String text,
            String voiceOverride,
            String modelOverride,
            String responseFormatOverride,
            String instructionsOverride,
            Double speedOverride
    ) throws IOException {
        if (text == null || text.isBlank()) return new byte[0];
        String model = blankToDefault(modelOverride, config.ttsModel());
        String voice = blankToDefault(voiceOverride, config.ttsVoice());
        String responseFormat = blankToDefault(responseFormatOverride, config.ttsFormat());
        double speed = speedOverride == null ? config.ttsSpeed() : speedOverride;
        var body = MAPPER.createObjectNode()
                .put("model", model)
                .put("voice", voice)
                .put("input", text)
                .put("response_format", responseFormat)
                .put("speed", speed);
        String instructions = blankToDefault(instructionsOverride, config.ttsInstructions());
        if (!instructions.isBlank() && !model.startsWith("tts-1")) body.put("instructions", instructions);
        HttpRequest request = HttpRequest.newBuilder()
                .uri(URI.create(config.baseUrl() + "/v1/audio/speech"))
                .timeout(Duration.ofSeconds(60))
                .header("Authorization", "Bearer " + config.apiKey())
                .header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofByteArray(MAPPER.writeValueAsBytes(body)))
                .build();
        HttpResponse<byte[]> response = context.await(http.sendAsync(request, HttpResponse.BodyHandlers.ofByteArray()));
        ensureSuccess("OpenAI TTS", response);
        return response.body();
    }

    private static void ensureSuccess(String operation, HttpResponse<byte[]> response) throws IOException {
        if (response.statusCode() / 100 == 2) return;
        String body = new String(response.body(), StandardCharsets.UTF_8);
        if (body.length() > 2_000) body = body.substring(0, 2_000);
        throw new IOException(operation + " failed: HTTP " + response.statusCode() + " " + body);
    }

    private static String buildTranslatePrompt(String sourceLang, String targetLang, String text) {
        String source = sourceLang == null || sourceLang.isBlank() ? "auto" : sourceLang.trim();
        String target = targetLang == null || targetLang.isBlank() ? "en" : targetLang.trim();
        return "Task: Translate.\n"
                + "Source language: " + source + "\n"
                + "Target language: " + target + "\n"
                + "Rules:\n"
                + "1) Return ONLY the translation.\n"
                + "2) Preserve meaning, numbers, names, and formatting.\n"
                + "3) If the source is already in target language, return it unchanged.\n\n"
                + "Text:\n" + text;
    }

    private static String extractOutputText(JsonNode responseJson) {
        StringBuilder result = new StringBuilder();
        JsonNode output = responseJson.get("output");
        if (output != null && output.isArray()) {
            for (JsonNode item : output) {
                JsonNode content = item.get("content");
                if (content == null || !content.isArray()) continue;
                for (JsonNode entry : content) {
                    if (!"output_text".equals(entry.path("type").asText(""))) continue;
                    String text = entry.path("text").asText("");
                    if (text.isBlank()) continue;
                    if (!result.isEmpty()) result.append('\n');
                    result.append(text);
                }
            }
        }
        return result.toString().trim();
    }

    private static byte[] buildMultipart(String boundary, byte[] audio, String audioMime, String model, String sourceLang) throws IOException {
        String filename = "audio" + guessExtension(audioMime);
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        writePart(output, boundary, "model", model);
        String language = normalizeLanguageForTranscription(sourceLang);
        if (!language.isBlank()) writePart(output, boundary, "language", language);
        output.write(("--" + boundary + "\r\n").getBytes(StandardCharsets.UTF_8));
        output.write(("Content-Disposition: form-data; name=\"file\"; filename=\"" + filename + "\"\r\n").getBytes(StandardCharsets.UTF_8));
        output.write(("Content-Type: " + audioMime + "\r\n\r\n").getBytes(StandardCharsets.UTF_8));
        output.write(audio);
        output.write("\r\n".getBytes(StandardCharsets.UTF_8));
        output.write(("--" + boundary + "--\r\n").getBytes(StandardCharsets.UTF_8));
        return output.toByteArray();
    }

    private static void writePart(ByteArrayOutputStream output, String boundary, String name, String value) throws IOException {
        output.write(("--" + boundary + "\r\n").getBytes(StandardCharsets.UTF_8));
        output.write(("Content-Disposition: form-data; name=\"" + name + "\"\r\n\r\n").getBytes(StandardCharsets.UTF_8));
        output.write(value.getBytes(StandardCharsets.UTF_8));
        output.write("\r\n".getBytes(StandardCharsets.UTF_8));
    }

    private static String normalizeTranscribeMime(String mime) {
        if (mime == null || mime.isBlank()) return "application/octet-stream";
        String result = mime.trim();
        int separator = result.indexOf(';');
        if (separator >= 0) result = result.substring(0, separator).trim();
        result = result.toLowerCase(Locale.ROOT);
        if ("video/webm".equals(result)) return "audio/webm";
        if ("audio/x-wav".equals(result)) return "audio/wav";
        if ("audio/mp3".equals(result)) return "audio/mpeg";
        if ("audio/x-m4a".equals(result) || "audio/m4a".equals(result)) return "audio/mp4";
        return result;
    }

    private static String normalizeLanguageForTranscription(String sourceLang) {
        if (sourceLang == null) return "";
        String result = sourceLang.trim().toLowerCase(Locale.ROOT);
        if (result.isBlank() || "auto".equals(result)) return "";
        int separator = result.indexOf('-');
        if (separator > 0) result = result.substring(0, separator);
        separator = result.indexOf('_');
        if (separator > 0) result = result.substring(0, separator);
        return result.matches("[a-z]{2,3}") ? result : "";
    }

    private static String guessExtension(String mime) {
        String normalized = Objects.requireNonNullElse(mime, "").toLowerCase(Locale.ROOT);
        if (normalized.contains("webm")) return ".webm";
        if (normalized.contains("wav")) return ".wav";
        if (normalized.contains("mpeg") || normalized.contains("mp3")) return ".mp3";
        if (normalized.contains("mp4") || normalized.contains("m4a")) return ".m4a";
        if (normalized.contains("ogg")) return ".ogg";
        return ".bin";
    }

    private static String blankToDefault(String value, String fallback) {
        return value == null || value.isBlank() ? Objects.requireNonNullElse(fallback, "") : value.trim();
    }

    private static String randomToken(int length) {
        final String alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
        SecureRandom random = new SecureRandom();
        StringBuilder result = new StringBuilder(length);
        for (int index = 0; index < length; index++) result.append(alphabet.charAt(random.nextInt(alphabet.length())));
        return result.toString();
    }
}
