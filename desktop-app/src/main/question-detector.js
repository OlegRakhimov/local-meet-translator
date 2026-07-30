const MAX_QUESTION_LENGTH = 2400;
const DEFAULT_DEDUPE_WINDOW_MS = 45_000;
const DEFAULT_CONTEXT_WINDOW_MS = 30 * 60_000;

const QUESTION_OPENERS = [
  /^(what|why|how|when|where|who|whom|whose|which)\b/i,
  /^(can|could|would|will|do|does|did|are|is|was|were|have|has|had|should|may|might)\b/i,
  /^(tell me|describe|explain|walk me through|give me an example|talk about)\b/i,
  /^(что|почему|как|когда|где|кто|какой|какая|какие|можете|можешь|расскажите|опишите|объясните)\b/i,
  /^(co|dlaczego|jak|kiedy|gdzie|kto|który|czy|możesz|proszę opowiedzieć|opisz|wyjaśnij)\b/i
];

const CODING_OPENERS = [
  /^(write|implement|create|build|code|develop|design|refactor|debug|fix|solve|find|return|print|reverse|sort|remove|check|validate|parse|calculate)\b/i,
  /^(can|could|would) you (write|implement|create|build|code|design|solve|find|reverse|sort|debug|fix)\b/i,
  /^(how would you|how do you) (write|implement|create|build|design|solve|find|reverse|sort|debug|fix)\b/i,
  /^(given|suppose|assume)\b.*\b(array|list|linked list|string|tree|graph|matrix|number|integer|input)\b/i,
  /^(напишите|реализуйте|создайте|разработайте|решите|найдите|разверните|отсортируйте|удалите|проверьте)\b/i,
  /^(zaimplementuj|napisz|utwórz|rozwiąż|znajdź|odwróć|posortuj|usuń|sprawdź)\b/i
];

