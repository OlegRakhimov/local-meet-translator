const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const SCHEMA_VERSION = 1;
const MAX_SESSIONS = 300;
const MAX_QUESTIONS_PER_SESSION = 300;

function cleanText(value, maxLength = 20_000) {
  return String(value ?? '')
    .replace(/\u0000/g, '')
    .replace(/\r\n?/g, '\n')
    .trim()
    .slice(0, maxLength);
}

function createId(prefix = 'live') {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `${prefix}-${crypto.randomBytes(12).toString('hex')}`;
}

function clampScore(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return 0;
  return Math.max(1, Math.min(5, Math.round(number)));
}

function normalizeQuestion(value) {
  return cleanText(value, 4000)
    .toLowerCase()
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[^\p{L}\p{N}']+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function sanitizeSuggestion(input = {}) {
  const source = input && typeof input === 'object' ? input : {};
  const list = (value, maxItems, maxLength) => (Array.isArray(value) ? value : [])
    .map(item => cleanText(item, maxLength))
    .filter(Boolean)
    .slice(0, maxItems);
  return {
    source: source.source === 'library' ? 'library' : source.source === 'ai' ? 'ai' : '',
    sourceEntryId: cleanText(source.sourceEntryId, 128),
    responseType: source.responseType === 'coding_solution' ? 'coding_solution' : 'interview_answer',
    firstSentence: cleanText(source.firstSentence, 3000),
    answer: cleanText(source.answer, 20_000),
    keyPoints: list(source.keyPoints, 12, 1200),
    keywords: list(source.keywords, 16, 400),
    basis: list(source.basis, 16, 1800),
    confidence: ['high', 'medium', 'low'].includes(source.confidence) ? source.confidence : '',
    experienceGap: source.experienceGap === true,
    safeFallback: cleanText(source.safeFallback, 5000),
    approachSummary: cleanText(source.approachSummary, 5000),
    implementationPlan: list(source.implementationPlan, 12, 1500),
    codeLanguage: cleanText(source.codeLanguage, 80),
    code: cleanText(source.code, 30_000),
    codeWalkthrough: list(source.codeWalkthrough, 120, 1500),
    complexity: cleanText(source.complexity, 3000),
    edgeCases: list(source.edgeCases, 16, 1200),
    speakingNotes: list(source.speakingNotes, 20, 1200),
    analyzedAt: cleanText(source.analyzedAt, 64)
  };
}

function sanitizeQuestion(input = {}, index = 0) {
  const source = input && typeof input === 'object' ? input : {};
  const text = cleanText(source.text || source.question, 4000);
  const suggestion = sanitizeSuggestion(source.suggestion || {});
  return {
    id: cleanText(source.id, 128) || createId('question'),
    text,
    normalized: cleanText(source.normalized, 4000) || normalizeQuestion(text),
    detectedAt: cleanText(source.detectedAt, 64) || new Date().toISOString(),
    suggestion: suggestion.source || suggestion.answer || suggestion.firstSentence ? suggestion : null,
    notes: cleanText(source.notes, 8000),
    rating: clampScore(source.rating),
    confidence: clampScore(source.confidence),
    needsPractice: source.needsPractice === true,
    answered: source.answered === true,
    order: Number.isFinite(Number(source.order)) ? Number(source.order) : index
  };
}

function sanitizeSession(input = {}, index = 0) {
  const source = input && typeof input === 'object' ? input : {};
  const status = source.status === 'active' ? 'active' : 'completed';
  const questions = (Array.isArray(source.questions) ? source.questions : [])
    .slice(0, MAX_QUESTIONS_PER_SESSION)
    .map((question, questionIndex) => sanitizeQuestion(question, questionIndex))
    .filter(question => question.text);
  return {
    id: cleanText(source.id, 128) || createId('session'),
    title: cleanText(source.title, 240) || `Interview session ${index + 1}`,
    role: cleanText(source.role, 240),
    company: cleanText(source.company, 240),
    status,
    startedAt: cleanText(source.startedAt, 64) || new Date().toISOString(),
    completedAt: status === 'completed' ? cleanText(source.completedAt, 64) : '',
    notes: cleanText(source.notes, 12_000),
    questions,
    order: Number.isFinite(Number(source.order)) ? Number(source.order) : index
  };
}

function defaultLiveInterviewData() {
  return { schemaVersion: SCHEMA_VERSION, activeSessionId: '', sessions: [], updatedAt: '' };
}

function sanitizeLiveInterviewData(input = {}) {
  const source = input && typeof input === 'object' ? input : {};
  const sessions = (Array.isArray(source.sessions) ? source.sessions : [])
    .slice(0, MAX_SESSIONS)
    .map((session, index) => sanitizeSession(session, index));
  sessions.sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)));
  const requestedActiveId = cleanText(source.activeSessionId, 128);
  const active = sessions.find(session => session.id === requestedActiveId && session.status === 'active')
    || sessions.find(session => session.status === 'active')
    || null;
  for (const session of sessions) {
    if (active && session.id !== active.id && session.status === 'active') {
      session.status = 'completed';
      session.completedAt = session.completedAt || new Date().toISOString();
    }
  }
  return {
    schemaVersion: SCHEMA_VERSION,
    activeSessionId: active ? active.id : '',
    sessions,
    updatedAt: cleanText(source.updatedAt, 64) || new Date().toISOString()
  };
}

