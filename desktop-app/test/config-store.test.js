const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  parseDotEnv,
  renderDotEnv,
  createConfigStore,
  boolFromEnv,
  intFromEnv,
  floatFromEnv
} = require('../src/main/config-store');

test('dotenv parser and renderer preserve escaped values', () => {
  const rendered = renderDotEnv({ OPENAI_API_KEY: 'key with spaces', CUSTOM: 'line1\nline2' });
  const parsed = parseDotEnv(rendered);
  assert.equal(parsed.OPENAI_API_KEY, 'key with spaces');
  assert.equal(parsed.CUSTOM, 'line1\nline2');
});

test('environment value helpers clamp and use fallback safely', () => {
  assert.equal(boolFromEnv('YES', false), true);
  assert.equal(boolFromEnv('unknown', false), false);
  assert.equal(intFromEnv('20', 3, 2, 15), 15);
  assert.equal(floatFromEnv('0.1', 1, 0.25, 4), 0.25);
});

test('config store generates security values and writes atomically', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'lmt-config-test-'));
  try {
    const home = path.join(temp, 'home');
    const userConfigDir = path.join(temp, 'appdata', 'Local Meet Translator');
    const envPath = path.join(userConfigDir, '.env');
    const repoRoot = path.join(temp, 'repo');
    fs.mkdirSync(home, { recursive: true });
    fs.mkdirSync(repoRoot, { recursive: true });
    const app = {
      getPath(name) {
        if (name === 'home') return home;
        throw new Error(`Unexpected path: ${name}`);
      },
      getLocale() { return 'ru-RU'; }
    };
    const store = createConfigStore({
      app,
      repoRoot,
      userConfigDir,
      envPath,
      legacyEnvPath: path.join(repoRoot, '.env')
    });
    const initial = store.loadSettings();
    assert.equal(initial.EXT_TARGET_LANG, 'ru');
    assert.equal(initial.OPENAI_TRANSCRIBE_MODEL, 'gpt-4o-transcribe');
    assert.equal(initial.EXT_CHUNK_SECONDS, '7');
    assert.equal(initial.INCOMING_ACCURACY_MIGRATED_20260805, 'true');
    assert.equal(initial.INTERVIEW_ASSISTANT_PROFILE_MODE, 'general');
    assert.match(initial.LOCAL_MEET_TRANSLATOR_TOKEN, /^[a-f0-9]{48}$/);
    assert.match(initial.DESKTOP_EXTENSION_PAIRING_CODE, /^[A-Z2-9]{4}(?:-[A-Z2-9]{4}){2}$/);
    assert.ok(fs.existsSync(envPath));

    const saved = store.saveSettings({
      OPENAI_API_KEY: 'test-key',
      INTERVIEW_ASSISTANT_ENABLED: 'true',
      INTERVIEW_ASSISTANT_PROFILE_MODE: 'speakit_polish_support',
      INTERVIEW_ASSISTANT_AUTO_ANALYZE: 'true',
      INTERVIEW_TELEPROMPTER_ENABLED: 'true',
      INTERVIEW_ASSISTANT_CONTENT_PROTECTION: 'true',
      SUBTITLE_WINDOW_CONTENT_PROTECTION: 'true'
    });
    assert.equal(saved.OPENAI_API_KEY, 'test-key');
    assert.equal(saved.INTERVIEW_ASSISTANT_PROFILE_MODE, 'speakit_polish_support');
    const compliance = store.saveSettings({
      EXAM_COMPLIANCE_MODE: 'true',
      INTERVIEW_ASSISTANT_ENABLED: 'false',
      INTERVIEW_ASSISTANT_AUTO_ANALYZE: 'false',
      INTERVIEW_TELEPROMPTER_ENABLED: 'false',
      INTERVIEW_ASSISTANT_CONTENT_PROTECTION: 'false',
      SUBTITLE_WINDOW_CONTENT_PROTECTION: 'false'
    });
    assert.equal(compliance.EXAM_COMPLIANCE_MODE, 'true');
    assert.equal(compliance.INTERVIEW_ASSISTANT_ENABLED, 'false');
    assert.equal(compliance.INTERVIEW_ASSISTANT_AUTO_ANALYZE, 'false');
    assert.equal(compliance.INTERVIEW_TELEPROMPTER_ENABLED, 'false');
    assert.equal(compliance.INTERVIEW_ASSISTANT_CONTENT_PROTECTION, 'false');
    assert.equal(compliance.SUBTITLE_WINDOW_CONTENT_PROTECTION, 'false');
    const restored = store.saveSettings({ EXAM_COMPLIANCE_MODE: 'false' });
    assert.equal(restored.EXAM_COMPLIANCE_MODE, 'false');
    assert.equal(restored.INTERVIEW_ASSISTANT_ENABLED, 'true');
    assert.equal(restored.INTERVIEW_ASSISTANT_AUTO_ANALYZE, 'true');
    assert.equal(restored.INTERVIEW_TELEPROMPTER_ENABLED, 'true');
    assert.equal(restored.INTERVIEW_ASSISTANT_CONTENT_PROTECTION, 'true');
    assert.equal(restored.SUBTITLE_WINDOW_CONTENT_PROTECTION, 'true');
    assert.equal(fs.readFileSync(envPath, 'utf8').includes('EXAM_COMPLIANCE_PREVIOUS_SETTINGS'), false);
    assert.equal(fs.readdirSync(userConfigDir).filter((name) => name.endsWith('.tmp')).length, 0);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});


test('config store migrates legacy incoming transcription settings once', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'lmt-accuracy-migration-test-'));
  try {
    const home = path.join(temp, 'home');
    const userConfigDir = path.join(temp, 'appdata', 'Local Meet Translator');
    const envPath = path.join(userConfigDir, '.env');
    const repoRoot = path.join(temp, 'repo');
    fs.mkdirSync(home, { recursive: true });
    fs.mkdirSync(userConfigDir, { recursive: true });
    fs.mkdirSync(repoRoot, { recursive: true });
    fs.writeFileSync(envPath, 'OPENAI_TRANSCRIBE_MODEL=whisper-1\nEXT_CHUNK_SECONDS=3\n', 'utf8');
    const app = {
      getPath(name) {
        if (name === 'home') return home;
        throw new Error(`Unexpected path: ${name}`);
      },
      getLocale() { return 'en-US'; }
    };
    const store = createConfigStore({
      app,
      repoRoot,
      userConfigDir,
      envPath,
      legacyEnvPath: path.join(repoRoot, '.env')
    });
    const migrated = store.loadSettings();
    assert.equal(migrated.OPENAI_TRANSCRIBE_MODEL, 'gpt-4o-transcribe');
    assert.equal(migrated.EXT_CHUNK_SECONDS, '7');
    assert.equal(migrated.INCOMING_ACCURACY_MIGRATED_20260805, 'true');

    const customized = store.saveSettings({ EXT_CHUNK_SECONDS: '9' });
    assert.equal(customized.EXT_CHUNK_SECONDS, '9');
    assert.equal(customized.INCOMING_ACCURACY_MIGRATED_20260805, 'true');
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
