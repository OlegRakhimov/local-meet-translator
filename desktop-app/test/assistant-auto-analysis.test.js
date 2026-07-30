'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  questionKey,
  createAutomaticAnalysisCoordinator
} = require('../src/main/assistant-auto-analysis');

test('questionKey normalizes punctuation and whitespace', () => {
  assert.equal(
    questionKey('  Could you tell me about Android?  '),
    'could you tell me about android'
  );
});

test('automatic coordinator analyzes only the latest queued question', async () => {
  const analyzed = [];
  const coordinator = createAutomaticAnalysisCoordinator({
    delayMs: 60_000,
    analyze: async question => {
      analyzed.push(question.text);
      return { ok: true };
    }
  });

  coordinator.queue({ text: 'First partial question?' });
  coordinator.queue({ text: 'Could you tell me about your Android experience?' });
  await coordinator.runLatest();

  assert.deepEqual(analyzed, ['Could you tell me about your Android experience?']);
});

test('automatic coordinator serializes analysis and keeps the newest queued question', async () => {
  const analyzed = [];
  let releaseFirst;
  const firstGate = new Promise(resolve => { releaseFirst = resolve; });
  const coordinator = createAutomaticAnalysisCoordinator({
    delayMs: 60_000,
    analyze: async question => {
      analyzed.push(question.text);
      if (analyzed.length === 1) await firstGate;
      return { ok: true };
    }
  });

  coordinator.queue({ text: 'Question one?' });
  const firstRun = coordinator.runLatest();
  coordinator.queue({ text: 'Question two?' });
  coordinator.queue({ text: 'Question two with stable wording?' });
  releaseFirst();
  await firstRun;
  await coordinator.runLatest();

  assert.deepEqual(analyzed, ['Question one?', 'Question two with stable wording?']);
});

test('completed question is not analyzed twice', async () => {
  let count = 0;
  const coordinator = createAutomaticAnalysisCoordinator({
    delayMs: 60_000,
    analyze: async () => {
      count += 1;
      return { ok: true };
    }
  });

  coordinator.queue({ text: 'Tell me about yourself?' });
  await coordinator.runLatest();
  const duplicate = coordinator.queue({ text: 'Tell me about yourself?' });

  assert.equal(count, 1);
  assert.equal(duplicate.accepted, false);
  assert.equal(duplicate.reason, 'duplicate');
});

test('finishing an answer allows the same question to be analyzed again without dropping queued work', async () => {
  let count = 0;
  const coordinator = createAutomaticAnalysisCoordinator({
    delayMs: 60_000,
    analyze: async () => {
      count += 1;
      return { ok: true };
    }
  });

  coordinator.queue({ text: 'Tell me about yourself?' });
  await coordinator.runLatest();
  coordinator.queue({ text: 'A different queued question?' });
  coordinator.forgetCompleted();
  assert.equal(coordinator.snapshot().queued.text, 'A different queued question?');
  await coordinator.runLatest();
  const repeated = coordinator.queue({ text: 'Tell me about yourself?' });
  assert.equal(repeated.accepted, true);
  await coordinator.runLatest();
  assert.equal(count, 3);
});
