const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createDiagnosticsTracker,
  buildDiagnosticsReport,
  diagnosticsToMarkdown,
  containsSensitiveValue,
  redactUserPath,
  safeHost
} = require('../src/main/diagnostics');

test('diagnostics tracker stores counters and metadata without text payloads', () => {
  let now = 100;
  const tracker = createDiagnosticsTracker({ clock: () => now, maxEvents: 2 });
  tracker.record('subtitleAccepted', { reason: 'new', transcript: 'must-not-be-stored' });
  now += 1;
  tracker.record('questionDetected', { status: 'accepted' });
  now += 1;
  tracker.record('remarkIgnored', { reason: 'remark' });
  const snapshot = tracker.snapshot();
  assert.equal(snapshot.counters.subtitleAccepted, 1);
  assert.equal(snapshot.counters.questionDetected, 1);
  assert.equal(snapshot.recentEvents.length, 2);
  assert.equal(JSON.stringify(snapshot).includes('must-not-be-stored'), false);
});

test('diagnostics report redacts paths and excludes secrets and transcript content', () => {
  const secret = 'example-api-key-secret-value';
  const token = 'desktop-extension-token-secret';
  const transcript = 'Could you tell me about yourself?';
  const report = buildDiagnosticsReport({
    appInfo: { name: 'Local Meet Translator', version: '1.0.17', platform: 'win32', arch: 'x64' },
    settings: {
      OPENAI_API_KEY: secret,
      DESKTOP_EXTENSION_TOKEN: token,
      LOCAL_MEET_TRANSLATOR_TOKEN: 'bridge-secret',
      DESKTOP_EXTENSION_PAIRING_CODE: '123456',
      EXT_SOURCE_LANG: 'en',
      EXT_TARGET_LANG: 'ru',
      INTERVIEW_ASSISTANT_AUTO_ANALYZE: 'true'
    },
    services: { desktopServer: { ok: true }, bridge: { ok: true }, voiceConversion: { ok: false } },
    overlays: {},
    extension: { activeMeetingUrl: 'https://meet.google.com/abc-defg-hij', recentClientCount: 1, hasActiveClient: true },
    session: { state: 'listening', mode: 'translator', sessionId: 'private-session-id' },
    tracker: { counters: {}, recentEvents: [{ type: 'questionDetected', reason: 'question', transcript }] },
    paths: { config: 'C:\\Users\\Oleg\\AppData\\Roaming\\Local Meet Translator\\.env' },
    homeDirectory: 'C:\\Users\\Oleg'
  });
  assert.equal(report.settings.hasOpenAiKey, true);
  assert.equal(report.services.extension.activeMeetingHost, 'meet.google.com');
  assert.equal(report.paths.config.startsWith('%USERPROFILE%'), true);
  assert.equal(containsSensitiveValue(report, [secret, token, transcript, 'bridge-secret', '123456']), false);
  const markdown = diagnosticsToMarkdown(report);
  assert.equal(markdown.includes(secret), false);
  assert.equal(markdown.includes(transcript), false);
});

test('path and host sanitizers return minimal information', () => {
  assert.equal(redactUserPath('C:\\Users\\Oleg\\AppData\\test.json', 'C:\\Users\\Oleg'), '%USERPROFILE%\\AppData\\test.json');
  assert.equal(safeHost('https://teams.microsoft.com/l/meetup-join/x'), 'teams.microsoft.com');
  assert.equal(safeHost('not-a-url'), '');
});
