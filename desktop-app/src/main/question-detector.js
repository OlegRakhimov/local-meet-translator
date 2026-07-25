const MAX_QUESTION_LENGTH = 1600;
const DEFAULT_DEDUPE_WINDOW_MS = 45_000;

const QUESTION_OPENERS = [
  /^(what|why|how|when|where|who|whom|whose|which)\b/i,
  /^(can|could|would|will|do|does|did|are|is|was|were|have|has|had|should|may|might)\b/i,
  /^(tell me|describe|explain|walk me through|give me an example|talk about)\b/i,
  /^(что|почему|как|когда|где|кто|какой|какая|какие|можете|можешь|расскажите|опишите|объясните)\b/i,
  /^(co|dlaczego|jak|kiedy|gdzie|kto|który|czy|możesz|proszę opowiedzieć|opisz|wyjaśnij)\b/i
];

function cleanQuestionText(value) {
  return String(value ?? '')
    .replace(/\u0000/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_QUESTION_LENGTH);
}

function normalizeQuestionText(value) {
  return cleanQuestionText(value)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function questionTokens(value) {
  return normalizeQuestionText(value).split(' ').filter(token => token.length > 1);
}

function tokenSimilarity(left, right) {
  const a = new Set(questionTokens(left));
  const b = new Set(questionTokens(right));
  if (!a.size || !b.size) return 0;
  let intersection = 0;
  for (const token of a) if (b.has(token)) intersection += 1;
  return intersection / Math.max(a.size, b.size);
}

function looksLikeQuestion(value) {
  const text = cleanQuestionText(value);
  if (text.length < 7) return false;
  const tokens = questionTokens(text);
  if (tokens.length < 2) return false;
  if (/\?\s*$/.test(text)) return true;
  return QUESTION_OPENERS.some(pattern => pattern.test(text));
}

function createQuestionDetector({ dedupeWindowMs = DEFAULT_DEDUPE_WINDOW_MS, maxHistory = 80 } = {}) {
  const history = [];

  function prune(now) {
    while (history.length && now - history[0].detectedAt > dedupeWindowMs) history.shift();
    if (history.length > maxHistory) history.splice(0, history.length - maxHistory);
  }

  function consume(subtitleEvent = {}, now = Date.now()) {
    if (subtitleEvent.channel === 'outgoing') return { accepted: false, reason: 'outgoing' };
    const text = cleanQuestionText(subtitleEvent.transcript || subtitleEvent.translation);
    if (!looksLikeQuestion(text)) return { accepted: false, reason: 'not-question' };
    const normalized = normalizeQuestionText(text);
    prune(now);
    const duplicate = history.find(item => item.normalized === normalized || tokenSimilarity(item.text, text) >= 0.92);
    if (duplicate) {
      return { accepted: false, reason: 'duplicate', duplicateOf: duplicate.id, question: duplicate };
    }
    const question = {
      id: `question-${now}-${Math.random().toString(16).slice(2)}`,
      text,
      normalized,
      detectedAt: now,
      eventId: cleanQuestionText(subtitleEvent.id).slice(0, 128),
      clientId: cleanQuestionText(subtitleEvent.clientId).slice(0, 256),
      tabId: cleanQuestionText(subtitleEvent.tabId).slice(0, 128),
      url: cleanQuestionText(subtitleEvent.url).slice(0, 2048)
    };
    history.push(question);
    prune(now);
    return { accepted: true, reason: 'question', question };
  }

  function snapshot() {
    return history.map(item => ({ ...item }));
  }

  function clear() {
    history.length = 0;
  }

  return { consume, snapshot, clear };
}

module.exports = {
  MAX_QUESTION_LENGTH,
  DEFAULT_DEDUPE_WINDOW_MS,
  cleanQuestionText,
  normalizeQuestionText,
  questionTokens,
  tokenSimilarity,
  looksLikeQuestion,
  createQuestionDetector
};
