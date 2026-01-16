package local.meettranslator;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.sun.net.httpserver.Headers;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.net.URI;
import java.net.http.HttpClient;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.time.Duration;
import java.util.Base64;
import java.util.Locale;
import java.util.Objects;

/**
 * Local Meet Translator Bridge
 *
 * Goals:
 *  - Keep OPENAI_API_KEY only on your PC (server-side), not in the browser extension.
 *  - Provide localhost endpoints for the extension:
 *      GET  /health
 *      POST /translate-text
 *      POST /transcribe-and-translate
 *      POST /tts (optional; disabled by default)
 *
 * Security:
 *  - Requires header X-Auth-Token == LOCAL_MEET_TRANSLATOR_TOKEN.
 *  - Binds to 127.0.0.1 only.
 */
public final class Main {

    private static final ObjectMapper MAPPER = new ObjectMapper();

    public static void main(String[] args) throws Exception {
        String apiKey = envRequired("OPENAI_API_KEY");

        String baseUrl = envOr("OPENAI_BASE_URL", "https://api.openai.com");
        int port = Integer.parseInt(envOr("LOCAL_MEET_TRANSLATOR_PORT", "8799"));

        // Models
        String transcribeModel = envOr("OPENAI_TRANSCRIBE_MODEL", "whisper-1");
        String textModel = envOr("OPENAI_TEXT_MODEL", "gpt-4o-mini");

        // Optional TTS (disabled by default)
        boolean enableTts = Boolean.parseBoolean(envOr("ENABLE_TTS", "false"));
        String ttsModel = envOr("OPENAI_TTS_MODEL", "gpt-4o-mini-tts");
        String ttsVoice = envOr("OPENAI_TTS_VOICE", "onyx"); // You can change later
        String ttsFormat = envOr("OPENAI_TTS_FORMAT", "mp3"); // mp3, wav, opus, aac, flac, pcm
        String ttsInstructions = envOr("OPENAI_TTS_INSTRUCTIONS", ""); // optional, for gpt-4o-mini-tts
        double ttsSpeed = Double.parseDouble(envOr("OPENAI_TTS_SPEED", "1.0"));

        // Local auth token
        String authToken = envOr("LOCAL_MEET_TRANSLATOR_TOKEN", randomToken(40));

        OpenAiClient client = new OpenAiClient(baseUrl, apiKey, transcribeModel, textModel, enableTts, ttsModel, ttsVoice, ttsFormat, ttsInstructions, ttsSpeed);

        HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", port), 0);

        server.createContext("/health", ex -> {
            if (!corsAndMethod(ex, "GET")) return;
            if (!checkAuth(ex, authToken)) return;

            try {
                writeJson(ex, 200, MAPPER.createObjectNode()
                        .put("ok", true)
                        .put("service", "local-meet-translator-bridge"));
            } catch (Exception e) {
                e.printStackTrace(System.err);
                try {
                    writeError(ex, 500, "Internal error: " + safeErr(e));
                } catch (Exception ignore) {
                    // ignore
                }
            }
        });

        server.createContext("/translate-text", ex -> {
            if (!corsAndMethod(ex, "POST")) return;
            if (!checkAuth(ex, authToken)) return;

            try {
                byte[] body = readBodyLimited(ex, 1_000_000);
                JsonNode req = MAPPER.readTree(body);

                String sourceLang = textOr(req, "sourceLang", "auto");
                String targetLang = textOr(req, "targetLang", "ru");
                String text = textOr(req, "text", "");

                if (text.isBlank()) {
                    writeError(ex, 400, "text is empty");
                    return;
                }

                String translation = client.translateText(sourceLang, targetLang, text);

                writeJson(ex, 200, MAPPER.createObjectNode()
                        .put("sourceLang", sourceLang)
                        .put("targetLang", targetLang)
                        .put("translation", translation));
            } catch (Exception e) {
                e.printStackTrace(System.err);
                try {
                    writeError(ex, 500, "Internal error: " + safeErr(e));
                } catch (Exception ignore) {
                    // ignore
                }
            }
        });

        server.createContext("/transcribe-and-translate", ex -> {
            if (!corsAndMethod(ex, "POST")) return;
            if (!checkAuth(ex, authToken)) return;

            try {
                byte[] body = readBodyLimited(ex, 12_000_000);
                JsonNode req = MAPPER.readTree(body);

                String audioBase64 = textOr(req, "audioBase64", "");
                String audioMime = textOr(req, "audioMime", "audio/webm");
                String sourceLang = textOr(req, "sourceLang", "auto");
                String targetLang = textOr(req, "targetLang", "ru");

                if (audioBase64.isBlank()) {
                    writeError(ex, 400, "audioBase64 is empty");
                    return;
                }

                byte[] audioBytes;
                try {
                    audioBytes = Base64.getDecoder().decode(audioBase64);
                } catch (IllegalArgumentException e) {
                    writeError(ex, 400, "audioBase64 is not valid base64");
                    return;
                }

                String transcript = client.transcribe(audioBytes, audioMime);

                // If the chunk is silence, transcription can be empty.
                // Treat that as a valid (empty) result to avoid spamming HTTP 500.
                if (transcript == null || transcript.isBlank()) {
                    writeJson(ex, 200, MAPPER.createObjectNode()
                            .put("audioMime", audioMime)
                            .put("sourceLang", sourceLang)
                            .put("targetLang", targetLang)
                            .put("transcript", "")
                            .put("translation", ""));
                    return;
                }

                String translation = client.translateText(sourceLang, targetLang, transcript);

                writeJson(ex, 200, MAPPER.createObjectNode()
                        .put("audioMime", audioMime)
                        .put("sourceLang", sourceLang)
                        .put("targetLang", targetLang)
                        .put("transcript", transcript)
                        .put("translation", translation));
            } catch (Exception e) {
                e.printStackTrace(System.err);
                try {
                    writeError(ex, 500, "Internal error: " + safeErr(e));
                } catch (Exception ignore) {
                    // ignore
                }
            }
        });

        server.createContext("/tts", ex -> {
            if (!corsAndMethod(ex, "POST")) return;
            if (!checkAuth(ex, authToken)) return;

            try {
                if (!client.isTtsEnabled()) {
                    writeError(ex, 403, "TTS is disabled. Set ENABLE_TTS=true and restart.");
                    return;
                }

                byte[] body = readBodyLimited(ex, 1_500_000);
                JsonNode req = MAPPER.readTree(body);

                String text = textOr(req, "text", "");
                if (text.isBlank()) {
                    writeError(ex, 400, "text is empty");
                    return;
                }

                String voice = textOr(req, "voice", "");
                String model = textOr(req, "model", "");
                String responseFormat = textOr(req, "response_format", "");
                String instructions = textOr(req, "instructions", "");
                Double speed = null;
                JsonNode speedNode = req.get("speed");
                if (speedNode != null && speedNode.isNumber()) {
                    speed = speedNode.asDouble();
                }

                byte[] audio = client.ttsAudio(text,
                        (voice == null || voice.isBlank()) ? null : voice,
                        (model == null || model.isBlank()) ? null : model,
                        (responseFormat == null || responseFormat.isBlank()) ? null : responseFormat,
                        (instructions == null || instructions.isBlank()) ? null : instructions,
                        speed);
                String fmt = (responseFormat == null || responseFormat.isBlank()) ? ttsFormat : responseFormat;
                String mime = guessAudioMime(fmt);
                String b64 = Base64.getEncoder().encodeToString(audio);

                writeJson(ex, 200, MAPPER.createObjectNode()
                        .put("audioMime", mime)
                        .put("audioBase64", b64));
            } catch (Exception e) {
                e.printStackTrace(System.err);
                try {
                    writeError(ex, 500, "Internal error: " + safeErr(e));
                } catch (Exception ignore) {
                    // ignore
                }
            }
        });

        server.setExecutor(null);
        server.start();

        System.out.println("Local Meet Translator bridge started");
        System.out.println("  URL:   http://127.0.0.1:" + port);
        System.out.println("  TOKEN: " + authToken);
        if (!enableTts) {
            System.out.println("  TTS:   disabled (set ENABLE_TTS=true later)");
        } else {
            System.out.println("  TTS:   enabled model=" + ttsModel + " voice=" + ttsVoice);
        }
    }

