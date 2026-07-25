'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createTeleprompterState } = require('../src/main/teleprompter');

function suggestion(question, answer) {
  return {
    question,
    source: 'library',
    confidence: 'high',
    firstSentence: answer,
    answer,
    keyPoints: [],
    basis: [],
    safeFallback: ''
  };
}

test('unfreezing automatically loads a prepared pending answer', () => {
  const state = createTeleprompterState({ frozen: false, chunkMode: 'short' });
  state.loadSuggestion(suggestion('Question one?', 'Answer one.'), { text: 'Question one?' });
  state.setFrozen(true);
  state.noteQuestion({ text: 'Question two?' });
  const pendingResult = state.loadSuggestion(
    suggestion('Question two?', 'Answer two.'),
    { text: 'Question two?' }
  );

  assert.equal(pendingResult.disposition, 'pending');
  assert.equal(state.snapshot().pending.question.text, 'Question two?');

  const unfrozen = state.setFrozen(false);
  assert.equal(unfrozen.loadedPending, true);
  assert.equal(unfrozen.current.question.text, 'Question two?');
  assert.equal(unfrozen.current.suggestion.answer, 'Answer two.');
  assert.equal(unfrozen.pending, null);
  assert.equal(unfrozen.pendingQuestion, null);
});

test('a new non-frozen question clears stale pending state', () => {
  const state = createTeleprompterState({ frozen: false });
  state.loadSuggestion(suggestion('Question one?', 'Answer one.'), { text: 'Question one?' });
  state.setFrozen(true);
  state.noteQuestion({ text: 'Old pending question?' });
  state.setFrozen(false);
  state.noteQuestion({ text: 'Current stable question?' });

  const snapshot = state.snapshot();
  assert.equal(snapshot.frozen, false);
  assert.equal(snapshot.pending, null);
  assert.equal(snapshot.pendingQuestion, null);
  assert.equal(snapshot.pendingAnalyzing, false);
});
