const $ = id => document.getElementById(id);
let latestState = {};

const MODE_UI = Object.freeze({
  WAITING: {
    title: 'ЖДУ ВОПРОС',
    description: 'Помощник слушает собеседника и автоматически подготовит ответ.'
  },
  ANSWERING: {
    title: 'ОТВЕЧАЮ',
    description: 'Текущий ответ закреплён. Новая реплика не заменит его автоматически.'
  },
  NEXT_QUESTION_READY: {
    title: 'СЛЕДУЮЩИЙ ВОПРОС ГОТОВ',
    description: 'Закончите текущий ответ и нажмите «Следующий вопрос».'
  },
  CODING: {
    title: 'РАБОТАЮ НАД КОДОМ',
    description: 'Текущая задача и код закреплены. Новые условия применяются только после подтверждения.'
  },
  CODING_CHANGE_READY: {
    title: 'НОВОЕ УСЛОВИЕ ЖДЁТ ПОДТВЕРЖДЕНИЯ',
    description: 'Выберите: применить условие к решению или оставить текущий код.'
  },
  NEW_CODING_TASK_READY: {
    title: 'НОВАЯ ЗАДАЧА ЖДЁТ ПЕРЕКЛЮЧЕНИЯ',
    description: 'Текущая задача сохранена. Перейдите к новой задаче только когда будете готовы.'
  }
});

const KIND_LABELS = Object.freeze({
  task: 'ЗАДАЧА',
  question: 'ВОПРОС',
  remark: 'РЕПЛИКА',
  utterance: 'РЕПЛИКА',
  'follow-up': 'ВОПРОС ПО РЕШЕНИЮ',
  recommendation: 'РЕКОМЕНДАЦИЯ',
  request: 'ПРОСЬБА',
  constraint: 'ОБЯЗАТЕЛЬНОЕ УСЛОВИЕ',
  correction: 'ИСПРАВЛЕНИЕ',
  'new-input': 'НОВАЯ ВВОДНАЯ',
  'new-task': 'НОВАЯ ЗАДАЧА',
  ambiguous: 'НУЖНО УТОЧНЕНИЕ',
  analyzing: 'АНАЛИЗИРУЮ'
});

function text(id, value) {
  const element = $(id);
  if (element) element.textContent = value || '';
}

function renderList(id, items) {
  const element = $(id);
  if (!element) return;
  element.innerHTML = '';
  for (const item of Array.isArray(items) ? items : []) {
    const li = document.createElement('li');
    li.textContent = item;
    element.appendChild(li);
  }
}

function renderKeywords(items) {
  const element = $('keywordChips');
  if (!element) return;
  element.innerHTML = '';
  for (const item of Array.isArray(items) ? items : []) {
    const chip = document.createElement('span');
    chip.className = 'keywordChip';
    chip.textContent = item;
    element.appendChild(chip);
  }
}

function renderMode(state = {}) {
  const mode = state.mode || 'WAITING';
  const ui = MODE_UI[mode] || MODE_UI.WAITING;
  text('modeBadge', ui.title);
  text('modeDescription', ui.description);
  const profileMode = state.settings?.profileMode || 'general';
  text('interviewProfileBadge', profileMode === 'speakit_polish_support'
    ? 'SPEAKIT · POLISH CUSTOMER SUPPORT'
    : 'ОБЩИЙ ПРОФИЛЬ');
  const modePanel = $('modeBadge')?.closest('.modePanel');
  if (modePanel) modePanel.dataset.mode = mode;
}

function renderUtteranceFeed(state = {}) {
  const feed = $('liveContextFeed');
  if (!feed) return;
  feed.innerHTML = '';
  const entries = Array.isArray(state.utteranceFeed) ? state.utteranceFeed : [];
  if ($('liveContextEmpty')) $('liveContextEmpty').hidden = entries.length > 0;
  for (const entry of entries) {
    const item = document.createElement('div');
    item.className = 'liveContextItem';

    const meta = document.createElement('div');
    meta.className = 'liveContextMeta';
    const badge = document.createElement('span');
    badge.className = `contextKind ${entry.kind || 'utterance'}`;
    badge.textContent = KIND_LABELS[entry.kind] || 'РЕПЛИКА';
    const time = document.createElement('span');
    time.className = 'liveContextTime';
    const date = new Date(Number(entry.ts || Date.now()));
    time.textContent = Number.isNaN(date.getTime()) ? '' : date.toLocaleTimeString('ru-RU', {
      hour: '2-digit', minute: '2-digit', second: '2-digit'
    });
    meta.append(badge, time);

    const content = document.createElement('div');
    content.className = 'liveContextContent';
    const body = document.createElement('p');
    body.className = 'liveContextText';
    body.textContent = entry.text || entry.translation || '';
    content.appendChild(body);

    const original = String(entry.text || '').trim().toLocaleLowerCase('ru-RU');
    const translated = String(entry.translation || '').trim();
    if (translated && translated.toLocaleLowerCase('ru-RU') !== original) {
      const translation = document.createElement('p');
      translation.className = 'liveContextTranslation';
      translation.textContent = translated;
      content.appendChild(translation);
    }

    item.append(meta, content);
    feed.appendChild(item);
  }
  feed.scrollTop = feed.scrollHeight;
}

