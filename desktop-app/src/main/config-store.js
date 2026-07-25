const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const SETTINGS_ORDER = [
  'OPENAI_API_KEY',
  'LOCAL_MEET_TRANSLATOR_PORT',
  'LOCAL_MEET_TRANSLATOR_TOKEN',
  'DESKTOP_EXTENSION_TOKEN',
  'DESKTOP_EXTENSION_PAIRING_CODE',
  'OPENAI_TRANSCRIBE_MODEL',
  'OPENAI_TEXT_MODEL',
  'ENABLE_TTS',
  'OPENAI_TTS_MODEL',
  'OPENAI_TTS_VOICE',
  'OPENAI_TTS_FORMAT',
  'OPENAI_TTS_SPEED',
  'ENABLE_VOICE_CONVERSION',
  'VOICE_CONVERSION_URL',
  'VOICE_CONVERSION_TOKEN',
  'VOICE_CONVERSION_FALLBACK_TO_ORIGINAL',
  'VOICE_CONVERSION_TIMEOUT_MS',
  'EXT_SOURCE_LANG',
  'EXT_TARGET_LANG',
  'EXT_CHUNK_SECONDS',
  'EXT_AUDIO_ISOLATION_MODE',
  'EXT_TTS_ENABLED',
  'EXT_TTS_VOICE',
  'EXT_TTS_SPEED',
  'EXT_MIC_TX_ENABLED',
  'EXT_MIC_TX_SOURCE_LANG',
  'EXT_MIC_TX_TARGET_LANG',
  'EXT_MIC_TX_CHUNK_SECONDS',
  'EXT_MIC_DEVICE_ID',
  'EXT_MIC_DEVICE_NAME',
  'EXT_TTS_SINK_DEVICE_ID',
  'EXT_TTS_SINK_DEVICE_NAME',
  'EXT_OUT_VOICE_STYLE',
  'EXT_RVC_MODEL_TAG',
  'EXT_SHOW_OUTGOING_SUBTITLES',
  'SUBTITLE_WINDOW_ENABLED',
  'SUBTITLE_WINDOW_CONTENT_PROTECTION',
  'SUBTITLE_WINDOW_ALWAYS_ON_TOP',
  'SUBTITLE_WINDOW_CLICK_THROUGH',
  'SUBTITLE_WINDOW_SHOW_ORIGINAL',
  'SUBTITLE_WINDOW_SHOW_TRANSLATION',
  'SUBTITLE_WINDOW_FONT_SIZE',
  'SUBTITLE_WINDOW_BACKGROUND_OPACITY',
  'SUBTITLE_WINDOW_MAX_LINES',
  'SUBTITLE_WINDOW_HOTKEY',
  'SUBTITLE_WINDOW_CLICK_THROUGH_HOTKEY',
  'INTERVIEW_ASSISTANT_ENABLED',
  'INTERVIEW_ASSISTANT_AUTO_ANALYZE',
  'INTERVIEW_ASSISTANT_CONTENT_PROTECTION',
  'INTERVIEW_ASSISTANT_ALWAYS_ON_TOP',
  'INTERVIEW_ASSISTANT_CLICK_THROUGH',
  'INTERVIEW_ASSISTANT_LANGUAGE_LEVEL',
  'INTERVIEW_ASSISTANT_ANSWER_STYLE',
  'INTERVIEW_ASSISTANT_FONT_SIZE',
  'INTERVIEW_ASSISTANT_BACKGROUND_OPACITY',
  'INTERVIEW_ASSISTANT_HOTKEY',
  'INTERVIEW_ASSISTANT_CLICK_THROUGH_HOTKEY',
  'INTERVIEW_ASSISTANT_MOVE_HOTKEY',
  'INTERVIEW_TELEPROMPTER_ENABLED',
  'INTERVIEW_TELEPROMPTER_FROZEN',
  'INTERVIEW_TELEPROMPTER_CHUNK_MODE',
  'INTERVIEW_TELEPROMPTER_SHOW_KEYWORDS',
  'INTERVIEW_TELEPROMPTER_SHOW_PLAN',
  'INTERVIEW_TELEPROMPTER_AUTO_START',
  'INTERVIEW_TELEPROMPTER_NEXT_HOTKEY',
  'INTERVIEW_TELEPROMPTER_PREVIOUS_HOTKEY',
  'INTERVIEW_TELEPROMPTER_FREEZE_HOTKEY',
  'INTERVIEW_TELEPROMPTER_LOAD_PENDING_HOTKEY',
  'VOICE_CONVERSION_HOST',
  'VOICE_CONVERSION_PORT',
  'RVC_INFER_CMD',
  'RVC_INFER_TIMEOUT_SEC'
];

