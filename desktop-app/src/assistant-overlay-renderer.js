const $ = id => document.getElementById(id);
let latestState = {};

const overlayLanguage = String(navigator.language || 'en').toLowerCase().startsWith('ru') ? 'ru' : 'en';
const codingUi = overlayLanguage === 'ru'
  ? {
      task: 'ЗАДАЧА',
      remark: 'КОММЕНТАРИЙ',
      followUp: 'ВОПРОС ПО РЕШЕНИЮ',
      recommendation: 'РЕКОМЕНДАЦИЯ',
      request: 'ПРОСЬБА',
      constraint: 'ОБЯЗАТЕЛЬНОЕ УСЛОВИЕ',
      correction: 'ИСПРАВЛЕНИЕ',
      newInput: 'НОВАЯ ВВОДНАЯ',
      newTask: 'НОВАЯ ЗАДАЧА',
      ambiguous: 'НУЖНО УТОЧНЕНИЕ',
      analyzingType: 'АНАЛИЗИРУЮ',
      clearFeed: 'Очистить реплики',
      endFocus: 'Завершить задачу',
      analyzeFollowUp: 'Подготовить ответ',
      analyzing: 'Анализирую…',
      followUpReady: 'Короткий ответ готов.',
      followUpWaiting: 'Новый вопрос готов к анализу. Решение задачи остаётся закреплённым.',
      followUpAnalyzing: 'Готовлю короткий ответ, не заменяя решение задачи…',
      pendingTask: 'Обнаружена новая задача',
      openTask: 'Открыть новую задачу',
      activeInputs: 'Учитываемые вводные',
      pendingChange: 'Как обработать новую реплику',
      applyChange: 'Применить к решению',
      applyingChange: 'Обновляю решение…',
      keepCurrent: 'Оставить текущее решение',
      applied: 'Применено',
      dismissed: 'Оставлено без изменений',
      classifierReason: 'Почему так распознано'
    }
  : {
      task: 'TASK',
      remark: 'COMMENT',
      followUp: 'QUESTION ABOUT SOLUTION',
      recommendation: 'RECOMMENDATION',
      request: 'REQUEST',
      constraint: 'MANDATORY CONDITION',
      correction: 'CORRECTION',
      newInput: 'NEW INPUT',
      newTask: 'NEW TASK',
      ambiguous: 'NEEDS CONFIRMATION',
      analyzingType: 'ANALYZING',
      clearFeed: 'Clear utterances',
      endFocus: 'Finish task',
      analyzeFollowUp: 'Prepare answer',
      analyzing: 'Analyzing…',
      followUpReady: 'Short answer ready.',
      followUpWaiting: 'A new question is ready for analysis. The coding solution remains pinned.',
      followUpAnalyzing: 'Preparing a short answer without replacing the coding solution…',
      pendingTask: 'New coding task detected',
      openTask: 'Open new task',
      activeInputs: 'Active interviewer inputs',
      pendingChange: 'How to handle the new utterance',
      applyChange: 'Apply to solution',
      applyingChange: 'Updating solution…',
      keepCurrent: 'Keep current solution',
      applied: 'Applied',
      dismissed: 'Kept without changes',
      classifierReason: 'Why it was classified this way'
    };

function text(id, value) { const el = $(id); if (el) el.textContent = value || ''; }
function renderList(id, items) {
  const el = $(id); if (!el) return;
  el.innerHTML = '';
  for (const item of Array.isArray(items) ? items : []) {
    const li = document.createElement('li'); li.textContent = item; el.appendChild(li);
  }
}
function renderKeywords(items) {
  const el = $('keywordChips');
  if (!el) return;
  el.innerHTML = '';
  for (const item of Array.isArray(items) ? items : []) {
    const span = document.createElement('span');
    span.className = 'keywordChip';
    span.textContent = item;
    el.appendChild(span);
  }
}

