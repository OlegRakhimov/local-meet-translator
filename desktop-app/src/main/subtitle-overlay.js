const fs = require('fs');
const path = require('path');

const DEFAULT_SUBTITLE_SETTINGS = Object.freeze({
  enabled: true,
  contentProtection: true,
  alwaysOnTop: true,
  clickThrough: false,
  showOriginal: true,
  showTranslation: true,
  fontSize: 28,
  backgroundOpacity: 0.82,
  maxLines: 3,
  toggleHotkey: 'CommandOrControl+Shift+S',
  clickThroughHotkey: 'CommandOrControl+Shift+X'
});

const SUPPORTED_PROTECTION_PLATFORMS = new Set(['win32', 'darwin']);
const MAX_SUBTITLE_TEXT_LENGTH = 10000;
const MAX_HISTORY_ITEMS = 50;

function boolValue(value, fallback) {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return fallback;
}

function boundedInteger(value, fallback, min, max) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function boundedFloat(value, fallback, min, max) {
  const parsed = Number.parseFloat(String(value ?? ''));
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function normalizeSubtitleSettings(settings = {}, platform = process.platform) {
  const source = settings || {};
  const contentProtectionDefault = SUPPORTED_PROTECTION_PLATFORMS.has(platform)
    ? DEFAULT_SUBTITLE_SETTINGS.contentProtection
    : false;
  return {
    enabled: boolValue(source.SUBTITLE_WINDOW_ENABLED ?? source.enabled, DEFAULT_SUBTITLE_SETTINGS.enabled),
    contentProtection: boolValue(
      source.SUBTITLE_WINDOW_CONTENT_PROTECTION ?? source.contentProtection,
      contentProtectionDefault
    ),
    alwaysOnTop: boolValue(source.SUBTITLE_WINDOW_ALWAYS_ON_TOP ?? source.alwaysOnTop, DEFAULT_SUBTITLE_SETTINGS.alwaysOnTop),
    clickThrough: boolValue(source.SUBTITLE_WINDOW_CLICK_THROUGH ?? source.clickThrough, DEFAULT_SUBTITLE_SETTINGS.clickThrough),
    showOriginal: boolValue(source.SUBTITLE_WINDOW_SHOW_ORIGINAL ?? source.showOriginal, DEFAULT_SUBTITLE_SETTINGS.showOriginal),
    showTranslation: boolValue(source.SUBTITLE_WINDOW_SHOW_TRANSLATION ?? source.showTranslation, DEFAULT_SUBTITLE_SETTINGS.showTranslation),
    fontSize: boundedInteger(source.SUBTITLE_WINDOW_FONT_SIZE ?? source.fontSize, DEFAULT_SUBTITLE_SETTINGS.fontSize, 16, 56),
    backgroundOpacity: boundedFloat(
      source.SUBTITLE_WINDOW_BACKGROUND_OPACITY ?? source.backgroundOpacity,
      DEFAULT_SUBTITLE_SETTINGS.backgroundOpacity,
      0.2,
      1
    ),
    maxLines: boundedInteger(source.SUBTITLE_WINDOW_MAX_LINES ?? source.maxLines, DEFAULT_SUBTITLE_SETTINGS.maxLines, 1, 8),
    toggleHotkey: String(source.SUBTITLE_WINDOW_HOTKEY ?? source.toggleHotkey ?? DEFAULT_SUBTITLE_SETTINGS.toggleHotkey).trim() || DEFAULT_SUBTITLE_SETTINGS.toggleHotkey,
    clickThroughHotkey: String(
      source.SUBTITLE_WINDOW_CLICK_THROUGH_HOTKEY ?? source.clickThroughHotkey ?? DEFAULT_SUBTITLE_SETTINGS.clickThroughHotkey
    ).trim() || DEFAULT_SUBTITLE_SETTINGS.clickThroughHotkey
  };
}

function cleanText(value, maxLength = MAX_SUBTITLE_TEXT_LENGTH) {
  return String(value ?? '')
    .replace(/\u0000/g, '')
    .replace(/\r\n?/g, '\n')
    .trim()
    .slice(0, maxLength);
}

function sanitizeSubtitleEvent(payload = {}) {
  const channel = payload.channel === 'outgoing' ? 'outgoing' : 'incoming';
  const transcript = cleanText(payload.transcript);
  const translation = cleanText(payload.translation);
  if (!transcript && !translation) {
    throw new TypeError('Subtitle event must contain transcript or translation.');
  }
  const timestamp = Number(payload.ts);
  return {
    id: cleanText(payload.id, 128) || `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    channel,
    transcript,
    translation,
    ts: Number.isFinite(timestamp) && timestamp > 0 ? timestamp : Date.now(),
    clientId: cleanText(payload.clientId, 256),
    tabId: cleanText(payload.tabId, 128),
    url: cleanText(payload.url, 2048)
  };
}

function intersectionArea(a, b) {
  const left = Math.max(a.x, b.x);
  const top = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  if (right <= left || bottom <= top) return 0;
  return (right - left) * (bottom - top);
}

function clampBoundsToDisplays(bounds, displays, fallbackDisplay) {
  const safeBounds = {
    x: Number.isFinite(bounds?.x) ? Math.round(bounds.x) : 0,
    y: Number.isFinite(bounds?.y) ? Math.round(bounds.y) : 0,
    width: boundedInteger(bounds?.width, 900, 420, 2400),
    height: boundedInteger(bounds?.height, 240, 140, 1200)
  };
  const available = Array.isArray(displays) ? displays.filter(Boolean) : [];
  const fallback = fallbackDisplay || available[0];
  if (!fallback || !fallback.workArea) return safeBounds;

  const visibleArea = available.reduce((sum, display) => sum + intersectionArea(safeBounds, display.workArea || display.bounds), 0);
  const minimumVisibleArea = Math.min(safeBounds.width, 120) * Math.min(safeBounds.height, 80);
  const chosen = visibleArea >= minimumVisibleArea
    ? (available.find(display => intersectionArea(safeBounds, display.workArea || display.bounds) > 0) || fallback)
    : fallback;
  const area = chosen.workArea || chosen.bounds;
  const width = Math.min(safeBounds.width, area.width);
  const height = Math.min(safeBounds.height, area.height);

  if (visibleArea < minimumVisibleArea) {
    return {
      x: Math.round(area.x + Math.max(0, (area.width - width) / 2)),
      y: Math.round(area.y + Math.max(0, area.height - height - 48)),
      width,
      height
    };
  }

  return {
    x: Math.max(area.x, Math.min(safeBounds.x, area.x + area.width - width)),
    y: Math.max(area.y, Math.min(safeBounds.y, area.y + area.height - height)),
    width,
    height
  };
}

function readStateFile(statePath) {
  try {
    if (!statePath || !fs.existsSync(statePath)) return {};
    const value = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    return value && typeof value === 'object' ? value : {};
  } catch (_) {
    return {};
  }
}

function writeStateFileAtomic(statePath, state) {
  if (!statePath) return;
  const directory = path.dirname(statePath);
  fs.mkdirSync(directory, { recursive: true });
  const temporaryPath = `${statePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporaryPath, statePath);
}

function createSubtitleOverlayController({
  BrowserWindow,
  screen,
  globalShortcut,
  desktopCapturer,
  preloadPath,
  htmlPath,
  statePath,
  loadSettings,
  saveSettings,
  sendLog = () => {},
  platform = process.platform
}) {
  if (!BrowserWindow) throw new TypeError('BrowserWindow is required.');
  if (!screen) throw new TypeError('screen is required.');
  if (typeof loadSettings !== 'function') throw new TypeError('loadSettings is required.');

  let subtitleWindow = null;
  let settings = normalizeSubtitleSettings(loadSettings(), platform);
  let paused = false;
  let statusText = 'idle';
  let history = [];
  let saveTimer = null;
  let lastProtectionTest = { result: 'not_completed', testedAt: '', detail: '' };
  let registeredShortcuts = [];

  function protectionSupported() {
    return SUPPORTED_PROTECTION_PLATFORMS.has(platform);
  }

  function currentProtectionState() {
    const requested = !!settings.contentProtection;
    const supported = protectionSupported();
    let applied = false;
    try {
      applied = !!(
        supported &&
        subtitleWindow &&
        !subtitleWindow.isDestroyed() &&
        typeof subtitleWindow.isContentProtected === 'function' &&
        subtitleWindow.isContentProtected()
      );
    } catch (_) {
      applied = false;
    }
    return {
      requested,
      supported,
      applied,
      platform,
      testResult: lastProtectionTest.result,
      lastTestedAt: lastProtectionTest.testedAt,
      testDetail: lastProtectionTest.detail
    };
  }

  function snapshot() {
    const visible = !!(subtitleWindow && !subtitleWindow.isDestroyed() && subtitleWindow.isVisible());
    return {
      visible,
      paused,
      status: statusText,
      settings: { ...settings },
      protection: currentProtectionState(),
      history: history.slice(-MAX_HISTORY_ITEMS)
    };
  }

  function send(channel, payload) {
    try {
      if (!subtitleWindow || subtitleWindow.isDestroyed()) return false;
      const contents = subtitleWindow.webContents;
      if (!contents || contents.isDestroyed()) return false;
      contents.send(channel, payload);
      return true;
    } catch (_) {
      return false;
    }
  }

  function broadcastState() {
    send('subtitle-overlay:state', snapshot());
  }

  function persistBounds() {
    if (!subtitleWindow || subtitleWindow.isDestroyed()) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try {
        const previous = readStateFile(statePath);
        writeStateFileAtomic(statePath, {
          ...previous,
          schemaVersion: 1,
          bounds: subtitleWindow.getNormalBounds(),
          updatedAt: new Date().toISOString()
        });
      } catch (error) {
        sendLog(`Subtitle window position could not be saved: ${error.message}`);
      }
    }, 250);
  }

  function getInitialBounds() {
    const saved = readStateFile(statePath);
    const primary = screen.getPrimaryDisplay();
    const workArea = primary.workArea;
    const fallback = {
      x: Math.round(workArea.x + Math.max(0, (workArea.width - 900) / 2)),
      y: Math.round(workArea.y + Math.max(0, workArea.height - 240 - 48)),
      width: Math.min(900, workArea.width),
      height: Math.min(240, workArea.height)
    };
    return clampBoundsToDisplays(saved.bounds || fallback, screen.getAllDisplays(), primary);
  }

  function applyContentProtection() {
    if (!subtitleWindow || subtitleWindow.isDestroyed()) return currentProtectionState();
    const enable = protectionSupported() && settings.contentProtection;
    try {
      if (typeof subtitleWindow.setContentProtection === 'function') {
        subtitleWindow.setContentProtection(enable);
      }
    } catch (error) {
      sendLog(`Subtitle content protection failed: ${error.message}`);
    }
    return currentProtectionState();
  }

  function applyWindowSettings() {
    if (!subtitleWindow || subtitleWindow.isDestroyed()) return;
    try { subtitleWindow.setAlwaysOnTop(!!settings.alwaysOnTop, settings.alwaysOnTop ? 'floating' : 'normal'); } catch (_) {}
    try { subtitleWindow.setIgnoreMouseEvents(!!settings.clickThrough, { forward: true }); } catch (_) {}
    applyContentProtection();
    broadcastState();
  }

  function ensureWindow() {
    if (subtitleWindow && !subtitleWindow.isDestroyed()) return subtitleWindow;
    const bounds = getInitialBounds();
    subtitleWindow = new BrowserWindow({
      ...bounds,
      minWidth: 420,
      minHeight: 140,
      show: false,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      resizable: true,
      movable: true,
      minimizable: true,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: false,
      focusable: true,
      webPreferences: {
        preload: path.resolve(preloadPath),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true
      }
    });

    // Protection is applied before loading or showing sensitive subtitle content.
    applyContentProtection();
    applyWindowSettings();
    subtitleWindow.loadFile(path.resolve(htmlPath));
    subtitleWindow.on('move', persistBounds);
    subtitleWindow.on('resize', persistBounds);
    subtitleWindow.on('closed', () => { subtitleWindow = null; });
    subtitleWindow.webContents.on('did-finish-load', () => broadcastState());
    return subtitleWindow;
  }

  function show() {
    if (!settings.enabled) return { ok: false, message: 'Subtitle window is disabled in settings.', ...snapshot() };
    const win = ensureWindow();
    if (!win.isVisible()) {
      if (typeof win.showInactive === 'function') win.showInactive();
      else win.show();
    }
    broadcastState();
    return { ok: true, ...snapshot() };
  }

  function hide() {
    if (subtitleWindow && !subtitleWindow.isDestroyed()) subtitleWindow.hide();
    return { ok: true, ...snapshot() };
  }

  function toggle() {
    if (subtitleWindow && !subtitleWindow.isDestroyed() && subtitleWindow.isVisible()) return hide();
    return show();
  }

  function clear() {
    history = [];
    send('subtitle-overlay:clear');
    return { ok: true, ...snapshot() };
  }

  function setPaused(next) {
    paused = !!next;
    statusText = paused ? 'paused' : (statusText === 'paused' ? 'listening' : statusText);
    broadcastState();
    return { ok: true, ...snapshot() };
  }

  function setStatus(nextStatus) {
    statusText = cleanText(nextStatus, 64) || 'idle';
    broadcastState();
    return { ok: true, ...snapshot() };
  }

  function setClickThrough(next) {
    settings.clickThrough = !!next;
    if (typeof saveSettings === 'function') {
      saveSettings({ SUBTITLE_WINDOW_CLICK_THROUGH: settings.clickThrough ? 'true' : 'false' });
    }
    applyWindowSettings();
    return { ok: true, ...snapshot() };
  }

  function pushSubtitle(payload) {
    const event = sanitizeSubtitleEvent(payload);
    history.push(event);
    if (history.length > MAX_HISTORY_ITEMS) history = history.slice(-MAX_HISTORY_ITEMS);
    if (settings.enabled) show();
    if (!paused) send('subtitle-overlay:event', event);
    return { ok: true, accepted: true, eventId: event.id, ...snapshot() };
  }

  function updateSettings(nextSettings) {
    settings = normalizeSubtitleSettings(nextSettings || loadSettings(), platform);
    if (!settings.enabled) hide();
    applyWindowSettings();
    registerShortcuts();
    return { ok: true, ...snapshot() };
  }

  function rehome() {
    if (!subtitleWindow || subtitleWindow.isDestroyed()) return;
    const current = subtitleWindow.getNormalBounds();
    const clamped = clampBoundsToDisplays(current, screen.getAllDisplays(), screen.getPrimaryDisplay());
    subtitleWindow.setBounds(clamped, false);
  }

  function unregisterShortcuts() {
    if (!globalShortcut) return;
    for (const accelerator of registeredShortcuts) {
      try { globalShortcut.unregister(accelerator); } catch (_) {}
    }
    registeredShortcuts = [];
  }

  function registerShortcut(accelerator, callback, label) {
    if (!globalShortcut || !accelerator) return;
    try {
      const registered = globalShortcut.register(accelerator, callback);
      if (registered) registeredShortcuts.push(accelerator);
      else sendLog(`Subtitle hotkey conflict: ${accelerator} (${label})`);
    } catch (error) {
      sendLog(`Subtitle hotkey registration failed: ${accelerator}: ${error.message}`);
    }
  }

  function registerShortcuts() {
    unregisterShortcuts();
    registerShortcut(settings.toggleHotkey, () => toggle(), 'show/hide');
    registerShortcut(settings.clickThroughHotkey, () => setClickThrough(!settings.clickThrough), 'click-through');
  }

  async function testContentProtection() {
    const testedAt = new Date().toISOString();
    if (!protectionSupported()) {
      lastProtectionTest = { result: 'unsupported', testedAt, detail: `Content protection is not supported by Electron on ${platform}.` };
      broadcastState();
      return { ok: false, ...lastProtectionTest, protection: currentProtectionState() };
    }
    if (!desktopCapturer || typeof desktopCapturer.getSources !== 'function') {
      lastProtectionTest = { result: 'inconclusive', testedAt, detail: 'Electron desktopCapturer is unavailable.' };
      broadcastState();
      return { ok: false, ...lastProtectionTest, protection: currentProtectionState() };
    }

    const title = `LMT Protection Test ${Date.now()} ${Math.random().toString(16).slice(2)}`;
    let testWindow = null;
    try {
      testWindow = new BrowserWindow({
        width: 360,
        height: 180,
        show: false,
        frame: true,
        title,
        backgroundColor: '#ff00ff',
        webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true }
      });
      if (typeof testWindow.setContentProtection !== 'function') {
        lastProtectionTest = { result: 'unsupported', testedAt, detail: 'BrowserWindow.setContentProtection is unavailable.' };
        return { ok: false, ...lastProtectionTest, protection: currentProtectionState() };
      }
      testWindow.setContentProtection(true);
      await testWindow.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent('<!doctype html><html><body style="margin:0;background:#ff00ff;color:#00ff00;font:700 28px sans-serif;display:grid;place-items:center;height:100vh">LMT PROTECTION TEST</body></html>'));
      if (typeof testWindow.showInactive === 'function') testWindow.showInactive();
      else testWindow.show();
      await new Promise(resolve => setTimeout(resolve, 450));

      const sources = await desktopCapturer.getSources({ types: ['window'], thumbnailSize: { width: 360, height: 180 }, fetchWindowIcons: false });
      const source = sources.find(item => String(item.name || '') === title || String(item.name || '').includes(title));
      if (!source) {
        lastProtectionTest = { result: 'passed', testedAt, detail: 'The protected test window was absent from Electron window capture.' };
      } else {
        const bitmap = source.thumbnail && typeof source.thumbnail.toBitmap === 'function' ? source.thumbnail.toBitmap() : null;
        if (!bitmap || bitmap.length < 4) {
          lastProtectionTest = { result: 'inconclusive', testedAt, detail: 'The capture source existed, but its thumbnail could not be inspected.' };
        } else {
          let magentaPixels = 0;
          const pixels = Math.floor(bitmap.length / 4);
          for (let index = 0; index < bitmap.length; index += 4) {
            const blue = bitmap[index];
            const green = bitmap[index + 1];
            const red = bitmap[index + 2];
            if (red > 180 && blue > 180 && green < 100) magentaPixels += 1;
          }
          const ratio = pixels ? magentaPixels / pixels : 0;
          lastProtectionTest = ratio > 0.15
            ? { result: 'failed', testedAt, detail: `Protected test content was visible in ${Math.round(ratio * 100)}% of the capture thumbnail.` }
            : { result: 'passed', testedAt, detail: 'The protected test content was not visible in the capture thumbnail.' };
        }
      }
    } catch (error) {
      lastProtectionTest = { result: 'inconclusive', testedAt, detail: error.message || String(error) };
    } finally {
      try { if (testWindow && !testWindow.isDestroyed()) testWindow.destroy(); } catch (_) {}
      broadcastState();
    }
    return { ok: lastProtectionTest.result === 'passed', ...lastProtectionTest, protection: currentProtectionState() };
  }

  function initialize() {
    settings = normalizeSubtitleSettings(loadSettings(), platform);
    registerShortcuts();
    const rehomeHandler = () => rehome();
    screen.on('display-removed', rehomeHandler);
    screen.on('display-metrics-changed', rehomeHandler);
    return snapshot();
  }

  function destroy() {
    clearTimeout(saveTimer);
    unregisterShortcuts();
    try { if (subtitleWindow && !subtitleWindow.isDestroyed()) subtitleWindow.destroy(); } catch (_) {}
    subtitleWindow = null;
  }

  return {
    initialize,
    ensureWindow,
    show,
    hide,
    toggle,
    clear,
    setPaused,
    setStatus,
    setClickThrough,
    pushSubtitle,
    updateSettings,
    testContentProtection,
    rehome,
    snapshot,
    destroy,
    getWindow: () => subtitleWindow
  };
}

module.exports = {
  DEFAULT_SUBTITLE_SETTINGS,
  SUPPORTED_PROTECTION_PLATFORMS,
  MAX_SUBTITLE_TEXT_LENGTH,
  normalizeSubtitleSettings,
  sanitizeSubtitleEvent,
  clampBoundsToDisplays,
  readStateFile,
  writeStateFileAtomic,
  createSubtitleOverlayController
};