function parseDotEnv(text) {
  const out = {};
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const idx = line.indexOf('=');
    if (idx < 1) continue;
    const key = line.slice(0, idx).trim();
    let value = line.slice(idx + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      const quote = value[0];
      value = value.slice(1, -1);
      if (quote === '"') {
        value = value
          .replace(/\\n/g, '\n')
          .replace(/\\r/g, '\r')
          .replace(/\\"/g, '"')
          .replace(/\\\\/g, '\\');
      }
    }
    out[key] = value;
  }
  return out;
}

function renderDotEnv(values) {
  const lines = ['# Local Meet Translator desktop-generated config. Do not commit this file.'];
  const used = new Set();
  const formatValue = (value) => {
    const text = String(value ?? '');
    if (text === '') return '';
    if (/[\r\n"\\#:=\s]/.test(text)) {
      return `"${text.replace(/\\/g, '\\\\').replace(/\r/g, '\\r').replace(/\n/g, '\\n').replace(/"/g, '\\"')}"`;
    }
    return text;
  };

  for (const key of SETTINGS_ORDER) {
    if (values[key] !== undefined) {
      lines.push(`${key}=${formatValue(values[key])}`);
      used.add(key);
    }
  }
  for (const [key, value] of Object.entries(values)) {
    if (key.startsWith('__') || used.has(key)) continue;
    lines.push(`${key}=${formatValue(value)}`);
  }
  return `${lines.join('\n')}\n`;
}

function boolFromEnv(value, fallback = false) {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return fallback;
}

function intFromEnv(value, fallback, min, max) {
  const number = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, number));
}

function floatFromEnv(value, fallback, min, max) {
  const number = Number.parseFloat(String(value ?? ''));
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, number));
}

function generatePairingCode(randomInt = crypto.randomInt) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const groups = [];
  for (let groupIndex = 0; groupIndex < 3; groupIndex += 1) {
    let group = '';
    for (let charIndex = 0; charIndex < 4; charIndex += 1) {
      group += alphabet[randomInt(0, alphabet.length)];
    }
    groups.push(group);
  }
  return groups.join('-');
}

