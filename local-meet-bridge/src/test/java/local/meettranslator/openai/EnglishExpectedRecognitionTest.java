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
        assertTrue(EnglishExpectedRecognition.shouldRetry("Please implement Two Sum using a HashMap."));
        assertFalse(EnglishExpectedRecognition.shouldRetry(new TranscriptionResult(
                "Please implement Two Sum using a HashMap.", "en", -0.20, 0.02, "high"
        )));
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

    @Test
    void forcesEnglishAndUsesRecentContextWithoutRepeatingIt() {
        String prompt = EnglishExpectedRecognition.transcriptionPrompt(
                EnglishExpectedRecognition.PRIMARY_MODE,
                "The interviewer asked about customer support experience."
        );
        assertTrue(prompt.contains("exact words in English"));
        assertTrue(prompt.contains("Recent accepted transcript context"));
        assertEquals("en", EnglishExpectedRecognition.translationSourceLanguage(EnglishExpectedRecognition.RETRY_MODE));
    }

    @Test
    void rejectsDetectedNonEnglishLanguageAndLowAgreement() {
        TranscriptionResult nonEnglish = new TranscriptionResult(
                "Dlaczego chcesz pracować w obsłudze klienta?", "pl", -0.15, 0.02, "high"
        );
        assertTrue(EnglishExpectedRecognition.shouldRetry(nonEnglish));
        assertFalse(EnglishExpectedRecognition.isTrusted(nonEnglish, TranscriptionResult.unknown("")));

        TranscriptionResult chosen = new TranscriptionResult(
                "Why do you want to work in customer support?", "en", -0.55, 0.12, "medium"
        );
        TranscriptionResult alternate = new TranscriptionResult(
                "Where do we want to go after customer support?", "en", -1.10, 0.45, "low"
        );
        assertTrue(EnglishExpectedRecognition.candidateAgreement(chosen.text(), alternate.text()) < 0.50);
        assertFalse(EnglishExpectedRecognition.isTrusted(chosen, alternate));
    }

    @Test
    void acceptsTwoConsistentUnknownResultsButNotOneUnverifiedResult() {
        TranscriptionResult chosen = TranscriptionResult.unknown("How would you handle an angry customer?");
        TranscriptionResult matching = TranscriptionResult.unknown("How would you handle an angry customer?");
        assertTrue(EnglishExpectedRecognition.isTrusted(chosen, matching));
        assertFalse(EnglishExpectedRecognition.isTrusted(chosen, TranscriptionResult.unknown("")));
    }
}
