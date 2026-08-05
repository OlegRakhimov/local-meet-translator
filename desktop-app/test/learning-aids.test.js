'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { sanitizeEntry } = require('../src/main/answer-library-store');
const { scoreAnswerEntry, entryToSuggestion } = require('../src/main/answer-matcher');

test('Answer Library preserves bilingual useful phrases', () => {
  const entry = sanitizeEntry({
    question: 'How does the backend verify membership?',
    answer: 'It queries the current membership.',
    keywords: ['membership — членство'],
    usefulPhrases: ['The backend verifies... — Backend проверяет...', 'The backend verifies... — Backend проверяет...']
  });
  assert.deepEqual(entry.usefulPhrases, ['The backend verifies... — Backend проверяет...']);
});

test('learning-aid keywords and phrases support matching and library guidance', () => {
  const entry = sanitizeEntry({
    question: 'How does authorization work?',
    answer: 'The backend checks the database.',
    keywords: ['organization membership — членство в организации'],
    usefulPhrases: ['The backend verifies current membership — Backend проверяет текущее членство']
  });
  assert.ok(scoreAnswerEntry('How is current organization membership verified?', entry) > 0);
  const suggestion = entryToSuggestion(entry, 0.8);
  assert.ok(suggestion.keyPoints.some(value => /backend verifies/i.test(value)));
});