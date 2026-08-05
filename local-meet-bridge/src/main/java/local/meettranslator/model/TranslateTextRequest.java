package local.meettranslator.model;

import com.fasterxml.jackson.databind.JsonNode;

public record TranslateTextRequest(String sourceLang, String targetLang, String text) {
    public static TranslateTextRequest from(JsonNode json) {
        return new TranslateTextRequest(
                JsonContract.text(json, "sourceLang", "auto", 32),
                JsonContract.text(json, "targetLang", "en", 32),
                JsonContract.requiredText(json, "text", 500_000)
        );
    }
}
