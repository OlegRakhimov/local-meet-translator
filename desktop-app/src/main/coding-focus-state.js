'use strict';

function cleanText(value, maxLength = 4000) {
  return String(value ?? '')
    .replace(/\u0000/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

function cloneSuggestion(value) {
  return value && typeof value === 'object' ? { ...value } : null;
}

function cloneQuestion(value) {
  return value && typeof value === 'object'
    ? { ...value, text: cleanText(value.text, 2400) }
    : null;
}

function cloneClassification(value) {
  if (!value || typeof value !== 'object') return null;
  return {
    ...value,
    normalizedInput: cleanText(value.normalizedInput, 2400),
    reason: cleanText(value.reason, 1200),
    combinedUtterance: cleanText(value.combinedUtterance, 4000),
    affectedInputIds: Array.isArray(value.affectedInputIds) ? value.affectedInputIds.slice(0, 8) : [],
    verificationCriteria: Array.isArray(value.verificationCriteria) ? value.verificationCriteria.slice(0, 8) : []
  };
}

function cloneInput(value) {
  return value && typeof value === 'object'
    ? {
        ...value,
        normalizedInput: cleanText(value.normalizedInput, 2400),
        sourceText: cleanText(value.sourceText, 2400),
        verificationCriteria: Array.isArray(value.verificationCriteria) ? value.verificationCriteria.slice(0, 8) : []
      }
    : null;
}

function clonePendingChange(value) {
  if (!value || typeof value !== 'object') return null;
  return {
    ...value,
    utterance: value.utterance ? { ...value.utterance, text: cleanText(value.utterance.text, 2400) } : null,
    classification: cloneClassification(value.classification),
    proposedInputs: Array.isArray(value.proposedInputs) ? value.proposedInputs.map(cloneInput).filter(Boolean) : []
  };
}

function createCodingFocusState({ maxEntries = 18 } = {}) {
  let active = false;
  let task = null;
  let liveContext = [];
  let followUp = null;
  let pendingTask = null;
  let activeInputs = [];
  let pendingChange = null;

  function snapshot() {
    return {
      active,
      task: cloneQuestion(task),
      liveContext: liveContext.map(item => ({ ...item, classification: cloneClassification(item.classification) })),
      followUp: followUp ? {
        ...followUp,
        question: cloneQuestion(followUp.question),
        suggestion: cloneSuggestion(followUp.suggestion)
      } : null,
      pendingTask: cloneQuestion(pendingTask),
      activeInputs: activeInputs.map(cloneInput).filter(Boolean),
      pendingChange: clonePendingChange(pendingChange)
    };
  }

  function start(question) {
    active = true;
    task = cloneQuestion(question);
    liveContext = [];
    followUp = null;
    pendingTask = null;
    activeInputs = [];
    pendingChange = null;
    return snapshot();
  }

  function stop() {
    active = false;
    task = null;
    liveContext = [];
    followUp = null;
    pendingTask = null;
    activeInputs = [];
    pendingChange = null;
    return snapshot();
  }

  function upsertContext(entry = {}) {
    if (!active) return snapshot();
    const text = cleanText(entry.text || entry.transcript || entry.translation, 2400);
    if (!text) return snapshot();
    const id = cleanText(entry.id, 160) || `context-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const normalized = text.toLocaleLowerCase('en-US');
    const next = {
      id,
      text,
      translation: cleanText(entry.translation, 2400),
      kind: cleanText(entry.kind, 40) || 'remark',
      status: cleanText(entry.status, 40) || 'ready',
      reason: cleanText(entry.reason, 1200),
      normalizedInput: cleanText(entry.normalizedInput, 2400),
      ts: Number(entry.ts || Date.now()),
      normalized,
      classification: cloneClassification(entry.classification)
    };
    const index = liveContext.findIndex(item => item.id === id);
    if (index >= 0) liveContext[index] = { ...liveContext[index], ...next };
    else {
      const last = liveContext[liveContext.length - 1];
      if (last && last.normalized === normalized && next.ts - Number(last.ts || 0) < 15_000) return snapshot();
      liveContext.push(next);
    }
    if (liveContext.length > maxEntries) liveContext.splice(0, liveContext.length - maxEntries);
    return snapshot();
  }

  function appendContext(entry = {}) {
    return upsertContext(entry);
  }

  function updateContext(id, patch = {}) {
    if (!active) return snapshot();
    const cleanId = cleanText(id, 160);
    const index = liveContext.findIndex(item => item.id === cleanId);
    if (index < 0) return snapshot();
    const current = liveContext[index];
    liveContext[index] = {
      ...current,
      ...patch,
      id: current.id,
      text: cleanText(patch.text ?? current.text, 2400),
      translation: cleanText(patch.translation ?? current.translation, 2400),
      reason: cleanText(patch.reason ?? current.reason, 1200),
      normalizedInput: cleanText(patch.normalizedInput ?? current.normalizedInput, 2400),
      classification: patch.classification ? cloneClassification(patch.classification) : current.classification
    };
    return snapshot();
  }

  function clearContext() {
    liveContext = [];
    return snapshot();
  }

  function setFollowUpQuestion(question) {
    if (!active) return snapshot();
    followUp = {
      question: cloneQuestion(question),
      status: 'question',
      suggestion: null,
      error: ''
    };
    return snapshot();
  }

  function setFollowUpAnalyzing(value = true) {
    if (!active || !followUp) return snapshot();
    followUp = {
      ...followUp,
      status: value ? 'analyzing' : (followUp.suggestion ? 'ready' : 'question'),
      error: ''
    };
    return snapshot();
  }

  function setFollowUpSuggestion(suggestion) {
    if (!active || !followUp) return snapshot();
    followUp = {
      ...followUp,
      status: 'ready',
      suggestion: cloneSuggestion(suggestion),
      error: ''
    };
    return snapshot();
  }

  function setFollowUpError(error) {
    if (!active || !followUp) return snapshot();
    followUp = {
      ...followUp,
      status: 'error',
      error: cleanText(error, 3000)
    };
    return snapshot();
  }

  function setPendingTask(question) {
    if (!active) return snapshot();
    pendingTask = cloneQuestion(question);
    return snapshot();
  }

  function takePendingTask() {
    const value = cloneQuestion(pendingTask);
    pendingTask = null;
    return { question: value, ...snapshot() };
  }

  function setPendingChange(change) {
    if (!active) return snapshot();
    pendingChange = clonePendingChange({
      ...change,
      status: cleanText(change?.status, 40) || 'waiting',
      error: cleanText(change?.error, 3000)
    });
    return snapshot();
  }

  function setPendingChangeStatus(status, error = '') {
    if (!pendingChange) return snapshot();
    pendingChange = {
      ...pendingChange,
      status: cleanText(status, 40) || pendingChange.status,
      error: cleanText(error, 3000)
    };
    return snapshot();
  }

  function clearPendingChange() {
    pendingChange = null;
    return snapshot();
  }

  function commitActiveInputs(inputs) {
    activeInputs = (Array.isArray(inputs) ? inputs : []).map(cloneInput).filter(Boolean).slice(-20);
    pendingChange = null;
    return snapshot();
  }

  function removeActiveInput(id) {
    const cleanId = cleanText(id, 160);
    activeInputs = activeInputs.filter(item => item.id !== cleanId);
    return snapshot();
  }

  function currentContext() {
    return {
      active,
      task: cloneQuestion(task),
      followUp: followUp ? { ...followUp, question: cloneQuestion(followUp.question), suggestion: cloneSuggestion(followUp.suggestion) } : null,
      activeInputs: activeInputs.map(cloneInput).filter(Boolean),
      pendingChange: clonePendingChange(pendingChange),
      liveContext: liveContext.map(item => ({ ...item, classification: cloneClassification(item.classification) }))
    };
  }

  return {
    snapshot,
    start,
    stop,
    appendContext,
    upsertContext,
    updateContext,
    clearContext,
    setFollowUpQuestion,
    setFollowUpAnalyzing,
    setFollowUpSuggestion,
    setFollowUpError,
    setPendingTask,
    takePendingTask,
    setPendingChange,
    setPendingChangeStatus,
    clearPendingChange,
    commitActiveInputs,
    removeActiveInput,
    currentContext
  };
}

module.exports = {
  cleanText,
  createCodingFocusState
};
