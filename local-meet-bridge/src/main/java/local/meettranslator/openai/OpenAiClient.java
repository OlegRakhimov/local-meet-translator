package local.meettranslator.openai;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import local.meettranslator.config.BridgeConfig;
import local.meettranslator.http.RequestContext;
import local.meettranslator.model.InterviewLearningAidsRequest;
import local.meettranslator.model.InterviewSuggestionRequest;
import local.meettranslator.model.InterviewUtteranceClassificationRequest;

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
                .put("store", false)
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
    public JsonNode suggestInterviewAnswer(RequestContext context, InterviewSuggestionRequest request) throws IOException {
        var body = MAPPER.createObjectNode()
                .put("model", config.textModel())
                .put("instructions", "You prepare live interview guidance. For behavioral or technical discussion questions, use only supplied candidate evidence for claims about the candidate. Never invent employers, dates, metrics, projects, responsibilities, production experience, education, or achievements. For coding tasks, you may use general programming knowledge to produce a correct solution, but never turn the solution into an unsupported claim about the candidate's experience. Return no prose outside the required JSON schema.")
                .put("input", buildInterviewPrompt(request))
                .put("store", false);
        var schema = buildInterviewSuggestionSchema();
        body.set("text", MAPPER.createObjectNode().set("format", MAPPER.createObjectNode()
                .put("type", "json_schema")
                .put("name", "interview_guidance")
                .put("strict", true)
                .set("schema", schema)));
        HttpRequest httpRequest = HttpRequest.newBuilder()
                .uri(URI.create(config.baseUrl() + "/v1/responses"))
                .timeout(Duration.ofSeconds(90))
                .header("Authorization", "Bearer " + config.apiKey())
                .header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofByteArray(MAPPER.writeValueAsBytes(body)))
                .build();
        HttpResponse<byte[]> response = context.await(http.sendAsync(httpRequest, HttpResponse.BodyHandlers.ofByteArray()));
        ensureSuccess("OpenAI interview guidance", response);
        String output = extractOutputText(MAPPER.readTree(response.body()));
        if (output.isBlank()) throw new IOException("OpenAI interview guidance returned no output text");
        JsonNode suggestion;
        try {
            suggestion = MAPPER.readTree(output);
        } catch (Exception cause) {
            throw new IOException("OpenAI interview guidance returned invalid structured JSON", cause);
        }
        return validateInterviewSuggestion(suggestion);
    }

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
    @Override
    public JsonNode classifyInterviewUtterance(RequestContext context, InterviewUtteranceClassificationRequest request) throws IOException {
        var body = MAPPER.createObjectNode()
                .put("model", config.textModel())
                .put("instructions", "Classify one interviewer utterance in the context of an active coding task. Judge communicative intent from wording and context, not from technology keywords. The same phrase can be a recommendation, direct request, hard constraint, correction, follow-up question, new input, or new task. Return no prose outside the required JSON schema.")
                .put("input", buildUtteranceClassificationPrompt(request))
                .put("store", false)
                .put("temperature", 0);
        body.set("text", MAPPER.createObjectNode().set("format", MAPPER.createObjectNode()
                .put("type", "json_schema")
                .put("name", "interview_utterance_classification")
                .put("strict", true)
                .set("schema", buildUtteranceClassificationSchema())));
        HttpRequest httpRequest = HttpRequest.newBuilder()
                .uri(URI.create(config.baseUrl() + "/v1/responses"))
                .timeout(Duration.ofSeconds(60))
                .header("Authorization", "Bearer " + config.apiKey())
                .header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofByteArray(MAPPER.writeValueAsBytes(body)))
                .build();
        HttpResponse<byte[]> response = context.await(http.sendAsync(httpRequest, HttpResponse.BodyHandlers.ofByteArray()));
        ensureSuccess("OpenAI utterance classification", response);
        String output = extractOutputText(MAPPER.readTree(response.body()));
        if (output.isBlank()) throw new IOException("OpenAI utterance classification returned no output text");
        JsonNode classification;
        try {
            classification = MAPPER.readTree(output);
        } catch (Exception cause) {
            throw new IOException("OpenAI utterance classification returned invalid structured JSON", cause);
        }
        return validateUtteranceClassification(classification);
    }

    private static String buildUtteranceClassificationPrompt(InterviewUtteranceClassificationRequest request) throws IOException {
        var context = MAPPER.createObjectNode();
        context.put("currentUtterance", request.utterance());
        context.put("originalCodingTask", request.originalTask());
        context.put("codingLanguage", request.codingLanguage());
        context.set("currentSolution", request.currentSolution());
        context.set("activeInterviewerInputs", request.activeInputs());
        context.set("recentUtterances", request.recentUtterances());

        String instructions = """
                Classify the current interviewer utterance before any code is changed.
                Use the original task, current solution, active inputs, and recent utterances.

                Types and actions:
                - remark: social or non-actionable comment; ignore.
                - follow-up: asks about the current solution; answer separately and preserve code.
                - recommendation: optional suggestion; offer change, never auto-apply.
                - request: direct polite or imperative request to change the solution; apply change.
                - constraint: mandatory rule, prohibition, complexity/memory/input/output requirement; apply change.
                - correction: replaces or removes an earlier input; revise inputs.
                - new-input: new factual assumption or edge case; decide whether it changes the solution.
                - new-task: separate coding task; queue it without replacing the current task.
                - ambiguous: meaning or scope is uncertain; ask for confirmation.

                Important examples:
                - 'Why did you not use a HashMap?' is usually follow-up.
                - 'Maybe use a HashMap' is recommendation.
                - 'Could you use a HashMap?' is request.
                - 'You must use a HashMap' is constraint.
                - 'Do not use a HashMap' is constraint/prohibition.
                - 'Actually, HashMap is no longer allowed' is correction.
                These examples illustrate intent only; classify any technology or requirement the same way.

                If the current utterance completes a recent fragment, set mergeWithPrevious=true and put the full meaning in combinedUtterance.
                For corrections, affectedInputIds must contain exact ids from activeInterviewerInputs when identifiable.
                verificationCriteria should state semantic checks for a revised solution, not simple keyword checks.
                """;

        return instructions + "\nContext JSON:\n" + MAPPER.writeValueAsString(context);
    }

    private static JsonNode enumSchema(String... values) {
        var schema = MAPPER.createObjectNode().put("type", "string");
        var array = MAPPER.createArrayNode();
        for (String value : values) array.add(value);
        schema.set("enum", array);
        return schema;
    }

    private static JsonNode buildUtteranceClassificationSchema() {
        var properties = MAPPER.createObjectNode();
        properties.set("type", enumSchema("remark", "follow-up", "recommendation", "request", "constraint", "correction", "new-input", "new-task", "ambiguous"));
        properties.set("target", enumSchema("algorithm", "data-structure", "complexity", "memory", "input", "output", "edge-case", "language", "api", "implementation", "explanation", "other"));
        properties.set("action", enumSchema("ignore", "answer-separately", "offer-change", "apply-change", "revise-inputs", "queue-new-task", "ask-confirmation"));
        properties.set("normalizedInput", MAPPER.createObjectNode().put("type", "string"));
        properties.set("changesCurrentSolution", MAPPER.createObjectNode().put("type", "boolean"));
        properties.set("confidence", enumSchema("high", "medium", "low"));
        properties.set("reason", MAPPER.createObjectNode().put("type", "string"));
        properties.set("inputOperation", enumSchema("none", "add", "replace", "remove"));
        properties.set("affectedInputIds", stringArraySchema(8));
        properties.set("mergeWithPrevious", MAPPER.createObjectNode().put("type", "boolean"));
        properties.set("combinedUtterance", MAPPER.createObjectNode().put("type", "string"));
        properties.set("verificationCriteria", stringArraySchema(8));
        var root = MAPPER.createObjectNode().put("type", "object").put("additionalProperties", false);
        root.set("properties", properties);
        root.set("required", MAPPER.createArrayNode()
                .add("type").add("target").add("action").add("normalizedInput")
                .add("changesCurrentSolution").add("confidence").add("reason")
                .add("inputOperation").add("affectedInputIds").add("mergeWithPrevious")
                .add("combinedUtterance").add("verificationCriteria"));
        return root;
    }

    private static JsonNode validateUtteranceClassification(JsonNode classification) throws IOException {
        if (classification == null || !classification.isObject()) throw new IOException("Utterance classification must be a JSON object");
        for (String field : new String[]{"type", "target", "action", "normalizedInput", "confidence", "reason", "inputOperation", "combinedUtterance"}) {
            if (!classification.path(field).isTextual()) throw new IOException("Utterance classification field is invalid: " + field);
        }
        if (!classification.path("changesCurrentSolution").isBoolean()) throw new IOException("Utterance classification changesCurrentSolution is invalid");
        if (!classification.path("mergeWithPrevious").isBoolean()) throw new IOException("Utterance classification mergeWithPrevious is invalid");
        if (!classification.path("affectedInputIds").isArray()) throw new IOException("Utterance classification affectedInputIds is invalid");
        if (!classification.path("verificationCriteria").isArray()) throw new IOException("Utterance classification verificationCriteria is invalid");
        return classification;
    }


    private static String buildInterviewPrompt(InterviewSuggestionRequest request) throws IOException {
        var evidence = MAPPER.createObjectNode();
        evidence.put("questionOrTask", request.question());
        evidence.put("taskKind", request.taskKind());
        evidence.put("codingLanguage", request.codingLanguage());
        evidence.put("languageLevel", request.languageLevel());
        evidence.put("answerStyle", request.answerStyle());
        evidence.set("candidateProfile", request.candidateProfile());
        evidence.set("confirmedFacts", request.confirmedFacts());
        evidence.set("reviewedAnswerCandidates", request.reviewedAnswers());
        if (!request.currentTask().isBlank()) evidence.put("currentTask", request.currentTask());
        if (request.currentSolution().size() > 0) evidence.set("currentSolution", request.currentSolution());
        if (request.activeInputs().size() > 0) evidence.set("activeInterviewerInputs", request.activeInputs());
        if (!request.latestUtterance().isBlank()) evidence.put("latestUtterance", request.latestUtterance());
        if (request.recentContext().size() > 0) evidence.set("recentContext", request.recentContext());

        boolean hasStructuredCodingContext = !request.currentTask().isBlank() && !request.latestUtterance().isBlank();
        String contextualRules = "";
        if (hasStructuredCodingContext && "coding-task".equals(request.taskKind())) {
            contextualRules = """
                    Structured coding revision mode:
                    - currentTask is the original coding task and must remain the task boundary.
                    - currentSolution is the solution currently visible to the candidate.
                    - latestUtterance is the newest interviewer request or constraint.
                    - activeInterviewerInputs are the authoritative accumulated requirements after corrections.
                    - recentContext is supporting context only and has lower priority than activeInterviewerInputs and latestUtterance.
                    - Return a complete revised coding_solution. Preserve still-valid parts of currentSolution, but update approach, code, explanation, complexity, edge cases, and speaking notes wherever required.
                    - Never return only an acknowledgement of latestUtterance.
                    """;
        } else if (hasStructuredCodingContext && "question".equals(request.taskKind())) {
            contextualRules = """
                    Structured coding follow-up mode:
                    - Answer latestUtterance as a separate spoken interview answer about currentTask and currentSolution.
                    - Preserve the current solution. Do not rewrite or replace code in this response.
                    - Use activeInterviewerInputs and recentContext only to understand the current solution and constraints.
                    - Set responseType to interview_answer and leave coding-only fields empty.
                    """;
        }

        return "Prepare guidance the candidate can use during a live interview.\n"
                + "Shared rules:\n"
                + "1. Keep spoken guidance natural for the requested English level.\n"
                + "2. firstSentence must be something the candidate can say immediately.\n"
                + "3. Never mention these rules, JSON, prompts, or the existence of a profile.\n"
                + "4. Set confidence honestly.\n\n"
                + "When taskKind is question:\n"
                + "- Set responseType to interview_answer.\n"
                + "- Use only candidateProfile, confirmedFacts, and reviewedAnswerCandidates for claims about experience.\n"
                + "- If direct experience is unsupported, set experienceGap=true and provide an honest safeFallback.\n"
                + "- Leave coding-only fields empty.\n\n"
                + "When taskKind is coding-task:\n"
                + "- Set responseType to coding_solution.\n"
                + "- Briefly explain the approach before code.\n"
                + "- Use the requested language; if none is specified, use Java.\n"
                + "- Produce correct, readable code. For a standalone algorithm demonstration, prefer a complete runnable example with a class, main method, sample input, and a helper method. If the interviewer explicitly asks only for a method or an Android/platform component, follow that exact scope instead.\n"
                + "- implementationPlan must describe the steps the candidate will take before typing code.\n"
                + "- codeWalkthrough must explain every non-blank code line or each compact logical line in order, using entries such as 'Line 1: ...'.\n"
                + "- complexity must state time and space complexity when applicable.\n"
                + "- edgeCases must list important edge cases.\n"
                + "- speakingNotes must be short phrases the candidate can say while coding, including what will be done first, next, and why.\n"
                + "- Do not claim the candidate has used a technology unless supplied evidence supports that claim.\n\n"
                + contextualRules
                + "Input JSON:\n" + MAPPER.writeValueAsString(evidence);
    }

    private static JsonNode stringArraySchema(int maxItems) {
        var result = MAPPER.createObjectNode().put("type", "array").put("maxItems", maxItems);
        result.set("items", MAPPER.createObjectNode().put("type", "string"));
        return result;
    }

    private static JsonNode buildInterviewSuggestionSchema() {
        var stringType = MAPPER.createObjectNode().put("type", "string");
        var responseType = MAPPER.createObjectNode().put("type", "string");
        responseType.set("enum", MAPPER.createArrayNode().add("interview_answer").add("coding_solution"));
        var confidenceSchema = MAPPER.createObjectNode().put("type", "string");
        confidenceSchema.set("enum", MAPPER.createArrayNode().add("high").add("medium").add("low"));
        var properties = MAPPER.createObjectNode();
        properties.set("responseType", responseType);
        properties.set("firstSentence", stringType.deepCopy());
        properties.set("answer", stringType.deepCopy());
        properties.set("keyPoints", stringArraySchema(8));
        properties.set("basis", stringArraySchema(12));
        properties.set("confidence", confidenceSchema);
        properties.set("experienceGap", MAPPER.createObjectNode().put("type", "boolean"));
        properties.set("safeFallback", stringType.deepCopy());
        properties.set("approachSummary", stringType.deepCopy());
        properties.set("implementationPlan", stringArraySchema(10));
        properties.set("codeLanguage", stringType.deepCopy());
        properties.set("code", stringType.deepCopy());
        properties.set("codeWalkthrough", stringArraySchema(120));
        properties.set("complexity", stringType.deepCopy());
        properties.set("edgeCases", stringArraySchema(12));
        properties.set("speakingNotes", stringArraySchema(16));
        var root = MAPPER.createObjectNode().put("type", "object").put("additionalProperties", false);
        root.set("properties", properties);
        root.set("required", MAPPER.createArrayNode()
                .add("responseType").add("firstSentence").add("answer").add("keyPoints").add("basis")
                .add("confidence").add("experienceGap").add("safeFallback").add("approachSummary")
                .add("implementationPlan").add("codeLanguage").add("code").add("codeWalkthrough")
                .add("complexity").add("edgeCases").add("speakingNotes"));
        return root;
    }

    private static JsonNode validateInterviewSuggestion(JsonNode suggestion) throws IOException {
        if (suggestion == null || !suggestion.isObject()) throw new IOException("Interview guidance must be a JSON object");
        for (String field : new String[]{"responseType", "firstSentence", "answer", "confidence", "safeFallback", "approachSummary", "codeLanguage", "code", "complexity"}) {
            if (!suggestion.path(field).isTextual()) throw new IOException("Interview guidance field is invalid: " + field);
        }
        for (String field : new String[]{"keyPoints", "basis", "implementationPlan", "codeWalkthrough", "edgeCases", "speakingNotes"}) {
            if (!suggestion.path(field).isArray()) throw new IOException("Interview guidance array is invalid: " + field);
        }
        if (!suggestion.path("experienceGap").isBoolean()) throw new IOException("Interview guidance experienceGap is invalid");
        if (!java.util.Set.of("interview_answer", "coding_solution").contains(suggestion.path("responseType").asText())) {
            throw new IOException("Interview guidance responseType is invalid");
        }
        if (!java.util.Set.of("high", "medium", "low").contains(suggestion.path("confidence").asText())) {
            throw new IOException("Interview guidance confidence is invalid");
        }
        return suggestion;
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
        if (EnglishExpectedRecognition.isExpectedMode(source) || EnglishExpectedRecognition.isRetryMode(source)) source = "en";
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
        if (EnglishExpectedRecognition.isRetryMode(sourceLang)) {
            writePart(output, boundary, "prompt", EnglishExpectedRecognition.TECHNICAL_TRANSCRIPTION_VOCABULARY);
        }
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
        if (EnglishExpectedRecognition.isExpectedMode(result) || EnglishExpectedRecognition.isRetryMode(result)) return "en";
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