function renderCodingContext(state = {}) {
  const focus = state.codingFocus || {};
  const active = !!focus.active;
  $('codingFocusPanel').hidden = !active;
  if (!active) return;

  const feed = $('liveContextFeed');
  feed.innerHTML = '';
  const entries = Array.isArray(focus.liveContext) ? focus.liveContext : [];
  $('liveContextEmpty').hidden = entries.length > 0;
  const kindLabels = {
    task: codingUi.task,
    remark: codingUi.remark,
    'follow-up': codingUi.followUp,
    recommendation: codingUi.recommendation,
    request: codingUi.request,
    constraint: codingUi.constraint,
    correction: codingUi.correction,
    'new-input': codingUi.newInput,
    'new-task': codingUi.newTask,
    ambiguous: codingUi.ambiguous,
    analyzing: codingUi.analyzingType
  };
  for (const entry of entries) {
    const item = document.createElement('div');
    item.className = `liveContextItem ${entry.status || ''}`;
    const meta = document.createElement('div');
    meta.className = 'liveContextMeta';
    const badge = document.createElement('span');
    badge.className = `contextKind ${entry.kind || 'remark'}`;
    badge.textContent = kindLabels[entry.kind] || String(entry.kind || 'remark').toUpperCase();
    const time = document.createElement('span');
    time.className = 'liveContextTime';
    const date = new Date(Number(entry.ts || Date.now()));
    time.textContent = Number.isNaN(date.getTime()) ? '' : date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    meta.append(badge, time);
    if (entry.status === 'applied' || entry.status === 'dismissed') {
      const stateBadge = document.createElement('span');
      stateBadge.className = `contextResolution ${entry.status}`;
      stateBadge.textContent = entry.status === 'applied' ? codingUi.applied : codingUi.dismissed;
      meta.appendChild(stateBadge);
    }
    const content = document.createElement('div');
    content.className = 'liveContextContent';
    const body = document.createElement('p');
    body.className = 'liveContextText';
    body.textContent = entry.text || entry.translation || '';
    content.appendChild(body);
    const original = String(entry.text || '').trim().toLocaleLowerCase();
    const translated = String(entry.translation || '').trim();
    if (translated && translated.toLocaleLowerCase() !== original) {
      const translation = document.createElement('p');
      translation.className = 'liveContextTranslation';
      translation.textContent = translated;
      content.appendChild(translation);
    }
    if (entry.reason) {
      const reason = document.createElement('p');
      reason.className = 'liveContextReason';
      reason.textContent = `${codingUi.classifierReason}: ${entry.reason}`;
      content.appendChild(reason);
    }
    item.append(meta, content);
    feed.appendChild(item);
  }
  feed.scrollTop = feed.scrollHeight;

  const activeInputs = Array.isArray(focus.activeInputs) ? focus.activeInputs : [];
  $('activeCodingInputsBlock').hidden = activeInputs.length === 0;
  text('activeCodingInputsLabel', codingUi.activeInputs);
  const inputHost = $('activeCodingInputs');
  inputHost.innerHTML = '';
  for (const item of activeInputs) {
    const chip = document.createElement('span');
    chip.className = 'activeCodingInput';
    chip.textContent = item.normalizedInput || item.sourceText || '';
    inputHost.appendChild(chip);
  }

  const pendingChange = focus.pendingChange || null;
  $('pendingCodingChangeBlock').hidden = !pendingChange?.classification;
  if (pendingChange?.classification) {
    const type = pendingChange.classification.type || 'ambiguous';
    text('pendingCodingChangeLabel', codingUi.pendingChange);
    text('pendingCodingChangeType', kindLabels[type] || String(type).toUpperCase());
    text('pendingCodingChangeText', pendingChange.utterance?.text || pendingChange.classification.normalizedInput || '');
    text('pendingCodingChangeReason', pendingChange.classification.reason || '');
    const error = pendingChange.error || '';
    $('pendingCodingChangeError').hidden = !error;
    text('pendingCodingChangeError', error);
    const applying = pendingChange.status === 'applying';
    $('applyCodingChange').disabled = applying;
    $('dismissCodingChange').disabled = applying;
    text('applyCodingChange', applying ? codingUi.applyingChange : codingUi.applyChange);
    text('dismissCodingChange', codingUi.keepCurrent);
  }

  const followUp = focus.followUp || null;
  $('codingFollowUpBlock').hidden = !followUp?.question?.text;
  text('codingFollowUpQuestion', followUp?.question?.text || '');
  const followUpStatuses = {
    question: codingUi.followUpWaiting,
    analyzing: codingUi.followUpAnalyzing,
    ready: codingUi.followUpReady,
    error: followUp?.error || 'Follow-up analysis failed.'
  };
  text('codingFollowUpStatus', followUpStatuses[followUp?.status] || '');
  $('codingFollowUpStatus').className = `codingFollowUpStatus ${followUp?.status === 'error' ? 'error' : ''}`;
  $('analyzeCodingFollowUp').disabled = followUp?.status === 'analyzing';
  $('analyzeCodingFollowUp').textContent = followUp?.status === 'analyzing' ? codingUi.analyzing : codingUi.analyzeFollowUp;
  const followSuggestion = followUp?.suggestion || null;
  $('codingFollowUpAnswerBlock').hidden = !followSuggestion;
  text('codingFollowUpFirstSentence', followSuggestion?.firstSentence || '');
  text('codingFollowUpAnswer', followSuggestion?.answer || '');

  $('pendingCodingTaskBlock').hidden = !focus.pendingTask?.text;
  text('pendingCodingTaskText', focus.pendingTask?.text || '');
}

