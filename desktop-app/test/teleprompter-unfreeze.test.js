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

test('unfreezing does not replace a locked answer without explicit loading', () => {
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
  assert.equal(unfrozen.loadedPending, false);
  assert.equal(unfrozen.current.question.text, 'Question one?');
  assert.equal(unfrozen.pending.question.text, 'Question two?');

  const loaded = state.loadPending();
  assert.equal(loaded.loaded, true);
  assert.equal(loaded.current.question.text, 'Question two?');
  assert.equal(loaded.current.suggestion.answer, 'Answer two.');
});

test('a locked answer keeps the latest detected question pending while unfrozen', () => {
  const state = createTeleprompterState({ frozen: false });
  state.loadSuggestion(suggestion('Question one?', 'Answer one.'), { text: 'Question one?' });
  state.setFrozen(true);
  state.noteQuestion({ text: 'Old pending question?' });
  state.setFrozen(false);
  state.noteQuestion({ text: 'Current stable question?' });

  const snapshot = state.snapshot();
  assert.equal(snapshot.frozen, false);
  assert.equal(snapshot.answerLocked, true);
  assert.equal(snapshot.pendingQuestion.text, 'Current stable question?');
  assert.equal(snapshot.pendingAnalyzing, false);
});
