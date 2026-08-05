package local.meettranslator.model;

import com.fasterxml.jackson.databind.ObjectMapper;
import local.meettranslator.http.ApiException;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;

class InterviewUtteranceClassificationRequestTest {
    private final ObjectMapper mapper = new ObjectMapper();

    @Test
    void acceptsBoundedContext() throws Exception {
        var request = InterviewUtteranceClassificationRequest.from(mapper.readTree("""
                {
                  "utterance":"Could you use a different data structure?",
                  "originalTask":"Write Two Sum in Java",
                  "codingLanguage":"java",
                  "currentSolution":{"approachSummary":"Nested loops"},
                  "activeInputs":[{"id":"a","normalizedInput":"Return indexes"}],
                  "recentUtterances":[{"text":"Please improve the complexity"}]
                }
                """));
        assertEquals("Could you use a different data structure?", request.utterance());
        assertEquals(1, request.activeInputs().size());
        assertEquals(1, request.recentUtterances().size());
    }

    @Test
    void rejectsMissingTaskAndOversizedArrays() throws Exception {
        assertThrows(ApiException.class, () -> InterviewUtteranceClassificationRequest.from(mapper.readTree(
                "{\"utterance\":\"Use another approach\"}")));
        StringBuilder items = new StringBuilder("[");
        for (int i = 0; i < 21; i++) {
            if (i > 0) items.append(',');
            items.append("{\"id\":\"").append(i).append("\"}");
        }
        items.append(']');
        String json = "{\"utterance\":\"Use another approach\",\"originalTask\":\"Task\",\"activeInputs\":" + items + "}";
        assertThrows(ApiException.class, () -> InterviewUtteranceClassificationRequest.from(mapper.readTree(json)));
    }
}
