const { normalizeQuestionText, questionTokens } = require('./question-detector');

const STOP_WORDS = new Set([
  'a','an','the','and','or','to','of','in','on','for','with','about','me','you','your','my','is','are','was','were',
  'do','does','did','can','could','would','will','please','tell','describe','explain','give','example'
]);

function meaningfulTokens(value) {
  return questionTokens(value).filter(token => !STOP_WORDS.has(token));
}

function overlapScore(queryTokens, candidateTokens) {
  const query = new Set(queryTokens);
  const candidate = new Set(candidateTokens);
  if (!query.size || !candidate.size) return 0;
  let overlap = 0;
  for (const token of query) if (candidate.has(token)) overlap += 1;
  const recall = overlap / query.size;
  const precision = overlap / candidate.size;
  return (recall * 0.7) + (precision * 0.3);
}

function scoreAnswerEntry(question, entry = {}) {
  const normalizedQuestion = normalizeQuestionText(question);
  const normalizedSaved = normalizeQuestionText(entry.question || '');
  if (!normalizedQuestion || !normalizedSaved || !entry.answer) return 0;
  if (normalizedQuestion === normalizedSaved) return 1;

  const queryTokens = meaningfulTokens(normalizedQuestion);
  const savedTokens = meaningfulTokens(normalizedSaved);
  const keywordTokens = meaningfulTokens(Array.isArray(entry.keywords) ? entry.keywords.join(' ') : entry.keywords || '');
  const intentTokens = meaningfulTokens(entry.intent || '');
  let score = overlapScore(queryTokens, savedTokens) * 0.68;
  score += overlapScore(queryTokens, keywordTokens) * 0.22;
  score += overlapScore(queryTokens, intentTokens) * 0.1;

  if (normalizedQuestion.includes(normalizedSaved) || normalizedSaved.includes(normalizedQuestion)) score += 0.12;
  if (entry.locked === true) score += 0.03;
  return Math.max(0, Math.min(1, score));
}

function entryToSuggestion(entry, score) {
  const keywords = Array.isArray(entry.keywords) ? entry.keywords.filter(Boolean).slice(0, 6) : [];
  const facts = Array.isArray(entry.groundingFacts) ? entry.groundingFacts.filter(Boolean).slice(0, 10) : [];
  return {
    source: 'library',
    sourceEntryId: String(entry.id || ''),
    responseType: 'interview_answer',
    question: String(entry.question || ''),
    firstSentence: String(entry.firstSentence || '').trim() || String(entry.answer || '').split(/(?<=[.!?])\s+/)[0] || '',
    answer: String(entry.answer || ''),
    keyPoints: keywords,
    basis: facts,
    confidence: score >= 0.82 ? 'high' : 'medium',
    experienceGap: false,
    safeFallback: '',
    score
  };
}

function matchAnswerLibrary(question, entries = [], { threshold = 0.52 } = {}) {
  const ranked = (Array.isArray(entries) ? entries : [])
    .map(entry => ({ entry, score: scoreAnswerEntry(question, entry) }))
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score);
  const best = ranked[0] || null;
  return {
    matched: !!best && best.score >= threshold,
    score: best ? best.score : 0,
    entry: best ? best.entry : null,
    suggestion: best && best.score >= threshold ? entryToSuggestion(best.entry, best.score) : null,
    candidates: ranked.slice(0, 5)
  };
}

module.exports = {
  STOP_WORDS,
  meaningfulTokens,
  overlapScore,
  scoreAnswerEntry,
  entryToSuggestion,
  matchAnswerLibrary
};
