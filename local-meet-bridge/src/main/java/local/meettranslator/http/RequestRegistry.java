package local.meettranslator.http;

import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

public final class RequestRegistry {
    private final Map<String, RequestContext> requests = new ConcurrentHashMap<>();

    public RequestContext register(String requestId) {
        RequestContext context = new RequestContext(requestId);
        RequestContext previous = requests.putIfAbsent(requestId, context);
        if (previous != null) throw new ApiException(409, "duplicate_request_id", "Request id is already active");
        return context;
    }

    public void unregister(RequestContext context) {
        if (context != null) requests.remove(context.requestId(), context);
    }

    public boolean cancel(String requestId) {
        RequestContext context = requests.get(requestId);
        return context != null && context.cancel();
    }

    public int activeCount() {
        return requests.size();
    }
}
