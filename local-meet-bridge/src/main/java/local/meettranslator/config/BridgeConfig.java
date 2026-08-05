package local.meettranslator.config;

import java.security.SecureRandom;
import java.util.Map;
import java.util.Objects;

public record BridgeConfig(
        String apiKey,
        String baseUrl,
        int port,
        String transcribeModel,
        String textModel,
        boolean ttsEnabled,
        String ttsModel,
        String ttsVoice,
        String ttsFormat,
        String ttsInstructions,
        double ttsSpeed,
        boolean voiceConversionEnabled,
        String voiceConversionUrl,
        String voiceConversionToken,
        boolean voiceConversionFallback,
        long voiceConversionTimeoutMs,
        String authToken
) {
    public BridgeConfig {
        apiKey = requireNonBlank(apiKey, "apiKey");
        baseUrl = stripTrailingSlash(requireNonBlank(baseUrl, "baseUrl"));
        if (port < 0 || port > 65_535) throw new IllegalArgumentException("port must be between 0 and 65535");
        transcribeModel = requireNonBlank(transcribeModel, "transcribeModel");
        textModel = requireNonBlank(textModel, "textModel");
        ttsModel = requireNonBlank(ttsModel, "ttsModel");
        ttsVoice = requireNonBlank(ttsVoice, "ttsVoice");
        ttsFormat = requireNonBlank(ttsFormat, "ttsFormat");
        ttsInstructions = Objects.requireNonNullElse(ttsInstructions, "");
        if (!Double.isFinite(ttsSpeed) || ttsSpeed < 0.25 || ttsSpeed > 4.0) {
            throw new IllegalArgumentException("ttsSpeed must be between 0.25 and 4.0");
        }
        voiceConversionUrl = stripTrailingSlash(requireNonBlank(voiceConversionUrl, "voiceConversionUrl"));
        voiceConversionToken = Objects.requireNonNullElse(voiceConversionToken, "").trim();
        if (voiceConversionTimeoutMs < 1_000 || voiceConversionTimeoutMs > 600_000) {
            throw new IllegalArgumentException("voiceConversionTimeoutMs must be between 1000 and 600000");
        }
        authToken = requireNonBlank(authToken, "authToken");
    }

    public static BridgeConfig fromEnvironment(Map<String, String> environment) {
        Objects.requireNonNull(environment, "environment");
        return new BridgeConfig(
                required(environment, "OPENAI_API_KEY"),
                value(environment, "OPENAI_BASE_URL", "https://api.openai.com"),
                integer(environment, "LOCAL_MEET_TRANSLATOR_PORT", 8799, 0, 65_535),
                value(environment, "OPENAI_TRANSCRIBE_MODEL", "whisper-1"),
                value(environment, "OPENAI_TEXT_MODEL", "gpt-4o-mini"),
                bool(environment, "ENABLE_TTS", false),
                value(environment, "OPENAI_TTS_MODEL", "gpt-4o-mini-tts"),
                value(environment, "OPENAI_TTS_VOICE", "onyx"),
                value(environment, "OPENAI_TTS_FORMAT", "mp3"),
                value(environment, "OPENAI_TTS_INSTRUCTIONS", ""),
                decimal(environment, "OPENAI_TTS_SPEED", 1.0, 0.25, 4.0),
                bool(environment, "ENABLE_VOICE_CONVERSION", false),
                value(environment, "VOICE_CONVERSION_URL", "http://127.0.0.1:18799"),
                value(environment, "VOICE_CONVERSION_TOKEN", ""),
                bool(environment, "VOICE_CONVERSION_FALLBACK_TO_ORIGINAL", true),
                longValue(environment, "VOICE_CONVERSION_TIMEOUT_MS", 180_000, 1_000, 600_000),
                value(environment, "LOCAL_MEET_TRANSLATOR_TOKEN", randomToken(40))
        );
    }

    private static String required(Map<String, String> environment, String name) {
        String result = environment.get(name);
        if (result == null || result.isBlank()) {
            throw new IllegalStateException("Missing required environment variable: " + name);
        }
        return result.trim();
    }

    private static String value(Map<String, String> environment, String name, String fallback) {
        String result = environment.get(name);
        return result == null || result.isBlank() ? fallback : result.trim();
    }

    private static boolean bool(Map<String, String> environment, String name, boolean fallback) {
        String raw = environment.get(name);
        return raw == null || raw.isBlank() ? fallback : Boolean.parseBoolean(raw.trim());
    }

    private static int integer(Map<String, String> environment, String name, int fallback, int min, int max) {
        String raw = environment.get(name);
        if (raw == null || raw.isBlank()) return fallback;
        try {
            int value = Integer.parseInt(raw.trim());
            if (value < min || value > max) throw new IllegalArgumentException(name + " must be between " + min + " and " + max);
            return value;
        } catch (NumberFormatException error) {
            throw new IllegalArgumentException(name + " must be an integer", error);
        }
    }

    private static long longValue(Map<String, String> environment, String name, long fallback, long min, long max) {
        String raw = environment.get(name);
        if (raw == null || raw.isBlank()) return fallback;
        try {
            long value = Long.parseLong(raw.trim());
            if (value < min || value > max) throw new IllegalArgumentException(name + " must be between " + min + " and " + max);
            return value;
        } catch (NumberFormatException error) {
            throw new IllegalArgumentException(name + " must be an integer", error);
        }
    }

    private static double decimal(Map<String, String> environment, String name, double fallback, double min, double max) {
        String raw = environment.get(name);
        if (raw == null || raw.isBlank()) return fallback;
        try {
            double value = Double.parseDouble(raw.trim());
            if (!Double.isFinite(value) || value < min || value > max) {
                throw new IllegalArgumentException(name + " must be between " + min + " and " + max);
            }
            return value;
        } catch (NumberFormatException error) {
            throw new IllegalArgumentException(name + " must be a number", error);
        }
    }

    private static String requireNonBlank(String value, String name) {
        if (value == null || value.isBlank()) throw new IllegalArgumentException(name + " must not be blank");
        return value.trim();
    }

    private static String stripTrailingSlash(String value) {
        String result = value;
        while (result.endsWith("/")) result = result.substring(0, result.length() - 1);
        return result;
    }

    private static String randomToken(int length) {
        final String alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
        SecureRandom random = new SecureRandom();
        StringBuilder result = new StringBuilder(length);
        for (int index = 0; index < length; index++) {
            result.append(alphabet.charAt(random.nextInt(alphabet.length())));
        }
        return result.toString();
    }
}
