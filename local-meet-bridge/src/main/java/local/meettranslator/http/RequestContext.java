package local.meettranslator.http;

import java.io.IOException;
import java.util.Objects;
import java.util.concurrent.CancellationException;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicReference;

public final class RequestContext {
    private final String requestId;
    private final AtomicBoolean cancelled = new AtomicBoolean(false);
    private final AtomicReference<CompletableFuture<?>> activeFuture = new AtomicReference<>();

    RequestContext(String requestId) {
        this.requestId = Objects.requireNonNull(requestId, "requestId");
    }

    public String requestId() {
        return requestId;
    }

    public boolean isCancelled() {
        return cancelled.get();
    }

    public boolean cancel() {
        boolean changed = cancelled.compareAndSet(false, true);
        CompletableFuture<?> future = activeFuture.getAndSet(null);
        if (future != null) future.cancel(true);
        return changed || future != null;
    }

    public void throwIfCancelled() {
        if (cancelled.get()) throw new ApiException(409, "request_cancelled", "Request was cancelled");
    }

    public <T> T await(CompletableFuture<T> future) throws IOException {
        Objects.requireNonNull(future, "future");
        throwIfCancelled();
        activeFuture.set(future);
        try {
            T result = future.get();
            throwIfCancelled();
            return result;
        } catch (CancellationException error) {
            throw new ApiException(409, "request_cancelled", "Request was cancelled", error);
        } catch (InterruptedException error) {
            Thread.currentThread().interrupt();
            throw new IOException("Request interrupted", error);
        } catch (ExecutionException error) {
            Throwable cause = error.getCause();
            if (cause instanceof IOException io) throw io;
            if (cause instanceof RuntimeException runtime) throw runtime;
            throw new IOException("Asynchronous request failed", cause);
        } finally {
            activeFuture.compareAndSet(future, null);
        }
    }
}
