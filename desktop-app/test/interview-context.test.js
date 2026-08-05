
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildCodingRequestParts,
  buildCurrentSolutionContext,
  buildActiveInputContext,
  buildRecentCodingContext
} = require('../src/main/interview-context');

test('structured coding context keeps request parts separate and bounded', () => {
  const focus = {
    task: { text: 'Given an integer array, return all duplicates.' },
    activeInputs: Array.from({ length: 25 }, (_, index) => ({
      id: `input-${index}`,
      type: 'constraint',
      target: 'edge-case',
      normalizedInput: `Handle edge case ${index} explicitly.`,
      verificationCriteria: ['No crash', 'Correct result']
    })),
    liveContext: [
      { id: 'remark', text: 'This is very nice.', kind: 'remark' },
      ...Array.from({ length: 10 }, (_, index) => ({
        id: `context-${index}`,
        text: `Meaningful request ${index}`,
        kind: 'request',
        classification: { type: 'request', target: 'implementation', action: 'apply-change' }
      }))
    ]
  };
  const currentSuggestion = {
    approachSummary: 'Use a frequency map.',
    codeLanguage: 'java',
    code: 'x'.repeat(45000),
    codeWalkthrough: Array.from({ length: 60 }, (_, index) => `Line ${index}: explanation`),
    edgeCases: ['null input', 'empty input'],
    speakingNotes: ['First, I will count values.']
  };

  const parts = buildCodingRequestParts({
    focus,
    currentSuggestion,
    latestUtterance: 'Please handle edge cases more explicitly.'
  });

  assert.equal(parts.currentTask, focus.task.text);
  assert.equal(parts.latestUtterance, 'Please handle edge cases more explicitly.');
  assert.equal(parts.currentSolution.code.length, 30000);
  assert.equal(parts.activeInputs.length, 20);
  assert.equal(parts.recentContext.length, 6);
  assert.ok(parts.recentContext.every(item => item.type !== 'remark'));
  assert.ok(JSON.stringify(parts.currentSolution).length < 70000);
  assert.ok(JSON.stringify(parts.activeInputs).length < 50000);
  assert.ok(JSON.stringify(parts.recentContext).length < 20000);
});

test('context helpers safely accept missing values', () => {
  assert.deepEqual(buildCurrentSolutionContext(), {
    approachSummary: '',
    implementationPlan: [],
    codeLanguage: '',
    code: '',
    codeWalkthrough: [],
    complexity: '',
    edgeCases: [],
    speakingNotes: []
  });
  assert.deepEqual(buildActiveInputContext(), []);
  assert.deepEqual(buildRecentCodingContext(), []);
});
