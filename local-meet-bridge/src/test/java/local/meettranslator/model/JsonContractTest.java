package local.meettranslator.model;

import com.fasterxml.jackson.databind.ObjectMapper;
import local.meettranslator.http.ApiException;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;

class JsonContractTest {
    private final ObjectMapper mapper = new ObjectMapper();

    @Test
    void requiresTextFields() throws Exception {
        var json = mapper.readTree("{\"text\":\"hello\"}");
        assertEquals("hello", JsonContract.requiredText(json, "text", 20));
        assertThrows(ApiException.class, () -> JsonContract.requiredText(mapper.createObjectNode(), "text", 20));
    }

    @Test
    void validatesNumberRange() throws Exception {
        var valid = mapper.readTree("{\"speed\":1.25}");
        assertEquals(1.25, JsonContract.optionalNumber(valid, "speed", 0.25, 4.0));
        var invalid = mapper.readTree("{\"speed\":9}");
        assertThrows(ApiException.class, () -> JsonContract.optionalNumber(invalid, "speed", 0.25, 4.0));
    }
}