function renderCodingContext(state = {}) {
  const focus = state.codingFocus || {};
  const active = !!focus.active;
  if ($('codingFocusPanel')) $('codingFocusPanel').hidden = !active;
  if (!active) return;

  const activeInputs = Array.isArray(focus.activeInputs) ? focus.activeInputs : [];
  if ($('activeCodingInputsBlock')) $('activeCodingInputsBlock').hidden = activeInputs.length === 0;
  const inputHost = $('activeCodingInputs');
  if (inputHost) {
    inputHost.innerHTML = '';
    for (const item of activeInputs) {
      const chip = document.createElement('span');
      chip.className = 'activeCodingInput';
      chip.textContent = item.normalizedInput || item.sourceText || '';
      inputHost.appendChild(chip);
    }
  }

  const pendingChange = focus.pendingChange || null;
  if ($('pendingCodingChangeBlock')) $('pendingCodingChangeBlock').hidden = !pendingChange?.classification;
  if (pendingChange?.classification) {
    const type = pendingChange.classification.type || 'ambiguous';
    text('pendingCodingChangeType', KIND_LABELS[type] || 'НОВОЕ УСЛОВИЕ');
    text('pendingCodingChangeText', pendingChange.utterance?.text || pendingChange.classification.normalizedInput || '');
    text('pendingCodingChangeReason', pendingChange.classification.reason || '');
    const error = pendingChange.error || '';
    if ($('pendingCodingChangeError')) $('pendingCodingChangeError').hidden = !error;
    text('pendingCodingChangeError', error);
    const applying = pendingChange.status === 'applying';
    if ($('applyCodingChange')) $('applyCodingChange').disabled = applying;
    if ($('dismissCodingChange')) $('dismissCodingChange').disabled = applying;
    text('applyCodingChange', applying ? 'Обновляю решение…' : 'Применить к решению');
  }

  const followUp = focus.followUp || null;
  if ($('codingFollowUpBlock')) $('codingFollowUpBlock').hidden = !followUp?.question?.text;
  text('codingFollowUpQuestion', followUp?.question?.text || '');
  const followUpStatuses = {
    question: 'Вопрос готов. Текущая задача и код остаются закреплёнными.',
    analyzing: 'Готовлю короткий ответ…',
    ready: 'Короткий ответ готов.',
    error: followUp?.error || 'Не удалось подготовить ответ.'
  };
  text('codingFollowUpStatus', followUpStatuses[followUp?.status] || '');
  if ($('codingFollowUpStatus')) $('codingFollowUpStatus').className = `codingFollowUpStatus ${followUp?.status === 'error' ? 'error' : ''}`;
  if ($('analyzeCodingFollowUp')) {
    $('analyzeCodingFollowUp').disabled = followUp?.status === 'analyzing';
    $('analyzeCodingFollowUp').textContent = followUp?.status === 'analyzing' ? 'Готовлю ответ…' : 'Подготовить ответ';
  }
  const followSuggestion = followUp?.suggestion || null;
  if ($('codingFollowUpAnswerBlock')) $('codingFollowUpAnswerBlock').hidden = !followSuggestion;
  text('codingFollowUpFirstSentence', followSuggestion?.firstSentence || '');
  text('codingFollowUpAnswer', followSuggestion?.answer || '');

  if ($('pendingCodingTaskBlock')) $('pendingCodingTaskBlock').hidden = !focus.pendingTask?.text;
  text('pendingCodingTaskText', focus.pendingTask?.text || '');
}

