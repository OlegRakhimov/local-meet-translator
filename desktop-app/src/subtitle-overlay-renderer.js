const elements = {
  lines: document.getElementById('lines'),
  statusDot: document.getElementById('statusDot'),
  statusText: document.getElementById('statusText'),
  titleText: document.getElementById('titleText'),
  waitingText: document.getElementById('waitingText'),
  protectionFooter: document.getElementById('protectionFooter'),
  pauseButton: document.getElementById('pauseButton'),
  clearButton: document.getElementById('clearButton'),
  clickThroughButton: document.getElementById('clickThroughButton'),
  hideButton: document.getElementById('hideButton')
};

const language = String(navigator.language || 'en').toLowerCase().startsWith('ru') ? 'ru' : 'en';
const text = language === 'ru'
  ? {
      title: 'Локальные субтитры', waiting: 'Ожидаю речь…', idle: 'Ожидание', listening: 'Слушаю',
      transcribing: 'Распознаю', paused: 'Пауза', error: 'Ошибка', protected: 'Защита от захвата включена',
      unprotected: 'Защита от захвата выключена', unsupported: 'Защита от захвата не поддерживается',
      outgoing: 'Вы'
    }
  : {
      title: 'Local subtitles', waiting: 'Waiting for speech…', idle: 'Idle', listening: 'Listening',
      transcribing: 'Transcribing', paused: 'Paused', error: 'Error', protected: 'Capture protection enabled',
      unprotected: 'Capture protection disabled', unsupported: 'Capture protection unsupported',
      outgoing: 'You'
    };

let state = {
  visible: true,
  paused: false,
  status: 'idle',
  settings: { showOriginal: true, showTranslation: true, fontSize: 28, backgroundOpacity: .82, maxLines: 3, clickThrough: false },
  protection: { supported: false, applied: false },
  history: []
};
let history = [];

function statusLabel(status) {
  return text[status] || status || text.idle;
}

function renderProtection() {
  const protection = state.protection || {};
  if (!protection.supported) elements.protectionFooter.textContent = text.unsupported;
  else if (protection.applied) elements.protectionFooter.textContent = text.protected;
  else elements.protectionFooter.textContent = text.unprotected;
}

function renderState() {
  const settings = state.settings || {};
  document.documentElement.style.setProperty('--subtitle-font-size', `${Number(settings.fontSize || 28)}px`);
  document.documentElement.style.setProperty('--subtitle-background-opacity', String(Number(settings.backgroundOpacity || .82)));
  document.body.classList.toggle('clickThrough', !!settings.clickThrough);
  elements.titleText.textContent = text.title;
  elements.statusText.textContent = statusLabel(state.paused ? 'paused' : state.status);
  elements.statusDot.className = `statusDot ${state.paused ? 'paused' : (state.status || 'idle')}`;
  elements.pauseButton.textContent = state.paused ? '▶' : 'Ⅱ';
  elements.pauseButton.title = state.paused ? (language === 'ru' ? 'Продолжить' : 'Resume') : (language === 'ru' ? 'Пауза' : 'Pause');
  elements.clickThroughButton.title = settings.clickThrough
    ? (language === 'ru' ? 'Отключить пропуск кликов (Ctrl+Shift+X)' : 'Disable click-through (Ctrl+Shift+X)')
    : (language === 'ru' ? 'Пропускать клики сквозь окно' : 'Enable click-through');
  renderProtection();
  renderHistory();
}

function renderHistory() {
  const settings = state.settings || {};
  const maxLines = Math.max(1, Number(settings.maxLines || 3));
  const visibleItems = history
    .filter(item => item && (item.translation || item.transcript))
    .slice(-maxLines);
  elements.lines.replaceChildren();

  if (!visibleItems.length) {
    const article = document.createElement('article');
    article.className = 'placeholder';
    const waiting = document.createElement('div');
    waiting.className = 'translation';
    waiting.textContent = text.waiting;
    article.appendChild(waiting);
    elements.lines.appendChild(article);
    return;
  }

  for (const item of visibleItems) {
    const article = document.createElement('article');
    article.className = `subtitleLine ${item.channel === 'outgoing' ? 'outgoing' : 'incoming'}`;
    const translation = document.createElement('div');
    translation.className = 'translation';
    const translatedText = item.channel === 'outgoing' && item.translation ? `${text.outgoing}: ${item.translation}` : item.translation;
    translation.textContent = settings.showTranslation !== false ? (translatedText || item.transcript || '—') : (item.transcript || '—');
    article.appendChild(translation);

    if (settings.showOriginal !== false && item.transcript && (settings.showTranslation === false || item.transcript !== item.translation)) {
      const original = document.createElement('div');
      original.className = 'original';
      original.textContent = item.transcript;
      article.appendChild(original);
    }
    elements.lines.appendChild(article);
  }
}

function applySnapshot(next) {
  state = next || state;
  history = Array.isArray(state.history) ? state.history.slice() : history;
  renderState();
}

window.lmtSubtitle.onState(applySnapshot);
window.lmtSubtitle.onEvent((item) => {
  history.push(item);
  if (history.length > 50) history = history.slice(-50);
  renderHistory();
});
window.lmtSubtitle.onClear(() => {
  history = [];
  renderHistory();
});

elements.pauseButton.addEventListener('click', async () => {
  applySnapshot(await window.lmtSubtitle.control('pause', { paused: !state.paused }));
});
elements.clearButton.addEventListener('click', async () => {
  applySnapshot(await window.lmtSubtitle.control('clear'));
});
elements.clickThroughButton.addEventListener('click', async () => {
  applySnapshot(await window.lmtSubtitle.control('clickThrough', { enabled: !(state.settings && state.settings.clickThrough) }));
});
elements.hideButton.addEventListener('click', async () => {
  await window.lmtSubtitle.control('hide');
});

window.addEventListener('DOMContentLoaded', async () => {
  applySnapshot(await window.lmtSubtitle.status());
});
