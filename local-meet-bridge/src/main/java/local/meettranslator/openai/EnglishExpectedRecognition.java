package local.meettranslator.openai;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Objects;
import java.util.Set;

public final class EnglishExpectedRecognition {
    public static final String MODE = "en-expected";
    public static final String PRIMARY_MODE = "en-primary";
    public static final String RETRY_MODE = "en-retry";

    private static final String BASE_PROMPT = """
            This is live audio from an English-language job interview. Transcribe only the speaker's exact words in English. Do not answer, summarize, explain, translate, repair, complete, or infer words that are not clearly present in the audio. Expect interview vocabulary about customer support, technical support, software development, Android, Kotlin, Java, APIs, troubleshooting, CRM, email, chat, phone calls, Polish, Russian, English, Serbia, relocation, shifts, salary, availability, and work experience.
            """.strip();

    private static final String RETRY_PROMPT = """
            Carefully transcribe only the exact English question or statement from a live job interview. Keep names, numbers, product terms, and technical terms exactly as spoken. Do not repair, complete, guess, or invent missing words, and do not answer the speaker.
            """.strip();

    private static final Set<String> VOCABULARY_TOKENS = Set.of(
            "java", "kotlin", "android", "api", "rest", "jwt", "sql", "postgresql", "docker",
            "algorithm", "complexity", "customer", "support", "crm", "serbia", "polish", "russian"
    );
    private static final Set<String> PROMPT_META_TOKENS = Set.of(
            "english", "job", "interview", "transcribe", "speaker", "exact", "words", "translate",
            "customer", "support", "technical", "software", "android", "kotlin"
    );

    private EnglishExpectedRecognition() {
    }

    public static boolean isExpectedMode(String sourceLang) {
        return MODE.equals(normalize(sourceLang));
    }

    public static boolean isPrimaryMode(String sourceLang) {
        return PRIMARY_MODE.equals(normalize(sourceLang));
    }

    public static boolean isRetryMode(String sourceLang) {
        return RETRY_MODE.equals(normalize(sourceLang));
    }

    public static boolean isStrictEnglishMode(String sourceLang) {
        return isExpectedMode(sourceLang) || isPrimaryMode(sourceLang) || isRetryMode(sourceLang);
    }

    public static String translationSourceLanguage(String sourceLang) {
        return isStrictEnglishMode(sourceLang) ? "en" : Objects.requireNonNullElse(sourceLang, "auto");
    }

    public static String transcriptionPrompt(String sourceLang, String context) {
        if (!isStrictEnglishMode(sourceLang)) return "";
        StringBuilder prompt = new StringBuilder(isRetryMode(sourceLang) ? RETRY_PROMPT : BASE_PROMPT);
        String safeContext = Objects.requireNonNullElse(context, "").replaceAll("\\s+", " ").trim();
        if (!safeContext.isBlank()) {
            if (safeContext.length() > 700) safeContext = safeContext.substring(safeContext.length() - 700);
            prompt.append("\nRecent accepted transcript context (for continuity only; do not repeat it unless spoken again): ")
                    .append(safeContext);
        }
        return prompt.toString();
    }

    public static boolean shouldRetry(String transcript) {
        return shouldRetry(TranscriptionResult.unknown(transcript));
    }

    public static boolean shouldRetry(TranscriptionResult result) {
        String text = Objects.requireNonNullElse(result, TranscriptionResult.unknown("")).text();
        if (text.isBlank()) return true;
        if (isPromptEcho(text)) return true;
        if (hasSubstantialNonLatinText(text)) return true;
        if (hasDetectedNonEnglishLanguage(result)) return true;
        return result != null && Set.of("low", "medium", "unknown").contains(result.confidenceLevel());
    }

    public static String chooseBetterCandidate(String automaticTranscript, String strictEnglishTranscript) {
        return chooseBetterCandidate(
                TranscriptionResult.unknown(automaticTranscript),
                TranscriptionResult.unknown(strictEnglishTranscript)
        ).text();
    }

    public static TranscriptionResult chooseBetterCandidate(TranscriptionResult first, TranscriptionResult second) {
        TranscriptionResult a = first == null ? TranscriptionResult.unknown("") : first;
        TranscriptionResult b = second == null ? TranscriptionResult.unknown("") : second;
        boolean aEcho = isPromptEcho(a.text());
        boolean bEcho = isPromptEcho(b.text());
        if (aEcho && bEcho) return TranscriptionResult.unknown("");
        if (aEcho) return b;
        if (bEcho) return a;
        if (b.text().isBlank()) return a;
        if (a.text().isBlank()) return b;

        int aScore = candidateScore(a);
        int bScore = candidateScore(b);
        if (bScore != aScore) return bScore > aScore ? b : a;

        int aEnglish = englishScore(a.text());
        int bEnglish = englishScore(b.text());
        if (bEnglish != aEnglish) return bEnglish > aEnglish ? b : a;

        return b.text().length() >= a.text().length() ? b : a;
    }

