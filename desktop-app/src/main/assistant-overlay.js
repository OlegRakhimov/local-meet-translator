const {
  SUPPORTED_PROTECTION_PLATFORMS,
  clampBoundsToDisplays,
  readStateFile,
  writeStateFileAtomic
} = require('./subtitle-overlay');

const DEFAULT_ASSISTANT_SETTINGS = Object.freeze({
  enabled: true,
  autoAnalyze: false,
  contentProtection: true,
  alwaysOnTop: true,
  clickThrough: false,
  fontSize: 20,
  backgroundOpacity: 0.94,
  languageLevel: 'B1',
  answerStyle: 'simple',
  toggleHotkey: 'CommandOrControl+Shift+A',
  clickThroughHotkey: 'CommandOrControl+Shift+Z'
});

const LEVELS = new Set(['A2', 'B1', 'B2']);
const STYLES = new Set(['simple', 'technical', 'star', 'general']);

function boolValue(value, fallback) {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return fallback;
}
function boundedInteger(value, fallback, min, max) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, parsed)) : fallback;
}
function boundedFloat(value, fallback, min, max) {
  const parsed = Number.parseFloat(String(value ?? ''));
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, parsed)) : fallback;
}
function normalizeAssistantSettings(settings = {}, platform = process.platform) {
  const contentProtectionDefault = SUPPORTED_PROTECTION_PLATFORMS.has(platform);
  const level = String(settings.INTERVIEW_ASSISTANT_LANGUAGE_LEVEL ?? settings.languageLevel ?? DEFAULT_ASSISTANT_SETTINGS.languageLevel).trim().toUpperCase();
  const style = String(settings.INTERVIEW_ASSISTANT_ANSWER_STYLE ?? settings.answerStyle ?? DEFAULT_ASSISTANT_SETTINGS.answerStyle).trim().toLowerCase();
  return {
    enabled: boolValue(settings.INTERVIEW_ASSISTANT_ENABLED ?? settings.enabled, DEFAULT_ASSISTANT_SETTINGS.enabled),
    autoAnalyze: boolValue(settings.INTERVIEW_ASSISTANT_AUTO_ANALYZE ?? settings.autoAnalyze, DEFAULT_ASSISTANT_SETTINGS.autoAnalyze),
    contentProtection: boolValue(settings.INTERVIEW_ASSISTANT_CONTENT_PROTECTION ?? settings.contentProtection, contentProtectionDefault),
    alwaysOnTop: boolValue(settings.INTERVIEW_ASSISTANT_ALWAYS_ON_TOP ?? settings.alwaysOnTop, DEFAULT_ASSISTANT_SETTINGS.alwaysOnTop),
    clickThrough: boolValue(settings.INTERVIEW_ASSISTANT_CLICK_THROUGH ?? settings.clickThrough, DEFAULT_ASSISTANT_SETTINGS.clickThrough),
    fontSize: boundedInteger(settings.INTERVIEW_ASSISTANT_FONT_SIZE ?? settings.fontSize, DEFAULT_ASSISTANT_SETTINGS.fontSize, 14, 36),
    backgroundOpacity: boundedFloat(settings.INTERVIEW_ASSISTANT_BACKGROUND_OPACITY ?? settings.backgroundOpacity, DEFAULT_ASSISTANT_SETTINGS.backgroundOpacity, 0.5, 1),
    languageLevel: LEVELS.has(level) ? level : DEFAULT_ASSISTANT_SETTINGS.languageLevel,
    answerStyle: STYLES.has(style) ? style : DEFAULT_ASSISTANT_SETTINGS.answerStyle,
    toggleHotkey: String(settings.INTERVIEW_ASSISTANT_HOTKEY ?? settings.toggleHotkey ?? DEFAULT_ASSISTANT_SETTINGS.toggleHotkey).trim() || DEFAULT_ASSISTANT_SETTINGS.toggleHotkey,
    clickThroughHotkey: String(settings.INTERVIEW_ASSISTANT_CLICK_THROUGH_HOTKEY ?? settings.clickThroughHotkey ?? DEFAULT_ASSISTANT_SETTINGS.clickThroughHotkey).trim() || DEFAULT_ASSISTANT_SETTINGS.clickThroughHotkey
  };
}

