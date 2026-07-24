package local.meettranslator.config;

import org.junit.jupiter.api.Test;

import java.util.HashMap;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

class BridgeConfigTest {
    @Test
    void loadsStableDefaults() {
        BridgeConfig config = BridgeConfig.fromEnvironment(Map.of("OPENAI_API_KEY", "test-key"));
        assertEquals(8799, config.port());
        assertEquals("whisper-1", config.transcribeModel());
        assertEquals("gpt-4o-mini", config.textModel());
        assertFalse(config.ttsEnabled());
        assertFalse(config.authToken().isBlank());
    }

    @Test
    void requiresApiKey() {
        IllegalStateException error = assertThrows(IllegalStateException.class,
                () -> BridgeConfig.fromEnvironment(Map.of()));
        assertTrue(error.getMessage().contains("OPENAI_API_KEY"));
    }

    @Test
    void rejectsInvalidPort() {
        Map<String, String> environment = new HashMap<>();
        environment.put("OPENAI_API_KEY", "test-key");
        environment.put("LOCAL_MEET_TRANSLATOR_PORT", "70000");
        assertThrows(IllegalArgumentException.class, () -> BridgeConfig.fromEnvironment(environment));
    }
}
