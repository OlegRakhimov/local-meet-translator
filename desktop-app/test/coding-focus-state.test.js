'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createCodingFocusState } = require('../src/main/coding-focus-state');

test('coding focus preserves the task while interviewer context grows', () => {
  const state = createCodingFocusState({ maxEntries: 3 });
  state.start({ id: 'task-1', text: 'Write Two Sum in Java', kind: 'coding-task' });
  state.appendContext({ text: 'Take your time.', kind: 'remark', ts: 1 });
  state.appendContext({ text: 'What is the complexity?', kind: 'follow-up', ts: 2 });
  const snapshot = state.snapshot();
  assert.equal(snapshot.active, true);
  assert.equal(snapshot.task.text, 'Write Two Sum in Java');
  assert.deepEqual(snapshot.liveContext.map(item => item.kind), ['remark', 'follow-up']);
});

test('coding focus stores a follow-up answer separately from the main task', () => {
  const state = createCodingFocusState();
  state.start({ text: 'Reverse a linked list', kind: 'coding-task' });
  state.setFollowUpQuestion({ text: 'Why is this O(n)?', kind: 'question' });
  state.setFollowUpAnalyzing(true);
  state.setFollowUpSuggestion({ answer: 'Each node is visited once.', firstSentence: 'It is O(n).' });
  const snapshot = state.snapshot();
  assert.equal(snapshot.task.text, 'Reverse a linked list');
  assert.equal(snapshot.followUp.status, 'ready');
  assert.equal(snapshot.followUp.suggestion.answer, 'Each node is visited once.');
});

test('new coding task remains pending until explicitly opened', () => {
  const state = createCodingFocusState();
  state.start({ text: 'Two Sum', kind: 'coding-task' });
  state.setPendingTask({ text: 'Now reverse a linked list', kind: 'coding-task' });
  assert.equal(state.snapshot().task.text, 'Two Sum');
  const taken = state.takePendingTask();
  assert.equal(taken.question.text, 'Now reverse a linked list');
  assert.equal(state.snapshot().pendingTask, null);
});

test('coding focus stores contextual classifications and pending changes without replacing the task', () => {
  const state = createCodingFocusState();
  state.start({ text: 'Two Sum', kind: 'coding-task' });
  state.upsertContext({ id: 'u1', text: 'Maybe use another lookup strategy.', kind: 'analyzing', status: 'analyzing' });
  state.updateContext('u1', {
    kind: 'recommendation',
    status: 'classified',
    normalizedInput: 'Consider a linear lookup strategy',
    classification: { type: 'recommendation', action: 'offer-change', confidence: 'high' }
  });
  state.setPendingChange({
    id: 'u1',
    utterance: { id: 'u1', text: 'Maybe use another lookup strategy.' },
    classification: { type: 'recommendation', action: 'offer-change', confidence: 'high' },
    proposedInputs: []
  });
  const snapshot = state.snapshot();
  assert.equal(snapshot.task.text, 'Two Sum');
  assert.equal(snapshot.liveContext[0].kind, 'recommendation');
  assert.equal(snapshot.pendingChange.classification.action, 'offer-change');
});

test('coding focus commits semantic inputs only after a revised solution is ready', () => {
  const state = createCodingFocusState();
  state.start({ text: 'Two Sum', kind: 'coding-task' });
  state.setPendingChange({ id: 'u2', utterance: { text: 'Return values instead.' }, classification: { type: 'correction' }, proposedInputs: [] });
  state.commitActiveInputs([{ id: 'i1', normalizedInput: 'Return values instead', status: 'active' }]);
  const snapshot = state.snapshot();
  assert.equal(snapshot.activeInputs[0].normalizedInput, 'Return values instead');
  assert.equal(snapshot.pendingChange, null);
});
