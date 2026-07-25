const test = require('node:test');
const assert = require('node:assert/strict');
const { scoreAnswerEntry, matchAnswerLibrary } = require('../src/main/answer-matcher');

const entries = [{
  id:'intro', question:'Tell me about yourself', intent:'introduction', answer:'I am an Android developer.',
  firstSentence:'I am an Android developer.', keywords:['background','yourself','introduction'], groundingFacts:['I use Kotlin.'], locked:true
}];

test('matches a reviewed answer by intent and question vocabulary', () => {
  const result = matchAnswerLibrary('Could you tell me about yourself?', entries, { threshold:0.4 });
  assert.equal(result.matched, true);
  assert.equal(result.suggestion.source, 'library');
  assert.equal(result.suggestion.firstSentence, 'I am an Android developer.');
});

test('does not force an unrelated library match', () => {
  const result = matchAnswerLibrary('How do you optimize Room database queries?', entries);
  assert.equal(result.matched, false);
  assert.ok(scoreAnswerEntry('How do you optimize Room database queries?', entries[0]) < 0.52);
});
