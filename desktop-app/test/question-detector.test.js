const test = require('node:test');
const assert = require('node:assert/strict');
const { looksLikeQuestion, createQuestionDetector } = require('../src/main/question-detector');

test('recognizes interview questions with and without a question mark', () => {
  assert.equal(looksLikeQuestion('What was the most difficult problem you solved?'), true);
  assert.equal(looksLikeQuestion('Tell me about yourself'), true);
  assert.equal(looksLikeQuestion('This is a normal statement.'), false);
});

test('detects incoming questions and suppresses close repeats', () => {
  const detector = createQuestionDetector({ dedupeWindowMs: 60_000 });
  const first = detector.consume({ id:'1', channel:'incoming', transcript:'How do you handle a difficult bug?' }, 1_000);
  const repeated = detector.consume({ id:'2', channel:'incoming', transcript:'How do you handle a difficult bug?' }, 2_000);
  assert.equal(first.accepted, true);
  assert.equal(repeated.accepted, false);
  assert.equal(repeated.reason, 'duplicate');
});

test('does not treat outgoing speech as an interviewer question', () => {
  const detector = createQuestionDetector();
  assert.equal(detector.consume({ channel:'outgoing', transcript:'What should I say?' }).reason, 'outgoing');
});
