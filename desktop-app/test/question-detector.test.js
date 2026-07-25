const test = require('node:test');
const assert = require('node:assert/strict');
const {
  looksLikeQuestion,
  looksLikeCodingTask,
  classifyInterviewUtterance,
  createQuestionDetector
} = require('../src/main/question-detector');

test('recognizes interview questions with and without a question mark', () => {
  assert.equal(looksLikeQuestion('What was the most difficult problem you solved?'), true);
  assert.equal(looksLikeQuestion('Tell me about yourself'), true);
  assert.equal(looksLikeQuestion('This is a normal statement.'), false);
});

test('distinguishes remarks and jokes from actionable questions', () => {
  assert.deepEqual(classifyInterviewUtterance('That was a good answer.').kind, 'remark');
  assert.deepEqual(classifyInterviewUtterance('We all have bugs on Friday afternoons.').kind, 'remark');
  assert.equal(classifyInterviewUtterance('How do you debug a difficult problem?').actionable, true);
});

test('recognizes coding tasks even without a question mark', () => {
  assert.equal(looksLikeCodingTask('Write a Java method that finds duplicate numbers in an array.'), true);
  assert.equal(looksLikeCodingTask('Given an integer array, find all duplicate values'), true);
  assert.equal(classifyInterviewUtterance('Implement reverse linked list in Java').kind, 'coding-task');
});

test('detects incoming questions and suppresses close repeats', () => {
  const detector = createQuestionDetector({ dedupeWindowMs: 60_000 });
  const first = detector.consume({ id:'1', channel:'incoming', transcript:'How do you handle a difficult bug?' }, 1_000);
  const repeated = detector.consume({ id:'2', channel:'incoming', transcript:'How do you handle a difficult bug?' }, 2_000);
  assert.equal(first.accepted, true);
  assert.equal(repeated.accepted, false);
  assert.equal(repeated.reason, 'duplicate');
});

test('accepts a second distinct question after an intervening remark', () => {
  const detector = createQuestionDetector({ dedupeWindowMs: 60_000 });
  const first = detector.consume({ channel:'incoming', transcript:'Tell me about your Android experience.' }, 1_000);
  const remark = detector.consume({ channel:'incoming', transcript:'That is interesting, thank you.' }, 2_000);
  const second = detector.consume({ channel:'incoming', transcript:'How do you test your Android applications?' }, 3_000);
  assert.equal(first.accepted, true);
  assert.equal(remark.accepted, false);
  assert.equal(remark.reason, 'remark');
  assert.equal(second.accepted, true);
  assert.equal(second.question.kind, 'question');
});

test('merges a coding constraint into the active coding task', () => {
  const detector = createQuestionDetector({ contextWindowMs: 60_000 });
  const task = detector.consume({ channel:'incoming', transcript:'Write a method that finds duplicates in an array.' }, 1_000);
  const constraint = detector.consume({ channel:'incoming', transcript:'Use Java and explain the time complexity.' }, 2_000);
  assert.equal(task.accepted, true);
  assert.equal(task.question.kind, 'coding-task');
  assert.equal(constraint.accepted, true);
  assert.equal(constraint.reason, 'coding-context');
  assert.match(constraint.question.text, /Additional constraint/);
  assert.match(constraint.question.text, /Use Java/);
});


test('does not merge a joke into an active coding task', () => {
  const detector = createQuestionDetector({ contextWindowMs: 60_000 });
  detector.consume({ channel:'incoming', transcript:'Write a Java method that reverses an array.' }, 1_000);
  const joke = detector.consume({ channel:'incoming', transcript:'That was funny, we all forget semicolons sometimes.' }, 2_000);
  assert.equal(joke.accepted, false);
  assert.equal(joke.reason, 'remark');
});

test('does not treat outgoing speech as an interviewer question', () => {
  const detector = createQuestionDetector();
  assert.equal(detector.consume({ channel:'outgoing', transcript:'What should I say?' }).reason, 'outgoing');
});
