const path = require('path');

const COUNTER_KEYS = Object.freeze([
  'subtitleAccepted',
  'subtitleDuplicate',
  'subtitleRejected',
  'questionDetected',
  'codingTaskDetected',
  'remarkIgnored',
  'analysisStarted',
  'analysisCompleted',
  'analysisFailed',
  'authRejected',
  'rateLimited'
]);

function cleanLabel(value, maxLength = 160) {
  return String(value ?? '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

function redactUserPath(value, homeDirectory = '') {
  const text = String(value || '');
  const home = String(homeDirectory || '').replace(/[\\/]+$/, '');
  if (!text) return '';
  if (home && text.toLowerCase().startsWith(home.toLowerCase())) {
    return `%USERPROFILE%${text.slice(home.length)}`;
  }
  return path.basename(text);
}

function safeHost(value) {
  try {
    const url = new URL(String(value || ''));
    return cleanLabel(url.hostname, 120);
  } catch (_) {
    return '';
  }
}

function createDiagnosticsTracker({ clock = () => Date.now(), maxEvents = 80 } = {}) {
  const startedAt = clock();
  const counters = Object.fromEntries(COUNTER_KEYS.map(key => [key, 0]));
  const recentEvents = [];

  function record(type, details = {}) {
    const key = COUNTER_KEYS.includes(type) ? type : '';
    if (key) counters[key] += 1;
    const event = {
      at: clock(),
      type: cleanLabel(type, 80),
      status: cleanLabel(details.status, 80),
      reason: cleanLabel(details.reason, 120)
    };
    recentEvents.push(event);
    if (recentEvents.length > maxEvents) recentEvents.splice(0, recentEvents.length - maxEvents);
    return event;
  }

  function reset() {
    for (const key of COUNTER_KEYS) counters[key] = 0;
    recentEvents.length = 0;
  }

  function snapshot() {
    return {
      startedAt,
      counters: { ...counters },
      recentEvents: recentEvents.map(event => ({ ...event }))
    };
  }

  return { record, reset, snapshot };
}

function buildSafeSettingsSummary(settings = {}) {
  return {
    sourceLanguage: cleanLabel(settings.EXT_SOURCE_LANG || 'auto', 30),
    targetLanguage: cleanLabel(settings.EXT_TARGET_LANG || '', 30),
    incomingChunkSeconds: Number(settings.EXT_CHUNK_SECONDS || 0) || 0,
    microphoneTranslationEnabled: String(settings.EXT_MIC_TX_ENABLED || 'false') === 'true',
    incomingTtsEnabled: String(settings.EXT_TTS_ENABLED || 'false') === 'true',
    voiceConversionEnabled: String(settings.ENABLE_VOICE_CONVERSION || 'false') === 'true',
    assistantEnabled: String(settings.INTERVIEW_ASSISTANT_ENABLED || 'true') === 'true',
    assistantAutoAnalyze: String(settings.INTERVIEW_ASSISTANT_AUTO_ANALYZE || 'false') === 'true',
    subtitleContentProtectionRequested: String(settings.SUBTITLE_WINDOW_CONTENT_PROTECTION || 'true') === 'true',
    assistantContentProtectionRequested: String(settings.INTERVIEW_ASSISTANT_CONTENT_PROTECTION || 'true') === 'true',
    hasOpenAiKey: !!cleanLabel(settings.OPENAI_API_KEY, 10),
    hasBridgeToken: !!cleanLabel(settings.LOCAL_MEET_TRANSLATOR_TOKEN, 10),
    hasExtensionToken: !!cleanLabel(settings.DESKTOP_EXTENSION_TOKEN, 10),
    hasPairingCode: !!cleanLabel(settings.DESKTOP_EXTENSION_PAIRING_CODE, 10)
  };
}

function buildDiagnosticsReport({
  appInfo = {},
  settings = {},
  services = {},
  overlays = {},
  extension = {},
  session = {},
  tracker = {},
  paths = {},
  homeDirectory = ''
} = {}) {
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    application: {
      name: cleanLabel(appInfo.name, 120),
      version: cleanLabel(appInfo.version, 40),
      packaged: appInfo.packaged === true,
      platform: cleanLabel(appInfo.platform, 40),
      arch: cleanLabel(appInfo.arch, 40),
      electron: cleanLabel(appInfo.electron, 40),
      node: cleanLabel(appInfo.node, 40)
    },
    settings: buildSafeSettingsSummary(settings),
    services: {
      desktopServer: services.desktopServer || { ok: false },
      bridge: services.bridge || { ok: false },
      voiceConversion: services.voiceConversion || { ok: false },
      extension: {
        recentClientCount: Number(extension.recentClientCount || 0),
        hasActiveClient: extension.hasActiveClient === true,
        activeMeetingHost: safeHost(extension.activeMeetingUrl)
      }
    },
    overlays: {
      subtitles: overlays.subtitles || {},
      assistant: overlays.assistant || {}
    },
    session: {
      state: cleanLabel(session.state, 80),
      mode: cleanLabel(session.mode, 80),
      hasSession: !!session.sessionId,
      hasRequest: !!session.requestId,
      lastError: cleanLabel(session.lastError, 240)
    },
    runtime: {
      startedAt: Number(tracker.startedAt || 0) || 0,
      counters: Object.fromEntries(COUNTER_KEYS.map(key => [key, Number(tracker.counters?.[key] || 0) || 0])),
      recentEvents: (Array.isArray(tracker.recentEvents) ? tracker.recentEvents : []).slice(-80).map(event => ({
        at: Number(event?.at || 0) || 0,
        type: cleanLabel(event?.type, 80),
        status: cleanLabel(event?.status, 80),
        reason: cleanLabel(event?.reason, 120)
      }))
    },
    paths: {
      config: redactUserPath(paths.config, homeDirectory),
      profile: redactUserPath(paths.profile, homeDirectory),
      answerLibrary: redactUserPath(paths.answerLibrary, homeDirectory),
      interviewHistory: redactUserPath(paths.interviewHistory, homeDirectory)
    },
    privacy: {
      rawAudioStoredByDesktop: false,
      secretsIncludedInReport: false,
      transcriptTextIncludedInReport: false,
      resumeTextIncludedInReport: false,
      reportPurpose: 'Local troubleshooting and release verification'
    }
  };
}

function diagnosticsToMarkdown(report = {}) {
  const lines = [
    '# Local Meet Translator diagnostics',
    '',
    `Generated: ${report.generatedAt || ''}`,
    `Version: ${report.application?.version || ''}`,
    `Platform: ${report.application?.platform || ''} ${report.application?.arch || ''}`,
    `Packaged: ${report.application?.packaged ? 'yes' : 'no'}`,
    '',
    '## Services',
    `- Desktop server: ${report.services?.desktopServer?.ok ? 'OK' : 'NOT READY'}`,
    `- Java bridge: ${report.services?.bridge?.ok ? 'OK' : 'NOT READY'}`,
    `- Voice conversion: ${report.services?.voiceConversion?.ok ? 'OK' : 'NOT READY'}`,
    `- Recent extension clients: ${report.services?.extension?.recentClientCount || 0}`,
    `- Active meeting host: ${report.services?.extension?.activeMeetingHost || 'none'}`,
    '',
    '## Protection',
    `- Subtitle protection applied: ${report.overlays?.subtitles?.protection?.applied ? 'yes' : 'no'}`,
    `- Assistant protection applied: ${report.overlays?.assistant?.protection?.applied ? 'yes' : 'no'}`,
    '',
    '## Runtime counters'
  ];
  for (const [key, value] of Object.entries(report.runtime?.counters || {})) lines.push(`- ${key}: ${value}`);
  lines.push(
    '',
    '## Privacy',
    '- Raw audio is not stored by the desktop app.',
    '- API keys, tokens, pairing codes, transcripts and resume text are excluded from this report.',
    ''
  );
  return lines.join('\n');
}

function containsSensitiveValue(value, sensitiveValues = []) {
  const serialized = JSON.stringify(value || {});
  return (Array.isArray(sensitiveValues) ? sensitiveValues : [])
    .map(item => String(item || ''))
    .filter(Boolean)
    .some(item => serialized.includes(item));
}

module.exports = {
  COUNTER_KEYS,
  cleanLabel,
  redactUserPath,
  safeHost,
  createDiagnosticsTracker,
  buildSafeSettingsSummary,
  buildDiagnosticsReport,
  diagnosticsToMarkdown,
  containsSensitiveValue
};
