const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');

const {
  normalizeSubtitleSettings,
  sanitizeSubtitleEvent,
  clampBoundsToDisplays,
  createSubtitleOverlayController
} = require('../src/main/subtitle-overlay');

test('subtitle settings are bounded and Windows protection defaults to enabled', () => {
  const settings = normalizeSubtitleSettings({
    SUBTITLE_WINDOW_FONT_SIZE: '999',
    SUBTITLE_WINDOW_BACKGROUND_OPACITY: '-1',
    SUBTITLE_WINDOW_MAX_LINES: '20'
  }, 'win32');
  assert.equal(settings.contentProtection, true);
  assert.equal(settings.fontSize, 56);
  assert.equal(settings.backgroundOpacity, 0.2);
  assert.equal(settings.maxLines, 8);
});

test('unsupported platforms do not claim protection by default', () => {
  const settings = normalizeSubtitleSettings({}, 'linux');
  assert.equal(settings.contentProtection, false);
});

test('subtitle event validation rejects empty data and bounds text', () => {
  assert.throws(() => sanitizeSubtitleEvent({}), /transcript or translation/);
  const event = sanitizeSubtitleEvent({
    channel: 'outgoing',
    transcript: `hello\u0000${'x'.repeat(12000)}`,
    translation: 'привет',
    ts: 10
  });
  assert.equal(event.channel, 'outgoing');
  assert.equal(event.transcript.includes('\u0000'), false);
  assert.equal(event.transcript.length, 10000);
  assert.equal(event.translation, 'привет');
  assert.equal(event.ts, 10);
});



test('subtitle event preserves recognition uncertainty metadata', () => {
  const event = sanitizeSubtitleEvent({
    channel: 'incoming',
    transcript: 'Why do we want to go to customer support?',
    translation: 'Почему мы хотим перейти в поддержку клиентов?',
    transcriptionTrusted: false,
    transcriptionUncertain: true,
    transcriptionConfidence: 'medium',
    transcriptionAgreement: 0.31,
    detectedLanguage: 'en',
    alternativeTranscript: 'Why do you want to work in customer support?'
  });
  assert.equal(event.transcriptionTrusted, false);
  assert.equal(event.transcriptionUncertain, true);
  assert.equal(event.transcriptionConfidence, 'medium');
  assert.equal(event.transcriptionAgreement, 0.31);
  assert.equal(event.detectedLanguage, 'en');
  assert.equal(event.alternativeTranscript, 'Why do you want to work in customer support?');
});

test('off-screen window bounds are returned to the primary display', () => {
  const displays = [{ workArea: { x: 0, y: 0, width: 1920, height: 1040 } }];
  const bounds = clampBoundsToDisplays({ x: 9000, y: 9000, width: 900, height: 240 }, displays, displays[0]);
  assert.equal(bounds.x, 510);
  assert.equal(bounds.y, 752);
  assert.equal(bounds.width, 900);
  assert.equal(bounds.height, 240);
});

test('controller applies content protection before loading subtitle HTML', () => {
  const calls = [];
  class MockWindow {
    constructor(options) { this.options = options; this.destroyed = false; this.visible = false; this.protected = false; this.webContents = { isDestroyed: () => false, send: () => {}, on: () => {} }; }
    setContentProtection(value) { calls.push(`protect:${value}`); this.protected = value; }
    isContentProtected() { return this.protected; }
    setAlwaysOnTop() {}
    setIgnoreMouseEvents() {}
    loadFile(file) { calls.push(`load:${path.basename(file)}`); }
    on() {}
    isDestroyed() { return this.destroyed; }
    isVisible() { return this.visible; }
    showInactive() { this.visible = true; }
    hide() { this.visible = false; }
    getNormalBounds() { return { x: 0, y: 0, width: 900, height: 240 }; }
    setBounds() {}
    destroy() { this.destroyed = true; }
  }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lmt-subtitle-test-'));
  const display = { workArea: { x: 0, y: 0, width: 1920, height: 1040 } };
  const controller = createSubtitleOverlayController({
    BrowserWindow: MockWindow,
    screen: { getPrimaryDisplay: () => display, getAllDisplays: () => [display], on: () => {} },
    globalShortcut: { register: () => true, unregister: () => {} },
    desktopCapturer: null,
    preloadPath: path.join(tmp, 'preload.js'),
    htmlPath: path.join(tmp, 'overlay.html'),
    statePath: path.join(tmp, 'state.json'),
    loadSettings: () => ({ SUBTITLE_WINDOW_CONTENT_PROTECTION: 'true' }),
    saveSettings: () => ({}),
    platform: 'win32'
  });
  controller.initialize();
  controller.show();
  const protectIndex = calls.indexOf('protect:true');
  const loadIndex = calls.indexOf('load:overlay.html');
  assert.ok(protectIndex >= 0);
  assert.ok(loadIndex >= 0);
  assert.ok(protectIndex < loadIndex);
  controller.destroy();
});

test('pushSubtitle keeps protected window local and updates history', () => {
  class MockWindow {
    constructor() { this.destroyed = false; this.visible = false; this.protected = false; this.sent = []; this.webContents = { isDestroyed: () => false, send: (channel, payload) => this.sent.push({ channel, payload }), on: () => {} }; }
    setContentProtection(value) { this.protected = value; }
    isContentProtected() { return this.protected; }
    setAlwaysOnTop() {}
    setIgnoreMouseEvents() {}
    loadFile() {}
    on() {}
    isDestroyed() { return this.destroyed; }
    isVisible() { return this.visible; }
    showInactive() { this.visible = true; }
    hide() { this.visible = false; }
    getNormalBounds() { return { x: 0, y: 0, width: 900, height: 240 }; }
    setBounds() {}
    destroy() { this.destroyed = true; }
  }
  const display = { workArea: { x: 0, y: 0, width: 1920, height: 1040 } };
  const controller = createSubtitleOverlayController({
    BrowserWindow: MockWindow,
    screen: { getPrimaryDisplay: () => display, getAllDisplays: () => [display], on: () => {} },
    globalShortcut: { register: () => true, unregister: () => {} },
    preloadPath: __filename,
    htmlPath: __filename,
    statePath: '',
    loadSettings: () => ({}),
    saveSettings: () => ({}),
    platform: 'win32'
  });
  controller.initialize();
  const result = controller.pushSubtitle({ transcript: 'Hello', translation: 'Привет' });
  assert.equal(result.accepted, true);
  assert.equal(result.visible, true);
  assert.equal(result.history.length, 1);
  assert.equal(result.protection.applied, true);
  controller.destroy();
});
