package local.meettranslator.http;

import org.junit.jupiter.api.Test;

import java.util.concurrent.CompletableFuture;

import static org.junit.jupiter.api.Assertions.*;

class RequestRegistryTest {
    @Test
    void rejectsDuplicateActiveRequestId() {
        RequestRegistry registry = new RequestRegistry();
        RequestContext first = registry.register("same-id");
        ApiException error = assertThrows(ApiException.class, () -> registry.register("same-id"));
        assertEquals("duplicate_request_id", error.code());
        registry.unregister(first);
        assertEquals(0, registry.activeCount());
    }

    @Test
    void cancelsAttachedFuture() {
        RequestRegistry registry = new RequestRegistry();
        RequestContext context = registry.register("request-1");
        CompletableFuture<String> future = new CompletableFuture<>();
        Thread waiter = new Thread(() -> assertThrows(ApiException.class, () -> context.await(future)));
        waiter.start();
        while (registry.activeCount() == 0) Thread.onSpinWait();
        assertTrue(registry.cancel("request-1"));
        assertDoesNotThrow(() -> waiter.join(2_000));
        assertFalse(waiter.isAlive());
        registry.unregister(context);
    }

    @Test
    void repeatedCancelIsSafe() {
        RequestRegistry registry = new RequestRegistry();
        RequestContext context = registry.register("request-2");
        assertTrue(registry.cancel("request-2"));
        assertFalse(registry.cancel("missing"));
        registry.unregister(context);
    }
}
