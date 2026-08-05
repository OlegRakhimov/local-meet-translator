const test = require('node:test');
const assert = require('node:assert/strict');
const { SessionStateMachine, SESSION_STATES } = require('../src/main/session-state');

test('session follows valid start, listen and idempotent stop lifecycle', () => {
  let sequence = 0;
  const session = new SessionStateMachine({ idFactory: () => `id-${++sequence}`, clock: () => sequence });
  session.begin('live_subtitles');
  assert.equal(session.snapshot().state, SESSION_STATES.PREPARING);
  assert.equal(session.nextRequest(), 'id-2');
  session.transition(SESSION_STATES.LISTENING);
  assert.equal(session.snapshot().state, SESSION_STATES.LISTENING);
  session.stop();
  assert.equal(session.snapshot().state, SESSION_STATES.IDLE);
  assert.doesNotThrow(() => session.stop());
});

test('session rejects invalid transition and concurrent begin', () => {
  const session = new SessionStateMachine({ idFactory: () => 'fixed-id' });
  session.begin();
  assert.throws(() => session.begin(), /Cannot begin/);
  assert.throws(() => session.transition(SESSION_STATES.ANALYSING), /Invalid session transition/);
});

test('error state retains a safe diagnostic and can restart', () => {
  const ids = ['one', 'two'];
  const session = new SessionStateMachine({ idFactory: () => ids.shift() || 'next' });
  session.begin();
  session.markError('bridge offline');
  assert.equal(session.snapshot().lastError, 'bridge offline');
  assert.doesNotThrow(() => session.begin('live_voice_translation'));
  assert.equal(session.snapshot().state, SESSION_STATES.PREPARING);
});

test('active session can prepare a mode switch without creating a second session', () => {
  let sequence = 0;
  const session = new SessionStateMachine({ idFactory: () => `id-${++sequence}` });
  session.prepare('live_subtitles');
  const sessionId = session.snapshot().sessionId;
  session.transition(SESSION_STATES.LISTENING);
  session.prepare('live_voice_translation');
  assert.equal(session.snapshot().sessionId, sessionId);
  assert.equal(session.snapshot().mode, 'live_voice_translation');
  assert.equal(session.snapshot().state, SESSION_STATES.LISTENING);
});