function cleanText(value, maxLength = 20_000) {
  return String(value ?? '').replace(/\u0000/g, '').replace(/\r\n?/g, '\n').trim().slice(0, maxLength);
}
function sanitizeSuggestion(input = {}) {
  const source = input && typeof input === 'object' ? input : {};
  const list = (value, maxItems, maxLength) => (Array.isArray(value) ? value : [])
    .map(item => cleanText(item, maxLength))
    .filter(Boolean)
    .slice(0, maxItems);
  const confidence = ['high', 'medium', 'low'].includes(source.confidence) ? source.confidence : 'low';
  return {
    source: source.source === 'library' ? 'library' : 'ai',
    sourceEntryId: cleanText(source.sourceEntryId, 128),
    question: cleanText(source.question, 1600),
    firstSentence: cleanText(source.firstSentence, 2500),
    answer: cleanText(source.answer, 16_000),
    keyPoints: list(source.keyPoints, 8, 1000),
    basis: list(source.basis, 12, 1500),
    confidence,
    experienceGap: source.experienceGap === true,
    safeFallback: cleanText(source.safeFallback, 4000),
    score: Number.isFinite(Number(source.score)) ? Number(source.score) : null
  };
}

function createAssistantOverlayController({
  BrowserWindow,
  screen,
  globalShortcut,
  preloadPath,
  htmlPath,
  statePath,
  loadSettings,
  saveSettings,
  sendLog = () => {},
  platform = process.platform
}) {
  let assistantWindow = null;
  let settings = normalizeAssistantSettings(loadSettings(), platform);
  let status = 'idle';
  let question = null;
  let suggestion = null;
  let error = '';
  let saveTimer = null;
  let registeredShortcuts = [];

  function protectionState() {
    const supported = SUPPORTED_PROTECTION_PLATFORMS.has(platform);
    let applied = false;
    try {
      applied = !!(supported && assistantWindow && !assistantWindow.isDestroyed() && assistantWindow.isContentProtected());
    } catch (_) {}
    return { requested: settings.contentProtection, supported, applied, platform };
  }
  function snapshot() {
    return {
      visible: !!(assistantWindow && !assistantWindow.isDestroyed() && assistantWindow.isVisible()),
      status,
      question: question ? { ...question } : null,
      suggestion: suggestion ? { ...suggestion } : null,
      error,
      settings: { ...settings },
      protection: protectionState()
    };
  }
  function sendState() {
    try {
      if (assistantWindow && !assistantWindow.isDestroyed() && !assistantWindow.webContents.isDestroyed()) {
        assistantWindow.webContents.send('assistant-overlay:state', snapshot());
      }
    } catch (_) {}
  }
  function persistBounds() {
    if (!assistantWindow || assistantWindow.isDestroyed()) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try {
        writeStateFileAtomic(statePath, {
          schemaVersion: 1,
          bounds: assistantWindow.getNormalBounds(),
          updatedAt: new Date().toISOString()
        });
      } catch (cause) {
        sendLog(`Assistant window position could not be saved: ${cause.message}`);
      }
    }, 250);
  }
  function initialBounds() {
    const saved = readStateFile(statePath);
    const primary = screen.getPrimaryDisplay();
    const area = primary.workArea;
    const fallback = {
      x: Math.round(area.x + area.width - Math.min(620, area.width) - 34),
      y: Math.round(area.y + 70),
      width: Math.min(620, area.width),
      height: Math.min(720, Math.max(420, area.height - 140))
    };
    return clampBoundsToDisplays(saved.bounds || fallback, screen.getAllDisplays(), primary);
  }
  function applyWindowSettings() {
    if (!assistantWindow || assistantWindow.isDestroyed()) return;
    try { assistantWindow.setAlwaysOnTop(settings.alwaysOnTop, 'floating'); } catch (_) {}
    try { assistantWindow.setContentProtection(settings.contentProtection); } catch (_) {}
    try { assistantWindow.setIgnoreMouseEvents(settings.clickThrough, { forward: true }); } catch (_) {}
    try { assistantWindow.setOpacity(settings.backgroundOpacity); } catch (_) {}
    sendState();
  }
  function ensureWindow() {
    if (assistantWindow && !assistantWindow.isDestroyed()) return assistantWindow;
    assistantWindow = new BrowserWindow({
      ...initialBounds(),
      show: false,
      frame: false,
      transparent: false,
      backgroundColor: '#0b1220',
      title: 'Local Meet Translator — Interview Assistant',
      skipTaskbar: false,
      resizable: true,
      minimizable: true,
      maximizable: false,
      webPreferences: {
        preload: preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true
      }
    });
    applyWindowSettings();
    assistantWindow.loadFile(htmlPath);
    assistantWindow.on('move', persistBounds);
    assistantWindow.on('resize', persistBounds);
    assistantWindow.on('closed', () => { assistantWindow = null; });
    assistantWindow.webContents.on('did-finish-load', sendState);
    return assistantWindow;
  }
  function show() {
    if (!settings.enabled) return { ok: false, message: 'Interview assistant is disabled.', ...snapshot() };
    const win = ensureWindow();
    if (typeof win.showInactive === 'function') win.showInactive(); else win.show();
    sendState();
    return { ok: true, ...snapshot() };
  }
  function hide() {
    if (assistantWindow && !assistantWindow.isDestroyed()) assistantWindow.hide();
    return { ok: true, ...snapshot() };
  }
  function toggle() {
    return snapshot().visible ? hide() : show();
  }
  function clear() {
    status = 'idle'; question = null; suggestion = null; error = ''; sendState();
    return { ok: true, ...snapshot() };
  }
  function setQuestion(value) {
    question = value ? { ...value, text: cleanText(value.text, 1600) } : null;
    suggestion = null;
    error = '';
    status = question ? 'question' : 'idle';
    if (settings.enabled) show(); else sendState();
    return snapshot();
  }
  function setAnalyzing(value = true) {
    status = value ? 'analyzing' : (suggestion ? 'ready' : question ? 'question' : 'idle');
    error = '';
    sendState();
    return snapshot();
  }
  function setSuggestion(value) {
    suggestion = sanitizeSuggestion(value);
    status = 'ready';
    error = '';
    if (settings.enabled) show(); else sendState();
    return snapshot();
  }
  function setError(value) {
    status = 'error';
    error = cleanText(value, 3000);
    sendState();
    return snapshot();
  }
  function updateSettings(source = loadSettings()) {
    settings = normalizeAssistantSettings(source, platform);
    applyWindowSettings();
    registerShortcuts();
    if (!settings.enabled) hide();
    return snapshot();
  }
  function setClickThrough(enabled) {
    settings = { ...settings, clickThrough: !!enabled };
    if (typeof saveSettings === 'function') saveSettings({ INTERVIEW_ASSISTANT_CLICK_THROUGH: settings.clickThrough ? 'true' : 'false' });
    applyWindowSettings();
    return { ok: true, ...snapshot() };
  }
  function unregisterShortcuts() {
    for (const accelerator of registeredShortcuts) {
      try { globalShortcut.unregister(accelerator); } catch (_) {}
    }
    registeredShortcuts = [];
  }
  function registerShortcuts() {
    unregisterShortcuts();
    if (!globalShortcut) return;
    const register = (accelerator, handler) => {
      if (!accelerator) return;
      try {
        if (globalShortcut.register(accelerator, handler)) registeredShortcuts.push(accelerator);
      } catch (cause) { sendLog(`Assistant hotkey ${accelerator} could not be registered: ${cause.message}`); }
    };
    register(settings.toggleHotkey, toggle);
    register(settings.clickThroughHotkey, () => setClickThrough(!settings.clickThrough));
  }
  function rehome() {
    if (!assistantWindow || assistantWindow.isDestroyed()) return snapshot();
    assistantWindow.setBounds(clampBoundsToDisplays(assistantWindow.getNormalBounds(), screen.getAllDisplays(), screen.getPrimaryDisplay()));
    return snapshot();
  }
  function initialize() {
    settings = normalizeAssistantSettings(loadSettings(), platform);
    registerShortcuts();
    screen.on('display-removed', rehome);
    screen.on('display-metrics-changed', rehome);
    return snapshot();
  }
  function destroy() {
    clearTimeout(saveTimer);
    unregisterShortcuts();
    try { if (assistantWindow && !assistantWindow.isDestroyed()) assistantWindow.destroy(); } catch (_) {}
    assistantWindow = null;
  }
  return {
    initialize, ensureWindow, show, hide, toggle, clear, setQuestion, setAnalyzing, setSuggestion,
    setError, updateSettings, setClickThrough, rehome, snapshot, destroy, getWindow: () => assistantWindow
  };
}

module.exports = {
  DEFAULT_ASSISTANT_SETTINGS,
  LEVELS,
  STYLES,
  normalizeAssistantSettings,
  sanitizeSuggestion,
  createAssistantOverlayController
};
