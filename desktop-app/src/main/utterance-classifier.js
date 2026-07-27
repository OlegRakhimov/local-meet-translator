'use strict';

const CLASSIFICATION_TYPES = new Set([
  'remark',
  'follow-up',
  'recommendation',
  'request',
  'constraint',
  'correction',
  'new-input',
  'new-task',
  'ambiguous'
]);
const ACTIONS = new Set([
  'ignore',
  'answer-separately',
  'offer-change',
  'apply-change',
  'revise-inputs',
  'queue-new-task',
  'ask-confirmation'
]);
const INPUT_OPERATIONS = new Set(['none', 'add', 'replace', 'remove']);
const CONFIDENCE_LEVELS = new Set(['high', 'medium', 'low']);
const TARGETS = new Set([
  'algorithm', 'data-structure', 'complexity', 'memory', 'input', 'output',
  'edge-case', 'language', 'api', 'implementation', 'explanation', 'other'
]);

function cleanText(value, maxLength = 4000) {
  return String(value ?? '')
    .replace(/\u0000/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

function list(value, maxItems = 8, maxLength = 1000) {
  return (Array.isArray(value) ? value : [])
    .map(item => cleanText(item, maxLength))
    .filter(Boolean)
    .slice(0, maxItems);
}

function normalizeClassification(input = {}, fallback = {}) {
  const source = input && typeof input === 'object' ? input : {};
  const fallbackType = CLASSIFICATION_TYPES.has(fallback.type) ? fallback.type : 'ambiguous';
  const type = CLASSIFICATION_TYPES.has(source.type) ? source.type : fallbackType;
  const defaultAction = {
    remark: 'ignore',
    'follow-up': 'answer-separately',
    recommendation: 'offer-change',
    request: 'apply-change',
    constraint: 'apply-change',
    correction: 'revise-inputs',
    'new-input': 'apply-change',
    'new-task': 'queue-new-task',
    ambiguous: 'ask-confirmation'
  }[type];
  const action = ACTIONS.has(source.action) ? source.action : defaultAction;
  const inputOperationDefault = ['request', 'constraint', 'new-input'].includes(type)
    ? 'add'
    : type === 'correction' ? 'replace' : 'none';
  const inputOperation = INPUT_OPERATIONS.has(source.inputOperation)
    ? source.inputOperation
    : inputOperationDefault;
  const target = TARGETS.has(source.target) ? source.target : 'other';
  const confidence = CONFIDENCE_LEVELS.has(source.confidence) ? source.confidence : 'medium';
  const normalizedInput = cleanText(source.normalizedInput || fallback.normalizedInput, 2400);
  const combinedUtterance = cleanText(source.combinedUtterance || fallback.combinedUtterance, 4000);
  const changesCurrentSolution = typeof source.changesCurrentSolution === 'boolean'
    ? source.changesCurrentSolution
    : ['recommendation', 'request', 'constraint', 'correction', 'new-input'].includes(type);
  return {
    type,
    target,
    action,
    normalizedInput,
    changesCurrentSolution,
    confidence,
    reason: cleanText(source.reason || fallback.reason, 1200),
    inputOperation,
    affectedInputIds: list(source.affectedInputIds, 8, 160),
    mergeWithPrevious: source.mergeWithPrevious === true,
    combinedUtterance,
    verificationCriteria: list(source.verificationCriteria, 8, 1000),
    source: source.source === 'fallback' ? 'fallback' : 'ai'
  };
}

const NEW_TASK = /^(now|next|another|new task|let(?:'s| us) move|moving on|теперь|следующая|другая задача|перейд[её]м|następnie|kolejne|nowe zadanie)\b/i;
const CORRECTION = /^(no[, ]|actually\b|instead\b|rather than\b|forget (?:the )?previous|scratch that|change that|not .* anymore|нет[, ]|на самом деле|вместо|забудьте|исправьте|nie[, ]|właściwie|zamiast)/i;
const HARD_CONSTRAINT = /\b(must|have to|need to|required|cannot|can't|do not|don't|not allowed|without any|at most|at least|exactly|обязательно|должен|нельзя|не используйте|без дополнитель|не более|не менее|musi|trzeba|nie wolno|bez dodatk)\b/i;
const RECOMMENDATION = /\b(maybe|perhaps|consider|you could try|you might|i suggest|i recommend|would be better|why not|возможно|может быть|стоит рассмотреть|я бы предложил|лучше было бы|może|warto rozważyć|sugeruję)\b/i;
const REQUEST = /^(please\b|can you\b|could you\b|would you\b|will you\b|try to\b|use\b|rewrite\b|change\b|implement\b|return\b|make it\b|пожалуйста|можете|могли бы|используйте|перепишите|измените|реализуйте|верните|proszę|czy możesz|użyj|przepisz|zmień|zaimplementuj)/i;
const NEW_INPUT = /^(assume\b|suppose\b|the input\b|the array\b|the list\b|the method\b|there (?:can|may|will) be\b|it may receive\b|values are\b|input is\b|output is\b|предположим|входные данные|массив|список|метод|может быть|значения|załóżmy|dane wejściowe|tablica|lista|metoda)/i;
const QUESTION = /^(what|why|how|when|where|which|can|could|would|is|are|does|do|did|should|что|почему|как|какой|можете|можешь|czy|co|dlaczego|jak)\b|\?\s*$/i;

function fallbackClassifyUtterance({ utterance, recentUtterances = [] } = {}) {
  const current = cleanText(utterance, 2400);
  const previous = cleanText(recentUtterances.at(-1)?.text || recentUtterances.at(-1), 2400);
  const combined = cleanText(`${previous} ${current}`, 4000);
  const base = {
    normalizedInput: current,
    combinedUtterance: current,
    reason: 'Local context-aware fallback was used because semantic classification was unavailable.',
    source: 'fallback'
  };
  if (!current) return normalizeClassification({ ...base, type: 'remark', action: 'ignore', changesCurrentSolution: false });
  if (NEW_TASK.test(current)) return normalizeClassification({ ...base, type: 'new-task', action: 'queue-new-task', confidence: 'high', changesCurrentSolution: false });
  if (CORRECTION.test(current)) return normalizeClassification({ ...base, type: 'correction', action: 'revise-inputs', inputOperation: 'replace', confidence: 'medium' });
  if (HARD_CONSTRAINT.test(current)) return normalizeClassification({ ...base, type: 'constraint', action: 'apply-change', inputOperation: 'add', confidence: 'medium' });
  if (RECOMMENDATION.test(current)) return normalizeClassification({ ...base, type: 'recommendation', action: 'offer-change', inputOperation: 'none', confidence: 'medium' });
  if (REQUEST.test(current)) return normalizeClassification({ ...base, type: 'request', action: 'apply-change', inputOperation: 'add', confidence: 'medium' });
  if (NEW_INPUT.test(current)) return normalizeClassification({ ...base, type: 'new-input', action: 'apply-change', inputOperation: 'add', confidence: 'medium' });
  if (QUESTION.test(current)) return normalizeClassification({ ...base, type: 'follow-up', action: 'answer-separately', confidence: 'medium', changesCurrentSolution: false });
  const previousLooksIncomplete = /\b(could you|can you|would you|instead of|rather than|use|using|without|with|and|or|to|a|an|the)$/i.test(previous);
  if (previous && previousLooksIncomplete) {
    return normalizeClassification({
      ...base,
      type: 'ambiguous',
      action: 'ask-confirmation',
      confidence: 'low',
      mergeWithPrevious: true,
      combinedUtterance: combined,
      normalizedInput: combined,
      changesCurrentSolution: true
    });
  }
  return normalizeClassification({ ...base, type: 'remark', action: 'ignore', confidence: 'medium', changesCurrentSolution: false });
}

function isAutomaticChange(classification, autoAnalyze) {
  if (!autoAnalyze || !classification?.changesCurrentSolution) return false;
  if (classification.confidence !== 'high') return false;
  return ['apply-change', 'revise-inputs'].includes(classification.action)
    && ['request', 'constraint', 'correction', 'new-input'].includes(classification.type);
}

function previewActiveInputs(activeInputs = [], classification = {}, utterance = {}) {
  const current = (Array.isArray(activeInputs) ? activeInputs : [])
    .filter(item => item && item.status !== 'removed')
    .map(item => ({ ...item }));
  const affected = new Set(list(classification.affectedInputIds, 8, 160));
  let next = current.filter(item => !affected.has(item.id));
  if (classification.inputOperation === 'remove') return next;
  const normalized = cleanText(classification.normalizedInput || utterance.text, 2400);
  if (!normalized || classification.inputOperation === 'none') return next;
  const duplicate = next.find(item => cleanText(item.normalizedInput).toLowerCase() === normalized.toLowerCase());
  if (duplicate) return next;
  next.push({
    id: cleanText(utterance.id, 160) || `input-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    type: classification.type,
    target: classification.target,
    normalizedInput: normalized,
    sourceText: cleanText(utterance.text, 2400),
    verificationCriteria: list(classification.verificationCriteria, 8, 1000),
    status: 'active',
    createdAt: Number(utterance.ts || Date.now())
  });
  return next.slice(-20);
}

module.exports = {
  CLASSIFICATION_TYPES,
  ACTIONS,
  cleanText,
  normalizeClassification,
  fallbackClassifyUtterance,
  isAutomaticChange,
  previewActiveInputs
};
