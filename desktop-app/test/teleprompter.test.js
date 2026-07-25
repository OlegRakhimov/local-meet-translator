const test = require('node:test');
const assert = require('node:assert/strict');
const {
  splitAnswerIntoChunks,
  buildTeleprompterDocument,
  createTeleprompterState
} = require('../src/main/teleprompter');

test('splits an answer into readable chunks without rewriting its words', () => {
  const answer = 'I build Android applications with Kotlin and Jetpack Compose. I also use Room, DataStore, REST APIs, and background services. I test the application before publishing it.';
  const chunks = splitAnswerIntoChunks(answer, { mode: 'short' });
  assert.ok(chunks.length >= 3);
  assert.equal(chunks.join(' ').replace(/\s+/g, ' '), answer.replace(/\s+/g, ' '));
  assert.ok(chunks.every(chunk => chunk.split(/\s+/).length <= 16));
});

test('builds a teleprompter document from an existing grounded suggestion only', () => {
  const document = buildTeleprompterDocument({
    source: 'library',
    question: 'Tell me about yourself',
    firstSentence: 'I am an Android developer.',
    answer: 'I am an Android developer. I build complete applications and test them before release.',
    keyPoints: ['Android development', 'Complete applications'],
    keywords: ['Kotlin', 'Compose']
  }, { chunkMode: 'medium' });
  assert.equal(document.source, 'library');
  assert.equal(document.firstSentence, 'I am an Android developer.');
  assert.deepEqual(document.keywords, ['Kotlin', 'Compose']);
  assert.match(document.chunks.join(' '), /complete applications/);
});

test('freeze keeps the current answer and queues a new answer', () => {
  const state = createTeleprompterState({ frozen: false, chunkMode: 'short' });
  state.loadSuggestion({ question: 'Question one?', answer: 'First answer. It stays visible.', firstSentence: 'First answer.' });
  state.setFrozen(true);
  state.noteQuestion({ id: 'q2', text: 'Question two?' });
  const result = state.loadSuggestion({ question: 'Question two?', answer: 'Second answer.', firstSentence: 'Second answer.' });
  assert.equal(result.disposition, 'pending');
  assert.equal(state.snapshot().current.suggestion.question, 'Question one?');
  assert.equal(state.snapshot().pending.suggestion.question, 'Question two?');
  assert.equal(state.snapshot().hasPending, true);
  const loaded = state.loadPending();
  assert.equal(loaded.loaded, true);
  assert.equal(state.snapshot().current.suggestion.question, 'Question two?');
});

test('next and previous controls stay within chunk boundaries', () => {
  const state = createTeleprompterState({ chunkMode: 'short' });
  state.loadSuggestion({
    question: 'Architecture?',
    answer: 'First sentence explains my Android development background with Kotlin and Compose. Second sentence describes Room, DataStore, REST APIs, testing, and background services. Third sentence explains how I prepare releases and publish stable applications.',
    firstSentence: 'First sentence has several words.'
  });
  const count = state.snapshot().chunkCount;
  assert.ok(count >= 2);
  for (let i = 0; i < count + 3; i += 1) state.nextChunk();
  assert.equal(state.snapshot().activeChunkIndex, count - 1);
  for (let i = 0; i < count + 3; i += 1) state.previousChunk();
  assert.equal(state.snapshot().activeChunkIndex, 0);
});

test('coding solution teleprompter uses speaking notes instead of reading code aloud', () => {
  const document = buildTeleprompterDocument({
    responseType: 'coding_solution',
    question: 'Write a Java method to find duplicates.',
    firstSentence: 'I will compare the values and collect duplicates.',
    answer: 'The full answer contains implementation details.',
    implementationPlan: ['Create the input array', 'Compare each pair', 'Print duplicates'],
    speakingNotes: ['First, I create the input array.', 'Next, I compare each pair.', 'Finally, I print each duplicate once.'],
    code: 'public class Main {}'
  }, { chunkMode: 'short' });
  assert.equal(document.responseType, 'coding_solution');
  assert.deepEqual(document.plan, ['Create the input array', 'Compare each pair', 'Print duplicates']);
  assert.match(document.chunks.join(' '), /First, I create the input array/);
  assert.doesNotMatch(document.chunks.join(' '), /public class Main/);
});
