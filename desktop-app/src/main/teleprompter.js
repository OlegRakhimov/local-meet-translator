const CHUNK_WORD_LIMITS = Object.freeze({ short: 16, medium: 28, long: 42 });
const CHUNK_MODES = new Set(Object.keys(CHUNK_WORD_LIMITS));

function cleanText(value, maxLength = 20_000) {
  return String(value ?? '')
    .replace(/\u0000/g, '')
    .replace(/\r\n?/g, '\n')
    .replace(/[\t ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .trim()
    .slice(0, maxLength);
}

function wordCount(value) {
  const text = cleanText(value);
  return text ? text.split(/\s+/).filter(Boolean).length : 0;
}

function splitByWords(text, maxWords) {
  const words = cleanText(text).split(/\s+/).filter(Boolean);
  const chunks = [];
  for (let index = 0; index < words.length; index += maxWords) {
    chunks.push(words.slice(index, index + maxWords).join(' '));
  }
  return chunks;
}

function splitLongSentence(sentence, maxWords) {
  const text = cleanText(sentence);
  if (!text) return [];
  if (wordCount(text) <= maxWords) return [text];

  const clauses = text
    .split(/(?<=[,;:!?—–-])\s+/u)
    .map(value => cleanText(value))
    .filter(Boolean);

  if (clauses.length <= 1) return splitByWords(text, maxWords);

  const chunks = [];
  let current = '';
  for (const clause of clauses) {
    if (wordCount(clause) > maxWords) {
      if (current) { chunks.push(current); current = ''; }
      chunks.push(...splitByWords(clause, maxWords));
      continue;
    }
    const candidate = current ? `${current} ${clause}` : clause;
    if (current && wordCount(candidate) > maxWords) {
      chunks.push(current);
      current = clause;
    } else {
      current = candidate;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

function splitAnswerIntoChunks(answer, options = {}) {
  const mode = CHUNK_MODES.has(options.mode) ? options.mode : 'medium';
  const maxWords = Number.isFinite(Number(options.maxWords))
    ? Math.max(8, Math.min(80, Number(options.maxWords)))
    : CHUNK_WORD_LIMITS[mode];
  const text = cleanText(answer, 24_000);
  if (!text) return [];

  const sentences = text
    .split(/(?<=[.!?])\s+(?=[A-ZА-ЯЁ0-9"“‘(])/u)
    .map(value => cleanText(value))
    .filter(Boolean);

  const source = sentences.length ? sentences : [text];
  const pieces = source.flatMap(sentence => splitLongSentence(sentence, maxWords));
  const chunks = [];
  let current = '';

  for (const piece of pieces) {
    const candidate = current ? `${current} ${piece}` : piece;
    if (current && wordCount(candidate) > maxWords) {
      chunks.push(current);
      current = piece;
    } else {
      current = candidate;
    }
  }
  if (current) chunks.push(current);
  return chunks.filter(Boolean).slice(0, 80);
}

function uniqueList(values, maxItems = 10, maxLength = 400) {
  const output = [];
  const seen = new Set();
  for (const raw of Array.isArray(values) ? values : []) {
    const value = cleanText(raw, maxLength);
    const key = value.toLocaleLowerCase('en-US');
    if (!value || seen.has(key)) continue;
    seen.add(key);
    output.push(value);
    if (output.length >= maxItems) break;
  }
  return output;
}

function buildTeleprompterDocument(suggestion = {}, options = {}) {
  const responseType = suggestion.responseType === 'coding_solution' ? 'coding_solution' : 'interview_answer';
  const speakingNotes = uniqueList(suggestion.speakingNotes, 16, 1000);
  const answer = responseType === 'coding_solution' && speakingNotes.length
    ? speakingNotes.join(' ')
    : cleanText(suggestion.answer, 24_000);
  const firstSentence = cleanText(suggestion.firstSentence, 3000);
  const chunks = splitAnswerIntoChunks(answer, { mode: options.chunkMode || 'medium' });
  const planSource = responseType === 'coding_solution' && Array.isArray(suggestion.implementationPlan)
    ? suggestion.implementationPlan
    : suggestion.keyPoints;
  return {
    responseType,
    question: cleanText(suggestion.question, 2400),
    firstSentence,
    chunks,
    plan: uniqueList(planSource, 10, 700),
    keywords: uniqueList(suggestion.keywords || suggestion.keyPoints, 12, 180),
    source: suggestion.source === 'library' ? 'library' : 'ai',
    confidence: ['high', 'medium', 'low'].includes(suggestion.confidence) ? suggestion.confidence : 'low',
    safeFallback: cleanText(suggestion.safeFallback, 5000)
  };
}

function normalizeTeleprompterSettings(input = {}) {
  const chunkMode = CHUNK_MODES.has(String(input.chunkMode || '').toLowerCase())
    ? String(input.chunkMode).toLowerCase()
    : 'medium';
  return {
    enabled: input.enabled !== false,
    frozen: input.frozen === true,
    chunkMode,
    showKeywords: input.showKeywords !== false,
    showPlan: input.showPlan !== false,
    autoStart: input.autoStart !== false
  };
}

function cloneEntry(entry) {
  if (!entry) return null;
  return {
    question: entry.question ? { ...entry.question } : null,
    suggestion: entry.suggestion ? { ...entry.suggestion } : null,
    document: entry.document ? {
      ...entry.document,
      chunks: [...entry.document.chunks],
      plan: [...entry.document.plan],
      keywords: [...entry.document.keywords]
    } : null,
    activeChunkIndex: entry.activeChunkIndex || 0,
    loadedAt: entry.loadedAt || 0
  };
}

function createTeleprompterState(initialSettings = {}) {
  let settings = normalizeTeleprompterSettings(initialSettings);
  let current = null;
  let pending = null;
  let pendingQuestion = null;
  let pendingAnalyzing = false;
  let answerLocked = false;

  function snapshot() {
    return {
      settings: { ...settings },
      frozen: !!settings.frozen,
      answerLocked,
      current: cloneEntry(current),
      pending: cloneEntry(pending),
      pendingQuestion: pendingQuestion ? { ...pendingQuestion } : null,
      pendingAnalyzing,
      hasPending: !!(pending || pendingQuestion),
      activeChunk: current?.document?.chunks?.[current.activeChunkIndex] || '',
      activeChunkIndex: current?.activeChunkIndex || 0,
      chunkCount: current?.document?.chunks?.length || 0
    };
  }

  function updateSettings(next = {}) {
    settings = normalizeTeleprompterSettings({ ...settings, ...next });
    if (current?.suggestion) {
      current.document = buildTeleprompterDocument(current.suggestion, settings);
      current.activeChunkIndex = Math.min(current.activeChunkIndex, Math.max(0, current.document.chunks.length - 1));
    }
    if (pending?.suggestion) pending.document = buildTeleprompterDocument(pending.suggestion, settings);
    return snapshot();
  }

  function setFrozen(value) {
    settings = { ...settings, frozen: !!value };
    return { loadedPending: false, ...snapshot() };
  }

  function noteQuestion(question) {
    const value = question ? { ...question, text: cleanText(question.text, 2000) } : null;
    if (!value) return snapshot();
    const currentQuestion = cleanText(current?.question?.text, 2000).toLowerCase();
    if (currentQuestion && currentQuestion === value.text.toLowerCase()) return snapshot();
    if ((answerLocked || settings.frozen) && current) {
      pendingQuestion = value;
    } else {
      pending = null;
      pendingQuestion = null;
      pendingAnalyzing = false;
    }
    return snapshot();
  }

  function setPendingAnalyzing(value) {
    pendingAnalyzing = !!value;
    return snapshot();
  }

  function loadSuggestion(suggestion, question = null) {
    const value = suggestion && typeof suggestion === 'object' ? { ...suggestion } : null;
    if (!value) return { disposition: 'ignored', ...snapshot() };
    const questionText = cleanText(value.question || question?.text, 2000);
    const document = buildTeleprompterDocument({ ...value, question: questionText }, settings);
    const currentQuestion = cleanText(current?.question?.text, 2000).toLowerCase();
    const newQuestion = questionText.toLowerCase();
    const preserveIndex = !settings.autoStart && current && currentQuestion === newQuestion;
    const entry = {
      question: question ? { ...question, text: questionText } : { text: questionText },
      suggestion: { ...value, question: questionText },
      document,
      activeChunkIndex: preserveIndex
        ? Math.min(current.activeChunkIndex || 0, Math.max(0, document.chunks.length - 1))
        : 0,
      loadedAt: Date.now()
    };
    if ((answerLocked || settings.frozen) && current && currentQuestion && newQuestion && currentQuestion !== newQuestion) {
      pending = entry;
      pendingQuestion = entry.question;
      pendingAnalyzing = false;
      return { disposition: 'pending', ...snapshot() };
    }
    current = entry;
    answerLocked = true;
    pending = null;
    pendingQuestion = null;
    pendingAnalyzing = false;
    return { disposition: 'current', ...snapshot() };
  }

  function loadPending() {
    if (!pending) return { loaded: false, ...snapshot() };
    current = pending;
    answerLocked = true;
    pending = null;
    pendingQuestion = null;
    pendingAnalyzing = false;
    return { loaded: true, ...snapshot() };
  }

  function nextChunk() {
    if (!current?.document?.chunks?.length) return snapshot();
    current.activeChunkIndex = Math.min(current.document.chunks.length - 1, current.activeChunkIndex + 1);
    return snapshot();
  }

  function previousChunk() {
    if (!current?.document?.chunks?.length) return snapshot();
    current.activeChunkIndex = Math.max(0, current.activeChunkIndex - 1);
    return snapshot();
  }

  function firstChunk() {
    if (current) current.activeChunkIndex = 0;
    return snapshot();
  }

  function clear() {
    current = null;
    pending = null;
    pendingQuestion = null;
    pendingAnalyzing = false;
    answerLocked = false;
    return snapshot();
  }

  return {
    snapshot,
    updateSettings,
    setFrozen,
    noteQuestion,
    setPendingAnalyzing,
    loadSuggestion,
    loadPending,
    nextChunk,
    previousChunk,
    firstChunk,
    clear
  };
}

module.exports = {
  CHUNK_WORD_LIMITS,
  CHUNK_MODES,
  cleanText,
  wordCount,
  splitAnswerIntoChunks,
  buildTeleprompterDocument,
  normalizeTeleprompterSettings,
  createTeleprompterState
};
