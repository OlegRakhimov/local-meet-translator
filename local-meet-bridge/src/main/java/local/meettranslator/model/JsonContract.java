package local.meettranslator.model;

import com.fasterxml.jackson.databind.JsonNode;
import local.meettranslator.http.ApiException;

import java.util.Set;

public final class JsonContract {
    private JsonContract() {
    }

    public static String text(JsonNode object, String field, String fallback, int maxLength) {
        JsonNode value = object.get(field);
        if (value == null || value.isNull()) return fallback;
        if (!value.isTextual()) throw invalid(field, "must be a string");
        String text = value.asText();
        if (text.length() > maxLength) throw invalid(field, "exceeds maximum length " + maxLength);
        return text;
    }

    public static String requiredText(JsonNode object, String field, int maxLength) {
        String value = text(object, field, "", maxLength).trim();
        if (value.isEmpty()) throw invalid(field, "must not be empty");
        return value;
    }

    public static Double optionalNumber(JsonNode object, String field, double min, double max) {
        JsonNode value = object.get(field);
        if (value == null || value.isNull()) return null;
        if (!value.isNumber()) throw invalid(field, "must be a number");
        double number = value.asDouble();
        if (!Double.isFinite(number) || number < min || number > max) {
            throw invalid(field, "must be between " + min + " and " + max);
        }
        return number;
    }

    public static JsonNode optionalObject(JsonNode object, String field) {
        JsonNode value = object.get(field);
        if (value == null || value.isNull()) return null;
        if (!value.isObject()) throw invalid(field, "must be an object");
        return value;
    }

    public static String enumText(JsonNode object, String field, String fallback, Set<String> allowed) {
        String value = text(object, field, fallback, 100);
        if (!allowed.contains(value)) throw invalid(field, "contains unsupported value");
        return value;
    }

    private static ApiException invalid(String field, String detail) {
        return new ApiException(400, "invalid_request", field + " " + detail);
    }
}
