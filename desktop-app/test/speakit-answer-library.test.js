const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeQuestionText } = require('../src/main/question-detector');
const { matchAnswerLibrary } = require('../src/main/answer-matcher');
const library = require('../src/presets/speakit-polish-support/answer-library.json');
const profile = require('../src/presets/speakit-polish-support/candidate-profile.json');

test('SpeakIT preset contains 67 reviewed first-person answers', () => {
  assert.equal(library.profileMode, 'speakit_polish_support');
  assert.ok(library.presetRevision >= 2);
  assert.equal(library.entries.length, 67);

  const seen = new Set();
  for (const entry of library.entries) {
    assert.equal(entry.locked, true, `${entry.id} must remain a reviewed locked answer`);
    assert.ok(entry.question.trim(), `${entry.id} has no question`);
    assert.ok(entry.answer.trim(), `${entry.id} has no answer`);
    assert.ok(entry.firstSentence.trim(), `${entry.id} has no first sentence`);
    assert.ok(
      entry.answer.startsWith(entry.firstSentence),
      `${entry.id} answer must start with its firstSentence`
    );
    assert.doesNotMatch(entry.firstSentence, /^(?:yes|no)\.?$/i, `${entry.id} has an unhelpful one-word opening`);
    assert.doesNotMatch(entry.answer, /^We\b/i, `${entry.id} must answer as Oleg, not as a group`);
    assert.doesNotMatch(entry.answer, /^Our\b/i, `${entry.id} must answer as Oleg, not as a group`);
    assert.doesNotMatch(entry.answer, /^Customer support is\b/i, `${entry.id} must not replace a personal answer with a definition`);
    assert.doesNotMatch(entry.answer, /\bgo to customer support\b/i, `${entry.id} contains unnatural wording`);

    const normalizedQuestion = normalizeQuestionText(entry.question);
    assert.ok(!seen.has(normalizedQuestion), `duplicate question: ${entry.question}`);
    seen.add(normalizedQuestion);
  }
});

test('SpeakIT instructions enforce first-person answers and correct ASR pronoun mistakes', () => {
  assert.match(profile.interviewInstructions, /first-person singular/i);
  assert.match(profile.interviewInstructions, /Never use we, us or our/i);
  assert.match(profile.interviewInstructions, /speech recognition changes you to we/i);
  assert.match(profile.interviewInstructions, /do not replace it with a generic definition/i);
});

test('the malformed customer-support question resolves to the reviewed personal answer', () => {
  const result = matchAnswerLibrary(
    'Why do we want to go to customer support?',
    library.entries
  );
  assert.equal(result.matched, true);
  assert.equal(result.suggestion.sourceEntryId, 'speakit-003');
  assert.match(result.suggestion.answer, /^I want to work in customer support/);
});
