package local.meettranslator.http;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.sun.net.httpserver.Headers;
import com.sun.net.httpserver.HttpExchange;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.UUID;
import java.util.regex.Pattern;

public final class HttpSupport {
    public static final ObjectMapper MAPPER = new ObjectMapper();
    private static final Pattern SAFE_REQUEST_ID = Pattern.compile("[A-Za-z0-9._:-]{1,120}");

    private HttpSupport() {
    }

    @FunctionalInterface
    public interface Handler {
        void handle(HttpExchange exchange, RequestContext context) throws Exception;
    }

    public static void handle(
            HttpExchange exchange,
            String expectedMethod,
            String expectedToken,
            RequestRegistry registry,
            Handler handler
    ) throws IOException {
        String requestId = requestId(exchange);
        exchange.getResponseHeaders().set("X-Request-Id", requestId);
        addCors(exchange.getResponseHeaders());

        if ("OPTIONS".equalsIgnoreCase(exchange.getRequestMethod())) {
            exchange.sendResponseHeaders(204, -1);
            exchange.close();
            return;
        }
        if (!expectedMethod.equalsIgnoreCase(exchange.getRequestMethod())) {
            writeError(exchange, 405, "method_not_allowed", "Method not allowed", requestId);
            return;
        }
        String token = exchange.getRequestHeaders().getFirst("X-Auth-Token");
        if (token == null || !token.equals(expectedToken)) {
            writeError(exchange, 401, "invalid_auth_token", "Missing or invalid X-Auth-Token", requestId);
            return;
        }

        RequestContext context = null;
        try {
            context = registry.register(requestId);
            handler.handle(exchange, context);
        } catch (ApiException error) {
            writeError(exchange, error.status(), error.code(), safeMessage(error), requestId);
        } catch (Exception error) {
            System.err.println("[bridge] requestId=" + requestId + " " + error.getClass().getSimpleName() + ": " + safeMessage(error));
            writeError(exchange, 500, "internal_error", "Internal error. Request id: " + requestId, requestId);
        } finally {
            registry.unregister(context);
        }
    }

    public static JsonNode readJsonBody(HttpExchange exchange, int maxBytes) {
        byte[] body = readBodyLimited(exchange, maxBytes);
        try {
            JsonNode json = MAPPER.readTree(body);
            if (json == null || !json.isObject()) {
                throw new ApiException(400, "invalid_json", "JSON body must be an object");
            }
            return json;
        } catch (JsonProcessingException error) {
            throw new ApiException(400, "invalid_json", "Request body contains invalid JSON", error);
        } catch (IOException error) {
            throw new ApiException(400, "invalid_json", "Could not read JSON body", error);
        }
    }

    public static byte[] readBodyLimited(HttpExchange exchange, int maxBytes) {
        String contentLength = exchange.getRequestHeaders().getFirst("Content-Length");
        if (contentLength != null) {
            try {
                long declared = Long.parseLong(contentLength);
                if (declared > maxBytes) throw new ApiException(413, "payload_too_large", "Request body exceeds " + maxBytes + " bytes");
            } catch (NumberFormatException ignored) {
                // Stream limit below remains authoritative.
            }
        }
        try (InputStream input = exchange.getRequestBody();
             ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[8192];
            int total = 0;
            int read;
            while ((read = input.read(buffer)) != -1) {
                total += read;
                if (total > maxBytes) throw new ApiException(413, "payload_too_large", "Request body exceeds " + maxBytes + " bytes");
                output.write(buffer, 0, read);
            }
            return output.toByteArray();
        } catch (ApiException error) {
            throw error;
        } catch (IOException error) {
            throw new ApiException(400, "body_read_failed", "Could not read request body", error);
        }
    }

    public static void writeJson(HttpExchange exchange, int status, JsonNode json, String requestId) throws IOException {
        byte[] bytes = MAPPER.writeValueAsBytes(json);
        Headers headers = exchange.getResponseHeaders();
        headers.set("Content-Type", "application/json; charset=utf-8");
        headers.set("X-Request-Id", requestId);
        addCors(headers);
        exchange.sendResponseHeaders(status, bytes.length);
        try (OutputStream output = exchange.getResponseBody()) {
            output.write(bytes);
        } finally {
            exchange.close();
        }
    }

    public static void writeError(HttpExchange exchange, int status, String code, String message, String requestId) throws IOException {
        writeJson(exchange, status, MAPPER.createObjectNode()
                .put("ok", false)
                .put("error", message)
                .put("code", code)
                .put("requestId", requestId), requestId);
    }

    public static ApiException upstream(String code, Exception error) {
        return new ApiException(502, code, safeMessage(error), error);
    }

    public static String requestId(HttpExchange exchange) {
        String supplied = exchange.getRequestHeaders().getFirst("X-Request-Id");
        if (supplied != null) {
            String clean = supplied.trim();
            if (SAFE_REQUEST_ID.matcher(clean).matches()) return clean;
        }
        return UUID.randomUUID().toString();
    }

    public static String safeMessage(Throwable error) {
        String message = error.getMessage();
        if (message == null || message.isBlank()) message = error.getClass().getSimpleName();
        return message.replaceAll("[\\r\\n]+", " ").trim();
    }

    private static void addCors(Headers headers) {
        headers.set("Access-Control-Allow-Origin", "*");
        headers.set("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
        headers.set("Access-Control-Allow-Headers", "Content-Type,X-Auth-Token,X-Request-Id");
        headers.set("Access-Control-Expose-Headers", "X-Request-Id");
        headers.set("Access-Control-Max-Age", "600");
    }
}