function createConfigStore({ app, repoRoot, userConfigDir, envPath, legacyEnvPath }) {
  if (!app || typeof app.getPath !== 'function') throw new TypeError('app.getPath is required');
  if (!repoRoot || !userConfigDir || !envPath || !legacyEnvPath) throw new TypeError('Config paths are required');

  function ensureUserConfigDir() {
    fs.mkdirSync(userConfigDir, { recursive: true });
  }

  function looksLikeUsefulEnv(file) {
    try {
      if (!file || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return false;
      const parsed = parseDotEnv(fs.readFileSync(file, 'utf8'));
      return Boolean(parsed.OPENAI_API_KEY || parsed.LOCAL_MEET_TRANSLATOR_TOKEN || parsed.LOCAL_MEET_TRANSLATOR_PORT);
    } catch (_) {
      return false;
    }
  }

  function findLegacyEnvCandidates() {
    const candidates = [];
    const add = (file) => {
      if (file && !candidates.includes(file)) candidates.push(file);
    };

    add(legacyEnvPath);
    add(path.join(process.resourcesPath || '', '.env'));

    const home = app.getPath('home');
    const androidStudioProjects = path.join(home, 'AndroidStudioProjects');
    add(path.join(androidStudioProjects, 'local-meet-translator-desktop-package', '.env'));
    add(path.join(androidStudioProjects, 'local-meet-translator-desktop-command-echo-fix', 'local-meet-translator-desktop-package', '.env'));

    try {
      if (fs.existsSync(androidStudioProjects)) {
        for (const name of fs.readdirSync(androidStudioProjects)) {
          if (!name.toLowerCase().startsWith('local-meet-translator')) continue;
          const dir = path.join(androidStudioProjects, name);
          add(path.join(dir, '.env'));
          add(path.join(dir, 'local-meet-translator-desktop-package', '.env'));
        }
      }
    } catch (_) {
      // Legacy discovery is best-effort only.
    }
    return candidates;
  }

  function migrateLegacyEnvIfNeeded() {
    ensureUserConfigDir();
    if (looksLikeUsefulEnv(envPath)) return { migrated: false, source: null };
    for (const candidate of findLegacyEnvCandidates()) {
      if (path.resolve(candidate) === path.resolve(envPath)) continue;
      if (!looksLikeUsefulEnv(candidate)) continue;
      fs.copyFileSync(candidate, envPath);
      try { fs.chmodSync(envPath, 0o600); } catch (_) {}
      return { migrated: true, source: candidate };
    }
    return { migrated: false, source: null };
  }

  function getSystemLanguageCode() {
    const supported = new Set(['ru', 'pl', 'de', 'es', 'it']);
    let raw = 'en';
    try { raw = (app.getLocale && app.getLocale()) || raw; } catch (_) {}
    raw = String(raw || process.env.LANG || process.env.LANGUAGE || 'en').toLowerCase();
    const code = raw.split(/[_.-]/)[0];
    return supported.has(code) ? code : 'en';
  }

  function applyDefaults(settings) {
    const result = { ...settings };
    let generatedSecurityValues = false;
    result.OPENAI_API_KEY ||= '';
    result.LOCAL_MEET_TRANSLATOR_PORT ||= '8799';
    if (!result.LOCAL_MEET_TRANSLATOR_TOKEN) {
      result.LOCAL_MEET_TRANSLATOR_TOKEN = crypto.randomBytes(24).toString('hex');
      generatedSecurityValues = true;
    }
    if (!result.DESKTOP_EXTENSION_TOKEN) {
      result.DESKTOP_EXTENSION_TOKEN = crypto.randomBytes(24).toString('hex');
      generatedSecurityValues = true;
    }
    if (!result.DESKTOP_EXTENSION_PAIRING_CODE) {
      result.DESKTOP_EXTENSION_PAIRING_CODE = generatePairingCode();
      generatedSecurityValues = true;
    }
    result.OPENAI_TRANSCRIBE_MODEL ||= 'whisper-1';
    result.OPENAI_TEXT_MODEL ||= 'gpt-4o-mini';
    result.ENABLE_TTS ||= 'true';
    result.OPENAI_TTS_MODEL ||= 'gpt-4o-mini-tts';
    result.OPENAI_TTS_VOICE ||= 'onyx';
    result.OPENAI_TTS_FORMAT ||= 'mp3';
    result.OPENAI_TTS_SPEED ||= '1.0';
    result.ENABLE_VOICE_CONVERSION ||= 'false';
    result.VOICE_CONVERSION_HOST ||= '127.0.0.1';
    result.VOICE_CONVERSION_PORT ||= '18799';
    result.VOICE_CONVERSION_URL ||= `http://127.0.0.1:${result.VOICE_CONVERSION_PORT}`;
    result.VOICE_CONVERSION_TOKEN ||= '';
    result.VOICE_CONVERSION_FALLBACK_TO_ORIGINAL ||= 'true';
    result.VOICE_CONVERSION_TIMEOUT_MS ||= '180000';
    result.RVC_INFER_CMD ||= '';
    result.RVC_INFER_TIMEOUT_SEC ||= '180';
    result.EXT_SOURCE_LANG ||= 'auto';
    result.EXT_TARGET_LANG ||= getSystemLanguageCode();
    if (!result.EXT_CHUNK_SECONDS || result.EXT_CHUNK_SECONDS === '5') result.EXT_CHUNK_SECONDS = '3';
    result.EXT_AUDIO_ISOLATION_MODE ||= 'true';
    result.EXT_TTS_ENABLED ||= 'false';
    result.EXT_TTS_VOICE ||= 'onyx';
    result.EXT_TTS_SPEED ||= '1.0';
    result.EXT_MIC_TX_ENABLED ||= 'false';
    result.EXT_MIC_TX_SOURCE_LANG ||= getSystemLanguageCode();
    result.EXT_MIC_TX_TARGET_LANG ||= 'en';
    result.EXT_MIC_TX_CHUNK_SECONDS ||= '5';
    result.EXT_MIC_DEVICE_ID ||= '';
    result.EXT_MIC_DEVICE_NAME ||= '';
    result.EXT_TTS_SINK_DEVICE_ID ||= '';
    result.EXT_TTS_SINK_DEVICE_NAME ||= '';
    if (result.EXT_MIC_TX_ENABLED === 'true' && !result.EXT_TTS_SINK_DEVICE_ID && !result.EXT_TTS_SINK_DEVICE_NAME) {
      result.EXT_TTS_SINK_DEVICE_NAME = 'CABLE Input';
    }
    if (boolFromEnv(result.EXT_AUDIO_ISOLATION_MODE, true)) {
      result.EXT_TTS_ENABLED = 'false';
      if (result.EXT_MIC_TX_ENABLED === 'true' && !result.EXT_TTS_SINK_DEVICE_NAME) {
        result.EXT_TTS_SINK_DEVICE_NAME = 'CABLE Input';
      }
    }
    result.EXT_OUT_VOICE_STYLE ||= 'openai';
    result.EXT_RVC_MODEL_TAG ||= '';
    result.EXT_SHOW_OUTGOING_SUBTITLES ||= 'false';
    result.SUBTITLE_WINDOW_ENABLED ||= 'true';
    result.SUBTITLE_WINDOW_CONTENT_PROTECTION ||= process.platform === 'win32' || process.platform === 'darwin' ? 'true' : 'false';
    result.SUBTITLE_WINDOW_ALWAYS_ON_TOP ||= 'true';
    result.SUBTITLE_WINDOW_CLICK_THROUGH ||= 'false';
    result.SUBTITLE_WINDOW_SHOW_ORIGINAL ||= 'true';
    result.SUBTITLE_WINDOW_SHOW_TRANSLATION ||= 'true';
    result.SUBTITLE_WINDOW_FONT_SIZE ||= '28';
    result.SUBTITLE_WINDOW_BACKGROUND_OPACITY ||= '0.82';
    result.SUBTITLE_WINDOW_MAX_LINES ||= '3';
    result.SUBTITLE_WINDOW_HOTKEY ||= 'CommandOrControl+Shift+S';
    result.SUBTITLE_WINDOW_CLICK_THROUGH_HOTKEY ||= 'CommandOrControl+Shift+X';
    result.INTERVIEW_ASSISTANT_ENABLED ||= 'true';
    result.INTERVIEW_ASSISTANT_AUTO_ANALYZE ||= 'false';
    result.INTERVIEW_ASSISTANT_CONTENT_PROTECTION ||= process.platform === 'win32' || process.platform === 'darwin' ? 'true' : 'false';
    result.INTERVIEW_ASSISTANT_ALWAYS_ON_TOP ||= 'true';
    result.INTERVIEW_ASSISTANT_CLICK_THROUGH ||= 'false';
    result.INTERVIEW_ASSISTANT_LANGUAGE_LEVEL ||= 'B1';
    result.INTERVIEW_ASSISTANT_ANSWER_STYLE ||= 'simple';
    result.INTERVIEW_ASSISTANT_FONT_SIZE ||= '20';
    result.INTERVIEW_ASSISTANT_BACKGROUND_OPACITY ||= '0.94';
    result.INTERVIEW_ASSISTANT_HOTKEY ||= 'CommandOrControl+Shift+A';
    result.INTERVIEW_ASSISTANT_CLICK_THROUGH_HOTKEY ||= 'CommandOrControl+Shift+Z';
    result.INTERVIEW_ASSISTANT_MOVE_HOTKEY ||= 'CommandOrControl+Shift+M';

    Object.defineProperties(result, {
      __ENV_PATH: { value: envPath, enumerable: false, configurable: false, writable: false },
      __CONFIG_DIR: { value: userConfigDir, enumerable: false, configurable: false, writable: false }
    });
    return { settings: result, generatedSecurityValues };
  }

  function loadSettings() {
    migrateLegacyEnvIfNeeded();
    let persisted = {};
    if (fs.existsSync(envPath)) persisted = parseDotEnv(fs.readFileSync(envPath, 'utf8'));
    const { settings, generatedSecurityValues } = applyDefaults(persisted);
    if (generatedSecurityValues) {
      try {
        ensureUserConfigDir();
        fs.writeFileSync(envPath, renderDotEnv(settings), { mode: 0o600 });
      } catch (_) {
        // A settings read should not crash only because a best-effort token write failed.
      }
    }
    return settings;
  }

  function saveSettings(next) {
    ensureUserConfigDir();
    const merged = { ...loadSettings(), ...(next || {}) };
    if (!merged.LOCAL_MEET_TRANSLATOR_TOKEN) merged.LOCAL_MEET_TRANSLATOR_TOKEN = crypto.randomBytes(24).toString('hex');
    if (!merged.DESKTOP_EXTENSION_TOKEN) merged.DESKTOP_EXTENSION_TOKEN = crypto.randomBytes(24).toString('hex');
    if (!merged.DESKTOP_EXTENSION_PAIRING_CODE) merged.DESKTOP_EXTENSION_PAIRING_CODE = generatePairingCode();

    const tempPath = `${envPath}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(tempPath, renderDotEnv(merged), { mode: 0o600 });
    fs.renameSync(tempPath, envPath);
    return loadSettings();
  }

  return {
    envPath,
    userConfigDir,
    ensureUserConfigDir,
    getSystemLanguageCode,
    migrateLegacyEnvIfNeeded,
    loadSettings,
    saveSettings
  };
}

module.exports = {
  SETTINGS_ORDER,
  parseDotEnv,
  renderDotEnv,
  boolFromEnv,
  intFromEnv,
  floatFromEnv,
  generatePairingCode,
  createConfigStore
};