    private static String safeErr(Exception e) {
        String msg = e.getMessage();
        if (msg == null || msg.isBlank()) msg = e.getClass().getSimpleName();
        return e.getClass().getSimpleName() + ": " + msg;
    }

    // -------------------- OpenAI client --------------------

    static final class OpenAiClient {
        private final String baseUrl;
        private final String apiKey;
        private final String transcribeModel;
        private final String textModel;

        private final boolean enableTts;
        private final String ttsModel;
        private final String ttsVoice;
        private final String ttsFormat;
        private final String ttsInstructions;
        private final double ttsSpeed;

        private final HttpClient http;

        OpenAiClient(String baseUrl,
                     String apiKey,
                     String transcribeModel,
                     String textModel,
                     boolean enableTts,
                     String ttsModel,
                     String ttsVoice,
                     String ttsFormat,
                     String ttsInstructions,
                     double ttsSpeed) {
            this.baseUrl = stripTrailingSlash(Objects.requireNonNull(baseUrl));
            this.apiKey = Objects.requireNonNull(apiKey);
            this.transcribeModel = Objects.requireNonNull(transcribeModel);
            this.textModel = Objects.requireNonNull(textModel);
            this.enableTts = enableTts;
            this.ttsModel = Objects.requireNonNull(ttsModel);
            this.ttsVoice = Objects.requireNonNull(ttsVoice);
            this.ttsFormat = Objects.requireNonNull(ttsFormat);
            this.ttsInstructions = ttsInstructions == null ? "" : ttsInstructions;
            this.ttsSpeed = ttsSpeed;
            this.http = HttpClient.newBuilder()
                    .connectTimeout(Duration.ofSeconds(20))
                    .build();
        }