function render(state = {}) {
  latestState = state || {};
  const root = $('assistantRoot');
  const compactOverlay = state.settings?.compactOverlay !== false;
  root.className = `assistantRoot ${state.status || 'idle'}${state.moveMode ? ' moveMode' : ''}${compactOverlay ? ' compactOverlay' : ''}`;
  root.style.setProperty('--assistant-font-size', `${state.settings?.fontSize || 20}px`);
  const configuredOpacity = Number(state.settings?.backgroundOpacity || 0.94);
  const panelOpacity = compactOverlay ? Math.min(configuredOpacity, 0.56) : configuredOpacity;
  root.style.setProperty('--assistant-panel-opacity', String(Math.max(0.15, Math.min(1, panelOpacity))));
  text('clearCodingContext', codingUi.clearFeed);
  text('endCodingFocus', codingUi.endFocus);
  text('pendingCodingTaskLabel', codingUi.pendingTask);
  text('openPendingCodingTask', codingUi.openTask);
  const questionKind = state.question?.kind || '';
  text('questionLabel', questionKind === 'coding-task' ? 'Coding task' : 'Question');
  text('questionText', state.question?.text || 'Waiting for an interview question or coding task…');
  renderCodingContext(state);

  const teleprompter = state.teleprompter || {};
  const current = teleprompter.current || null;
  const document = current?.document || null;
  const suggestion = state.suggestion || current?.suggestion || null;
  const hasSuggestion = !!suggestion;
  $('suggestionBlock').hidden = !hasSuggestion;
  $('emptyState').hidden = hasSuggestion || state.status === 'analyzing' || state.status === 'error';
  text('emptyState', state.settings?.autoAnalyze
    ? 'Automatic AI analysis is enabled. Waiting for a stable interview question…'
    : 'Automatic AI analysis is off. Analyze the detected question from the desktop app.');
  $('errorState').hidden = state.status !== 'error';
  text('errorState', state.error || 'The suggestion could not be prepared.');

  const statuses = { idle: 'Waiting', question: 'Question detected', analyzing: 'Analyzing…', ready: 'Ready', error: 'Error' };
  text('statusBadge', statuses[state.status] || state.status || 'Waiting');

  const frozen = !!teleprompter.frozen;
  $('freezeBadge').hidden = !frozen;
  $('moveBadge').hidden = !state.moveMode;
  text('moveAssistantOverlay', state.moveMode ? '✓' : '↔');
  text('freezeTeleprompter', frozen ? 'Unfreeze' : 'Freeze');

  const pendingQuestion = teleprompter.pendingQuestion?.text || teleprompter.pending?.question?.text || '';
  $('pendingBlock').hidden = !(pendingQuestion && (teleprompter.frozen || teleprompter.pending));
  text('pendingQuestionText', pendingQuestion);
  text('loadPendingAnswer', teleprompter.pendingAnalyzing ? 'Analyzing pending…' : 'Load pending');
  $('loadPendingAnswer').disabled = !teleprompter.pending;

  $('codingSolutionBlock').hidden = true;
  if (!hasSuggestion) return;

  const isCoding = suggestion.responseType === 'coding_solution';
  text('taskTypeBadge', isCoding ? 'CODING SOLUTION' : 'INTERVIEW ANSWER');
  $('codingSolutionBlock').hidden = !isCoding;

  text('sourceBadge', suggestion.source === 'library' ? 'ANSWER LIBRARY' : 'AI GROUNDED');
  text('confidenceBadge', `${String(suggestion.confidence || 'low').toUpperCase()} CONFIDENCE`);
  text('firstSentence', document?.firstSentence || suggestion.firstSentence);
  text('answerText', suggestion.answer);
  text('fallbackText', suggestion.safeFallback);
  $('fallbackBlock').hidden = !suggestion.safeFallback;
  renderList('keyPoints', suggestion.keyPoints);
  renderList('basis', suggestion.basis);

  if (isCoding) {
    text('codeLanguage', suggestion.codeLanguage || state.question?.codingLanguage || 'Java');
    text('approachSummary', suggestion.approachSummary);
    renderList('implementationPlan', suggestion.implementationPlan);
    text('complexityText', suggestion.complexity);
    renderList('edgeCases', suggestion.edgeCases);
    text('codeText', suggestion.code);
    renderList('codeWalkthrough', suggestion.codeWalkthrough);
    renderList('speakingNotes', suggestion.speakingNotes);
  }

  const chunks = document?.chunks || [];
  const activeIndex = Math.max(0, Math.min(chunks.length - 1, Number(teleprompter.activeChunkIndex || 0)));
  text('activeChunk', chunks[activeIndex] || suggestion.answer || suggestion.firstSentence);
  text('chunkProgress', chunks.length ? `${activeIndex + 1} / ${chunks.length}` : '1 / 1');
  text('chunkModeBadge', `${String(teleprompter.settings?.chunkMode || 'medium').toUpperCase()} CHUNKS`);
  $('previousChunk').disabled = activeIndex <= 0;
  $('nextChunk').disabled = !chunks.length || activeIndex >= chunks.length - 1;

  const showPlan = teleprompter.settings?.showPlan !== false;
  const showKeywords = teleprompter.settings?.showKeywords !== false;
  $('planColumn').hidden = !showPlan || !(document?.plan || []).length;
  $('keywordsColumn').hidden = !showKeywords || !(document?.keywords || []).length;
  $('teleprompterGuidance').hidden = $('planColumn').hidden && $('keywordsColumn').hidden;
  renderList('answerPlan', document?.plan || []);
  renderKeywords(document?.keywords || []);
}

