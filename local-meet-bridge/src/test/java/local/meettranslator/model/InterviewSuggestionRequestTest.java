
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
                {"question":"Tell me about yourself","taskKind":"question","codingLanguage":"","languageLevel":"B1","answerStyle":"simple",
                 "candidateProfile":{"targetRole":"Android Developer"},
                 "confirmedFacts":["I use Kotlin."],"reviewedAnswers":[]}
                """));
        assertEquals("Tell me about yourself", request.question());
        assertEquals("question", request.taskKind());
        assertEquals("B1", request.languageLevel());
        assertEquals(1, request.confirmedFacts().size());
        assertTrue(request.currentTask().isBlank());
        assertEquals(0, request.currentSolution().size());
    }

    @Test
    void acceptsCodingTaskMetadata() throws Exception {
        var request = InterviewSuggestionRequest.from(mapper.readTree("""
                {"question":"Write a Java method that finds duplicates in an array.",
                 "taskKind":"coding-task","codingLanguage":"java",
                 "languageLevel":"B1","answerStyle":"technical"}
                """));
        assertEquals("coding-task", request.taskKind());
        assertEquals("java", request.codingLanguage());
    }

    @Test
    void acceptsStructuredCodingContextWithoutInflatingQuestion() throws Exception {
        var request = InterviewSuggestionRequest.from(mapper.readTree("""
                {
                  "question":"Given an integer array, return all duplicates.",
                  "taskKind":"coding-task",
                  "codingLanguage":"java",
                  "currentTask":"Given an integer array, return all duplicates.",
                  "currentSolution":{"approachSummary":"Use a frequency map.","code":"class Main {}"},
                  "activeInputs":[{"id":"input-1","type":"request","normalizedInput":"Handle edge cases explicitly."}],
                  "latestUtterance":"Can you handle edge cases more explicitly?",
                  "recentContext":[{"id":"context-1","type":"constraint","text":"Do not modify the input."}]
                }
                """));
        assertEquals("Given an integer array, return all duplicates.", request.question());
        assertEquals("Can you handle edge cases more explicitly?", request.latestUtterance());
        assertEquals("class Main {}", request.currentSolution().path("code").asText());
        assertEquals(1, request.activeInputs().size());
        assertEquals(1, request.recentContext().size());
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