        boolean isTtsEnabled() {
            return enableTts;
        }

        

        String getDefaultTtsFormat() {
            return ttsFormat;
        }
        private static String normalizeTranscribeMime(String mime) {
            if (mime == null) return "application/octet-stream";
            String m = mime.trim();
            if (m.isEmpty()) return "application/octet-stream";

            // MediaRecorder often reports a full type like: audio/webm;codecs=opus
            int semi = m.indexOf(';');
            if (semi >= 0) m = m.substring(0, semi).trim();

            m = m.toLowerCase(Locale.ROOT);

            // Some browsers produce video/webm even for audio-only streams.
            if ("video/webm".equals(m)) return "audio/webm";

            // Normalize common aliases.
            if ("audio/x-wav".equals(m)) return "audio/wav";
            if ("audio/mp3".equals(m)) return "audio/mpeg";
            if ("audio/x-m4a".equals(m) || "audio/m4a".equals(m)) return "audio/mp4";

            return m;
        }

String transcribe(byte[] audio, String audioMime) throws IOException {
            String endpoint = baseUrl + "/v1/audio/transcriptions";

            String boundary = "----LocalMeetTranslatorBoundary" + randomToken(12);
            byte[] multipart = buildMultipart(boundary, audio, normalizeTranscribeMime(audioMime), transcribeModel);

            java.net.http.HttpRequest request = java.net.http.HttpRequest.newBuilder()
                    .uri(URI.create(endpoint))
                    .timeout(Duration.ofSeconds(120))
                    .header("Authorization", "Bearer " + apiKey)
                    .header("Content-Type", "multipart/form-data; boundary=" + boundary)
                    .POST(java.net.http.HttpRequest.BodyPublishers.ofByteArray(multipart))
                    .build();

            java.net.http.HttpResponse<byte[]> resp;
            try {
                resp = http.send(request, java.net.http.HttpResponse.BodyHandlers.ofByteArray());
            } catch (InterruptedException ie) {
                Thread.currentThread().interrupt();
                throw new IOException("OpenAI transcribe interrupted", ie);
            }

            if (resp.statusCode() / 100 != 2) {
                throw new IOException("OpenAI transcribe failed: HTTP " + resp.statusCode() + " " + new String(resp.body(), StandardCharsets.UTF_8));
            }

            JsonNode json = MAPPER.readTree(resp.body());
            JsonNode textNode = json.get("text");
            if (textNode == null || textNode.isNull()) {
                throw new IOException("OpenAI transcribe response has no 'text': " + json);
            }
            // NOTE: Whisper may return an empty string for silence. Treat that as a valid result.
            return textNode.asText("");
        }

