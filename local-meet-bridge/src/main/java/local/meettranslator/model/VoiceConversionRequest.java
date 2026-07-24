package local.meettranslator.model;

import com.fasterxml.jackson.databind.JsonNode;

public record VoiceConversionRequest(boolean requested, String modelTag) {
    public static VoiceConversionRequest from(JsonNode json) {
        JsonNode node = JsonContract.optionalObject(json, "voiceConversion");
        if (node == null) return new VoiceConversionRequest(false, "");
        String type = JsonContract.text(node, "type", "", 32);
        String modelTag = JsonContract.text(node, "modelTag", "", 200);
        if (modelTag.isBlank()) modelTag = JsonContract.text(node, "model", "", 200);
        return new VoiceConversionRequest("rvc".equalsIgnoreCase(type), modelTag);
    }
}
