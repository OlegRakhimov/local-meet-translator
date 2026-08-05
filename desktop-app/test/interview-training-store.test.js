const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  sanitizeTrainingData,
  summarizeTraining,
  buildMarkdownReport,
  createInterviewTrainingStore
} = require('../src/main/interview-training-store');

test('training data sanitizes attempts and scores', () => {
  const data = sanitizeTrainingData({ sessions: [{ title: ' Android ', status: 'completed', attempts: [{ question: ' Why Android? ', rating: 9, confidence: 0, needsPractice: true }] }] });
  assert.equal(data.sessions[0].title, 'Android');
  assert.equal(data.sessions[0].attempts[0].rating, 5);
  assert.equal(data.sessions[0].attempts[0].confidence, 0);
  assert.equal(data.sessions[0].attempts[0].needsPractice, true);
});

test('training summary counts completed practice only', () => {
  const summary = summarizeTraining({ sessions: [
    { status: 'completed', attempts: [{ question: 'A', rating: 4, confidence: 3 }, { question: 'B', rating: 2, confidence: 2, needsPractice: true }] },
    { status: 'active', attempts: [{ question: 'C', rating: 5, confidence: 5 }] }
  ] });
  assert.equal(summary.totalSessions, 1);
  assert.equal(summary.totalAttempts, 2);
  assert.equal(summary.averageRating, 3);
  assert.equal(summary.needsPracticeCount, 1);
});

test('training store persists and exports markdown report', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'lmt-training-'));
  const trainingPath = path.join(directory, 'interview-training.json');
  const store = createInterviewTrainingStore({ trainingPath });
  store.save({ sessions: [{ title: 'Session', status: 'completed', completedAt: new Date().toISOString(), attempts: [{ question: 'Tell me about yourself', practiceAnswer: 'I am an Android developer.', rating: 4 }] }] });
  const loaded = store.load();
  assert.equal(loaded.summary.totalSessions, 1);
  const reportPath = path.join(directory, 'report.md');
  store.exportMarkdown(reportPath, loaded.data);
  assert.match(fs.readFileSync(reportPath, 'utf8'), /Tell me about yourself/);
  assert.match(buildMarkdownReport(loaded.data), /Average answer rating/);
});