window.lmtAssistantOverlay.onState(render);
$('hideAssistantOverlay').onclick = () => window.lmtAssistantOverlay.hide();
$('moveAssistantOverlay').onclick = () => window.lmtAssistantOverlay.control('moveMode', { enabled: !latestState.moveMode });
$('previousChunk').onclick = () => window.lmtAssistantOverlay.control('previousChunk');
$('nextChunk').onclick = () => window.lmtAssistantOverlay.control('nextChunk');
$('freezeTeleprompter').onclick = () => window.lmtAssistantOverlay.control('freezeTeleprompter', { enabled: !(latestState.teleprompter?.frozen) });
$('loadPendingAnswer').onclick = () => window.lmtAssistantOverlay.control('loadPending');

$('clearCodingContext').onclick = () => window.lmtAssistantOverlay.control('clearCodingContext');
$('endCodingFocus').onclick = () => window.lmtAssistantOverlay.control('endCodingFocus');
$('analyzeCodingFollowUp').onclick = () => window.lmtAssistantOverlay.control('analyzeCodingFollowUp');
$('openPendingCodingTask').onclick = () => window.lmtAssistantOverlay.control('openPendingCodingTask');
$('applyCodingChange').onclick = () => window.lmtAssistantOverlay.control('applyCodingChange');
$('dismissCodingChange').onclick = () => window.lmtAssistantOverlay.control('dismissCodingChange');
