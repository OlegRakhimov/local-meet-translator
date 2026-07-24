const crypto = require('crypto');

const SESSION_STATES = Object.freeze({
  IDLE: 'idle',
  PREPARING: 'preparing',
  LISTENING: 'listening',
  TRANSCRIBING: 'transcribing',
  WAITING_FOR_ANSWER: 'waiting_for_answer',
  ANALYSING: 'analysing',
  GENERATING: 'generating',
  PAUSED: 'paused',
  COMPLETED: 'completed',
  STOPPING: 'stopping',
  ERROR: 'error'
});

const ALLOWED_TRANSITIONS = Object.freeze({
  [SESSION_STATES.IDLE]: new Set([SESSION_STATES.PREPARING]),
  [SESSION_STATES.PREPARING]: new Set([SESSION_STATES.LISTENING, SESSION_STATES.WAITING_FOR_ANSWER, SESSION_STATES.STOPPING, SESSION_STATES.ERROR]),
  [SESSION_STATES.LISTENING]: new Set([SESSION_STATES.TRANSCRIBING, SESSION_STATES.GENERATING, SESSION_STATES.PAUSED, SESSION_STATES.STOPPING, SESSION_STATES.ERROR]),
  [SESSION_STATES.TRANSCRIBING]: new Set([SESSION_STATES.LISTENING, SESSION_STATES.GENERATING, SESSION_STATES.PAUSED, SESSION_STATES.STOPPING, SESSION_STATES.ERROR]),
  [SESSION_STATES.WAITING_FOR_ANSWER]: new Set([SESSION_STATES.ANALYSING, SESSION_STATES.PAUSED, SESSION_STATES.STOPPING, SESSION_STATES.ERROR]),
  [SESSION_STATES.ANALYSING]: new Set([SESSION_STATES.WAITING_FOR_ANSWER, SESSION_STATES.GENERATING, SESSION_STATES.PAUSED, SESSION_STATES.STOPPING, SESSION_STATES.ERROR]),
  [SESSION_STATES.GENERATING]: new Set([SESSION_STATES.LISTENING, SESSION_STATES.WAITING_FOR_ANSWER, SESSION_STATES.PAUSED, SESSION_STATES.STOPPING, SESSION_STATES.ERROR]),
  [SESSION_STATES.PAUSED]: new Set([SESSION_STATES.LISTENING, SESSION_STATES.WAITING_FOR_ANSWER, SESSION_STATES.STOPPING, SESSION_STATES.ERROR]),
  [SESSION_STATES.COMPLETED]: new Set([SESSION_STATES.PREPARING, SESSION_STATES.IDLE]),
  [SESSION_STATES.STOPPING]: new Set([SESSION_STATES.COMPLETED, SESSION_STATES.IDLE, SESSION_STATES.ERROR]),
  [SESSION_STATES.ERROR]: new Set([SESSION_STATES.PREPARING, SESSION_STATES.STOPPING, SESSION_STATES.IDLE])
});

class SessionStateMachine {
  constructor({ mode = 'translator', clock = () => Date.now(), idFactory = () => crypto.randomUUID() } = {}) {
    this.mode = mode;
    this.clock = clock;
    this.idFactory = idFactory;
    this.sessionId = '';
    this.requestId = '';
    this.state = SESSION_STATES.IDLE;
    this.lastError = '';
    this.updatedAt = this.clock();
  }

  begin(mode = this.mode) {
    if (![SESSION_STATES.IDLE, SESSION_STATES.COMPLETED, SESSION_STATES.ERROR].includes(this.state)) {
      throw new Error(`Cannot begin a session from state ${this.state}`);
    }
    this.mode = mode;
    this.sessionId = this.idFactory();
    this.requestId = '';
    this.lastError = '';
    this.transition(SESSION_STATES.PREPARING);
    return this.snapshot();
  }

  prepare(mode = this.mode) {
    if ([SESSION_STATES.IDLE, SESSION_STATES.COMPLETED, SESSION_STATES.ERROR].includes(this.state)) {
      this.begin(mode);
    } else if (this.state === SESSION_STATES.STOPPING) {
      throw new Error('Cannot prepare a request while the session is stopping');
    } else {
      this.mode = mode;
      this.updatedAt = this.clock();
    }
    return this.nextRequest();
  }

  nextRequest() {
    if (!this.sessionId) throw new Error('Cannot create request id without an active session');
    this.requestId = this.idFactory();
    this.updatedAt = this.clock();
    return this.requestId;
  }

  transition(nextState, details = {}) {
    if (nextState === this.state) return this.snapshot();
    const allowed = ALLOWED_TRANSITIONS[this.state];
    if (!allowed || !allowed.has(nextState)) {
      throw new Error(`Invalid session transition: ${this.state} -> ${nextState}`);
    }
    this.state = nextState;
    if (nextState === SESSION_STATES.ERROR) this.lastError = String(details.error || details.message || 'Unknown session error');
    if (nextState !== SESSION_STATES.ERROR && details.clearError) this.lastError = '';
    this.updatedAt = this.clock();
    return this.snapshot();
  }

  markError(error) {
    if (this.state === SESSION_STATES.ERROR) {
      this.lastError = String(error || 'Unknown session error');
      this.updatedAt = this.clock();
      return this.snapshot();
    }
    return this.transition(SESSION_STATES.ERROR, { error });
  }

  stop() {
    if ([SESSION_STATES.IDLE, SESSION_STATES.COMPLETED].includes(this.state)) return this.snapshot();
    if (this.state !== SESSION_STATES.STOPPING) this.transition(SESSION_STATES.STOPPING);
    this.transition(SESSION_STATES.IDLE, { clearError: true });
    this.sessionId = '';
    this.requestId = '';
    return this.snapshot();
  }

  snapshot() {
    return Object.freeze({
      sessionId: this.sessionId,
      requestId: this.requestId,
      mode: this.mode,
      state: this.state,
      lastError: this.lastError,
      updatedAt: this.updatedAt
    });
  }
}

module.exports = { SESSION_STATES, ALLOWED_TRANSITIONS, SessionStateMachine };
