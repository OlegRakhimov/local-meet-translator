const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  normalizeQuestion,
  sanitizeLiveInterviewData,
  summarizeLiveInterviews,
  buildMarkdownReport,
  createLiveInterviewStore
} = require('../src/main/live-interview-store');

function tempStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lmt-live-review-'));
  let tick = 0;
  const store = createLiveInterviewStore({
    historyPath: path.join(dir, 'live-interviews.json'),
    clock: () => `2026-07-25T10:00:0${tick++}.000Z`,
    idFactory: prefix => `${prefix}-${tick}`
  });
  return { dir, store };
}

test('normalizes punctuation and spacing in interview questions', () => {
  assert.equal(normalizeQuestion('  Tell me—about   yourself? '), 'tell me about yourself');
});

test('starts a live session and records each normalized question once', () => {
  const { store } = tempStore();
  const started = store.startSession({ title: 'Android interview', role: 'Android Developer' });
  assert.equal(started.ok, true);
  assert.equal(started.data.activeSessionId, started.session.id);
  const first = store.recordQuestion({ text: 'Tell me about yourself?' });
  const duplicate = store.recordQuestion({ text: 'Tell me about yourself!' });
  assert.equal(first.recorded, true);
  assert.equal(duplicate.recorded, false);
  assert.equal(duplicate.reason, 'duplicate');
  assert.equal(duplicate.data.sessions[0].questions.length, 1);
});

test('attaches a grounded suggestion to the matching recorded question', () => {
  const { store } = tempStore();
  store.startSession({ title: 'Technical interview' });
  store.recordQuestion({ text: 'How do you structure an Android application?' });
  const updated = store.recordSuggestion('How do you structure an Android application?', {
    source: 'library',
    firstSentence: 'I normally separate UI, domain and data responsibilities.',
    answer: 'I use a clear layered architecture.',
    basis: ['Confirmed Work Time Calculator project']
  });
  assert.equal(updated.recorded, true);
  const question = updated.data.sessions[0].questions[0];
  assert.equal(question.suggestion.source, 'library');
  assert.equal(question.suggestion.basis[0], 'Confirmed Work Time Calculator project');
});

test('keeps only one active session and completes the previous session', () => {
  const { store } = tempStore();
  const first = store.startSession({ title: 'First' });
  const second = store.startSession({ title: 'Second' });
  const firstStored = second.data.sessions.find(session => session.id === first.session.id);
  assert.equal(firstStored.status, 'completed');
  assert.equal(second.data.activeSessionId, second.session.id);
});

test('summarizes completed post-session review data', () => {
  const data = sanitizeLiveInterviewData({
    sessions: [{
      id: 's1', title: 'Interview', status: 'completed', startedAt: '2026-01-01', completedAt: '2026-01-02',
      questions: [
        { text: 'Q1?', rating: 4, needsPractice: false, suggestion: { source: 'ai', answer: 'A1' } },
        { text: 'Q2?', rating: 2, needsPractice: true }
      ]
    }]
  });
  const summary = summarizeLiveInterviews(data);
  assert.equal(summary.totalSessions, 1);
  assert.equal(summary.totalQuestions, 2);
  assert.equal(summary.analyzedQuestions, 1);
  assert.equal(summary.needsPracticeCount, 1);
  assert.equal(summary.averageRating, 3);
});

test('Markdown report contains session notes and reviewed question details', () => {
  const report = buildMarkdownReport({ sessions: [{
    title: 'Recruiter call', status: 'completed', startedAt: '2026-01-01', completedAt: '2026-01-02', notes: 'Follow up tomorrow.',
    questions: [{ text: 'Why this role?', answered: true, rating: 5, confidence: 4, notes: 'Good answer.', suggestion: { source: 'library', firstSentence: 'This role fits my Android focus.', answer: 'Full answer', basis: ['Confirmed fact'] } }]
  }] });
  assert.match(report, /Recruiter call/);
  assert.match(report, /Follow up tomorrow/);
  assert.match(report, /Why this role/);
  assert.match(report, /Confirmed fact/);
});

test('preserves coding solution details in the local post-session report', () => {
  const data = sanitizeLiveInterviewData({
    sessions: [{
      title: 'Coding interview', status: 'completed', startedAt: '2026-07-25T10:00:00Z', completedAt: '2026-07-25T10:20:00Z',
      questions: [{
        text: 'Write a Java method that finds duplicates.',
        suggestion: {
          source: 'ai', responseType: 'coding_solution', firstSentence: 'I will start with a simple baseline.',
          answer: 'I will compare the values and collect duplicates.', approachSummary: 'Use nested loops.',
          implementationPlan: ['Create main', 'Create the array', 'Compare pairs'], codeLanguage: 'java',
          code: 'public class Main {}', codeWalkthrough: ['Line 1: declares the class.'],
          complexity: 'Time O(n^2), space O(1).', edgeCases: ['Empty array'], speakingNotes: ['First, I create main.']
        }
      }]
    }]
  });
  const report = buildMarkdownReport(data);
  assert.match(report, /Code \(java\)/);
  assert.match(report, /public class Main/);
  assert.match(report, /Line-by-line explanation/);
  assert.match(report, /O\(n\^2\)/);
});
