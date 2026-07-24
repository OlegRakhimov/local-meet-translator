const DEFAULTS = Object.freeze({
  duplicateWindowMs: 18000,
  completionWindowMs: 9000,
  maxHistoryPerScope: 24,
  similarityThreshold: 0.86
});

function normalizeSubtitleText(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[\p{P}\p{S}]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokens(value) {
  return normalizeSubtitleText(value).split(/\s+/).filter(Boolean);
}

function jaccardSimilarity(a, b) {
  const left = new Set(tokens(a));
  const right = new Set(tokens(b));
  if (!left.size || !right.size) return 0;
  let common = 0;
  for (const item of left) if (right.has(item)) common += 1;
  const union = left.size + right.size - common;
  return union ? common / union : 0;
}

function cleanScopePart(value, fallback = '-') {
  const text = String(value ?? '').trim();
  return text || fallback;
}

function eventScope(event) {
  return [
    event && event.channel === 'outgoing' ? 'outgoing' : 'incoming',
    cleanScopePart(event && event.clientId),
    cleanScopePart(event && event.tabId)
  ].join('|');
}

function eventNorm(event) {
  const transcript = normalizeSubtitleText(event && event.transcript);
  const translation = normalizeSubtitleText(event && event.translation);
  return transcript || translation;
}

function isShorterRepeat(candidate, previous) {
  return !!candidate && !!previous && previous.includes(candidate) && candidate.length <= previous.length;
}

function isLongerCompletion(candidate, previous) {
  if (!candidate || !previous || candidate === previous) return false;
  if (!candidate.includes(previous)) return false;
  const previousWords = previous.split(/\s+/).filter(Boolean).length;
  const candidateWords = candidate.split(/\s+/).filter(Boolean).length;
  return candidateWords >= previousWords + 1 || candidate.length >= previous.length + 5;
}

function createSubtitleDedupeGuard(options = {}) {
  const settings = { ...DEFAULTS, ...(options || {}) };
  const historyByScope = new Map();

  function prune(scope, now) {
    const history = historyByScope.get(scope) || [];
    const cutoff = now - settings.duplicateWindowMs;
    const kept = history.filter(item => item.at >= cutoff);
    if (kept.length > settings.maxHistoryPerScope) {
      kept.splice(0, kept.length - settings.maxHistoryPerScope);
    }
    historyByScope.set(scope, kept);
    return kept;
  }

  function remember(scope, event, norm, now) {
    const history = prune(scope, now);
    history.push({
      id: String(event.id || ''),
      norm,
      transcript: normalizeSubtitleText(event.transcript),
      translation: normalizeSubtitleText(event.translation),
      at: now
    });
    if (history.length > settings.maxHistoryPerScope) {
      history.splice(0, history.length - settings.maxHistoryPerScope);
    }
  }

  function evaluate(event, now = Date.now()) {
    const scope = eventScope(event);
    const norm = eventNorm(event);
    if (!norm) return { accepted: false, reason: 'empty', scope };

    const history = prune(scope, now);
    for (let index = history.length - 1; index >= 0; index -= 1) {
      const previous = history[index];
      const age = now - previous.at;
      if (age > settings.duplicateWindowMs) continue;

      if (norm === previous.norm || isShorterRepeat(norm, previous.norm)) {
        return { accepted: false, reason: 'duplicate', scope, duplicateOf: previous.id };
      }

      if (age <= settings.completionWindowMs && isLongerCompletion(norm, previous.norm)) {
        history.splice(index, 1);
        remember(scope, event, norm, now);
        return {
          accepted: true,
          reason: 'completion',
          scope,
          replaceEventId: previous.id || ''
        };
      }

      const similarity = jaccardSimilarity(norm, previous.norm);
      const wordCount = norm.split(/\s+/).filter(Boolean).length;
      const previousWordCount = previous.norm.split(/\s+/).filter(Boolean).length;
      const sizeClose = Math.abs(wordCount - previousWordCount) <= Math.max(2, Math.ceil(previousWordCount * 0.3));
      if (sizeClose && similarity >= settings.similarityThreshold) {
        return { accepted: false, reason: 'near-duplicate', scope, duplicateOf: previous.id, similarity };
      }
    }

    remember(scope, event, norm, now);
    return { accepted: true, reason: 'new', scope, replaceEventId: '' };
  }

  function reset(scope = '') {
    if (scope) historyByScope.delete(scope);
    else historyByScope.clear();
  }

  function snapshot() {
    const result = {};
    for (const [scope, history] of historyByScope.entries()) {
      result[scope] = history.map(item => ({ ...item }));
    }
    return result;
  }

  return { evaluate, reset, snapshot };
}

module.exports = {
  DEFAULTS,
  normalizeSubtitleText,
  jaccardSimilarity,
  eventScope,
  eventNorm,
  isShorterRepeat,
  isLongerCompletion,
  createSubtitleDedupeGuard
};
