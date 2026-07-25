const {
  SUPPORTED_PROTECTION_PLATFORMS,
  clampBoundsToDisplays,
  readStateFile,
  writeStateFileAtomic
} = require('./subtitle-overlay');
const {
  CHUNK_MODES,
  createTeleprompterState
} = require('./teleprompter');

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
  clickThroughHotkey: 'CommandOrControl+Shift+Z',
  moveHotkey: 'CommandOrControl+Shift+M',
  teleprompterEnabled: true,
  teleprompterFrozen: false,
  teleprompterChunkMode: 'medium',
  teleprompterShowKeywords: true,
  teleprompterShowPlan: true,
  teleprompterAutoStart: true,
  teleprompterNextHotkey: 'CommandOrControl+Shift+Right',
  teleprompterPreviousHotkey: 'CommandOrControl+Shift+Left',
  teleprompterFreezeHotkey: 'CommandOrControl+Shift+F',
  teleprompterLoadPendingHotkey: 'CommandOrControl+Shift+Enter'
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
  const chunkMode = String(settings.INTERVIEW_TELEPROMPTER_CHUNK_MODE ?? settings.teleprompterChunkMode ?? DEFAULT_ASSISTANT_SETTINGS.teleprompterChunkMode).trim().toLowerCase();
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
    clickThroughHotkey: String(settings.INTERVIEW_ASSISTANT_CLICK_THROUGH_HOTKEY ?? settings.clickThroughHotkey ?? DEFAULT_ASSISTANT_SETTINGS.clickThroughHotkey).trim() || DEFAULT_ASSISTANT_SETTINGS.clickThroughHotkey,
    moveHotkey: String(settings.INTERVIEW_ASSISTANT_MOVE_HOTKEY ?? settings.moveHotkey ?? DEFAULT_ASSISTANT_SETTINGS.moveHotkey).trim() || DEFAULT_ASSISTANT_SETTINGS.moveHotkey,
    teleprompterEnabled: boolValue(settings.INTERVIEW_TELEPROMPTER_ENABLED ?? settings.teleprompterEnabled, DEFAULT_ASSISTANT_SETTINGS.teleprompterEnabled),
    teleprompterFrozen: boolValue(settings.INTERVIEW_TELEPROMPTER_FROZEN ?? settings.teleprompterFrozen, DEFAULT_ASSISTANT_SETTINGS.teleprompterFrozen),
    teleprompterChunkMode: CHUNK_MODES.has(chunkMode) ? chunkMode : DEFAULT_ASSISTANT_SETTINGS.teleprompterChunkMode,
    teleprompterShowKeywords: boolValue(settings.INTERVIEW_TELEPROMPTER_SHOW_KEYWORDS ?? settings.teleprompterShowKeywords, DEFAULT_ASSISTANT_SETTINGS.teleprompterShowKeywords),
    teleprompterShowPlan: boolValue(settings.INTERVIEW_TELEPROMPTER_SHOW_PLAN ?? settings.teleprompterShowPlan, DEFAULT_ASSISTANT_SETTINGS.teleprompterShowPlan),
    teleprompterAutoStart: boolValue(settings.INTERVIEW_TELEPROMPTER_AUTO_START ?? settings.teleprompterAutoStart, DEFAULT_ASSISTANT_SETTINGS.teleprompterAutoStart),
    teleprompterNextHotkey: String(settings.INTERVIEW_TELEPROMPTER_NEXT_HOTKEY ?? settings.teleprompterNextHotkey ?? DEFAULT_ASSISTANT_SETTINGS.teleprompterNextHotkey).trim() || DEFAULT_ASSISTANT_SETTINGS.teleprompterNextHotkey,
    teleprompterPreviousHotkey: String(settings.INTERVIEW_TELEPROMPTER_PREVIOUS_HOTKEY ?? settings.teleprompterPreviousHotkey ?? DEFAULT_ASSISTANT_SETTINGS.teleprompterPreviousHotkey).trim() || DEFAULT_ASSISTANT_SETTINGS.teleprompterPreviousHotkey,
    teleprompterFreezeHotkey: String(settings.INTERVIEW_TELEPROMPTER_FREEZE_HOTKEY ?? settings.teleprompterFreezeHotkey ?? DEFAULT_ASSISTANT_SETTINGS.teleprompterFreezeHotkey).trim() || DEFAULT_ASSISTANT_SETTINGS.teleprompterFreezeHotkey,
    teleprompterLoadPendingHotkey: String(settings.INTERVIEW_TELEPROMPTER_LOAD_PENDING_HOTKEY ?? settings.teleprompterLoadPendingHotkey ?? DEFAULT_ASSISTANT_SETTINGS.teleprompterLoadPendingHotkey).trim() || DEFAULT_ASSISTANT_SETTINGS.teleprompterLoadPendingHotkey
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
  const responseType = source.responseType === 'coding_solution' ? 'coding_solution' : 'interview_answer';
  return {
    source: source.source === 'library' ? 'library' : 'ai',
    sourceEntryId: cleanText(source.sourceEntryId, 128),
    responseType,
    question: cleanText(source.question, 2400),
    firstSentence: cleanText(source.firstSentence, 2500),
    answer: cleanText(source.answer, 20_000),
    keyPoints: list(source.keyPoints, 8, 1000),
    keywords: list(source.keywords || source.keyPoints, 12, 300),
    basis: list(source.basis, 12, 1500),
    confidence,
    experienceGap: source.experienceGap === true,
    safeFallback: cleanText(source.safeFallback, 4000),
    approachSummary: cleanText(source.approachSummary, 5000),
    implementationPlan: list(source.implementationPlan, 10, 1200),
    codeLanguage: cleanText(source.codeLanguage, 80),
    code: cleanText(source.code, 30_000),
    codeWalkthrough: list(source.codeWalkthrough, 120, 1200),
    complexity: cleanText(source.complexity, 3000),
    edgeCases: list(source.edgeCases, 12, 1000),
    speakingNotes: list(source.speakingNotes, 16, 1000),
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
  let moveMode = false;
  const teleprompter = createTeleprompterState({
    enabled: settings.teleprompterEnabled,
    frozen: settings.teleprompterFrozen,
    chunkMode: settings.teleprompterChunkMode,
    showKeywords: settings.teleprompterShowKeywords,
    showPlan: settings.teleprompterShowPlan,
    autoStart: settings.teleprompterAutoStart
  });

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
      teleprompter: teleprompter.snapshot(),
      error,
      settings: { ...settings },
      moveMode,
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
          schemaVersion: 2,
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
      x: Math.round(area.x + area.width - Math.min(680, area.width) - 34),
      y: Math.round(area.y + 50),
      width: Math.min(680, area.width),
      height: Math.min(780, Math.max(460, area.height - 100))
    };
    return clampBoundsToDisplays(saved.bounds || fallback, screen.getAllDisplays(), primary);
  }
  function applyTeleprompterSettings() {
    teleprompter.updateSettings({
      enabled: settings.teleprompterEnabled,
      frozen: settings.teleprompterFrozen,
      chunkMode: settings.teleprompterChunkMode,
      showKeywords: settings.teleprompterShowKeywords,
      showPlan: settings.teleprompterShowPlan,
      autoStart: settings.teleprompterAutoStart
    });
  }
  function applyWindowSettings() {
    if (!assistantWindow || assistantWindow.isDestroyed()) return;
    try { assistantWindow.setAlwaysOnTop(settings.alwaysOnTop, 'floating'); } catch (_) {}
    try { assistantWindow.setContentProtection(settings.contentProtection); } catch (_) {}
    try { assistantWindow.setMovable(true); } catch (_) {}
    try { assistantWindow.setIgnoreMouseEvents(moveMode ? false : settings.clickThrough, { forward: true }); } catch (_) {}
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
    if (typeof assistantWindow.webContents.setWindowOpenHandler === 'function') {
      assistantWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    }
    if (typeof assistantWindow.webContents.on === 'function') {
      assistantWindow.webContents.on('will-navigate', (event, url) => {
        if (typeof assistantWindow.webContents.getURL === 'function' && url !== assistantWindow.webContents.getURL()) event.preventDefault();
      });
    }
    assistantWindow.loadFile(htmlPath);
    assistantWindow.on('move', persistBounds);
    assistantWindow.on('resize', persistBounds);
    assistantWindow.on('closed', () => { assistantWindow = null; moveMode = false; });
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
    moveMode = false;
    if (assistantWindow && !assistantWindow.isDestroyed()) { applyWindowSettings(); assistantWindow.hide(); }
    return { ok: true, ...snapshot() };
  }
  function toggle() { return snapshot().visible ? hide() : show(); }
  function clear() {
    status = 'idle'; question = null; suggestion = null; error = ''; teleprompter.clear(); sendState();
    return { ok: true, ...snapshot() };
  }
  function setQuestion(value) {
    const incoming = value ? { ...value, text: cleanText(value.text, 1600) } : null;
    if (!incoming) return snapshot();
    const tpBefore = teleprompter.snapshot();
    teleprompter.noteQuestion(incoming);
    if (tpBefore.frozen && tpBefore.current) {
      if (settings.enabled) show(); else sendState();
      return snapshot();
    }
    question = incoming;
    suggestion = null;
    error = '';
    status = 'question';
    if (settings.enabled) show(); else sendState();
    return snapshot();
  }
  function setAnalyzing(value = true) {
    const tp = teleprompter.snapshot();
    if (value && tp.frozen && tp.current && tp.pendingQuestion) {
      teleprompter.setPendingAnalyzing(true);
      error = '';
      sendState();
      return snapshot();
    }
    status = value ? 'analyzing' : (suggestion ? 'ready' : question ? 'question' : 'idle');
    error = '';
    sendState();
    return snapshot();
  }
  function setSuggestion(value) {
    const sanitized = sanitizeSuggestion(value);
    const result = teleprompter.loadSuggestion(sanitized, sanitized.question ? { text: sanitized.question } : question);
    if (result.disposition === 'pending') {
      status = suggestion ? 'ready' : 'question';
      error = '';
      if (settings.enabled) show(); else sendState();
      return snapshot();
    }
    suggestion = sanitized;
    if (sanitized.question) question = { ...(question || {}), text: sanitized.question };
    status = 'ready';
    error = '';
    if (settings.enabled) show(); else sendState();
    return snapshot();
  }
  function setError(value) {
    const tp = teleprompter.snapshot();
    if (tp.frozen && tp.current && tp.pendingQuestion) teleprompter.setPendingAnalyzing(false);
    status = 'error';
    error = cleanText(value, 3000);
    sendState();
    return snapshot();
  }
  function updateSettings(source = loadSettings()) {
    settings = normalizeAssistantSettings(source, platform);
    applyTeleprompterSettings();
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
  function setMoveMode(enabled) {
    moveMode = enabled === undefined ? !moveMode : !!enabled;
    const win = ensureWindow();
    try { win.setMovable(true); } catch (_) {}
    applyWindowSettings();
    if (moveMode) {
      try { win.show(); win.focus(); } catch (_) {}
    }
    sendState();
    return { ok: true, ...snapshot() };
  }
  function setFrozen(enabled) {
    settings = { ...settings, teleprompterFrozen: !!enabled };
    const result = teleprompter.setFrozen(!!enabled);
    if (result.loadedPending && result.current) {
      question = result.current.question ? { ...result.current.question } : question;
      suggestion = result.current.suggestion ? { ...result.current.suggestion } : suggestion;
      status = suggestion ? 'ready' : question ? 'question' : 'idle';
      error = '';
    }
    if (typeof saveSettings === 'function') saveSettings({ INTERVIEW_TELEPROMPTER_FROZEN: settings.teleprompterFrozen ? 'true' : 'false' });
    sendState();
    return { ok: true, ...snapshot() };
  }
  function nextChunk() { teleprompter.nextChunk(); sendState(); return { ok: true, ...snapshot() }; }
  function previousChunk() { teleprompter.previousChunk(); sendState(); return { ok: true, ...snapshot() }; }
  function firstChunk() { teleprompter.firstChunk(); sendState(); return { ok: true, ...snapshot() }; }
  function loadPending() {
    const result = teleprompter.loadPending();
    if (result.loaded && result.current) {
      question = result.current.question ? { ...result.current.question } : question;
      suggestion = result.current.suggestion ? { ...result.current.suggestion } : suggestion;
      status = suggestion ? 'ready' : question ? 'question' : 'idle';
      error = '';
    }
    sendState();
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
    register(settings.moveHotkey, () => setMoveMode());
    register(settings.teleprompterNextHotkey, nextChunk);
    register(settings.teleprompterPreviousHotkey, previousChunk);
    register(settings.teleprompterFreezeHotkey, () => setFrozen(!teleprompter.snapshot().frozen));
    register(settings.teleprompterLoadPendingHotkey, loadPending);
  }
  function rehome() {
    if (!assistantWindow || assistantWindow.isDestroyed()) return snapshot();
    assistantWindow.setBounds(clampBoundsToDisplays(assistantWindow.getNormalBounds(), screen.getAllDisplays(), screen.getPrimaryDisplay()));
    return snapshot();
  }
  function initialize() {
    settings = normalizeAssistantSettings(loadSettings(), platform);
    applyTeleprompterSettings();
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
    moveMode = false;
  }
  return {
    initialize, ensureWindow, show, hide, toggle, clear, setQuestion, setAnalyzing, setSuggestion,
    setError, updateSettings, setClickThrough, setMoveMode, setFrozen, nextChunk, previousChunk, firstChunk,
    loadPending, rehome, snapshot, destroy, getWindow: () => assistantWindow
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