        String translateText(String sourceLang, String targetLang, String text) throws IOException {
            if (text == null || text.isBlank()) {
                return "";
            }

            String endpoint = baseUrl + "/v1/responses";

            String prompt = buildTranslatePrompt(sourceLang, targetLang, text);

            var body = MAPPER.createObjectNode()
                    .put("model", textModel)
                    .put("input", prompt)
                    .put("temperature", 0);

            byte[] jsonBytes = MAPPER.writeValueAsBytes(body);

            java.net.http.HttpRequest request = java.net.http.HttpRequest.newBuilder()
                    .uri(URI.create(endpoint))
                    .timeout(Duration.ofSeconds(60))
                    .header("Authorization", "Bearer " + apiKey)
                    .header("Content-Type", "application/json")
                    .POST(java.net.http.HttpRequest.BodyPublishers.ofByteArray(jsonBytes))
                    .build();

            java.net.http.HttpResponse<byte[]> resp;
            try {
                resp = http.send(request, java.net.http.HttpResponse.BodyHandlers.ofByteArray());
            } catch (InterruptedException ie) {
                Thread.currentThread().interrupt();
                throw new IOException("OpenAI translate interrupted", ie);
            }

            if (resp.statusCode() / 100 != 2) {
                throw new IOException("OpenAI responses failed: HTTP " + resp.statusCode() + " " + new String(resp.body(), StandardCharsets.UTF_8));
            }

            JsonNode json = MAPPER.readTree(resp.body());
            String extracted = extractOutputText(json);
            if (extracted.isBlank()) {
                throw new IOException("OpenAI responses returned no output_text: " + json);
            }
            return extracted;
        }

        byte[] ttsAudio(String text,
                        String voiceOverride,
                        String modelOverride,
                        String responseFormatOverride,
                        String instructionsOverride,
                        Double speedOverride) throws IOException {
            if (text == null || text.isBlank()) {
                return new byte[0];
            }
        
            String endpoint = baseUrl + "/v1/audio/speech";
        
            String model = (modelOverride == null || modelOverride.isBlank()) ? ttsModel : modelOverride.trim();
            String voice = (voiceOverride == null || voiceOverride.isBlank()) ? ttsVoice : voiceOverride.trim();
            String responseFormat = (responseFormatOverride == null || responseFormatOverride.isBlank()) ? ttsFormat : responseFormatOverride.trim();
            double speed = (speedOverride == null) ? ttsSpeed : speedOverride;
        
            var body = MAPPER.createObjectNode()
                    .put("model", model)
                    .put("voice", voice)
                    .put("input", text)
                    .put("response_format", responseFormat)
                    .put("speed", speed);
        
            String instructions = (instructionsOverride == null || instructionsOverride.isBlank()) ? ttsInstructions : instructionsOverride;
            if (instructions != null && !instructions.isBlank() && !model.startsWith("tts-1")) {
                body.put("instructions", instructions);
            }
        
            byte[] jsonBytes = MAPPER.writeValueAsBytes(body);
        
            java.net.http.HttpRequest request = java.net.http.HttpRequest.newBuilder()
                    .uri(URI.create(endpoint))
                    .timeout(Duration.ofSeconds(60))
                    .header("Authorization", "Bearer " + apiKey)
                    .header("Content-Type", "application/json")
                    .POST(java.net.http.HttpRequest.BodyPublishers.ofByteArray(jsonBytes))
                    .build();
        
            java.net.http.HttpResponse<byte[]> resp;
            try {
                resp = http.send(request, java.net.http.HttpResponse.BodyHandlers.ofByteArray());
            } catch (InterruptedException ie) {
                Thread.currentThread().interrupt();
                throw new IOException("OpenAI TTS interrupted", ie);
            }
        
            if (resp.statusCode() / 100 != 2) {
                throw new IOException("OpenAI TTS failed: HTTP " + resp.statusCode() + " " + new String(resp.body(), StandardCharsets.UTF_8));
            }
            return resp.body();
        }
        
