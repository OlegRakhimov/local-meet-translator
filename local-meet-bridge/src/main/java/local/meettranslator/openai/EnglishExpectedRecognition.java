package local.meettranslator.openai;

import java.util.Locale;
import java.util.Objects;

public final class EnglishExpectedRecognition {
    public static final String MODE = "en-expected";
    public static final String RETRY_MODE = "en-retry";

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
        if (strict.isBlank()) return automatic;
        if (automatic.isBlank()) return strict;
        int automaticScore = englishScore(automatic);
        int strictScore = englishScore(strict);
        return strictScore >= automaticScore ? strict : automatic;
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

    private static String normalize(String value) {
        return Objects.requireNonNullElse(value, "").trim().toLowerCase(Locale.ROOT);
    }
}
