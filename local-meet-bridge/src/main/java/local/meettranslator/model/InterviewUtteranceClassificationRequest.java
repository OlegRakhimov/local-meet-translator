package local.meettranslator.model;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import local.meettranslator.http.ApiException;

public record InterviewUtteranceClassificationRequest(
        String utterance,
        String originalTask,
        String codingLanguage,
        ObjectNode currentSolution,
        ArrayNode activeInputs,
        ArrayNode recentUtterances
) {
    public static InterviewUtteranceClassificationRequest from(JsonNode json) {
        if (json == null || !json.isObject()) {
            throw new ApiException(400, "invalid_request", "Request body must be a JSON object.");
        }
        String utterance = JsonContract.requiredText(json, "utterance", 4_000);
        String originalTask = JsonContract.requiredText(json, "originalTask", 4_000);
        String codingLanguage = JsonContract.text(json, "codingLanguage", "", 80).trim();
        ObjectNode currentSolution = objectCopy(json.get("currentSolution"), "currentSolution", 45_000);
        ArrayNode activeInputs = objectArrayCopy(json.get("activeInputs"), "activeInputs", 20, 40_000);
        ArrayNode recentUtterances = objectArrayCopy(json.get("recentUtterances"), "recentUtterances", 8, 24_000);
        return new InterviewUtteranceClassificationRequest(
                utterance,
                originalTask,
                codingLanguage,
                currentSolution,
                activeInputs,
                recentUtterances
        );
    }

    private static ObjectNode objectCopy(JsonNode value, String field, int maxSerializedLength) {
        if (value == null || value.isNull()) return Factory.objectNode();
        if (!value.isObject()) throw invalid(field, "must be an object");
        if (value.toString().length() > maxSerializedLength) throw invalid(field, "is too large");
        return ((ObjectNode) value).deepCopy();
    }

    private static ArrayNode objectArrayCopy(JsonNode value, String field, int maxItems, int maxSerializedLength) {
        ArrayNode result = Factory.arrayNode();
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

    private static final class Factory {
        private static final com.fasterxml.jackson.databind.ObjectMapper MAPPER = new com.fasterxml.jackson.databind.ObjectMapper();
        static ObjectNode objectNode() { return MAPPER.createObjectNode(); }
        static ArrayNode arrayNode() { return MAPPER.createArrayNode(); }
    }
}