                private static String buildTranslatePrompt(String sourceLang, String targetLang, String text) {
            String src = (sourceLang == null || sourceLang.isBlank()) ? "auto" : sourceLang.trim();
            String tgt = (targetLang == null || targetLang.isBlank()) ? "ru" : targetLang.trim();

            return ""
                    + "Task: Translate.\n"
                    + "Source language: " + src + "\n"
                    + "Target language: " + tgt + "\n"
                    + "Rules:\n"
                    + "1) Return ONLY the translation.\n"
                    + "2) Preserve meaning, numbers, names, and formatting.\n"
                    + "3) If the source is already in target language, return it unchanged.\n"
                    + "\n"
                    + "Text:\n"
                    + text;
        }

        private static String extractOutputText(JsonNode responseJson) {
            StringBuilder sb = new StringBuilder();

            JsonNode output = responseJson.get("output");
            if (output != null && output.isArray()) {
                for (JsonNode item : output) {
                    JsonNode content = item.get("content");
                    if (content != null && content.isArray()) {
                        for (JsonNode c : content) {
                            String type = c.path("type").asText("");
                            if ("output_text".equals(type)) {
                                String t = c.path("text").asText("");
                                if (!t.isBlank()) {
                                    if (sb.length() > 0) sb.append("\n");
                                    sb.append(t);
                                }
                            }
                        }
                    }
                }
            }
            return sb.toString().trim();
        }

        private static byte[] buildMultipart(String boundary, byte[] audioBytes, String audioMime, String model) throws IOException {
            String filename = "audio" + guessExt(audioMime);

            ByteArrayOutputStream out = new ByteArrayOutputStream();

            out.write(("--" + boundary + "\r\n").getBytes(StandardCharsets.UTF_8));
            out.write(("Content-Disposition: form-data; name=\"model\"\r\n\r\n").getBytes(StandardCharsets.UTF_8));
            out.write(model.getBytes(StandardCharsets.UTF_8));
            out.write("\r\n".getBytes(StandardCharsets.UTF_8));

            out.write(("--" + boundary + "\r\n").getBytes(StandardCharsets.UTF_8));
            out.write(("Content-Disposition: form-data; name=\"file\"; filename=\"" + filename + "\"\r\n").getBytes(StandardCharsets.UTF_8));
            out.write(("Content-Type: " + audioMime + "\r\n\r\n").getBytes(StandardCharsets.UTF_8));
            out.write(audioBytes);
            out.write("\r\n".getBytes(StandardCharsets.UTF_8));

            out.write(("--" + boundary + "--\r\n").getBytes(StandardCharsets.UTF_8));

            return out.toByteArray();
        }

        private static String guessExt(String mime) {
            if (mime == null) return ".bin";
            String m = mime.toLowerCase(Locale.ROOT);
            if (m.contains("webm")) return ".webm";
            if (m.contains("wav")) return ".wav";
            if (m.contains("mpeg") || m.contains("mp3")) return ".mp3";
            if (m.contains("mp4") || m.contains("m4a")) return ".m4a";
            if (m.contains("ogg")) return ".ogg";
            return ".bin";
        }

