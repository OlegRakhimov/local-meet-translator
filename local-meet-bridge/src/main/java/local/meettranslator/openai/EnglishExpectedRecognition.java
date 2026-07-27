package local.meettranslator.openai;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Objects;
import java.util.Set;

public final class EnglishExpectedRecognition {
    public static final String MODE = "en-expected";
    public static final String RETRY_MODE = "en-retry";
    public static final String TECHNICAL_TRANSCRIPTION_VOCABULARY =
            "Java, Kotlin, Android, API, REST, JWT, SQL, PostgreSQL, Docker, algorithm, complexity";

    private static final Set<String> VOCABULARY_TOKENS = Set.of(
            "java", "kotlin", "android", "api", "rest", "jwt", "sql", "postgresql", "docker", "algorithm", "complexity"
    );
    private static final Set<String> PROMPT_META_TOKENS = Set.of(
            "english", "software", "engineering", "interview", "preserve", "terms", "transcribe", "exactly"
    );

    private EnglishExpectedRecognition() {
    }

    public static boolean isExpectedMode(String sourceLang) {
        return MODE.equals(normalize(sourceLang));
    }

    public static boolean isRetryMode(String sourceLang) {
        return RETRY_MODE.equals(normalize(sourceLang));
    }

    public static String translationSourceLanguage(String sourceLang) {
        return isExpectedMode(sourceLang) || isRetryMode(sourceLang) ? "en" : Objects.requireNonNullElse(sourceLang, "auto");
    }

    public static boolean shouldRetry(String transcript) {
        String text = Objects.requireNonNullElse(transcript, "").trim();
        if (text.isBlank()) return true;
        if (isPromptEcho(text)) return true;

        int letters = 0;
        int latinLetters = 0;
        int nonLatinLetters = 0;
        int replacementCharacters = 0;
        for (int index = 0; index < text.length();) {
            int codePoint = text.codePointAt(index);
            index += Character.charCount(codePoint);
            if (codePoint == 0xfffd) replacementCharacters += 1;
            if (!Character.isLetter(codePoint)) continue;
            letters += 1;
            if (Character.UnicodeScript.of(codePoint) == Character.UnicodeScript.LATIN) latinLetters += 1;
            else nonLatinLetters += 1;
        }

        if (replacementCharacters > 0) return true;
        if (letters == 0) return text.length() > 4;
        if (nonLatinLetters >= 2 && nonLatinLetters * 5 >= letters) return true;
        return latinLetters * 100 < letters * 78;
    }

    public static String chooseBetterCandidate(String automaticTranscript, String strictEnglishTranscript) {
        String automatic = Objects.requireNonNullElse(automaticTranscript, "").trim();
        String strict = Objects.requireNonNullElse(strictEnglishTranscript, "").trim();
        boolean automaticEcho = isPromptEcho(automatic);
        boolean strictEcho = isPromptEcho(strict);
        if (automaticEcho && strictEcho) return "";
        if (automaticEcho) return strict;
        if (strictEcho) return automatic;
        if (strict.isBlank()) return automatic;
        if (automatic.isBlank()) return strict;
        int automaticScore = englishScore(automatic);
        int strictScore = englishScore(strict);
        return strictScore >= automaticScore ? strict : automatic;
    }

    public static boolean isPromptEcho(String transcript) {
        String normalized = normalizeWords(transcript);
        if (normalized.isBlank()) return false;
        if (normalized.contains("english software engineering interview")) return true;
        if (normalized.contains("preserve java kotlin android api sql")) return true;
        if (normalized.contains("transcribe exactly in english")) return true;
        if (normalized.contains("интервью по программной инженерии")) return true;
        if (normalized.contains("сохраните термины java kotlin android")) return true;
        if (normalized.contains("транскрибируйте точно на английском")) return true;

        List<String> tokens = wordTokens(normalized);
        if (tokens.isEmpty()) return false;
        Set<String> unique = new HashSet<>(tokens);
        int vocabularyMatches = 0;
        int metaMatches = 0;
        for (String token : unique) {
            if (VOCABULARY_TOKENS.contains(token)) vocabularyMatches += 1;
            if (PROMPT_META_TOKENS.contains(token)) metaMatches += 1;
        }
        if (metaMatches >= 3 && unique.size() <= 24) return true;
        return unique.size() >= 5
                && unique.size() <= VOCABULARY_TOKENS.size() + 3
                && vocabularyMatches >= 5
                && vocabularyMatches * 100 >= unique.size() * 75;
    }

    static int englishScore(String text) {
        int score = 0;
        int letters = 0;
        int latin = 0;
        int nonLatin = 0;
        int words = 0;
        boolean insideWord = false;
        for (int index = 0; index < text.length();) {
            int codePoint = text.codePointAt(index);
            index += Character.charCount(codePoint);
            if (Character.isLetter(codePoint)) {
                letters += 1;
                if (!insideWord) words += 1;
                insideWord = true;
                if (Character.UnicodeScript.of(codePoint) == Character.UnicodeScript.LATIN) latin += 1;
                else nonLatin += 1;
            } else {
                insideWord = false;
                if (codePoint == 0xfffd) score -= 30;
            }
        }
        score += latin * 3;
        score -= nonLatin * 9;
        score += Math.min(words, 20) * 2;
        if (letters > 0 && latin * 100 >= letters * 90) score += 20;
        return score;
    }

    private static List<String> wordTokens(String normalized) {
        List<String> result = new ArrayList<>();
        for (String token : normalized.split("\\s+")) {
            if (!token.isBlank()) result.add(token);
        }
        return result;
    }

    private static String normalizeWords(String value) {
        return normalize(value)
                .replaceAll("[^\\p{L}\\p{N}]+", " ")
                .replaceAll("\\s+", " ")
                .trim();
    }

    private static String normalize(String value) {
        return Objects.requireNonNullElse(value, "").trim().toLowerCase(Locale.ROOT);
    }
}