package local.meettranslator.openai;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;

final class EnglishExpectedRecognitionTest {
    @Test
    void recognizesExpectedEnglishMode() {
        assertTrue(EnglishExpectedRecognition.isExpectedMode("en-expected"));
        assertEquals("en", EnglishExpectedRecognition.translationSourceLanguage("en-expected"));
        assertFalse(EnglishExpectedRecognition.isExpectedMode("en"));
    }

    @Test
    void retriesForNonLatinOrBrokenTranscript() {
        assertTrue(EnglishExpectedRecognition.shouldRetry("这是一个数组问题"));
        assertTrue(EnglishExpectedRecognition.shouldRetry("Какой-то неправильный текст"));
        assertTrue(EnglishExpectedRecognition.shouldRetry("\ufffd broken"));
        assertFalse(EnglishExpectedRecognition.shouldRetry("Please implement Two Sum using a HashMap."));
    }

    @Test
    void choosesTheMoreEnglishCandidate() {
        assertEquals(
                "Please explain the time complexity.",
                EnglishExpectedRecognition.chooseBetterCandidate("解释时间复杂度", "Please explain the time complexity.")
        );
        assertEquals(
                "Use a HashMap and return the indices.",
                EnglishExpectedRecognition.chooseBetterCandidate("Use a HashMap and return the indices.", "")
        );
    }
}
