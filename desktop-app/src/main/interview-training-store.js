const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const SCHEMA_VERSION = 1;
const MAX_SESSIONS = 200;
const MAX_ATTEMPTS_PER_SESSION = 200;

function cleanText(value, maxLength = 20_000) {
  return String(value ?? '')
    .replace(/\u0000/g, '')
    .replace(/\r\n?/g, '\n')
    .trim()
    .slice(0, maxLength);
}

function createId(prefix = 'training') {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `${prefix}-${crypto.randomBytes(12).toString('hex')}`;
}

function clampScore(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return 0;
  return Math.max(1, Math.min(5, Math.round(number)));
}

function sanitizeAttempt(input = {}, index = 0) {
  const source = input && typeof input === 'object' ? input : {};
  return {
    id: cleanText(source.id, 128) || createId('attempt'),
    answerEntryId: cleanText(source.answerEntryId, 128),
    question: cleanText(source.question, 4000),
    referenceAnswer: cleanText(source.referenceAnswer, 20_000),
    firstSentence: cleanText(source.firstSentence, 3000),
    practiceAnswer: cleanText(source.practiceAnswer, 20_000),
    notes: cleanText(source.notes, 8000),
    rating: clampScore(source.rating),
    confidence: clampScore(source.confidence),
    needsPractice: source.needsPractice === true,
    completedAt: cleanText(source.completedAt, 64),
    order: Number.isFinite(Number(source.order)) ? Number(source.order) : index
  };
}

function sanitizeSession(input = {}, index = 0) {
  const source = input && typeof input === 'object' ? input : {};
  const attempts = (Array.isArray(source.attempts) ? source.attempts : [])
    .slice(0, MAX_ATTEMPTS_PER_SESSION)
    .map((attempt, attemptIndex) => sanitizeAttempt(attempt, attemptIndex))
    .filter(attempt => attempt.question || attempt.practiceAnswer || attempt.referenceAnswer);
  const status = source.status === 'active' ? 'active' : 'completed';
  return {
    id: cleanText(source.id, 128) || createId('session'),
    title: cleanText(source.title, 240) || `Practice session ${index + 1}`,
    status,
    startedAt: cleanText(source.startedAt, 64) || new Date().toISOString(),
    completedAt: status === 'completed' ? cleanText(source.completedAt, 64) : '',
    selectedQuestionIds: (Array.isArray(source.selectedQuestionIds) ? source.selectedQuestionIds : [])
      .map(value => cleanText(value, 128))
      .filter(Boolean)
      .slice(0, MAX_ATTEMPTS_PER_SESSION),
    currentIndex: Math.max(0, Number.parseInt(source.currentIndex, 10) || 0),
    attempts,
    order: Number.isFinite(Number(source.order)) ? Number(source.order) : index
  };
}

function defaultTrainingData() {
  return { schemaVersion: SCHEMA_VERSION, sessions: [], updatedAt: '' };
}

function sanitizeTrainingData(input = {}) {
  const source = input && typeof input === 'object' ? input : {};
  const sessions = (Array.isArray(source.sessions) ? source.sessions : [])
    .slice(0, MAX_SESSIONS)
    .map((session, index) => sanitizeSession(session, index));
  sessions.sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)));
  return {
    schemaVersion: SCHEMA_VERSION,
    sessions,
    updatedAt: cleanText(source.updatedAt, 64) || new Date().toISOString()
  };
}

function summarizeTraining(input = {}) {
  const data = sanitizeTrainingData(input);
  const completedSessions = data.sessions.filter(session => session.status === 'completed');
  const attempts = completedSessions.flatMap(session => session.attempts);
  const rated = attempts.filter(attempt => attempt.rating > 0);
  const confidenceRated = attempts.filter(attempt => attempt.confidence > 0);
  const needsPractice = attempts.filter(attempt => attempt.needsPractice);
  const average = values => values.length
    ? Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(2))
    : 0;
  const difficultQuestions = [...needsPractice]
    .sort((a, b) => (a.rating || 6) - (b.rating || 6))
    .slice(0, 10)
    .map(attempt => ({ question: attempt.question, rating: attempt.rating, notes: attempt.notes }));
  return {
    totalSessions: completedSessions.length,
    totalAttempts: attempts.length,
    averageRating: average(rated.map(attempt => attempt.rating)),
    averageConfidence: average(confidenceRated.map(attempt => attempt.confidence)),
    needsPracticeCount: needsPractice.length,
    difficultQuestions
  };
}

