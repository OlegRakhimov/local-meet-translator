const test = require('node:test');
const assert = require('node:assert/strict');
const {
  constantTimeEqual,
  createSlidingWindowRateLimiter,
  isJsonRequest,
  applyLocalSecurityHeaders
} = require('../src/main/security-guard');

test('constantTimeEqual accepts only the exact non-empty secret', () => {
  assert.equal(constantTimeEqual('abc123', 'abc123'), true);
  assert.equal(constantTimeEqual('abc123', 'abc124'), false);
  assert.equal(constantTimeEqual('', ''), false);
  assert.equal(constantTimeEqual('secret', ''), false);
});

test('sliding window rate limiter blocks excess requests and resets after the window', () => {
  let now = 1_000;
  const limiter = createSlidingWindowRateLimiter({ windowMs: 1_000, maxAttempts: 2, clock: () => now });
  assert.equal(limiter.consume('client').allowed, true);
  assert.equal(limiter.consume('client').allowed, true);
  const blocked = limiter.consume('client');
  assert.equal(blocked.allowed, false);
  assert.ok(blocked.retryAfterMs > 0);
  now += 1_001;
  assert.equal(limiter.consume('client').allowed, true);
});

test('JSON request and security headers are enforced by helpers', () => {
  assert.equal(isJsonRequest({ headers: { 'content-type': 'application/json; charset=utf-8' } }), true);
  assert.equal(isJsonRequest({ headers: { 'content-type': 'text/plain' } }), false);
  const headers = new Map();
  applyLocalSecurityHeaders({ setHeader: (name, value) => headers.set(name, value) });
  assert.equal(headers.get('Cache-Control'), 'no-store, max-age=0');
  assert.equal(headers.get('X-Content-Type-Options'), 'nosniff');
  assert.equal(headers.get('Referrer-Policy'), 'no-referrer');
});
