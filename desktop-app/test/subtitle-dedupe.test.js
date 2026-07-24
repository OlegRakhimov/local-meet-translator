const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeSubtitleText,
  jaccardSimilarity,
  createSubtitleDedupeGuard
} = require('../src/main/subtitle-dedupe');

test('normalizes punctuation and case', () => {
  assert.equal(normalizeSubtitleText(' Hello, WORLD! '), 'hello world');
});

test('jaccard similarity compares words', () => {
  assert.equal(jaccardSimilarity('one two', 'one two'), 1);
  assert.ok(jaccardSimilarity('one two three', 'one two four') > 0.4);
});

test('rejects exact and delayed repeated subtitles in the same scope', () => {
  const guard = createSubtitleDedupeGuard();
  const first = { id: 'a', channel: 'incoming', clientId: 'c', tabId: '1', transcript: 'How are you today?', translation: 'Как вы сегодня?' };
  assert.equal(guard.evaluate(first, 1000).accepted, true);
  const duplicate = guard.evaluate({ ...first, id: 'b' }, 9000);
  assert.equal(duplicate.accepted, false);
  assert.equal(duplicate.reason, 'duplicate');
  assert.equal(duplicate.duplicateOf, 'a');
});

test('allows a longer completion and asks overlay to replace the partial line', () => {
  const guard = createSubtitleDedupeGuard();
  assert.equal(guard.evaluate({ id: 'a', channel: 'incoming', transcript: 'I want to explain' }, 1000).accepted, true);
  const completion = guard.evaluate({ id: 'b', channel: 'incoming', transcript: 'I want to explain the project architecture' }, 4000);
  assert.equal(completion.accepted, true);
  assert.equal(completion.reason, 'completion');
  assert.equal(completion.replaceEventId, 'a');
});

test('does not mix dedupe history between tabs', () => {
  const guard = createSubtitleDedupeGuard();
  const phrase = { channel: 'incoming', clientId: 'c', transcript: 'same phrase' };
  assert.equal(guard.evaluate({ ...phrase, id: 'a', tabId: '1' }, 1000).accepted, true);
  assert.equal(guard.evaluate({ ...phrase, id: 'b', tabId: '2' }, 1100).accepted, true);
});
