const $ = id => document.getElementById(id);
let latestState = {};

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
function render(state = {}) {
  latestState = state || {};
  const root = $('assistantRoot');
  root.className = `assistantRoot ${state.status || 'idle'}${state.moveMode ? ' moveMode' : ''}`;
  root.style.setProperty('--assistant-font-size', `${state.settings?.fontSize || 20}px`);
  text('questionText', state.question?.text || 'Waiting for an interview question…');

  const teleprompter = state.teleprompter || {};
  const current = teleprompter.current || null;
  const document = current?.document || null;
  const suggestion = state.suggestion || current?.suggestion || null;
  const hasSuggestion = !!suggestion;
  $('suggestionBlock').hidden = !hasSuggestion;
  $('emptyState').hidden = hasSuggestion || state.status === 'analyzing' || state.status === 'error';
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
  $('pendingBlock').hidden = !pendingQuestion;
  text('pendingQuestionText', pendingQuestion);
  text('loadPendingAnswer', teleprompter.pendingAnalyzing ? 'Analyzing pending…' : 'Load pending');
  $('loadPendingAnswer').disabled = !teleprompter.pending;

  if (!hasSuggestion) return;

  text('sourceBadge', suggestion.source === 'library' ? 'ANSWER LIBRARY' : 'AI GROUNDED');
  text('confidenceBadge', `${String(suggestion.confidence || 'low').toUpperCase()} CONFIDENCE`);
  text('firstSentence', document?.firstSentence || suggestion.firstSentence);
  text('answerText', suggestion.answer);
  text('fallbackText', suggestion.safeFallback);
  $('fallbackBlock').hidden = !suggestion.safeFallback;
  renderList('keyPoints', suggestion.keyPoints);
  renderList('basis', suggestion.basis);

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
