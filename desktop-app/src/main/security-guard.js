const crypto = require('crypto');

function normalizeSecret(value) {
  return String(value ?? '').trim();
}

function constantTimeEqual(expected, actual) {
  const left = crypto.createHash('sha256').update(normalizeSecret(expected), 'utf8').digest();
  const right = crypto.createHash('sha256').update(normalizeSecret(actual), 'utf8').digest();
  return crypto.timingSafeEqual(left, right) && normalizeSecret(expected).length > 0;
}

function createSlidingWindowRateLimiter({ windowMs = 60_000, maxAttempts = 60, clock = () => Date.now(), maxKeys = 500 } = {}) {
  const hits = new Map();

  function pruneKey(key, now) {
    const cutoff = now - windowMs;
    const current = (hits.get(key) || []).filter(value => value > cutoff);
    if (current.length) hits.set(key, current);
    else hits.delete(key);
    return current;
  }

  function pruneAll(now) {
    for (const key of hits.keys()) pruneKey(key, now);
    if (hits.size <= maxKeys) return;
    const entries = [...hits.entries()].sort((a, b) => (a[1][0] || 0) - (b[1][0] || 0));
    for (const [key] of entries.slice(0, Math.max(0, hits.size - maxKeys))) hits.delete(key);
  }

  function consume(keyValue, cost = 1) {
    const key = String(keyValue || 'default').slice(0, 300);
    const now = clock();
    pruneAll(now);
    const current = pruneKey(key, now);
    const requestedCost = Math.max(1, Math.min(20, Number(cost) || 1));
    if (current.length + requestedCost > maxAttempts) {
      const oldest = current[0] || now;
      return {
        allowed: false,
        remaining: 0,
        retryAfterMs: Math.max(1, windowMs - (now - oldest)),
        count: current.length
      };
    }
    for (let index = 0; index < requestedCost; index += 1) current.push(now);
    hits.set(key, current);
    return {
      allowed: true,
      remaining: Math.max(0, maxAttempts - current.length),
      retryAfterMs: 0,
      count: current.length
    };
  }

  function reset(keyValue = '') {
    const key = String(keyValue || '');
    if (key) hits.delete(key);
    else hits.clear();
  }

  function snapshot() {
    const now = clock();
    pruneAll(now);
    return {
      windowMs,
      maxAttempts,
      keys: hits.size,
      activeHits: [...hits.values()].reduce((sum, values) => sum + values.length, 0)
    };
  }

  return { consume, reset, snapshot };
}

function isJsonRequest(req) {
  const value = String(req?.headers?.['content-type'] || '').toLowerCase();
  return value.startsWith('application/json');
}

function applyLocalSecurityHeaders(res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-site');
}

module.exports = {
  normalizeSecret,
  constantTimeEqual,
  createSlidingWindowRateLimiter,
  isJsonRequest,
  applyLocalSecurityHeaders
};
