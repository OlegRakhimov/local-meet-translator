package local.meettranslator.openai;

import com.fasterxml.jackson.databind.JsonNode;
import local.meettranslator.http.RequestContext;
import local.meettranslator.model.InterviewSuggestionRequest;
import local.meettranslator.model.InterviewUtteranceClassificationRequest;

import java.io.IOException;

public interface AiClient {
    boolean isTtsEnabled();

    String defaultTtsFormat();

    String transcribe(RequestContext context, byte[] audio, String audioMime, String sourceLang) throws IOException;

    String translateText(RequestContext context, String sourceLang, String targetLang, String text) throws IOException;

    JsonNode suggestInterviewAnswer(RequestContext context, InterviewSuggestionRequest request) throws IOException;

    JsonNode classifyInterviewUtterance(RequestContext context, InterviewUtteranceClassificationRequest request) throws IOException;

    byte[] ttsAudio(
            RequestContext context,
            String text,
            String voiceOverride,
            String modelOverride,
            String responseFormatOverride,
            String instructionsOverride,
            Double speedOverride
    ) throws IOException;
}
