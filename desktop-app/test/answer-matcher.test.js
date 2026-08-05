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

test('matches a Polish vacancy question through a reviewed alias', () => {
  const result = matchAnswerLibrary('Proszę opowiedzieć coś o sobie.', [{
    id: 'speakit-intro',
    question: 'Tell me about yourself.',
    aliases: ['Could you introduce yourself?', 'Proszę opowiedzieć coś o sobie.'],
    intent: 'introduction',
    answer: 'My background combines legal, business and technical experience.',
    firstSentence: 'My background combines legal, business and technical experience.',
    locked: true
  }]);
  assert.equal(result.matched, true);
  assert.equal(result.suggestion.sourceEntryId, 'speakit-intro');
  assert.ok(result.score >= 0.9);
});