const CODING_TERMS = /\b(code|function|method|class|algorithm|array|list|linked list|hashmap|hash map|map|set|stack|queue|tree|graph|matrix|string|loop|recursion|complexity|big o|java|kotlin|python|javascript|typescript|sql|android|compose|coroutine|flow|room|api|endpoint)\b/i;
const CODING_CONTINUATION = /^(use|using|without|with|and then|then|also|it should|the function should|return|do it|now use|assume|for example|при этом|без|используя|затем|также|функция должна|верните|теперь|użyj|używając|bez|następnie|również)\b/i;
const RELATIVE_CODING_CONTINUATION = /^(that|which|where|который|которая|которые|где|który|która|które|gdzie)\b/i;
const CODING_CONSTRAINT_TERMS = /\b(return|accept|take|receive|handle|ignore|print|throw|null|empty|duplicate|unique|sorted|complexity|memory|time|space|input|output|method|function|array|list|map|set|вернуть|принимать|обработать|игнорировать|вывести|пустой|дубликат|уникальный|отсортированный|сложность|память|метод|функция|массив|список)\b/i;
const SHORT_SOCIAL_QUESTION = /^(right|okay|ok|correct|really|seriously|isn't it|don't you think|you know|да|правда|верно|понятно|окей|серьезно)[?!. ]*$/i;
const NEW_CODING_TASK_OPENERS = /^(now|next|another|let's move|let us move|moving on|new task|next task|теперь|следующая|другая задача|перейд[её]м|następnie|kolejne|nowe zadanie)\b/i;

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

function looksLikeAnswerEcho(value, candidates = [], options = {}) {
  const utteranceTokens = new Set(questionTokens(value));
  const minTokens = Number.isFinite(Number(options.minTokens))
    ? Math.max(3, Number(options.minTokens))
    : 5;
  const threshold = Number.isFinite(Number(options.threshold))
    ? Math.max(0.5, Math.min(1, Number(options.threshold)))
    : 0.82;
  if (utteranceTokens.size < minTokens) return false;

  for (const candidate of Array.isArray(candidates) ? candidates : []) {
    const candidateTokens = new Set(questionTokens(candidate));
    if (candidateTokens.size < minTokens) continue;
    let intersection = 0;
    for (const token of utteranceTokens) if (candidateTokens.has(token)) intersection += 1;
    if (intersection >= minTokens && intersection / utteranceTokens.size >= threshold) return true;
  }
  return false;
}

function detectCodingLanguage(value) {
  const text = cleanQuestionText(value).toLowerCase();
  if (/\bkotlin\b/.test(text)) return 'kotlin';
  if (/\bpython\b/.test(text)) return 'python';
  if (/\b(type|java)script\b|\bjs\b/.test(text)) return 'javascript';
  if (/\btypescript\b|\bts\b/.test(text)) return 'typescript';
  if (/\bsql\b/.test(text)) return 'sql';
  if (/\bjava\b/.test(text)) return 'java';
  return '';
}


function looksLikeCodingContinuation(value) {
  const text = cleanQuestionText(value);
  if (!text) return false;
  if (CODING_CONTINUATION.test(text)) return true;
  return RELATIVE_CODING_CONTINUATION.test(text) && CODING_CONSTRAINT_TERMS.test(text);
}

function looksLikeCodingTask(value) {
  const text = cleanQuestionText(value);
  if (text.length < 5) return false;
  if (CODING_OPENERS.some(pattern => pattern.test(text))) return true;
  if (/\b(show|give) me (the )?(code|implementation)\b/i.test(text)) return true;
  return /\b(write|implement|create|code|solve|find|reverse|sort|debug|fix|refactor)\b/i.test(text) && CODING_TERMS.test(text);
}

function looksLikeNewCodingTask(value) {
  const text = cleanQuestionText(value);
  if (!text || !NEW_CODING_TASK_OPENERS.test(text)) return false;
  const withoutTransition = cleanQuestionText(
    text.replace(NEW_CODING_TASK_OPENERS, '').replace(/^[,.:;\-\s]+/, '')
  );
  return looksLikeCodingTask(withoutTransition) || CODING_TERMS.test(withoutTransition);
}

function looksLikeQuestion(value) {
  const text = cleanQuestionText(value);
  if (text.length < 7 || SHORT_SOCIAL_QUESTION.test(text)) return false;
  const tokens = questionTokens(text);
  if (tokens.length < 2) return false;
  if (looksLikeCodingTask(text)) return true;
  if (/\?\s*$/.test(text)) return true;
  return QUESTION_OPENERS.some(pattern => pattern.test(text));
}

function classifyInterviewUtterance(value, context = {}) {
  const text = cleanQuestionText(value);
  if (!text) return { kind: 'empty', actionable: false, text };
  const activeCodingTask = cleanQuestionText(context.activeCodingTask);
  const activeAt = Number(context.activeAt || 0);
  const now = Number(context.now || Date.now());
  const hasActiveCodingTask = !!(activeCodingTask && now - activeAt <= DEFAULT_CONTEXT_WINDOW_MS);

  if (hasActiveCodingTask) {
    if (looksLikeNewCodingTask(text)) {
      return {
        kind: 'new-coding-task',
        actionable: true,
        text,
        utterance: text,
        codingLanguage: detectCodingLanguage(text),
        baseTaskText: activeCodingTask
      };
    }
    if (looksLikeCodingContinuation(text)) {
      const mergedText = cleanQuestionText(`${activeCodingTask} Additional constraint: ${text}`);
      return {
        kind: 'coding-context',
        actionable: true,
        text: mergedText,
        utterance: text,
        codingLanguage: detectCodingLanguage(text) || detectCodingLanguage(activeCodingTask),
        baseTaskText: activeCodingTask
      };
    }
    if (looksLikeQuestion(text)) {
      return {
        kind: 'coding-follow-up',
        actionable: true,
        text,
        utterance: text,
        codingLanguage: detectCodingLanguage(activeCodingTask),
        baseTaskText: activeCodingTask
      };
    }
    if (looksLikeCodingTask(text)) {
      return {
        kind: 'new-coding-task',
        actionable: true,
        text,
        utterance: text,
        codingLanguage: detectCodingLanguage(text),
        baseTaskText: activeCodingTask
      };
    }
  }

  if (looksLikeCodingTask(text)) {
    return { kind: 'coding-task', actionable: true, text, codingLanguage: detectCodingLanguage(text) };
  }
  if (looksLikeQuestion(text)) return { kind: 'question', actionable: true, text, codingLanguage: '' };
  return { kind: 'remark', actionable: false, text };
}

function createQuestionDetector({
  dedupeWindowMs = DEFAULT_DEDUPE_WINDOW_MS,
  contextWindowMs = DEFAULT_CONTEXT_WINDOW_MS,
  maxHistory = 80
} = {}) {
  const history = [];
  let activeCodingTask = null;

  function prune(now) {
    while (history.length && now - history[0].detectedAt > dedupeWindowMs) history.shift();
    if (history.length > maxHistory) history.splice(0, history.length - maxHistory);
    if (activeCodingTask && now - activeCodingTask.detectedAt > contextWindowMs) activeCodingTask = null;
  }

  function consume(subtitleEvent = {}, now = Date.now()) {
    if (subtitleEvent.channel === 'outgoing') return { accepted: false, reason: 'outgoing' };
    prune(now);
    const rawText = cleanQuestionText(subtitleEvent.transcript || subtitleEvent.translation);
    const classification = classifyInterviewUtterance(rawText, {
      activeCodingTask: activeCodingTask?.text || '',
      activeAt: activeCodingTask?.detectedAt || 0,
      now
    });
    if (!classification.actionable) {
      return { accepted: false, reason: classification.kind, classification };
    }

    const text = classification.text;
    const normalized = normalizeQuestionText(text);
    const duplicate = history.find(item => item.normalized === normalized || tokenSimilarity(item.text, text) >= 0.92);
    if (duplicate) {
      return { accepted: false, reason: 'duplicate', duplicateOf: duplicate.id, question: duplicate, classification };
    }

    const question = {
      id: `question-${now}-${Math.random().toString(16).slice(2)}`,
      text,
      utterance: classification.utterance || rawText,
      normalized,
      kind: ['question', 'coding-follow-up'].includes(classification.kind) ? 'question' : 'coding-task',
      codingLanguage: classification.codingLanguage || '',
      detectedAt: now,
      eventId: cleanQuestionText(subtitleEvent.id).slice(0, 128),
      clientId: cleanQuestionText(subtitleEvent.clientId).slice(0, 256),
      tabId: cleanQuestionText(subtitleEvent.tabId).slice(0, 128),
      url: cleanQuestionText(subtitleEvent.url).slice(0, 2048),
      relation: classification.kind,
      baseTaskText: cleanQuestionText(classification.baseTaskText).slice(0, MAX_QUESTION_LENGTH)
    };
    history.push(question);
    if (classification.kind === 'coding-task') activeCodingTask = { ...question };
    else if (classification.kind === 'coding-context' && activeCodingTask) {
      activeCodingTask = { ...activeCodingTask, text: classification.text, detectedAt: now };
    } else if (!activeCodingTask && question.kind !== 'coding-task') {
      activeCodingTask = null;
    }
    prune(now);
    return { accepted: true, reason: classification.kind, question, classification };
  }

  function snapshot() {
    return {
      history: history.map(item => ({ ...item })),
      activeCodingTask: activeCodingTask ? { ...activeCodingTask } : null
    };
  }

  function clear() {
    history.length = 0;
    activeCodingTask = null;
  }

  function clearHistory() {
    history.length = 0;
    return snapshot();
  }

  function clearActiveCodingTask() {
    activeCodingTask = null;
    return snapshot();
  }

  function activateCodingTask(question, now = Date.now()) {
    const text = cleanQuestionText(question?.text || question);
    activeCodingTask = text ? { ...(question && typeof question === 'object' ? question : {}), text, kind: 'coding-task', detectedAt: now } : null;
    return snapshot();
  }

  return { consume, snapshot, clear, clearHistory, clearActiveCodingTask, activateCodingTask };
}

module.exports = {
  MAX_QUESTION_LENGTH,
  DEFAULT_DEDUPE_WINDOW_MS,
  DEFAULT_CONTEXT_WINDOW_MS,
  cleanQuestionText,
  normalizeQuestionText,
  questionTokens,
  tokenSimilarity,
  looksLikeAnswerEcho,
  detectCodingLanguage,
  looksLikeCodingContinuation,
  NEW_CODING_TASK_OPENERS,
  looksLikeCodingTask,
  looksLikeNewCodingTask,
  looksLikeQuestion,
  classifyInterviewUtterance,
  createQuestionDetector
};