        private static String stripTrailingSlash(String s) {
            while (s.endsWith("/")) s = s.substring(0, s.length() - 1);
            return s;
        }
    }

    // -------------------- HTTP helpers --------------------

    private static boolean corsAndMethod(HttpExchange ex, String expectedMethod) throws IOException {
        addCors(ex.getResponseHeaders());

        if ("OPTIONS".equalsIgnoreCase(ex.getRequestMethod())) {
            ex.sendResponseHeaders(204, -1);
            ex.close();
            return false;
        }

        if (!expectedMethod.equalsIgnoreCase(ex.getRequestMethod())) {
            writeError(ex, 405, "Method not allowed");
            return false;
        }
        return true;
    }

    private static void addCors(Headers h) {
        h.set("Access-Control-Allow-Origin", "*");
        h.set("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
        h.set("Access-Control-Allow-Headers", "Content-Type,X-Auth-Token");
        h.set("Access-Control-Max-Age", "600");
    }

    private static boolean checkAuth(HttpExchange ex, String expectedToken) throws IOException {
        String token = ex.getRequestHeaders().getFirst("X-Auth-Token");
        if (token == null || !token.equals(expectedToken)) {
            writeError(ex, 401, "Missing or invalid X-Auth-Token");
            return false;
        }
        return true;
    }

    private static byte[] readBodyLimited(HttpExchange ex, int maxBytes) throws IOException {
        try (InputStream in = ex.getRequestBody();
             ByteArrayOutputStream out = new ByteArrayOutputStream()) {

            byte[] buf = new byte[8192];
            int total = 0;
            int n;
            while ((n = in.read(buf)) != -1) {
                total += n;
                if (total > maxBytes) {
                    throw new IOException("Request body too large (limit " + maxBytes + " bytes)");
                }
                out.write(buf, 0, n);
            }
            return out.toByteArray();
        }
    }

    private static void writeError(HttpExchange ex, int status, String message) throws IOException {
        writeJson(ex, status, MAPPER.createObjectNode()
                .put("ok", false)
                .put("error", message));
    }

    private static void writeJson(HttpExchange ex, int status, JsonNode json) throws IOException {
        byte[] bytes = MAPPER.writeValueAsBytes(json);
        ex.getResponseHeaders().set("Content-Type", "application/json; charset=utf-8");
        addCors(ex.getResponseHeaders());
        ex.sendResponseHeaders(status, bytes.length);
        try (OutputStream os = ex.getResponseBody()) {
            os.write(bytes);
        } finally {
            ex.close();
        }
    }

    private static String textOr(JsonNode node, String field, String def) {
        if (node == null) return def;
        JsonNode v = node.get(field);
        if (v == null || v.isNull()) return def;
        String s = v.asText(def);
        return s == null ? def : s;
    }


    private static String guessAudioMime(String responseFormat) {
        if (responseFormat == null) return "audio/mpeg";
        String f = responseFormat.trim().toLowerCase(Locale.ROOT);
        return switch (f) {
            case "mp3" -> "audio/mpeg";
            case "wav" -> "audio/wav";
            case "flac" -> "audio/flac";
            case "aac" -> "audio/aac";
            case "opus" -> "audio/opus";
            case "pcm" -> "audio/pcm";
            default -> "application/octet-stream";
        };
    }

    private static String envOr(String name, String def) {
        String v = System.getenv(name);
        return (v == null || v.isBlank()) ? def : v.trim();
    }

    private static String envRequired(String name) {
        String v = System.getenv(name);
        if (v == null || v.isBlank()) {
            throw new IllegalStateException("Missing required environment variable: " + name);
        }
        return v.trim();
    }

    private static String randomToken(int len) {
        final String alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
        SecureRandom rnd = new SecureRandom();
        StringBuilder sb = new StringBuilder(len);
        for (int i = 0; i < len; i++) sb.append(alphabet.charAt(rnd.nextInt(alphabet.length())));
        return sb.toString();
    }
}
