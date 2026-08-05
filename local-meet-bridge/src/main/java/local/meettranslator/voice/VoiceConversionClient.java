package local.meettranslator.voice;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import local.meettranslator.http.RequestContext;

import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.Base64;
import java.util.Objects;

public final class VoiceConversionClient {
    private static final ObjectMapper MAPPER = new ObjectMapper();
    private final String baseUrl;
    private final String token;
    private final Duration timeout;
    private final HttpClient http;

    public VoiceConversionClient(String baseUrl, String token, long timeoutMs) {
        this.baseUrl = stripTrailingSlash(Objects.requireNonNull(baseUrl, "baseUrl"));
        this.token = Objects.requireNonNullElse(token, "").trim();
        this.timeout = Duration.ofMillis(Math.max(1_000, timeoutMs));
        this.http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(10)).build();
    }

    public boolean ping(RequestContext context) throws IOException {
        HttpRequest.Builder builder = HttpRequest.newBuilder()
                .uri(URI.create(baseUrl + "/health"))
                .timeout(timeout)
                .GET();
        if (!token.isBlank()) builder.header("X-Auth-Token", token);
        HttpResponse<byte[]> response = context.await(http.sendAsync(builder.build(), HttpResponse.BodyHandlers.ofByteArray()));
        if (response.statusCode() / 100 != 2) return false;
        return MAPPER.readTree(response.body()).path("ok").asBoolean(false);
    }

    public byte[] convertWav(RequestContext context, byte[] wavAudio, String modelTag) throws IOException {
        if (wavAudio == null || wavAudio.length == 0) return wavAudio == null ? new byte[0] : wavAudio;
        var body = MAPPER.createObjectNode()
                .put("audioBase64", Base64.getEncoder().encodeToString(wavAudio))
                .put("audioMime", "audio/wav");
        if (modelTag != null && !modelTag.isBlank()) body.put("modelTag", modelTag.trim());
        HttpRequest.Builder builder = HttpRequest.newBuilder()
                .uri(URI.create(baseUrl + "/convert"))
                .timeout(timeout)
                .header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofByteArray(MAPPER.writeValueAsBytes(body)));
        if (!token.isBlank()) builder.header("X-Auth-Token", token);
        HttpResponse<byte[]> response = context.await(http.sendAsync(builder.build(), HttpResponse.BodyHandlers.ofByteArray()));
        if (response.statusCode() / 100 != 2) {
            throw new IOException("voice-conversion failed: HTTP " + response.statusCode() + " " + new String(response.body(), StandardCharsets.UTF_8));
        }
        JsonNode json = MAPPER.readTree(response.body());
        String encoded = json.path("audioBase64").asText("");
        if (encoded.isBlank()) throw new IOException("voice-conversion response missing audioBase64");
        try {
            return Base64.getDecoder().decode(encoded);
        } catch (IllegalArgumentException error) {
            throw new IOException("voice-conversion returned invalid base64", error);
        }
    }

    private static String stripTrailingSlash(String value) {
        String result = value;
        while (result.endsWith("/")) result = result.substring(0, result.length() - 1);
        return result;
    }
}