function writeJsonAtomic(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporaryPath, filePath);
}

function readJsonSafe(filePath) {
  if (!fs.existsSync(filePath)) return { data: defaultTrainingData(), recovered: false, warning: '' };
  try {
    return { data: sanitizeTrainingData(JSON.parse(fs.readFileSync(filePath, 'utf8'))), recovered: false, warning: '' };
  } catch (error) {
    const corruptPath = `${filePath}.corrupt-${Date.now()}`;
    try { fs.renameSync(filePath, corruptPath); } catch (_) {}
    return {
      data: defaultTrainingData(),
      recovered: true,
      warning: `Interview training history was unreadable and was moved to ${corruptPath}: ${error.message}`
    };
  }
}

function buildMarkdownReport(input = {}) {
  const data = sanitizeTrainingData(input);
  const summary = summarizeTraining(data);
  const lines = [
    '# Local Meet Translator — Interview Training Report',
    '',
    `Generated: ${new Date().toISOString()}`,
    '',
    '## Summary',
    '',
    `- Completed sessions: ${summary.totalSessions}`,
    `- Practiced answers: ${summary.totalAttempts}`,
    `- Average answer rating: ${summary.averageRating || '—'} / 5`,
    `- Average confidence: ${summary.averageConfidence || '—'} / 5`,
    `- Marked for more practice: ${summary.needsPracticeCount}`,
    ''
  ];
  for (const session of data.sessions.filter(item => item.status === 'completed')) {
    lines.push(`## ${session.title}`, '', `Started: ${session.startedAt}`, `Completed: ${session.completedAt || '—'}`, '');
    session.attempts.forEach((attempt, index) => {
      lines.push(`### ${index + 1}. ${attempt.question || 'Untitled question'}`, '');
      if (attempt.practiceAnswer) lines.push('**Practice answer**', '', attempt.practiceAnswer, '');
      if (attempt.referenceAnswer) lines.push('**Reference answer**', '', attempt.referenceAnswer, '');
      lines.push(`Rating: ${attempt.rating || '—'} / 5`, `Confidence: ${attempt.confidence || '—'} / 5`, `Needs more practice: ${attempt.needsPractice ? 'Yes' : 'No'}`, '');
      if (attempt.notes) lines.push('**Notes**', '', attempt.notes, '');
    });
  }
  return `${lines.join('\n')}\n`;
}

function createInterviewTrainingStore({ trainingPath }) {
  if (!trainingPath) throw new TypeError('trainingPath is required.');
  function load() {
    const result = readJsonSafe(trainingPath);
    return { ok: true, path: trainingPath, ...result, summary: summarizeTraining(result.data) };
  }
  function save(input) {
    const data = sanitizeTrainingData(input);
    writeJsonAtomic(trainingPath, data);
    return { ok: true, path: trainingPath, data, summary: summarizeTraining(data) };
  }
  function reset() {
    const data = defaultTrainingData();
    writeJsonAtomic(trainingPath, data);
    return { ok: true, path: trainingPath, data, summary: summarizeTraining(data) };
  }
  function exportJson(filePath, input) {
    const data = sanitizeTrainingData(input);
    writeJsonAtomic(filePath, data);
    return { ok: true, filePath, data };
  }
  function exportMarkdown(filePath, input) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, buildMarkdownReport(input), 'utf8');
    return { ok: true, filePath };
  }
  return { load, save, reset, exportJson, exportMarkdown, trainingPath };
}

module.exports = {
  SCHEMA_VERSION,
  cleanText,
  sanitizeAttempt,
  sanitizeSession,
  defaultTrainingData,
  sanitizeTrainingData,
  summarizeTraining,
  buildMarkdownReport,
  createInterviewTrainingStore
};
