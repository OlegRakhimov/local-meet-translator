
'use strict';

function cleanText(value, maxLength = 2400) {
  return String(value ?? '')
    .replace(/\u0000/g, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .trim()
    .slice(0, maxLength);
}

function cleanList(values, maxItems, maxLength) {
  return (Array.isArray(values) ? values : [])
    .map(value => cleanText(value, maxLength))
    .filter(Boolean)
    .slice(0, maxItems);
}

function buildCurrentSolutionContext(suggestion = {}) {
  return {
    approachSummary: cleanText(suggestion.approachSummary, 3000),
    implementationPlan: cleanList(suggestion.implementationPlan, 8, 500),
    codeLanguage: cleanText(suggestion.codeLanguage, 80),
    code: cleanText(suggestion.code, 30000),
    codeWalkthrough: cleanList(suggestion.codeWalkthrough, 24, 500),
    complexity: cleanText(suggestion.complexity, 1500),
    edgeCases: cleanList(suggestion.edgeCases, 10, 500),
    speakingNotes: cleanList(suggestion.speakingNotes, 12, 400)
  };
}

function buildActiveInputContext(inputs = []) {
  return (Array.isArray(inputs) ? inputs : [])
    .slice(-20)
    .map(item => ({
      id: cleanText(item?.id, 160),
      type: cleanText(item?.type || item?.kind, 40),
      target: cleanText(item?.target, 40),
      operation: cleanText(item?.operation || item?.inputOperation, 40),
      normalizedInput: cleanText(item?.normalizedInput || item?.sourceText, 900),
      verificationCriteria: cleanList(item?.verificationCriteria, 4, 240)
    }))
    .filter(item => item.normalizedInput);
}

function buildRecentCodingContext(entries = [], latestUtterance = '') {
  const latest = cleanText(latestUtterance, 2400).toLocaleLowerCase('en-US');
  return (Array.isArray(entries) ? entries : [])
    .map(item => {
      const classification = item?.classification || {};
      const type = cleanText(classification.type || item?.kind, 40) || 'other';
      const text = cleanText(item?.text || item?.normalizedInput, 1000);
      if (!text || type === 'remark') return null;
      if (latest && text.toLocaleLowerCase('en-US') === latest) return null;
      return {
        id: cleanText(item?.id, 160),
        type,
        target: cleanText(classification.target, 40),
        action: cleanText(classification.action, 40),
        status: cleanText(item?.status, 40),
        text,
        normalizedInput: cleanText(classification.normalizedInput || item?.normalizedInput, 900),
        reason: cleanText(classification.reason || item?.reason, 500)
      };
    })
    .filter(Boolean)
    .slice(-6);
}

function buildCodingRequestParts({ focus = {}, currentSuggestion = {}, latestUtterance = '', proposedInputs = null } = {}) {
  const activeInputs = proposedInputs == null ? focus.activeInputs : proposedInputs;
  return {
    currentTask: cleanText(focus?.task?.text, 2400),
    currentSolution: buildCurrentSolutionContext(currentSuggestion),
    activeInputs: buildActiveInputContext(activeInputs),
    latestUtterance: cleanText(latestUtterance, 2400),
    recentContext: buildRecentCodingContext(focus.liveContext, latestUtterance)
  };
}

module.exports = {
  cleanText,
  buildCurrentSolutionContext,
  buildActiveInputContext,
  buildRecentCodingContext,
  buildCodingRequestParts
};
