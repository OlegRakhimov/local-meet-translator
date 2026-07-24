const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  sanitizeLibrary,
  createAnswerLibraryStore
} = require('../src/main/answer-library-store');

test('sanitizeLibrary normalizes entries and removes empty records', () => {
  const library = sanitizeLibrary({
    entries: [
      {
        question: '  Tell me about yourself  ',
        level: 'b1',
        style: 'TECHNICAL',
        answer: '  I am an Android developer.  ',
        keywords: ['Android', 'android', 'Kotlin'],
        groundingFacts: 'Published app\nPublished app\nCompose',
        locked: true
      },
      { question: '', answer: '' }
    ]
  });
  assert.equal(library.entries.length, 1);
  assert.equal(library.entries[0].question, 'Tell me about yourself');
  assert.equal(library.entries[0].level, 'B1');
  assert.equal(library.entries[0].style, 'technical');
  assert.deepEqual(library.entries[0].keywords, ['Android', 'Kotlin']);
  assert.deepEqual(library.entries[0].groundingFacts, ['Published app', 'Compose']);
  assert.equal(library.entries[0].locked, true);
});

test('answer library store writes atomically and loads persisted entries', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'lmt-answer-library-'));
  const libraryPath = path.join(directory, 'answer-library.json');
  const store = createAnswerLibraryStore({ libraryPath });
  const saved = store.save({ entries: [{ question: 'Why Android?', answer: 'I enjoy building useful mobile products.' }] });
  assert.equal(saved.ok, true);
  assert.equal(saved.library.entries.length, 1);
  const loaded = store.load();
  assert.equal(loaded.library.entries[0].question, 'Why Android?');
  assert.equal(loaded.library.entries[0].answer, 'I enjoy building useful mobile products.');
  assert.equal(fs.existsSync(libraryPath), true);
});

test('answer library store recovers from invalid JSON', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'lmt-answer-library-corrupt-'));
  const libraryPath = path.join(directory, 'answer-library.json');
  fs.writeFileSync(libraryPath, '{not-json');
  const store = createAnswerLibraryStore({ libraryPath });
  const loaded = store.load();
  assert.equal(loaded.recovered, true);
  assert.equal(loaded.library.entries.length, 0);
  assert.match(loaded.warning, /unreadable/i);
});
