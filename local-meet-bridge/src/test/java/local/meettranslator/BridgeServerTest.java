package local.meettranslator;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import local.meettranslator.config.BridgeConfig;
import local.meettranslator.http.RequestContext;
import local.meettranslator.http.RequestRegistry;
import local.meettranslator.openai.AiClient;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;

import static org.junit.jupiter.api.Assertions.*;

class BridgeServerTest {
    private static final ObjectMapper MAPPER = new ObjectMapper();
    private BridgeServer server;
    private HttpClient http;
    private int port;

    @BeforeEach
    void startServer() throws Exception {
        BridgeConfig config = new BridgeConfig(
                "test-key",
                "https://example.invalid",
                0,
                "test-transcribe",
                "test-text",
                true,
                "test-tts",
                "onyx",
                "mp3",
                "",
                1.0,
                false,
                "http://127.0.0.1:18799",
                "",
                true,
                180_000,
                "test-token"
        );
        server = new BridgeServer(config, new FakeAiClient(), null, new RequestRegistry());
        port = server.start();
        http = HttpClient.newHttpClient();
    }

    @AfterEach
    void stopServer() {
        if (server != null) server.close();
    }

    @Test
    void healthRequiresAuthenticationAndUsesStructuredError() throws Exception {
        HttpResponse<String> response = http.send(
                HttpRequest.newBuilder(URI.create(baseUrl() + "/health")).GET().build(),
                HttpResponse.BodyHandlers.ofString()
        );
        assertEquals(401, response.statusCode());
        JsonNode json = MAPPER.readTree(response.body());
        assertFalse(json.path("ok").asBoolean(true));
        assertEquals("invalid_auth_token", json.path("code").asText());
        assertFalse(json.path("requestId").asText().isBlank());
        assertTrue(response.headers().firstValue("X-Request-Id").isPresent());
    }

    @Test
    void translatesTextWithTypedRequest() throws Exception {
        HttpRequest request = HttpRequest.newBuilder(URI.create(baseUrl() + "/translate-text"))
                .header("X-Auth-Token", "test-token")
                .header("X-Request-Id", "translation-test")
                .header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString("{\"sourceLang\":\"en\",\"targetLang\":\"ru\",\"text\":\"Hello\"}"))
                .build();
        HttpResponse<String> response = http.send(request, HttpResponse.BodyHandlers.ofString());
        assertEquals(200, response.statusCode());
        assertEquals("translation-test", response.headers().firstValue("X-Request-Id").orElseThrow());
        JsonNode json = MAPPER.readTree(response.body());
        assertEquals("translated:Hello", json.path("translation").asText());
    }

    @Test
    void rejectsMalformedJsonWithoutStackTrace() throws Exception {
        HttpRequest request = HttpRequest.newBuilder(URI.create(baseUrl() + "/translate-text"))
                .header("X-Auth-Token", "test-token")
                .header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString("{"))
                .build();
        HttpResponse<String> response = http.send(request, HttpResponse.BodyHandlers.ofString());
        assertEquals(400, response.statusCode());
        JsonNode json = MAPPER.readTree(response.body());
        assertEquals("invalid_json", json.path("code").asText());
        assertFalse(response.body().contains("Exception"));
    }

    private String baseUrl() {
        return "http://127.0.0.1:" + port;
    }

    private static final class FakeAiClient implements AiClient {
        @Override
        public boolean isTtsEnabled() {
            return true;
        }

        @Override
        public String defaultTtsFormat() {
            return "mp3";
        }

        @Override
        public String transcribe(RequestContext context, byte[] audio, String audioMime, String sourceLang) {
            return new String(audio, StandardCharsets.UTF_8);
        }

        @Override
        public String translateText(RequestContext context, String sourceLang, String targetLang, String text) {
            return "translated:" + text;
        }

        @Override
        public byte[] ttsAudio(RequestContext context, String text, String voiceOverride, String modelOverride, String responseFormatOverride, String instructionsOverride, Double speedOverride) throws IOException {
            return text.getBytes(StandardCharsets.UTF_8);
        }
    }
}
