const $ = id => document.getElementById(id);
function text(id, value) { const el = $(id); if (el) el.textContent = value || ''; }
function renderList(id, items) {
  const el = $(id); if (!el) return;
  el.innerHTML = '';
  for (const item of Array.isArray(items) ? items : []) {
    const li = document.createElement('li'); li.textContent = item; el.appendChild(li);
  }
}
function render(state = {}) {
  const root = $('assistantRoot');
  root.className = `assistantRoot ${state.status || 'idle'}`;
  root.style.setProperty('--assistant-font-size', `${state.settings?.fontSize || 20}px`);
  text('questionText', state.question?.text || 'Waiting for an interview question…');
  const suggestion = state.suggestion;
  $('suggestionBlock').hidden = !suggestion;
  $('emptyState').hidden = !!suggestion || state.status === 'analyzing' || state.status === 'error';
  $('errorState').hidden = state.status !== 'error';
  text('errorState', state.error || 'The suggestion could not be prepared.');
  const statuses = { idle: 'Waiting', question: 'Question detected', analyzing: 'Analyzing…', ready: 'Ready', error: 'Error' };
  text('statusBadge', statuses[state.status] || state.status || 'Waiting');
  if (!suggestion) return;
  text('sourceBadge', suggestion.source === 'library' ? 'ANSWER LIBRARY' : 'AI GROUNDED');
  text('confidenceBadge', `${String(suggestion.confidence || 'low').toUpperCase()} CONFIDENCE`);
  text('firstSentence', suggestion.firstSentence);
  text('answerText', suggestion.answer);
  text('fallbackText', suggestion.safeFallback);
  $('fallbackBlock').hidden = !suggestion.safeFallback;
  renderList('keyPoints', suggestion.keyPoints);
  renderList('basis', suggestion.basis);
}
window.lmtAssistantOverlay.onState(render);

$('hideAssistantOverlay').onclick = () => window.lmtAssistantOverlay.hide();
