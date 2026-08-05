'use strict';

function cleanQuestion(value) {
  return String(value?.text || value || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 2000);
}

function questionKey(value) {
  return cleanQuestion(value)
    .toLowerCase()
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[^\p{L}\p{N}']+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function createAutomaticAnalysisCoordinator({
  analyze,
  delayMs = 1200,
  onState = () => {},
  setTimer = setTimeout,
  clearTimer = clearTimeout
} = {}) {
  if (typeof analyze !== 'function') throw new TypeError('analyze must be a function');

  let timer = null;
  let queued = null;
  let running = null;
  let lastCompletedKey = '';
  let stopped = false;

  function emit(status, extra = {}) {
    try { onState({ status, ...extra, snapshot: snapshot() }); } catch (_) {}
  }

  function snapshot() {
    return {
      queued: queued ? { ...queued } : null,
      running: running ? { ...running } : null,
      lastCompletedKey,
      timerPending: !!timer,
      stopped
    };
  }

  function cancelTimer() {
    if (!timer) return;
    clearTimer(timer);
    timer = null;
  }

  function schedule() {
    cancelTimer();
    if (stopped || !queued || running) return;
    timer = setTimer(() => {
      timer = null;
      void runLatest();
    }, Math.max(0, Number(delayMs) || 0));
  }

  async function runLatest() {
    cancelTimer();
    if (stopped || running || !queued) return snapshot();
    const next = queued;
    queued = null;
    const key = questionKey(next);
    if (!key || key === lastCompletedKey) {
      emit('skipped', { reason: !key ? 'empty' : 'already-completed' });
      schedule();
      return snapshot();
    }

    running = { ...next };
    emit('started');
    try {
      const result = await analyze({ ...next });
      if (result && result.ok !== false && !result.stale && !result.skipped) {
        lastCompletedKey = key;
        emit('completed');
      } else {
        emit('not-completed', { reason: result?.message || (result?.stale ? 'stale' : 'not-ok') });
      }
    } catch (error) {
      emit('failed', { error: error?.message || String(error) });
    } finally {
      running = null;
      if (queued && questionKey(queued) !== lastCompletedKey) schedule();
    }
    return snapshot();
  }

  function queue(question) {
    const text = cleanQuestion(question);
    const key = questionKey(text);
    if (stopped || !key) return { accepted: false, reason: stopped ? 'stopped' : 'empty', ...snapshot() };

    const runningKey = questionKey(running);
    const queuedKey = questionKey(queued);
    if (key === runningKey || key === queuedKey || key === lastCompletedKey) {
      return { accepted: false, reason: 'duplicate', ...snapshot() };
    }

    queued = typeof question === 'object' && question
      ? { ...question, text }
      : { text };
    emit('queued');
    if (!running) schedule();
    return { accepted: true, reason: 'queued', ...snapshot() };
  }

  function cancelPending() {
    cancelTimer();
    queued = null;
    emit('pending-canceled');
    return snapshot();
  }

  function forgetCompleted() {
    lastCompletedKey = '';
    emit('completed-forgotten');
    return snapshot();
  }

  function clear() {
    cancelPending();
    forgetCompleted();
    emit('cleared');
    return snapshot();
  }

  function stop() {
    stopped = true;
    cancelPending();
    emit('stopped');
    return snapshot();
  }

  return { queue, cancelPending, forgetCompleted, clear, stop, snapshot, runLatest };
}

module.exports = {
  cleanQuestion,
  questionKey,
  createAutomaticAnalysisCoordinator
};
