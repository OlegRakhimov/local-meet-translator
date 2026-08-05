'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeClassification,
  fallbackClassifyUtterance,
  isAutomaticChange,
  previewActiveInputs
} = require('../src/main/utterance-classifier');

test('normalizes semantic classifier output without relying on technology keywords', () => {
  const result = normalizeClassification({
    type: 'recommendation',
    target: 'algorithm',
    action: 'offer-change',
    normalizedInput: 'Consider a linear-time lookup structure',
    changesCurrentSolution: true,
    confidence: 'high',
    reason: 'The interviewer suggests an option but does not require it.',
    inputOperation: 'none',
    affectedInputIds: [],
    mergeWithPrevious: false,
    combinedUtterance: '',
    verificationCriteria: ['Avoid the nested scan']
  });
  assert.equal(result.type, 'recommendation');
  assert.equal(result.action, 'offer-change');
  assert.equal(result.inputOperation, 'none');
});

test('fallback distinguishes recommendation, direct request, and hard constraint by wording', () => {
  assert.equal(fallbackClassifyUtterance({ utterance: 'Maybe a different lookup structure would be better.' }).type, 'recommendation');
  assert.equal(fallbackClassifyUtterance({ utterance: 'Could you rewrite this using a lookup structure?' }).type, 'request');
  assert.equal(fallbackClassifyUtterance({ utterance: 'The solution must run in linear time.' }).type, 'constraint');
});

test('only high-confidence direct changes auto-apply', () => {
  assert.equal(isAutomaticChange({ type: 'request', action: 'apply-change', confidence: 'high', changesCurrentSolution: true }, true), true);
  assert.equal(isAutomaticChange({ type: 'recommendation', action: 'offer-change', confidence: 'high', changesCurrentSolution: true }, true), false);
  assert.equal(isAutomaticChange({ type: 'constraint', action: 'apply-change', confidence: 'medium', changesCurrentSolution: true }, true), false);
});

test('previewActiveInputs replaces affected inputs and preserves unrelated context', () => {
  const current = [
    { id: 'a', normalizedInput: 'Return indexes', status: 'active' },
    { id: 'b', normalizedInput: 'Use Java', status: 'active' }
  ];
  const next = previewActiveInputs(current, {
    type: 'correction',
    target: 'output',
    inputOperation: 'replace',
    affectedInputIds: ['a'],
    normalizedInput: 'Return values instead',
    verificationCriteria: []
  }, { id: 'c', text: 'Actually return the values.', ts: 10 });
  assert.deepEqual(next.map(item => item.normalizedInput), ['Use Java', 'Return values instead']);
});
