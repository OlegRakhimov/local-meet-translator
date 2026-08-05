package local.meettranslator;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import local.meettranslator.config.BridgeConfig;
import local.meettranslator.http.RequestContext;
import local.meettranslator.http.RequestRegistry;
import local.meettranslator.openai.AiClient;
import local.meettranslator.model.InterviewSuggestionRequest;
import local.meettranslator.model.InterviewUtteranceClassificationRequest;
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
    void createsGroundedInterviewSuggestionWithTypedRequest() throws Exception {
        String body = """
                {
                  "question":"Tell me about a difficult project",
                  "taskKind":"question",
                  "codingLanguage":"",
                  "languageLevel":"B1",
                  "answerStyle":"simple",
                  "candidateProfile":{"targetRole":"Android Developer"},
                  "confirmedFacts":["I built Work Time Calculator from scratch."],
                  "reviewedAnswers":[]
                }
                """;
        HttpRequest request = HttpRequest.newBuilder(URI.create(baseUrl() + "/interview/suggest-answer"))
                .header("X-Auth-Token", "test-token")
                .header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString(body))
                .build();
        HttpResponse<String> response = http.send(request, HttpResponse.BodyHandlers.ofString());
        assertEquals(200, response.statusCode());
        JsonNode json = MAPPER.readTree(response.body());
        assertTrue(json.path("ok").asBoolean());
        assertEquals("I can describe Work Time Calculator.", json.path("suggestion").path("firstSentence").asText());
        assertEquals("high", json.path("suggestion").path("confidence").asText());
    }

    @Test
    void classifiesContextualCodingUtteranceWithTypedRequest() throws Exception {
        String body = """
                {
                  "utterance":"Maybe use a different lookup strategy.",
                  "originalTask":"Write Two Sum in Java.",
                  "codingLanguage":"java",
                  "currentSolution":{"approachSummary":"Nested loops","code":"class Main {}"},
                  "activeInputs":[],
                  "recentUtterances":[]
                }
                """;
        HttpRequest request = HttpRequest.newBuilder(URI.create(baseUrl() + "/interview/classify-utterance"))
                .header("X-Auth-Token", "test-token")
                .header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString(body))
                .build();
        HttpResponse<String> response = http.send(request, HttpResponse.BodyHandlers.ofString());
        assertEquals(200, response.statusCode());
        JsonNode json = MAPPER.readTree(response.body());
        assertEquals("recommendation", json.path("classification").path("type").asText());
        assertEquals("offer-change", json.path("classification").path("action").asText());
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
        public JsonNode suggestInterviewAnswer(RequestContext context, InterviewSuggestionRequest request) {
            ObjectNode suggestion = MAPPER.createObjectNode();
            suggestion.put("firstSentence", "I can describe Work Time Calculator.");
            suggestion.put("answer", "I built the project from scratch and solved technical problems step by step.");
            suggestion.set("keyPoints", MAPPER.createArrayNode().add("Built from scratch"));
            suggestion.set("basis", MAPPER.createArrayNode().add("I built Work Time Calculator from scratch."));
            suggestion.put("confidence", "high");
            suggestion.put("experienceGap", false);
            suggestion.put("safeFallback", "");
            suggestion.put("responseType", "interview_answer");
            suggestion.put("approachSummary", "");
            suggestion.set("implementationPlan", MAPPER.createArrayNode());
            suggestion.put("codeLanguage", "");
            suggestion.put("code", "");
            suggestion.set("codeWalkthrough", MAPPER.createArrayNode());
            suggestion.put("complexity", "");
            suggestion.set("edgeCases", MAPPER.createArrayNode());
            suggestion.set("speakingNotes", MAPPER.createArrayNode());
            return suggestion;
        }

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
        @Override
        public JsonNode classifyInterviewUtterance(RequestContext context, InterviewUtteranceClassificationRequest request) {
            ObjectNode classification = MAPPER.createObjectNode();
            classification.put("type", "recommendation");
            classification.put("target", "algorithm");
            classification.put("action", "offer-change");
            classification.put("normalizedInput", "Consider a different lookup strategy");
            classification.put("changesCurrentSolution", true);
            classification.put("confidence", "high");
            classification.put("reason", "Optional suggestion");
            classification.put("inputOperation", "none");
            classification.set("affectedInputIds", MAPPER.createArrayNode());
            classification.put("mergeWithPrevious", false);
            classification.put("combinedUtterance", "");
            classification.set("verificationCriteria", MAPPER.createArrayNode().add("Avoid nested scanning"));
            return classification;
        }

        @Override
        public byte[] ttsAudio(RequestContext context, String text, String voiceOverride, String modelOverride, String responseFormatOverride, String instructionsOverride, Double speedOverride) throws IOException {
            return text.getBytes(StandardCharsets.UTF_8);
        }
    }
}