function summarizeLiveInterviews(input = {}) {
  const data = sanitizeLiveInterviewData(input);
  const completed = data.sessions.filter(session => session.status === 'completed');
  const questions = completed.flatMap(session => session.questions);
  const analyzed = questions.filter(question => question.suggestion);
  const needsPractice = questions.filter(question => question.needsPractice);
  const rated = questions.filter(question => question.rating > 0);
  const averageRating = rated.length
    ? Number((rated.reduce((sum, question) => sum + question.rating, 0) / rated.length).toFixed(2))
    : 0;
  return {
    totalSessions: completed.length,
    totalQuestions: questions.length,
    analyzedQuestions: analyzed.length,
    needsPracticeCount: needsPractice.length,
    averageRating,
    activeSessionId: data.activeSessionId
  };
}

function writeJsonAtomic(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporaryPath, filePath);
}

function readJsonSafe(filePath) {
  if (!fs.existsSync(filePath)) return { data: defaultLiveInterviewData(), recovered: false, warning: '' };
  try {
    return { data: sanitizeLiveInterviewData(JSON.parse(fs.readFileSync(filePath, 'utf8'))), recovered: false, warning: '' };
  } catch (error) {
    const corruptPath = `${filePath}.corrupt-${Date.now()}`;
    try { fs.renameSync(filePath, corruptPath); } catch (_) {}
    return {
      data: defaultLiveInterviewData(),
      recovered: true,
      warning: `Live interview history was unreadable and was moved to ${corruptPath}: ${error.message}`
    };
  }
}

function buildMarkdownReport(input = {}) {
  const data = sanitizeLiveInterviewData(input);
  const summary = summarizeLiveInterviews(data);
  const lines = [
    '# Local Meet Translator — Post-session Interview Review',
    '',
    `Generated: ${new Date().toISOString()}`,
    '',
    '## Summary',
    '',
    `- Completed sessions: ${summary.totalSessions}`,
    `- Detected questions: ${summary.totalQuestions}`,
    `- Questions with suggestions: ${summary.analyzedQuestions}`,
    `- Marked for more practice: ${summary.needsPracticeCount}`,
    `- Average self-rating: ${summary.averageRating || '—'} / 5`,
    ''
  ];
  for (const session of data.sessions.filter(item => item.status === 'completed')) {
    lines.push(`## ${session.title}`, '');
    if (session.role) lines.push(`Role: ${session.role}`);
    if (session.company) lines.push(`Company: ${session.company}`);
    lines.push(`Started: ${session.startedAt}`, `Completed: ${session.completedAt || '—'}`, '');
    if (session.notes) lines.push('**Session notes**', '', session.notes, '');
    session.questions.forEach((question, index) => {
      lines.push(`### ${index + 1}. ${question.text}`, '');
      if (question.suggestion) {
        lines.push(`Suggestion source: ${question.suggestion.source || '—'}`);
        if (question.suggestion.firstSentence) lines.push('', '**First sentence**', '', question.suggestion.firstSentence, '');
        if (question.suggestion.answer) lines.push('**Suggested answer**', '', question.suggestion.answer, '');
        if (question.suggestion.responseType === 'coding_solution') {
          if (question.suggestion.approachSummary) lines.push('**Approach**', '', question.suggestion.approachSummary, '');
          if (question.suggestion.implementationPlan.length) lines.push('**Implementation plan**', '', ...question.suggestion.implementationPlan.map(item => `- ${item}`), '');
          if (question.suggestion.code) lines.push(`**Code (${question.suggestion.codeLanguage || 'text'})**`, '', '```' + (question.suggestion.codeLanguage || ''), question.suggestion.code, '```', '');
          if (question.suggestion.codeWalkthrough.length) lines.push('**Line-by-line explanation**', '', ...question.suggestion.codeWalkthrough.map(item => `- ${item}`), '');
          if (question.suggestion.complexity) lines.push('**Complexity**', '', question.suggestion.complexity, '');
          if (question.suggestion.edgeCases.length) lines.push('**Edge cases**', '', ...question.suggestion.edgeCases.map(item => `- ${item}`), '');
        }
        if (question.suggestion.basis.length) lines.push('**Grounding basis**', '', ...question.suggestion.basis.map(item => `- ${item}`), '');
      }
      lines.push(`Answered: ${question.answered ? 'Yes' : 'No'}`, `Self-rating: ${question.rating || '—'} / 5`, `Confidence: ${question.confidence || '—'} / 5`, `Needs more practice: ${question.needsPractice ? 'Yes' : 'No'}`, '');
      if (question.notes) lines.push('**Notes**', '', question.notes, '');
    });
  }
  return `${lines.join('\n')}\n`;
}

