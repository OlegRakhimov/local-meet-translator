package local.meettranslator.openai;

import java.util.Locale;
import java.util.Objects;

public record TranscriptionResult(
        String text,
        String detectedLanguage,
        double averageLogprob,
        double lowConfidenceTokenRatio,
        String confidenceLevel
) {
    public TranscriptionResult {
        text = Objects.requireNonNullElse(text, "").trim();
        detectedLanguage = Objects.requireNonNullElse(detectedLanguage, "").trim().toLowerCase(Locale.ROOT);
        averageLogprob = Double.isFinite(averageLogprob) ? averageLogprob : Double.NaN;
        lowConfidenceTokenRatio = Double.isFinite(lowConfidenceTokenRatio)
                ? Math.max(0.0, Math.min(1.0, lowConfidenceTokenRatio))
                : Double.NaN;
        String normalized = Objects.requireNonNullElse(confidenceLevel, "unknown").trim().toLowerCase(Locale.ROOT);
        confidenceLevel = switch (normalized) {
            case "high", "medium", "low" -> normalized;
            default -> "unknown";
        };
    }

    public static TranscriptionResult unknown(String text) {
        return new TranscriptionResult(text, "", Double.NaN, Double.NaN, "unknown");
    }

    public boolean isLowConfidence() {
        return "low".equals(confidenceLevel);
    }

    public int confidenceRank() {
        return switch (confidenceLevel) {
            case "high" -> 3;
            case "medium" -> 2;
            case "unknown" -> 1;
            default -> 0;
        };
    }
}
