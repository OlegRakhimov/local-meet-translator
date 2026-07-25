package local.meettranslator.model;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import local.meettranslator.http.ApiException;

import java.util.Set;

public record InterviewSuggestionRequest(
        String question,
        String languageLevel,
        String answerStyle,
        ObjectNode candidateProfile,
        ArrayNode confirmedFacts,
        ArrayNode reviewedAnswers
) {
    private static final Set<String> LEVELS = Set.of("A2", "B1", "B2");
    private static final Set<String> STYLES = Set.of("simple", "technical", "star", "general");

    public static InterviewSuggestionRequest from(JsonNode json) {
        if (json == null || !json.isObject()) throw new ApiException(400, "invalid_request", "Request body must be a JSON object.");
        String question = JsonContract.requiredText(json, "question", 1_600);
        String level = JsonContract.enumText(json, "languageLevel", "B1", LEVELS);
        String style = JsonContract.enumText(json, "answerStyle", "simple", STYLES);
        ObjectNode profile = objectCopy(json.get("candidateProfile"), "candidateProfile", 40_000);
        ArrayNode facts = textArrayCopy(json.get("confirmedFacts"), "confirmedFacts", 120, 1_500);
        ArrayNode answers = objectArrayCopy(json.get("reviewedAnswers"), "reviewedAnswers", 5, 30_000);
        return new InterviewSuggestionRequest(question, level, style, profile, facts, answers);
    }

    private static ObjectNode objectCopy(JsonNode value, String field, int maxSerializedLength) {
        if (value == null || value.isNull()) return JsonContractObjectFactory.objectNode();
        if (!value.isObject()) throw invalid(field, "must be an object");
        if (value.toString().length() > maxSerializedLength) throw invalid(field, "is too large");
        return ((ObjectNode) value).deepCopy();
    }

    private static ArrayNode textArrayCopy(JsonNode value, String field, int maxItems, int maxItemLength) {
        ArrayNode result = JsonContractObjectFactory.arrayNode();
        if (value == null || value.isNull()) return result;
        if (!value.isArray()) throw invalid(field, "must be an array");
        if (value.size() > maxItems) throw invalid(field, "contains too many items");
        for (JsonNode item : value) {
            if (!item.isTextual()) throw invalid(field, "must contain strings only");
            String text = item.asText().trim();
            if (text.length() > maxItemLength) throw invalid(field, "contains an item that is too long");
            if (!text.isEmpty()) result.add(text);
        }
        return result;
    }

    private static ArrayNode objectArrayCopy(JsonNode value, String field, int maxItems, int maxSerializedLength) {
        ArrayNode result = JsonContractObjectFactory.arrayNode();
        if (value == null || value.isNull()) return result;
        if (!value.isArray()) throw invalid(field, "must be an array");
        if (value.size() > maxItems) throw invalid(field, "contains too many items");
        if (value.toString().length() > maxSerializedLength) throw invalid(field, "is too large");
        for (JsonNode item : value) {
            if (!item.isObject()) throw invalid(field, "must contain objects only");
            result.add(item.deepCopy());
        }
        return result;
    }

    private static ApiException invalid(String field, String detail) {
        return new ApiException(400, "invalid_request", field + " " + detail);
    }

    private static final class JsonContractObjectFactory {
        private static final com.fasterxml.jackson.databind.ObjectMapper MAPPER = new com.fasterxml.jackson.databind.ObjectMapper();
        static ObjectNode objectNode() { return MAPPER.createObjectNode(); }
        static ArrayNode arrayNode() { return MAPPER.createArrayNode(); }
    }
}