function renderSaveStatus(state = {}, hasSuggestion = false) {
  const session = state.sessionSave || { status: 'idle', message: '' };
  const fallback = hasSuggestion ? 'Ответ сохраняется в текущую сессию автоматически' : 'Жду готовый ответ';
  text('sessionSaveStatus', session.message || fallback);
  if ($('sessionSaveStatus')) $('sessionSaveStatus').className = `saveStatus ${session.status || 'idle'}`;

  const library = state.librarySave || { status: 'idle', message: '' };
  if ($('librarySaveStatus')) {
    $('librarySaveStatus').hidden = !library.message;
    $('librarySaveStatus').className = `librarySaveStatus ${library.status || 'idle'}`;
  }
  text('librarySaveStatus', library.message || '');
  if ($('saveAnswerToLibrary')) {
    $('saveAnswerToLibrary').disabled = !hasSuggestion || library.status === 'saving';
    $('saveAnswerToLibrary').textContent = library.status === 'saving'
      ? 'Сохраняю…'
      : 'Сохранить в Answer Library';
  }
}

function render(state = {}) {
  latestState = state || {};
  const root = $('assistantRoot');
  const compactOverlay = state.settings?.compactOverlay !== false;
  root.className = `assistantRoot ${state.status || 'idle'}${state.moveMode ? ' moveMode' : ''}${compactOverlay ? ' compactOverlay' : ''}`;
  root.style.setProperty('--assistant-font-size', `${state.settings?.fontSize || 20}px`);
  const configuredOpacity = Number(state.settings?.backgroundOpacity || 0.94);
  const panelOpacity = compactOverlay ? Math.min(configuredOpacity, 0.68) : configuredOpacity;
  root.style.setProperty('--assistant-panel-opacity', String(Math.max(0.15, Math.min(1, panelOpacity))));

  renderMode(state);
  renderUtteranceFeed(state);
  renderCodingContext(state);

  const focus = state.codingFocus || {};
  const questionKind = state.question?.kind || '';
  text('questionLabel', focus.active || questionKind === 'coding-task' ? 'Текущая задача' : 'Текущий вопрос');
  text('questionText', state.question?.text || focus.task?.text || 'Жду вопрос или задачу по программированию…');

  const teleprompter = state.teleprompter || {};
  const current = teleprompter.current || null;
  const document = current?.document || null;
  const suggestion = state.suggestion || current?.suggestion || null;
  const hasSuggestion = !!suggestion;
  const isCoding = suggestion?.responseType === 'coding_solution';

  if ($('suggestionBlock')) $('suggestionBlock').hidden = !hasSuggestion;
  if ($('emptyState')) $('emptyState').hidden = hasSuggestion || state.status === 'analyzing' || state.status === 'error';
  text('emptyState', state.status === 'analyzing'
    ? 'Готовлю ответ…'
    : 'Жду вопрос. Ответ будет подготовлен автоматически.');
  if ($('errorState')) $('errorState').hidden = state.status !== 'error';
  text('errorState', state.error || 'Не удалось подготовить ответ.');

  const frozen = !!teleprompter.frozen;
  const answerLocked = !!teleprompter.answerLocked;
  if ($('freezeBadge')) $('freezeBadge').hidden = !(frozen || answerLocked);
  text('freezeBadge', frozen ? 'ЗАМОРОЖЕНО' : 'ОТВЕТ ЗАКРЕПЛЁН');
  if ($('moveBadge')) $('moveBadge').hidden = !state.moveMode;
  text('moveAssistantOverlay', state.moveMode ? '✓' : '↔');

  const pendingQuestion = teleprompter.pendingQuestion?.text || teleprompter.pending?.question?.text || '';
  if ($('pendingBlock')) $('pendingBlock').hidden = !pendingQuestion;
  text('pendingQuestionText', pendingQuestion);
  if ($('loadPendingAnswer')) {
    $('loadPendingAnswer').disabled = !teleprompter.pending;
    $('loadPendingAnswer').textContent = teleprompter.pendingAnalyzing ? 'Готовлю следующий ответ…' : 'Следующий вопрос';
  }
  const pendingError = state.pendingError || '';
  if ($('pendingAnswerError')) $('pendingAnswerError').hidden = !pendingError;
  text('pendingAnswerError', pendingError ? `Не удалось подготовить следующий ответ: ${pendingError}` : '');
  if ($('retryPendingAnswer')) $('retryPendingAnswer').hidden = !pendingError;
  if ($('dismissPendingAnswer')) $('dismissPendingAnswer').hidden = !pendingError;

  renderSaveStatus(state, hasSuggestion);
  if (!hasSuggestion) return;

  text('taskTypeBadge', isCoding ? 'РЕШЕНИЕ ЗАДАЧИ' : 'ОТВЕТ НА ВОПРОС');
  text('sourceBadge', suggestion.source === 'library' ? 'БИБЛИОТЕКА ОТВЕТОВ' : 'ИИ');
  const confidenceLabels = { high: 'ВЫСОКАЯ УВЕРЕННОСТЬ', medium: 'СРЕДНЯЯ УВЕРЕННОСТЬ', low: 'НИЗКАЯ УВЕРЕННОСТЬ' };
  text('confidenceBadge', confidenceLabels[suggestion.confidence] || confidenceLabels.low);

  const hasCurrentAnswer = !!current;
  if ($('teleprompterBlock')) $('teleprompterBlock').hidden = !hasCurrentAnswer;
  text('firstSentence', document?.firstSentence || suggestion.firstSentence);
  text('answerText', suggestion.answer);
  text('fallbackText', suggestion.safeFallback);
  if ($('fallbackBlock')) $('fallbackBlock').hidden = !suggestion.safeFallback;
  renderList('keyPoints', suggestion.keyPoints);
  renderList('basis', suggestion.basis);

  if ($('codingSolutionBlock')) $('codingSolutionBlock').hidden = !isCoding;
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
  text('activeChunk', chunks[activeIndex] || suggestion.firstSentence || suggestion.answer);
  text('chunkProgress', chunks.length ? `${activeIndex + 1} / ${chunks.length}` : '1 / 1');
  const chunkLabels = { short: 'КОРОТКИЕ ФРАГМЕНТЫ', medium: 'СРЕДНИЕ ФРАГМЕНТЫ', long: 'ДЛИННЫЕ ФРАГМЕНТЫ' };
  text('chunkModeBadge', chunkLabels[teleprompter.settings?.chunkMode] || chunkLabels.medium);
  if ($('previousChunk')) $('previousChunk').disabled = activeIndex <= 0;
  if ($('nextChunk')) $('nextChunk').disabled = !chunks.length || activeIndex >= chunks.length - 1;
  if ($('finishCurrentAnswer')) $('finishCurrentAnswer').disabled = !current;

  const showPlan = !isCoding && teleprompter.settings?.showPlan !== false;
  const showKeywords = !isCoding && teleprompter.settings?.showKeywords !== false;
  if ($('planColumn')) $('planColumn').hidden = !showPlan || !(document?.plan || []).length;
  if ($('keywordsColumn')) $('keywordsColumn').hidden = !showKeywords || !(document?.keywords || []).length;
  if ($('teleprompterGuidance')) $('teleprompterGuidance').hidden = isCoding || ($('planColumn')?.hidden && $('keywordsColumn')?.hidden);
  renderList('answerPlan', document?.plan || []);
  renderKeywords(document?.keywords || []);
}

