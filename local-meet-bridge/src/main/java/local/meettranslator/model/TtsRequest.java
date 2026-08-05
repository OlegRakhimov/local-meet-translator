package local.meettranslator.model;

import com.fasterxml.jackson.databind.JsonNode;

public record TtsRequest(
        String text,
        String voice,
        String model,
        String responseFormat,
        String instructions,
        Double speed,
        VoiceConversionRequest voiceConversion
) {
    public static TtsRequest from(JsonNode json) {
        return new TtsRequest(
                JsonContract.requiredText(json, "text", 200_000),
                JsonContract.text(json, "voice", "", 100),
                JsonContract.text(json, "model", "", 200),
                JsonContract.text(json, "response_format", "", 32),
                JsonContract.text(json, "instructions", "", 20_000),
                JsonContract.optionalNumber(json, "speed", 0.25, 4.0),
                VoiceConversionRequest.from(json)
        );
    }
}
