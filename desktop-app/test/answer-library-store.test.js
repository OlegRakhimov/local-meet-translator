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

test('answer library preserves aliases and restores a bundled vacancy preset', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'lmt-answer-library-preset-'));
  const libraryPath = path.join(directory, 'answer-library-speakit.json');
  const store = createAnswerLibraryStore({
    libraryPath,
    presetLibrary: {
      profileMode: 'speakit_polish_support',
      entries: [{
        id: 'intro',
        question: 'Tell me about yourself.',
        aliases: ['Could you introduce yourself?', 'Proszę opowiedzieć coś o sobie.'],
        answer: 'My background combines legal, business and technical experience.'
      }]
    }
  });

  const initial = store.load().library;
  assert.equal(initial.profileMode, 'speakit_polish_support');
  assert.deepEqual(initial.entries[0].aliases, ['Could you introduce yourself?', 'Proszę opowiedzieć coś o sobie.']);

  store.save({ entries: [] });
  const restored = store.reset().library;
  assert.equal(restored.entries.length, 1);
  assert.equal(restored.entries[0].id, 'intro');
});

test('bundled preset revision replaces reviewed entries and preserves custom answers', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'lmt-answer-library-revision-'));
  const libraryPath = path.join(directory, 'answer-library-speakit.json');
  fs.writeFileSync(libraryPath, JSON.stringify({
    profileMode: 'speakit_polish_support',
    presetRevision: 1,
    entries: [
      {
        id: 'speakit-003',
        question: 'Why are you interested in customer support?',
        answer: 'Old reviewed answer.',
        locked: true
      },
      {
        id: 'custom-question',
        question: 'What is your personal example?',
        answer: 'My custom answer.',
        locked: false
      }
    ]
  }));

  const store = createAnswerLibraryStore({
    libraryPath,
    presetLibrary: {
      profileMode: 'speakit_polish_support',
      presetRevision: 2,
      entries: [{
        id: 'speakit-003',
        question: 'Why do you want to work in customer support?',
        aliases: ['Why do we want to go to customer support?'],
        answer: 'I want to work in customer support because I enjoy helping people.',
        locked: true
      }]
    }
  });

  const loaded = store.load();
  assert.equal(loaded.presetUpdated, true);
  assert.equal(loaded.library.presetRevision, 2);
  assert.equal(loaded.library.entries.find(entry => entry.id === 'speakit-003').answer,
    'I want to work in customer support because I enjoy helping people.');
  assert.equal(loaded.library.entries.find(entry => entry.id === 'custom-question').answer, 'My custom answer.');

  const secondLoad = store.load();
  assert.equal(secondLoad.presetUpdated, false);
});