window.lmtAssistantOverlay.onState(render);
$('hideAssistantOverlay').onclick = () => window.lmtAssistantOverlay.hide();
$('moveAssistantOverlay').onclick = () => window.lmtAssistantOverlay.control('moveMode', { enabled: !latestState.moveMode });
$('decreaseAssistantOverlay').onclick = () => window.lmtAssistantOverlay.control('decreaseWindowSize');
$('increaseAssistantOverlay').onclick = () => window.lmtAssistantOverlay.control('increaseWindowSize');
$('previousChunk').onclick = () => window.lmtAssistantOverlay.control('previousChunk');
$('nextChunk').onclick = () => window.lmtAssistantOverlay.control('nextChunk');
$('finishCurrentAnswer').onclick = () => window.lmtAssistantOverlay.control('finishAnswer');
$('loadPendingAnswer').onclick = () => window.lmtAssistantOverlay.control('nextQuestion');
$('retryPendingAnswer').onclick = () => window.lmtAssistantOverlay.control('retryPending');
$('dismissPendingAnswer').onclick = () => window.lmtAssistantOverlay.control('dismissPending');
$('saveAnswerToLibrary').onclick = () => window.lmtAssistantOverlay.control('saveCurrentToLibrary');
$('clearUtteranceFeed').onclick = () => window.lmtAssistantOverlay.control('clearUtteranceFeed');
$('endCodingFocus').onclick = () => window.lmtAssistantOverlay.control('endCodingFocus');
$('analyzeCodingFollowUp').onclick = () => window.lmtAssistantOverlay.control('analyzeCodingFollowUp');
$('openPendingCodingTask').onclick = () => window.lmtAssistantOverlay.control('openPendingCodingTask');
$('applyCodingChange').onclick = () => window.lmtAssistantOverlay.control('applyCodingChange');
$('dismissCodingChange').onclick = () => window.lmtAssistantOverlay.control('dismissCodingChange');
