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
const { createCodingFocusState } = require('./coding-focus-state');
const { isExamComplianceModeEnabled } = require('./compliance-mode');
const { normalizeInterviewProfileMode } = require('./interview-profile-mode');

const DEFAULT_ASSISTANT_SETTINGS = Object.freeze({
  enabled: true,
  profileMode: 'general',
  autoAnalyze: true,
  contentProtection: true,
  alwaysOnTop: true,
  clickThrough: false,
  compactOverlay: true,
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
const ASSISTANT_WINDOW = Object.freeze({
  minWidth: 520,
  minHeight: 500,
  compactWidth: 760,
  compactHeight: 820,
  regularWidth: 840,
  regularHeight: 900,
  widthStep: 100,
  heightStep: 80,
  displayMargin: 24
});

const ASSISTANT_MODES = Object.freeze({
  WAITING: 'WAITING',
  ANSWERING: 'ANSWERING',
  NEXT_QUESTION_READY: 'NEXT_QUESTION_READY',
  CODING: 'CODING',
  CODING_CHANGE_READY: 'CODING_CHANGE_READY',
  NEW_CODING_TASK_READY: 'NEW_CODING_TASK_READY'
});

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
  const complianceMode = isExamComplianceModeEnabled(settings);
  const enabled = complianceMode ? false : boolValue(settings.INTERVIEW_ASSISTANT_ENABLED ?? settings.enabled, DEFAULT_ASSISTANT_SETTINGS.enabled);
  const autoAnalyzeRequested = boolValue(settings.INTERVIEW_ASSISTANT_AUTO_ANALYZE ?? settings.autoAnalyze, DEFAULT_ASSISTANT_SETTINGS.autoAnalyze);
  return {
    complianceMode,
    enabled,
    profileMode: normalizeInterviewProfileMode(settings.INTERVIEW_ASSISTANT_PROFILE_MODE ?? settings.profileMode ?? DEFAULT_ASSISTANT_SETTINGS.profileMode),
    autoAnalyze: enabled && (autoAnalyzeRequested || DEFAULT_ASSISTANT_SETTINGS.autoAnalyze),
    contentProtection: complianceMode ? false : boolValue(settings.INTERVIEW_ASSISTANT_CONTENT_PROTECTION ?? settings.contentProtection, contentProtectionDefault),
    alwaysOnTop: boolValue(settings.INTERVIEW_ASSISTANT_ALWAYS_ON_TOP ?? settings.alwaysOnTop, DEFAULT_ASSISTANT_SETTINGS.alwaysOnTop),
    clickThrough: boolValue(settings.INTERVIEW_ASSISTANT_CLICK_THROUGH ?? settings.clickThrough, DEFAULT_ASSISTANT_SETTINGS.clickThrough),
    compactOverlay: boolValue(settings.INTERVIEW_ASSISTANT_COMPACT_OVERLAY ?? settings.compactOverlay, DEFAULT_ASSISTANT_SETTINGS.compactOverlay),
    fontSize: boundedInteger(settings.INTERVIEW_ASSISTANT_FONT_SIZE ?? settings.fontSize, DEFAULT_ASSISTANT_SETTINGS.fontSize, 14, 36),
    backgroundOpacity: boundedFloat(settings.INTERVIEW_ASSISTANT_BACKGROUND_OPACITY ?? settings.backgroundOpacity, DEFAULT_ASSISTANT_SETTINGS.backgroundOpacity, 0.15, 1),
    languageLevel: LEVELS.has(level) ? level : DEFAULT_ASSISTANT_SETTINGS.languageLevel,
    answerStyle: STYLES.has(style) ? style : DEFAULT_ASSISTANT_SETTINGS.answerStyle,
    toggleHotkey: String(settings.INTERVIEW_ASSISTANT_HOTKEY ?? settings.toggleHotkey ?? DEFAULT_ASSISTANT_SETTINGS.toggleHotkey).trim() || DEFAULT_ASSISTANT_SETTINGS.toggleHotkey,
    clickThroughHotkey: String(settings.INTERVIEW_ASSISTANT_CLICK_THROUGH_HOTKEY ?? settings.clickThroughHotkey ?? DEFAULT_ASSISTANT_SETTINGS.clickThroughHotkey).trim() || DEFAULT_ASSISTANT_SETTINGS.clickThroughHotkey,
    moveHotkey: String(settings.INTERVIEW_ASSISTANT_MOVE_HOTKEY ?? settings.moveHotkey ?? DEFAULT_ASSISTANT_SETTINGS.moveHotkey).trim() || DEFAULT_ASSISTANT_SETTINGS.moveHotkey,
    teleprompterEnabled: complianceMode ? false : boolValue(settings.INTERVIEW_TELEPROMPTER_ENABLED ?? settings.teleprompterEnabled, DEFAULT_ASSISTANT_SETTINGS.teleprompterEnabled),
    teleprompterFrozen: boolValue(settings.INTERVIEW_TELEPROMPTER_FROZEN ?? settings.teleprompterFrozen, DEFAULT_ASSISTANT_SETTINGS.teleprompterFrozen),
    teleprompterChunkMode: CHUNK_MODES.has(chunkMode) ? chunkMode : DEFAULT_ASSISTANT_SETTINGS.teleprompterChunkMode,
    teleprompterShowKeywords: boolValue(settings.INTERVIEW_TELEPROMPTER_SHOW_KEYWORDS ?? settings.teleprompterShowKeywords, DEFAULT_ASSISTANT_SETTINGS.teleprompterShowKeywords),
    teleprompterShowPlan: boolValue(settings.INTERVIEW_TELEPROMPTER_SHOW_PLAN ?? settings.teleprompterShowPlan, DEFAULT_ASSISTANT_SETTINGS.teleprompterShowPlan),
    teleprompterAutoStart: complianceMode ? false : boolValue(settings.INTERVIEW_TELEPROMPTER_AUTO_START ?? settings.teleprompterAutoStart, DEFAULT_ASSISTANT_SETTINGS.teleprompterAutoStart),
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
  let pendingError = '';
  let sessionSave = { status: 'idle', message: '' };
  let librarySave = { status: 'idle', message: '' };
  let utteranceFeed = [];
  let saveTimer = null;
  let registeredShortcuts = [];
  let moveMode = false;
  const codingFocus = createCodingFocusState();
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
  function currentMode() {
    const focus = codingFocus.snapshot();
    const tp = teleprompter.snapshot();
    if (focus.pendingTask?.text) return ASSISTANT_MODES.NEW_CODING_TASK_READY;
    if (focus.pendingChange?.classification) return ASSISTANT_MODES.CODING_CHANGE_READY;
    if (focus.active) return ASSISTANT_MODES.CODING;
    if (tp.pending) return ASSISTANT_MODES.NEXT_QUESTION_READY;
    if (tp.current || suggestion) return ASSISTANT_MODES.ANSWERING;
    return ASSISTANT_MODES.WAITING;
  }
  function snapshot() {
    return {
      visible: !!(assistantWindow && !assistantWindow.isDestroyed() && assistantWindow.isVisible()),
      status,
      mode: currentMode(),
      question: question ? { ...question } : null,
      suggestion: suggestion ? { ...suggestion } : null,
      teleprompter: teleprompter.snapshot(),
      codingFocus: codingFocus.snapshot(),
      utteranceFeed: utteranceFeed.map(item => ({ ...item })),
      sessionSave: { ...sessionSave },
      librarySave: { ...librarySave },
      error,
      pendingError,
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
          schemaVersion: 3,
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
    const preferredWidth = settings.compactOverlay ? ASSISTANT_WINDOW.compactWidth : ASSISTANT_WINDOW.regularWidth;
    const preferredHeight = settings.compactOverlay ? ASSISTANT_WINDOW.compactHeight : ASSISTANT_WINDOW.regularHeight;
    const maxWidth = Math.max(ASSISTANT_WINDOW.minWidth, area.width - ASSISTANT_WINDOW.displayMargin);
    const maxHeight = Math.max(ASSISTANT_WINDOW.minHeight, area.height - ASSISTANT_WINDOW.displayMargin);
    const fallback = {
      x: Math.round(area.x + area.width - Math.min(preferredWidth, maxWidth) - 34),
      y: Math.round(area.y + 50),
      width: Math.min(preferredWidth, maxWidth),
      height: Math.min(preferredHeight, maxHeight)
    };
    const rawSavedBounds = saved.bounds && typeof saved.bounds === 'object' ? saved.bounds : null;
    const savedBounds = rawSavedBounds
      ? {
          ...rawSavedBounds,
          width: Number(saved.schemaVersion || 0) >= 3
            ? Number(rawSavedBounds.width || preferredWidth)
            : Math.max(Number(rawSavedBounds.width || 0), preferredWidth),
          height: Number(saved.schemaVersion || 0) >= 3
            ? Number(rawSavedBounds.height || preferredHeight)
            : Math.max(Number(rawSavedBounds.height || 0), preferredHeight)
        }
      : null;
    return clampBoundsToDisplays(savedBounds || fallback, screen.getAllDisplays(), primary);
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
    // Keep text fully opaque. Only the CSS panels use the configured background alpha.
    try { assistantWindow.setOpacity(1); } catch (_) {}
    sendState();
  }
  function ensureWindow() {
    if (assistantWindow && !assistantWindow.isDestroyed()) return assistantWindow;
    assistantWindow = new BrowserWindow({
      ...initialBounds(),
      show: false,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      title: 'Local Meet Translator — Interview Assistant',
      skipTaskbar: false,
      resizable: true,
      minWidth: ASSISTANT_WINDOW.minWidth,
      minHeight: ASSISTANT_WINDOW.minHeight,
      thickFrame: true,
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
  function resizeWindow(direction) {
    const win = ensureWindow();
    const delta = Number(direction) >= 0 ? 1 : -1;
    const current = win.getNormalBounds();
    const display = typeof screen.getDisplayMatching === 'function'
      ? screen.getDisplayMatching(current)
      : screen.getPrimaryDisplay();
    const area = display?.workArea || screen.getPrimaryDisplay().workArea;
    const maxWidth = Math.max(ASSISTANT_WINDOW.minWidth, area.width - ASSISTANT_WINDOW.displayMargin);
    const maxHeight = Math.max(ASSISTANT_WINDOW.minHeight, area.height - ASSISTANT_WINDOW.displayMargin);
    const width = Math.max(ASSISTANT_WINDOW.minWidth, Math.min(maxWidth, current.width + delta * ASSISTANT_WINDOW.widthStep));
    const height = Math.max(ASSISTANT_WINDOW.minHeight, Math.min(maxHeight, current.height + delta * ASSISTANT_WINDOW.heightStep));
    const next = clampBoundsToDisplays({
      ...current,
      x: current.x + Math.round((current.width - width) / 2),
      y: current.y + Math.round((current.height - height) / 2),
      width,
      height
    }, screen.getAllDisplays(), display || screen.getPrimaryDisplay());
    win.setBounds(next);
    persistBounds();
    sendState();
    return { ok: true, bounds: win.getNormalBounds(), ...snapshot() };
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
    status = 'idle'; question = null; suggestion = null; error = ''; pendingError = '';
    sessionSave = { status: 'idle', message: '' };
    librarySave = { status: 'idle', message: '' };
    utteranceFeed = [];
    teleprompter.clear();
    codingFocus.stop();
    sendState();
    return { ok: true, ...snapshot() };
  }
  function finishAnswer() {
    const codingActive = codingFocus.snapshot().active;
    teleprompter.finishCurrent();
    error = '';
    pendingError = '';
    librarySave = { status: 'idle', message: '' };
    if (!codingActive) {
      question = null;
      suggestion = null;
      status = 'idle';
    } else {
      question = codingFocus.snapshot().task || question;
      status = suggestion ? 'ready' : 'question';
    }
    if (settings.enabled) show(); else sendState();
    return { ok: true, ...snapshot() };
  }
  function finishCodingTask() {
    status = 'idle'; question = null; suggestion = null; error = ''; pendingError = '';
    librarySave = { status: 'idle', message: '' };
    teleprompter.clear();
    codingFocus.stop();
    if (settings.enabled) show(); else sendState();
    return { ok: true, ...snapshot() };
  }
  function setQuestion(value) {
    const incoming = value ? { ...value, text: cleanText(value.text, 1600) } : null;
    if (!incoming) return snapshot();
    const tpBefore = teleprompter.snapshot();
    teleprompter.noteQuestion(incoming);
    if ((tpBefore.answerLocked || tpBefore.frozen) && tpBefore.current) {
      pendingError = '';
      if (settings.enabled) show(); else sendState();
      return snapshot();
    }
    question = incoming;
    suggestion = null;
    sessionSave = { status: 'saving', message: 'Сохраняю вопрос в текущую сессию…' };
    librarySave = { status: 'idle', message: '' };
    if (incoming.kind === 'coding-task') codingFocus.start(incoming);
    else if (!codingFocus.snapshot().active) codingFocus.stop();
    error = '';
    status = 'question';
    if (settings.enabled) show(); else sendState();
    return snapshot();
  }
  function setAnalyzing(value = true) {
    const tp = teleprompter.snapshot();
    if (value && tp.pendingQuestion && (((tp.answerLocked || tp.frozen) && tp.current) || !tp.current)) {
      teleprompter.setPendingAnalyzing(true);
      pendingError = '';
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
      pendingError = '';
      error = '';
      if (settings.enabled) show(); else sendState();
      return snapshot();
    }
    suggestion = sanitized;
    if (sanitized.question) question = { ...(question || {}), text: sanitized.question };
    if (sanitized.responseType === 'coding_solution' && !codingFocus.snapshot().active) {
      codingFocus.start(question || { text: sanitized.question, kind: 'coding-task' });
    }
    status = 'ready';
    error = '';
    if (settings.enabled) show(); else sendState();
    return snapshot();
  }
  function setError(value) {
    const tp = teleprompter.snapshot();
    if (tp.pendingQuestion && (((tp.answerLocked || tp.frozen) && tp.current) || !tp.current)) {
      teleprompter.setPendingAnalyzing(false);
      status = suggestion ? 'ready' : 'question';
      pendingError = cleanText(value, 3000);
      error = '';
      sendState();
      return snapshot();
    }
    status = 'error';
    pendingError = '';
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
    teleprompter.setFrozen(!!enabled);
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
      pendingError = '';
      error = '';
    }
    sendState();
    return { ok: true, ...snapshot() };
  }
  function dismissPending() {
    teleprompter.clearPending();
    pendingError = '';
    sendState();
    return { ok: true, ...snapshot() };
  }
  function setSessionSaveStatus(nextStatus = 'idle', message = '') {
    sessionSave = { status: cleanText(nextStatus, 40) || 'idle', message: cleanText(message, 500) };
    sendState();
    return { ok: true, ...snapshot() };
  }
  function setLibrarySaveStatus(nextStatus = 'idle', message = '') {
    librarySave = { status: cleanText(nextStatus, 40) || 'idle', message: cleanText(message, 500) };
    sendState();
    return { ok: true, ...snapshot() };
  }
  function addUtterance(entry = {}) {
    const text = cleanText(entry.text || entry.transcript || entry.translation, 2400);
    if (!text) return snapshot();
    const id = cleanText(entry.id, 160) || `utterance-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const next = {
      id,
      text,
      translation: cleanText(entry.translation, 2400),
      kind: cleanText(entry.kind, 40) || 'utterance',
      ts: Number(entry.ts || Date.now())
    };
    const index = utteranceFeed.findIndex(item => item.id === id);
    if (index >= 0) utteranceFeed[index] = { ...utteranceFeed[index], ...next };
    else utteranceFeed.push(next);
    if (utteranceFeed.length > 20) utteranceFeed.splice(0, utteranceFeed.length - 20);
    sendState();
    return snapshot();
  }
  function updateUtterance(id, patch = {}) {
    const cleanId = cleanText(id, 160);
    const index = utteranceFeed.findIndex(item => item.id === cleanId);
    if (index < 0) return snapshot();
    utteranceFeed[index] = {
      ...utteranceFeed[index],
      ...patch,
      id: cleanId,
      text: cleanText(patch.text ?? utteranceFeed[index].text, 2400),
      translation: cleanText(patch.translation ?? utteranceFeed[index].translation, 2400),
      kind: cleanText(patch.kind ?? utteranceFeed[index].kind, 40) || 'utterance'
    };
    sendState();
    return snapshot();
  }
  function clearUtteranceFeed() {
    utteranceFeed = [];
    sendState();
    return { ok: true, ...snapshot() };
  }

  function addCodingContext(entry = {}) {
    codingFocus.appendContext(entry);
    sendState();
    return { ok: true, ...snapshot() };
  }
  function updateCodingContext(id, patch = {}) {
    codingFocus.updateContext(id, patch);
    sendState();
    return { ok: true, ...snapshot() };
  }
  function setPendingCodingChange(change = {}) {
    codingFocus.setPendingChange(change);
    sendState();
    return { ok: true, ...snapshot() };
  }
  function setPendingCodingChangeStatus(status, error = '') {
    codingFocus.setPendingChangeStatus(status, error);
    sendState();
    return { ok: true, ...snapshot() };
  }
  function clearPendingCodingChange() {
    codingFocus.clearPendingChange();
    sendState();
    return { ok: true, ...snapshot() };
  }
  function commitCodingInputs(inputs = []) {
    codingFocus.commitActiveInputs(inputs);
    sendState();
    return { ok: true, ...snapshot() };
  }
  function removeCodingInput(id) {
    codingFocus.removeActiveInput(id);
    sendState();
    return { ok: true, ...snapshot() };
  }
  function setCodingFollowUp(questionValue) {
    codingFocus.setFollowUpQuestion(questionValue);
    sendState();
    return { ok: true, ...snapshot() };
  }
  function setCodingFollowUpAnalyzing(value = true) {
    codingFocus.setFollowUpAnalyzing(value);
    sendState();
    return snapshot();
  }
  function setCodingFollowUpSuggestion(value) {
    codingFocus.setFollowUpSuggestion(sanitizeSuggestion(value));
    sendState();
    return snapshot();
  }
  function setCodingFollowUpError(value) {
    codingFocus.setFollowUpError(value);
    sendState();
    return snapshot();
  }
  function setPendingCodingTask(questionValue) {
    codingFocus.setPendingTask(questionValue);
    sendState();
    return { ok: true, ...snapshot() };
  }
  function takePendingCodingTask() {
    const result = codingFocus.takePendingTask();
    sendState();
    return result;
  }
  function endCodingFocus() {
    codingFocus.stop();
    sendState();
    return { ok: true, ...snapshot() };
  }
  function clearCodingContext() {
    codingFocus.clearContext();
    sendState();
    return { ok: true, ...snapshot() };
  }
  function codingContextSnapshot() {
    return codingFocus.currentContext();
  }

  function unregisterShortcuts() {
    for (const accelerator of registeredShortcuts) {
      try { globalShortcut.unregister(accelerator); } catch (_) {}
    }
    registeredShortcuts = [];
  }
  function registerShortcuts() {
    unregisterShortcuts();
    if (!globalShortcut || !settings.enabled || settings.complianceMode) return;
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
    initialize, ensureWindow, show, hide, toggle, clear, finishAnswer, finishCodingTask, setQuestion, setAnalyzing, setSuggestion,
    setError, updateSettings, setClickThrough, setMoveMode, setFrozen, nextChunk, previousChunk, firstChunk,
    loadPending, nextQuestion: loadPending, dismissPending, setSessionSaveStatus, setLibrarySaveStatus,
    addUtterance, updateUtterance, clearUtteranceFeed,
    addCodingContext, updateCodingContext, setCodingFollowUp, setCodingFollowUpAnalyzing, setCodingFollowUpSuggestion,
    setCodingFollowUpError, setPendingCodingTask, takePendingCodingTask, endCodingFocus, clearCodingContext,
    setPendingCodingChange, setPendingCodingChangeStatus, clearPendingCodingChange, commitCodingInputs, removeCodingInput,
    codingContextSnapshot, resizeWindow, rehome, snapshot, destroy, getWindow: () => assistantWindow
  };
}

module.exports = {
  DEFAULT_ASSISTANT_SETTINGS,
  LEVELS,
  STYLES,
  ASSISTANT_MODES,
  normalizeAssistantSettings,
  sanitizeSuggestion,
  createAssistantOverlayController
};
