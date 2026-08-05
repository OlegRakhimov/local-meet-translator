package local.meettranslator.model;

import com.fasterxml.jackson.databind.JsonNode;
import local.meettranslator.http.ApiException;

import java.util.Base64;

public record TranscribeAndTranslateRequest(
        byte[] audio,
        String audioMime,
        String sourceLang,
        String targetLang,
        String transcriptionContext
) {
    public static TranscribeAndTranslateRequest from(JsonNode json) {
        String encoded = JsonContract.requiredText(json, "audioBase64", 16_000_000);
        byte[] audio;
        try {
            audio = Base64.getDecoder().decode(encoded);
        } catch (IllegalArgumentException error) {
            throw new ApiException(400, "invalid_request", "audioBase64 is not valid base64", error);
        }
        return new TranscribeAndTranslateRequest(
                audio,
                JsonContract.text(json, "audioMime", "audio/webm", 100),
                JsonContract.text(json, "sourceLang", "auto", 32),
                JsonContract.text(json, "targetLang", "en", 32),
                JsonContract.text(json, "transcriptionContext", "", 1200)
        );
    }
}