    public static double candidateAgreement(String first, String second) {
        List<String> a = wordTokens(normalizeWords(first));
        List<String> b = wordTokens(normalizeWords(second));
        if (a.isEmpty() || b.isEmpty()) return 0.0;
        Set<String> left = new HashSet<>(a);
        Set<String> right = new HashSet<>(b);
        int intersection = 0;
        for (String token : left) if (right.contains(token)) intersection += 1;
        int union = left.size() + right.size() - intersection;
        return union == 0 ? 0.0 : (double) intersection / union;
    }

    public static boolean isTrusted(TranscriptionResult chosen, TranscriptionResult alternate) {
        if (chosen == null || chosen.text().isBlank()) return false;
        if (isPromptEcho(chosen.text()) || hasSubstantialNonLatinText(chosen.text())) return false;
        if (hasDetectedNonEnglishLanguage(chosen)) return false;
        if ("high".equals(chosen.confidenceLevel())) return true;

        String alternateText = alternate == null ? "" : alternate.text();
        if (alternateText.isBlank() || hasDetectedNonEnglishLanguage(alternate)) return false;
        double agreement = candidateAgreement(chosen.text(), alternateText);
        if ("medium".equals(chosen.confidenceLevel())) return agreement >= 0.50;
        if ("unknown".equals(chosen.confidenceLevel())) return agreement >= 0.55;
        return false;
    }

    public static boolean isPromptEcho(String transcript) {
        String normalized = normalizeWords(transcript);
        if (normalized.isBlank()) return false;
        if (normalized.contains("live audio from an english language job interview")) return true;
        if (normalized.contains("transcribe the speaker s exact words in english")) return true;
        if (normalized.contains("do not answer summarize explain or translate")) return true;
        if (normalized.contains("recent accepted transcript context")) return true;
        if (normalized.contains("carefully transcribe the exact english question")) return true;
        if (normalized.contains("english software engineering interview")) return true;
        if (normalized.contains("preserve java kotlin android api sql")) return true;
        if (normalized.contains("transcribe exactly in english")) return true;
        if (normalized.contains("интервью по программной инженерии")) return true;
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
        return metaMatches >= 6 && unique.size() <= 45
                || (unique.size() >= 7 && unique.size() <= 30 && vocabularyMatches >= 7 && metaMatches >= 3);
    }

    static int englishScore(String text) {
        int score = 0;
        int letters = 0;
        int latin = 0;
        int nonLatin = 0;
        int words = 0;
        boolean insideWord = false;
        for (int index = 0; index < Objects.requireNonNullElse(text, "").length();) {
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

    private static int candidateScore(TranscriptionResult result) {
        int score = result.confidenceRank() * 100;
        if (Double.isFinite(result.averageLogprob())) score += (int) Math.round(result.averageLogprob() * 20.0);
        if (Double.isFinite(result.lowConfidenceTokenRatio())) score -= (int) Math.round(result.lowConfidenceTokenRatio() * 40.0);
        if (hasSubstantialNonLatinText(result.text())) score -= 200;
        if (hasDetectedNonEnglishLanguage(result)) score -= 250;
        return score;
    }

    static boolean hasDetectedNonEnglishLanguage(TranscriptionResult result) {
        if (result == null) return false;
        String language = normalize(result.detectedLanguage());
        if (language.isBlank() || "unknown".equals(language)) return false;
        return !("en".equals(language) || language.startsWith("en-") || language.startsWith("en_"));
    }

    private static boolean hasSubstantialNonLatinText(String text) {
        int letters = 0;
        int latinLetters = 0;
        int nonLatinLetters = 0;
        int replacementCharacters = 0;
        String value = Objects.requireNonNullElse(text, "");
        for (int index = 0; index < value.length();) {
            int codePoint = value.codePointAt(index);
            index += Character.charCount(codePoint);
            if (codePoint == 0xfffd) replacementCharacters += 1;
            if (!Character.isLetter(codePoint)) continue;
            letters += 1;
            if (Character.UnicodeScript.of(codePoint) == Character.UnicodeScript.LATIN) latinLetters += 1;
            else nonLatinLetters += 1;
        }
        if (replacementCharacters > 0) return true;
        if (letters == 0) return value.trim().length() > 4;
        if (nonLatinLetters >= 2 && nonLatinLetters * 5 >= letters) return true;
        return latinLetters * 100 < letters * 78;
    }

    private static List<String> wordTokens(String normalized) {
        List<String> result = new ArrayList<>();
        for (String token : Objects.requireNonNullElse(normalized, "").split("\\s+")) {
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
