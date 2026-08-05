package local.meettranslator.openai;

import com.fasterxml.jackson.databind.ObjectMapper;
import local.meettranslator.model.InterviewSuggestionRequest;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

class OpenAiClientInterviewProfileTest {
    private static final ObjectMapper MAPPER = new ObjectMapper();

    @Test
    void addsStrictSpeakItRulesForThePolishCustomerSupportProfile() throws Exception {
        var request = InterviewSuggestionRequest.from(MAPPER.readTree("""
                {
                  "question": "Dlaczego chce Pan pracować w obsłudze klienta?",
                  "candidateProfile": {
                    "profileMode": "speakit_polish_support"
                  }
                }
                """));

        String rules = OpenAiClient.profileSpecificInterviewRules(request);
        assertTrue(rules.contains("answer in natural spoken English"));
        assertTrue(rules.contains("prepared library is not a closed list"));
        assertTrue(rules.contains("unsupportedClaims"));
    }

    @Test
    void keepsGeneralProfileFreeOfVacancySpecificRules() throws Exception {
        var request = InterviewSuggestionRequest.from(MAPPER.readTree("""
                {
                  "question": "Tell me about yourself",
                  "candidateProfile": {
                    "profileMode": "general"
                  }
                }
                """));

        assertEquals("", OpenAiClient.profileSpecificInterviewRules(request));
    }
}