function createLiveInterviewStore({ historyPath, clock = () => new Date().toISOString(), idFactory = createId }) {
  if (!historyPath) throw new TypeError('historyPath is required.');

  function loadData() {
    return readJsonSafe(historyPath);
  }
  function saveData(input) {
    const data = sanitizeLiveInterviewData(input);
    data.updatedAt = clock();
    writeJsonAtomic(historyPath, data);
    return data;
  }
  function response(data, extras = {}) {
    return { ok: true, path: historyPath, data, summary: summarizeLiveInterviews(data), ...extras };
  }
  function load() {
    const result = loadData();
    return response(result.data, { recovered: result.recovered, warning: result.warning });
  }
  function startSession(details = {}) {
    const current = loadData().data;
    const now = clock();
    for (const session of current.sessions) {
      if (session.status === 'active') {
        session.status = 'completed';
        session.completedAt = session.completedAt || now;
      }
    }
    const session = sanitizeSession({
      id: idFactory('session'),
      title: details.title,
      role: details.role,
      company: details.company,
      status: 'active',
      startedAt: now,
      notes: details.notes,
      questions: []
    }, 0);
    current.sessions.unshift(session);
    current.activeSessionId = session.id;
    const data = saveData(current);
    return response(data, { session });
  }
  function endSession(sessionId = '') {
    const current = loadData().data;
    const targetId = cleanText(sessionId, 128) || current.activeSessionId;
    const session = current.sessions.find(item => item.id === targetId);
    if (!session) return { ok: false, message: 'Active interview session was not found.', path: historyPath, data: current, summary: summarizeLiveInterviews(current) };
    session.status = 'completed';
    session.completedAt = session.completedAt || clock();
    if (current.activeSessionId === session.id) current.activeSessionId = '';
    const data = saveData(current);
    return response(data, { session });
  }
  function recordQuestion(questionInput = {}) {
    const current = loadData().data;
    const session = current.sessions.find(item => item.id === current.activeSessionId && item.status === 'active');
    if (!session) return response(current, { recorded: false, reason: 'no-active-session' });
    const question = sanitizeQuestion({
      id: questionInput.id || idFactory('question'),
      text: questionInput.text,
      normalized: questionInput.normalized,
      detectedAt: typeof questionInput.detectedAt === 'number' ? new Date(questionInput.detectedAt).toISOString() : questionInput.detectedAt || clock(),
      order: session.questions.length
    }, session.questions.length);
    if (!question.text) return response(current, { recorded: false, reason: 'empty-question' });
    const existing = session.questions.find(item => item.normalized && item.normalized === question.normalized);
    if (existing) return response(current, { recorded: false, reason: 'duplicate', question: existing });
    session.questions.push(question);
    const data = saveData(current);
    return response(data, { recorded: true, question });
  }
  function recordSuggestion(questionText, suggestionInput = {}) {
    const current = loadData().data;
    const session = current.sessions.find(item => item.id === current.activeSessionId && item.status === 'active');
    if (!session) return response(current, { recorded: false, reason: 'no-active-session' });
    const normalized = normalizeQuestion(questionText);
    const question = [...session.questions].reverse().find(item => item.normalized === normalized)
      || [...session.questions].reverse().find(item => normalized && (item.normalized.includes(normalized) || normalized.includes(item.normalized)));
    if (!question) return response(current, { recorded: false, reason: 'question-not-found' });
    question.suggestion = sanitizeSuggestion({ ...suggestionInput, analyzedAt: clock() });
    const data = saveData(current);
    return response(data, { recorded: true, question });
  }
  function updateSession(sessionInput = {}) {
    const current = loadData().data;
    const sanitized = sanitizeSession(sessionInput, 0);
    const index = current.sessions.findIndex(item => item.id === sanitized.id);
    if (index < 0) return { ok: false, message: 'Interview session was not found.', path: historyPath, data: current, summary: summarizeLiveInterviews(current) };
    current.sessions[index] = sanitized;
    current.activeSessionId = sanitized.status === 'active' ? sanitized.id : (current.activeSessionId === sanitized.id ? '' : current.activeSessionId);
    const data = saveData(current);
    return response(data, { session: sanitized });
  }
  function reset() {
    const data = defaultLiveInterviewData();
    writeJsonAtomic(historyPath, data);
    return response(data);
  }
  function exportJson(filePath, input) {
    const data = sanitizeLiveInterviewData(input);
    writeJsonAtomic(filePath, data);
    return { ok: true, filePath, data };
  }
  function exportMarkdown(filePath, input) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, buildMarkdownReport(input), 'utf8');
    return { ok: true, filePath };
  }

  return { load, startSession, endSession, recordQuestion, recordSuggestion, updateSession, reset, exportJson, exportMarkdown, historyPath };
}

module.exports = {
  SCHEMA_VERSION,
  cleanText,
  normalizeQuestion,
  sanitizeSuggestion,
  sanitizeQuestion,
  sanitizeSession,
  defaultLiveInterviewData,
  sanitizeLiveInterviewData,
  summarizeLiveInterviews,
  buildMarkdownReport,
  createLiveInterviewStore
};
