package local.meettranslator.model;

import com.fasterxml.jackson.databind.ObjectMapper;
import local.meettranslator.http.ApiException;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;

class InterviewSuggestionRequestTest {
    private final ObjectMapper mapper = new ObjectMapper();

    @Test
    void acceptsBoundedGroundedRequest() throws Exception {
        var request = InterviewSuggestionRequest.from(mapper.readTree("""
                {"question":"Tell me about yourself","languageLevel":"B1","answerStyle":"simple",
                 "candidateProfile":{"targetRole":"Android Developer"},
                 "confirmedFacts":["I use Kotlin."],"reviewedAnswers":[]}
                """));
        assertEquals("Tell me about yourself", request.question());
        assertEquals("B1", request.languageLevel());
        assertEquals(1, request.confirmedFacts().size());
    }

    @Test
    void rejectsUnsupportedLevelAndOversizedArrays() throws Exception {
        assertThrows(ApiException.class, () -> InterviewSuggestionRequest.from(mapper.readTree(
                "{\"question\":\"Why?\",\"languageLevel\":\"C2\",\"answerStyle\":\"simple\"}")));
        StringBuilder facts = new StringBuilder("[");
        for (int i = 0; i < 121; i++) {
            if (i > 0) facts.append(',');
            facts.append("\"fact").append(i).append("\"");
        }
        facts.append(']');
        String json = "{\"question\":\"Tell me?\",\"confirmedFacts\":" + facts + "}";
        assertThrows(ApiException.class, () -> InterviewSuggestionRequest.from(mapper.readTree(json)));
    }
}
