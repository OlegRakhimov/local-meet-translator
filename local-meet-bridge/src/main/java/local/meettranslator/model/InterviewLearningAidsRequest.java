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