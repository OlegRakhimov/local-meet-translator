const $ = (id) => document.getElementById(id);
function log(line) {
  const el = $('log');
  const text = String(line ?? '');
  if (!el) {
    try { console.log('[LMT]', text); } catch (_) {}
    return;
  }
  el.textContent += text + '\n';
  el.scrollTop = el.scrollHeight;
}
function dot(id, ok, running=false) { const el=$(id); el.className='dot ' + (running ? 'run' : ok ? 'ok' : 'err'); }
function val(id) { return $(id).value.trim(); }
function checked(id) { return $(id).checked; }
function t(key) {
  return (window.LMT_I18N && window.LMT_I18N.t(key)) || key;
}
function delay(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

async function runUiAction(name, button, action) {
  const btn = typeof button === 'string' ? $(button) : button;
  if (btn) btn.disabled = true;
  log(`[UI] ${name}`);
  try {
    return await action();
  } catch (e) {
    const message = String(e && (e.message || e) || e);
    log(`[UI ERROR] ${name}: ${message}`);
    throw e;
  } finally {
    if (btn) btn.disabled = false;
  }
}
function systemLanguageCode() {
  const supported = new Set(['ru','pl','de','es','it']);
  const code = String(navigator.language || 'en').toLowerCase().split('-')[0];
  return supported.has(code) ? code : 'en';
}
function applyI18n() {
  const i18n = window.LMT_I18N;
  if (!i18n) return;
  document.querySelectorAll('[data-i18n]').forEach(el => { el.textContent = i18n.t(el.dataset.i18n); });
  document.querySelectorAll('[data-i18n-placeholder]').forEach(el => { el.placeholder = i18n.t(el.dataset.i18nPlaceholder); });
}
function setVoiceStep(id, state, text) {
  const el = $(id);
  if (!el) return;
  el.className = `readinessItem ${state}`;
  el.textContent = text;
}
function setOutgoingState(state, title, detail) {
  const panel = $('outgoingState');
  if (panel) panel.className = `voiceState ${state}`;
  if ($('outgoingStateTitle')) $('outgoingStateTitle').textContent = title;
  if ($('outgoingStateDetail')) $('outgoingStateDetail').textContent = detail;
}
function resetOutgoingSteps() {
  setVoiceStep('voiceStepBridge', 'pending', t('stepBridge'));
  setVoiceStep('voiceStepTab', 'pending', t('stepTab'));
  setVoiceStep('voiceStepMic', 'pending', t('stepMic'));
  setVoiceStep('voiceStepOutput', 'pending', t('stepOutput'));
}

const VOICES = ['onyx', 'alloy', 'ash', 'ballad', 'coral', 'echo', 'fable', 'nova', 'sage', 'shimmer', 'verse'];
function initVoices() {
  const el = $('extTtsVoice');
  if (!el) return;
  el.innerHTML = VOICES.map(v => `<option value="${v}">${v}</option>`).join('');
}
function apply(s) {
  $('openaiKey').value = s.OPENAI_API_KEY || '';
  $('bridgePort').value = s.LOCAL_MEET_TRANSLATOR_PORT || '8799';
  $('voicePort').value = s.VOICE_CONVERSION_PORT || '18799';
  $('textModel').value = s.OPENAI_TEXT_MODEL || 'gpt-4o-mini';
  $('transcribeModel').value = s.OPENAI_TRANSCRIBE_MODEL || 'whisper-1';
  $('enableTts').checked = String(s.ENABLE_TTS || 'true') === 'true';
  $('enableVoiceConversion').checked = String(s.ENABLE_VOICE_CONVERSION || 'false') === 'true';
  $('token').value = s.LOCAL_MEET_TRANSLATOR_TOKEN || '';
  if ($('pairingCode')) $('pairingCode').value = s.DESKTOP_EXTENSION_PAIRING_CODE || '';
  if ($('desktopExtensionToken')) $('desktopExtensionToken').value = s.DESKTOP_EXTENSION_TOKEN || '';
  if ($('envPath')) $('envPath').textContent = s.__ENV_PATH || '';
  $('extSourceLang').value = s.EXT_SOURCE_LANG || 'auto';
  $('extTargetLang').value = s.EXT_TARGET_LANG || systemLanguageCode();
  $('extChunkSeconds').value = s.EXT_CHUNK_SECONDS || '3';
  const isolationMode = String(s.EXT_AUDIO_ISOLATION_MODE || 'true') === 'true';
  if ($('extAudioIsolationMode')) $('extAudioIsolationMode').checked = isolationMode;
  $('extTtsEnabled').checked = isolationMode ? false : String(s.EXT_TTS_ENABLED || 'false') === 'true';
  $('extTtsEnabled').disabled = isolationMode;
  $('extTtsVoice').value = s.EXT_TTS_VOICE || 'onyx';
  $('extTtsSpeed').value = s.EXT_TTS_SPEED || '1.0';
  $('extMicTxEnabled').checked = String(s.EXT_MIC_TX_ENABLED || 'false') === 'true';
  $('extMicTxSourceLang').value = s.EXT_MIC_TX_SOURCE_LANG || systemLanguageCode();
  $('extMicTxTargetLang').value = s.EXT_MIC_TX_TARGET_LANG || 'en';
  $('extMicTxChunkSeconds').value = s.EXT_MIC_TX_CHUNK_SECONDS || '5';
  $('extMicDeviceId').value = s.EXT_MIC_DEVICE_ID || '';
  if ($('extMicDeviceName')) $('extMicDeviceName').value = s.EXT_MIC_DEVICE_NAME || '';
  $('extTtsSinkDeviceId').value = s.EXT_TTS_SINK_DEVICE_ID || '';
  if ($('extTtsSinkDeviceName')) $('extTtsSinkDeviceName').value = s.EXT_TTS_SINK_DEVICE_NAME || 'CABLE Input';
  $('extOutVoiceStyle').value = s.EXT_OUT_VOICE_STYLE || 'openai';
  $('extRvcModelTag').value = s.EXT_RVC_MODEL_TAG || '';
  $('extShowOutgoingSubtitles').checked = String(s.EXT_SHOW_OUTGOING_SUBTITLES || 'false') === 'true';
  if ($('subtitleWindowEnabled')) $('subtitleWindowEnabled').checked = String(s.SUBTITLE_WINDOW_ENABLED || 'true') === 'true';
  if ($('subtitleContentProtection')) $('subtitleContentProtection').checked = String(s.SUBTITLE_WINDOW_CONTENT_PROTECTION || 'true') === 'true';
  if ($('subtitleAlwaysOnTop')) $('subtitleAlwaysOnTop').checked = String(s.SUBTITLE_WINDOW_ALWAYS_ON_TOP || 'true') === 'true';
  if ($('subtitleClickThrough')) $('subtitleClickThrough').checked = String(s.SUBTITLE_WINDOW_CLICK_THROUGH || 'false') === 'true';
  if ($('subtitleShowOriginal')) $('subtitleShowOriginal').checked = String(s.SUBTITLE_WINDOW_SHOW_ORIGINAL || 'true') === 'true';
  if ($('subtitleShowTranslation')) $('subtitleShowTranslation').checked = String(s.SUBTITLE_WINDOW_SHOW_TRANSLATION || 'true') === 'true';
  if ($('subtitleFontSize')) $('subtitleFontSize').value = s.SUBTITLE_WINDOW_FONT_SIZE || '28';
  if ($('subtitleBackgroundOpacity')) $('subtitleBackgroundOpacity').value = s.SUBTITLE_WINDOW_BACKGROUND_OPACITY || '0.82';
  if ($('subtitleMaxLines')) $('subtitleMaxLines').value = s.SUBTITLE_WINDOW_MAX_LINES || '3';
  if ($('subtitleHotkey')) $('subtitleHotkey').value = s.SUBTITLE_WINDOW_HOTKEY || 'CommandOrControl+Shift+S';
}
function readSettings() {
  return {
    OPENAI_API_KEY: val('openaiKey'),
    LOCAL_MEET_TRANSLATOR_PORT: val('bridgePort') || '8799',
    LOCAL_MEET_TRANSLATOR_TOKEN: val('token'),
    OPENAI_TEXT_MODEL: val('textModel') || 'gpt-4o-mini',
    OPENAI_TRANSCRIBE_MODEL: val('transcribeModel') || 'whisper-1',
    ENABLE_TTS: checked('enableTts') ? 'true' : 'false',
    ENABLE_VOICE_CONVERSION: checked('enableVoiceConversion') ? 'true' : 'false',
    VOICE_CONVERSION_HOST: '127.0.0.1',
    VOICE_CONVERSION_PORT: val('voicePort') || '18799',
    VOICE_CONVERSION_URL: `http://127.0.0.1:${val('voicePort') || '18799'}`,
    EXT_SOURCE_LANG: val('extSourceLang') || 'auto',
    EXT_TARGET_LANG: val('extTargetLang') || systemLanguageCode(),
    EXT_CHUNK_SECONDS: val('extChunkSeconds') || '3',
    EXT_AUDIO_ISOLATION_MODE: checked('extAudioIsolationMode') ? 'true' : 'false',
    EXT_TTS_ENABLED: checked('extAudioIsolationMode') ? 'false' : (checked('extTtsEnabled') ? 'true' : 'false'),
    EXT_TTS_VOICE: val('extTtsVoice') || 'onyx',
    EXT_TTS_SPEED: val('extTtsSpeed') || '1.0',
    EXT_MIC_TX_ENABLED: checked('extMicTxEnabled') ? 'true' : 'false',
    EXT_MIC_TX_SOURCE_LANG: val('extMicTxSourceLang') || systemLanguageCode(),
    EXT_MIC_TX_TARGET_LANG: val('extMicTxTargetLang') || 'en',
    EXT_MIC_TX_CHUNK_SECONDS: val('extMicTxChunkSeconds') || '5',
    EXT_MIC_DEVICE_ID: val('extMicDeviceId'),
    EXT_MIC_DEVICE_NAME: $('extMicDeviceName') ? val('extMicDeviceName') : '',
    EXT_TTS_SINK_DEVICE_ID: val('extTtsSinkDeviceId'),
    EXT_TTS_SINK_DEVICE_NAME: $('extTtsSinkDeviceName') ? val('extTtsSinkDeviceName') : 'CABLE Input',
    EXT_OUT_VOICE_STYLE: val('extOutVoiceStyle') || 'openai',
    EXT_RVC_MODEL_TAG: val('extRvcModelTag'),
    EXT_SHOW_OUTGOING_SUBTITLES: checked('extShowOutgoingSubtitles') ? 'true' : 'false',
    SUBTITLE_WINDOW_ENABLED: checked('subtitleWindowEnabled') ? 'true' : 'false',
    SUBTITLE_WINDOW_CONTENT_PROTECTION: checked('subtitleContentProtection') ? 'true' : 'false',
    SUBTITLE_WINDOW_ALWAYS_ON_TOP: checked('subtitleAlwaysOnTop') ? 'true' : 'false',
    SUBTITLE_WINDOW_CLICK_THROUGH: checked('subtitleClickThrough') ? 'true' : 'false',
    SUBTITLE_WINDOW_SHOW_ORIGINAL: checked('subtitleShowOriginal') ? 'true' : 'false',
    SUBTITLE_WINDOW_SHOW_TRANSLATION: checked('subtitleShowTranslation') ? 'true' : 'false',
    SUBTITLE_WINDOW_FONT_SIZE: val('subtitleFontSize') || '28',
    SUBTITLE_WINDOW_BACKGROUND_OPACITY: val('subtitleBackgroundOpacity') || '0.82',
    SUBTITLE_WINDOW_MAX_LINES: val('subtitleMaxLines') || '3',
    SUBTITLE_WINDOW_HOTKEY: val('subtitleHotkey') || 'CommandOrControl+Shift+S'
  };
}
function splitProfileLines(value) {
  const seen = new Set();
  const result = [];
  for (const raw of String(value || '').split(/\r?\n/)) {
    const text = raw.trim();
    const key = text.toLowerCase();
    if (!text || seen.has(key)) continue;
    seen.add(key);
    result.push(text);
  }
  return result;
}

function candidateProfileFromUi() {
  const confirmed = $('candidateFactsConfirmed') ? checked('candidateFactsConfirmed') : false;
  const locked = $('candidateFactsLocked') ? checked('candidateFactsLocked') : false;
  return {
    fullName: val('candidateFullName'),
    targetRole: val('candidateTargetRole'),
    location: val('candidateLocation'),
    professionalSummary: val('candidateSummary'),
    skills: splitProfileLines(val('candidateSkills')),
    languages: splitProfileLines(val('candidateLanguages')),
    experience: val('candidateExperience'),
    projects: val('candidateProjects'),
    education: val('candidateEducation'),
    resumeText: val('candidateResumeText'),
    resumeSource: $('candidateResumeSource') ? String($('candidateResumeSource').textContent || '').trim().replace(/^—$/, '') : '',
    confirmedFacts: splitProfileLines(val('candidateFacts')).map(text => ({
      text,
      source: 'manual',
      category: 'general',
      confirmed,
      locked
    }))
  };
}

function applyCandidateProfile(profile = {}) {
  if ($('candidateFullName')) $('candidateFullName').value = profile.fullName || '';
  if ($('candidateTargetRole')) $('candidateTargetRole').value = profile.targetRole || '';
  if ($('candidateLocation')) $('candidateLocation').value = profile.location || '';
  if ($('candidateSummary')) $('candidateSummary').value = profile.professionalSummary || '';
  if ($('candidateSkills')) $('candidateSkills').value = Array.isArray(profile.skills) ? profile.skills.join('\n') : String(profile.skills || '');
  if ($('candidateLanguages')) $('candidateLanguages').value = Array.isArray(profile.languages) ? profile.languages.join('\n') : String(profile.languages || '');
  if ($('candidateExperience')) $('candidateExperience').value = profile.experience || '';
  if ($('candidateProjects')) $('candidateProjects').value = profile.projects || '';
  if ($('candidateEducation')) $('candidateEducation').value = profile.education || '';
  if ($('candidateResumeText')) $('candidateResumeText').value = profile.resumeText || '';
  if ($('candidateResumeSource')) $('candidateResumeSource').textContent = profile.resumeSource || '—';
  const facts = Array.isArray(profile.confirmedFacts) ? profile.confirmedFacts : [];
  if ($('candidateFacts')) $('candidateFacts').value = facts.map(item => item && item.text ? item.text : '').filter(Boolean).join('\n');
  if ($('candidateFactsConfirmed')) $('candidateFactsConfirmed').checked = facts.length > 0 && facts.every(item => item && item.confirmed !== false);
  if ($('candidateFactsLocked')) $('candidateFactsLocked').checked = facts.length > 0 && facts.every(item => item && item.locked === true);
}

function renderCandidateProfileStatus(result = {}) {
  const profile = result.profile || result || {};
  const facts = Array.isArray(profile.confirmedFacts) ? profile.confirmedFacts : [];
  const confirmedCount = facts.filter(item => item && item.confirmed !== false).length;
  const loaded = !!(profile.fullName || profile.targetRole || profile.resumeText || facts.length);
  if ($('candidateProfileDot')) dot('candidateProfileDot', loaded || result.ok !== false, false);
  if ($('candidateProfileStatusText')) {
    $('candidateProfileStatusText').textContent = loaded
      ? `${t('candidateProfileLoaded')} · ${confirmedCount} ${t('candidateConfirmedFactsCount')}`
      : t('candidateProfileEmpty');
  }
  if ($('candidateProfilePath')) $('candidateProfilePath').textContent = result.path || result.filePath || '';
  if (result.warning) log(`[PROFILE WARNING] ${result.warning}`);
}

async function loadCandidateProfile() {
  const result = await window.lmt.candidateProfileLoad();
  applyCandidateProfile(result.profile || {});
  renderCandidateProfileStatus(result);
  return result;
}

async function refreshHealth() {
  const h = await window.lmt.health();
  dot('bridgeDot', h.bridge.ok); $('bridgeText').textContent = h.bridge.text;
  dot('voiceDot', h.voice.ok); $('voiceText').textContent = h.voice.text;
}
function protectionSummary(protection) {
  if (!protection) return t('subtitleProtectionUnknown');
  if (!protection.supported) return t('subtitleProtectionUnsupported');
  if (protection.applied) return t('subtitleProtectionApplied');
  if (protection.requested) return t('subtitleProtectionFailed');
  return t('subtitleProtectionDisabled');
}
function renderSubtitleStatus(status) {
  if (!status) return;
  const visible = !!status.visible;
  const protection = status.protection || {};
  if ($('subtitleWindowDot')) dot('subtitleWindowDot', protection.applied || (!protection.supported && !protection.requested), visible);
  if ($('subtitleWindowStateText')) {
    $('subtitleWindowStateText').textContent = visible ? t('subtitleWindowVisible') : t('subtitleWindowHidden');
  }
  if ($('subtitleProtectionText')) $('subtitleProtectionText').textContent = protectionSummary(protection);
  if ($('subtitleClickThrough') && status.settings) $('subtitleClickThrough').checked = !!status.settings.clickThrough;
}
async function refreshSubtitleStatus() {
  const status = await window.lmt.subtitleStatus();
  renderSubtitleStatus(status);
  return status;
}
try {
  window.lmt.onLog(log);
} catch (e) {
  log(`[INIT ERROR] Cannot attach desktop logs: ${String(e && (e.message || e) || e)}`);
}

window.addEventListener('error', (event) => {
  log(`[RENDERER ERROR] ${event.message || 'Unknown error'}`);
});
async function loadAppInfo() {
  try {
    const info = await window.lmt.appInfo();
    const version = String(info?.version || '').trim();
    const versionElement = $('appVersion');
    if (versionElement) versionElement.textContent = version ? `v${version}` : '';
    if (version) document.title = `Local Meet Translator ${version}`;
  } catch (error) {
    console.warn('Could not load application version.', error);
  }
}

window.addEventListener('unhandledrejection', (event) => {
  const reason = event && event.reason;
  log(`[RENDERER PROMISE ERROR] ${String(reason && (reason.message || reason) || reason || 'Unknown rejection')}`);
});

window.addEventListener('DOMContentLoaded', async () => {
  applyI18n();
  initVoices();
  resetOutgoingSteps();
  $('save').onclick = async () => {
    const r = await window.lmt.save(readSettings());
    apply(r.settings || {});
    renderSubtitleStatus(r.subtitle || await window.lmt.subtitleStatus());
    log(r.message);
  };
  $('openEnv').onclick = () => window.lmt.openEnv();
  if ($('showSubtitleWindow')) $('showSubtitleWindow').onclick = async () => {
    renderSubtitleStatus(await window.lmt.subtitleControl('show'));
  };
  if ($('hideSubtitleWindow')) $('hideSubtitleWindow').onclick = async () => {
    renderSubtitleStatus(await window.lmt.subtitleControl('hide'));
  };
  if ($('clearSubtitleWindow')) $('clearSubtitleWindow').onclick = async () => {
    renderSubtitleStatus(await window.lmt.subtitleControl('clear'));
  };
  if ($('testSubtitleProtection')) $('testSubtitleProtection').onclick = async () => {
    const button = $('testSubtitleProtection');
    button.disabled = true;
    try {
      const result = await window.lmt.subtitleControl('testProtection');
      renderSubtitleStatus(result.protection ? { ...result, protection: result.protection } : result);
      log(`[SUBTITLE PROTECTION] ${result.result || 'unknown'}: ${result.detail || ''}`);
    } finally {
      button.disabled = false;
    }
  };
  if ($('subtitleClickThrough')) $('subtitleClickThrough').onchange = async () => {
    const saved = await window.lmt.save(readSettings());
    apply(saved.settings || {});
    renderSubtitleStatus(saved.subtitle || await window.lmt.subtitleStatus());
  };
  if ($('enableOutgoingVoice')) $('enableOutgoingVoice').onclick = async () => {
    const button = $('enableOutgoingVoice');
    log('[UI] Start voice translation clicked.');
    if (!$('meetingCableConfirmed') || !$('meetingCableConfirmed').checked) {
      setOutgoingState('error', t('voiceNeedsConfirmation'), t('voiceNeedsConfirmationDetail'));
      setVoiceStep('voiceStepOutput', 'error', t('stepMeetingOutputMissing'));
      return;
    }
    button.disabled = true;
    let voiceStarted = false;
    resetOutgoingSteps();
    setOutgoingState('checking', t('voiceStarting'), t('voiceChecking'));
    try {
      $('extMicTxEnabled').checked = true;
      if ($('extAudioIsolationMode')) $('extAudioIsolationMode').checked = true;
      $('enableTts').checked = true;
      if ($('extTtsEnabled')) $('extTtsEnabled').checked = false;
      if ($('extTtsEnabled')) $('extTtsEnabled').disabled = true;
      if ($('extTtsSinkDeviceName') && !$('extTtsSinkDeviceName').value.trim()) $('extTtsSinkDeviceName').value = 'CABLE Input';
      await window.lmt.save(readSettings());

      setVoiceStep('voiceStepOutput', 'checking', t('stepOutputChecking'));
      const cable = await window.lmt.checkCable();
      dot('cableDot', cable.ok);
      $('cableText').textContent = cable.text;
      if (!cable.ok) {
        setVoiceStep('voiceStepOutput', 'error', t('stepOutputFailed'));
        setOutgoingState('error', t('voiceNotStarted'), cable.text);
        return;
      }
      setVoiceStep('voiceStepOutput', 'ok', t('stepOutputReady'));

      setVoiceStep('voiceStepBridge', 'checking', t('stepBridgeChecking'));
      let health = await window.lmt.health();
      if (!health.bridge.ok) {
        const started = await window.lmt.startBridge();
        log(started.message);
        await delay(1600);
        health = await window.lmt.health();
      }
      dot('bridgeDot', health.bridge.ok);
      $('bridgeText').textContent = health.bridge.text;
      if (!health.bridge.ok) {
        setVoiceStep('voiceStepBridge', 'error', t('stepBridgeFailed'));
        setOutgoingState('error', t('voiceNotStarted'), health.bridge.text);
        return;
      }
      setVoiceStep('voiceStepBridge', 'ok', t('stepBridgeReady'));

      setVoiceStep('voiceStepTab', 'checking', t('stepTabChecking'));
      setVoiceStep('voiceStepMic', 'checking', t('stepMicChecking'));
      const result = await window.lmt.startTranslation({
        mode: 'voice',
        micTxEnabled: true,
        audioIsolationMode: true,
        ttsEnabled: false,
        micDeviceName: $('extMicDeviceName') ? val('extMicDeviceName') : '',
        micDeviceId: $('extMicDeviceId') ? val('extMicDeviceId') : '',
        ttsSinkDeviceName: $('extTtsSinkDeviceName') ? (val('extTtsSinkDeviceName') || 'CABLE Input') : 'CABLE Input',
        ttsSinkDeviceId: $('extTtsSinkDeviceId') ? val('extTtsSinkDeviceId') : '',
        micTxSourceLang: val('extMicTxSourceLang') || systemLanguageCode(),
        micTxTargetLang: val('extMicTxTargetLang') || 'en',
        micTxChunkSeconds: val('extMicTxChunkSeconds') || '5',
        outVoiceStyle: val('extOutVoiceStyle') || 'openai',
        rvcModelTag: val('extRvcModelTag'),
        showOutgoingSubtitles: checked('extShowOutgoingSubtitles')
      });
      log(result.message);
      if (!result.ok) {
        const details = result.details || {};
        setVoiceStep('voiceStepTab', result.state === 'tab-missing' || result.state === 'timeout' ? 'error' : 'ok',
          result.state === 'tab-missing' || result.state === 'timeout' ? t('stepTabFailed') : t('stepTabReady'));
        setVoiceStep('voiceStepMic', 'error', t('stepMicFailed'));
        if (details.sinkReady === false) setVoiceStep('voiceStepOutput', 'error', t('stepOutputFailed'));
        const detail = result.state === 'tab-missing' || result.state === 'timeout'
          ? t('voiceConnectTabDetail')
          : `${t('voiceAudioAccessDetail')} ${result.message}`;
        setOutgoingState('error', t('voiceNotStarted'), detail);
        return;
      }

      const details = result.details || {};
      setVoiceStep('voiceStepTab', 'ok', t('stepTabReady'));
      setVoiceStep('voiceStepMic', details.micTxReady ? 'ok' : 'error',
        details.micTxReady ? `${t('stepMicReady')}: ${details.microphoneLabel || t('ready')}` : t('stepMicFailed'));
      setVoiceStep('voiceStepOutput', details.sinkReady ? 'ok' : 'error',
        details.sinkReady ? `${t('stepOutputReady')}: ${details.outputLabel || 'CABLE Input'}` : t('stepOutputFailed'));
      if (!details.micTxReady || !details.sinkReady) {
        setOutgoingState('error', t('voiceNotStarted'), t('voiceReadinessFailed'));
        return;
      }
      setOutgoingState('running', t('voiceRunning'), t('voiceRunningDetail'));
      voiceStarted = true;
    } catch (e) {
      setOutgoingState('error', t('voiceNotStarted'), String(e && (e.message || e)));
    } finally {
      if (!voiceStarted) {
        $('extMicTxEnabled').checked = false;
        await window.lmt.save(readSettings());
      }
      button.disabled = false;
    }
  };
  if ($('disableOutgoingVoice')) $('disableOutgoingVoice').onclick = async () => {
    await runUiAction('Switch to subtitles-only mode clicked.', 'disableOutgoingVoice', async () => {
      $('extMicTxEnabled').checked = false;
      await window.lmt.save(readSettings());
      const result = await window.lmt.startTranslation({ mode: 'subtitles', micTxEnabled: false });
      log(result.message);
      resetOutgoingSteps();
      setOutgoingState('idle', t('voiceOff'), t('voiceStoppedDetail'));
      return result;
    });
  };
  $('startBridge').onclick = async () => { await window.lmt.save(readSettings()); log((await window.lmt.startBridge()).message); setTimeout(refreshHealth, 1200); };
  $('stopBridge').onclick = async () => { log((await window.lmt.stopBridge()).message); setTimeout(refreshHealth, 500); };
  $('startVoice').onclick = async () => { await window.lmt.save(readSettings()); log((await window.lmt.startVoice()).message); setTimeout(refreshHealth, 1200); };
  $('stopVoice').onclick = async () => { log((await window.lmt.stopVoice()).message); setTimeout(refreshHealth, 500); };
  $('health').onclick = refreshHealth;
  $('checkCable').onclick = async () => { const r = await window.lmt.checkCable(); dot('cableDot', r.ok); $('cableText').textContent = r.text; log(r.text); };
  $('openExtension').onclick = async () => log((await window.lmt.openExtension()).message);
  $("startTranslation").onclick = async () => {
    await runUiAction('Start subtitles only clicked.', 'startTranslation', async () => {
      $('extMicTxEnabled').checked = false;
      const saved = await window.lmt.save(readSettings());
      if (saved && saved.message) log(saved.message);
      const result = await window.lmt.startTranslation({ mode: 'subtitles', micTxEnabled: false });
      log(result && result.message ? result.message : JSON.stringify(result || {}));
      return result;
    });
  };
  $("stopTranslation").onclick = async () => {
    await runUiAction('Stop all translation clicked.', 'stopTranslation', async () => {
      const result = await window.lmt.stopTranslation();
      log(result && result.message ? result.message : JSON.stringify(result || {}));
      resetOutgoingSteps();
      setOutgoingState('idle', t('voiceOff'), t('voiceStoppedDetail'));
      return result;
    });
  };
  if ($('saveCandidateProfile')) $('saveCandidateProfile').onclick = async () => {
    await runUiAction('Save candidate profile clicked.', 'saveCandidateProfile', async () => {
      const result = await window.lmt.candidateProfileSave(candidateProfileFromUi());
      applyCandidateProfile(result.profile || {});
      renderCandidateProfileStatus(result);
      log(`[PROFILE] ${t('candidateProfileSaved')}`);
      return result;
    });
  };
  if ($('importCandidateProfile')) $('importCandidateProfile').onclick = async () => {
    await runUiAction('Import candidate profile clicked.', 'importCandidateProfile', async () => {
      const result = await window.lmt.candidateProfileImport();
      if (!result || result.canceled) return result;
      if (!result.ok) throw new Error(result.error || 'Candidate profile import failed.');
      applyCandidateProfile(result.profile || {});
      renderCandidateProfileStatus(result);
      log(`[PROFILE] ${t('candidateProfileImportedReview')}`);
      return result;
    });
  };
  if ($('exportCandidateProfile')) $('exportCandidateProfile').onclick = async () => {
    await runUiAction('Export candidate profile clicked.', 'exportCandidateProfile', async () => {
      const result = await window.lmt.candidateProfileExport(candidateProfileFromUi());
      if (result && !result.canceled && !result.ok) throw new Error(result.error || 'Candidate profile export failed.');
      if (result && result.ok) log(`[PROFILE] ${t('candidateProfileExported')}: ${result.filePath || ''}`);
      return result;
    });
  };
  if ($('resetCandidateProfile')) $('resetCandidateProfile').onclick = async () => {
    if (!window.confirm(t('candidateProfileResetConfirm'))) return;
    await runUiAction('Reset candidate profile clicked.', 'resetCandidateProfile', async () => {
      const result = await window.lmt.candidateProfileReset();
      applyCandidateProfile(result.profile || {});
      renderCandidateProfileStatus(result);
      log(`[PROFILE] ${t('candidateProfileCleared')}`);
      return result;
    });
  };

  if ($('extAudioIsolationMode')) $('extAudioIsolationMode').onchange = () => {
    const isolationMode = checked('extAudioIsolationMode');
    $('extTtsEnabled').disabled = isolationMode;
    if (isolationMode) $('extTtsEnabled').checked = false;
    if (isolationMode && $('extTtsSinkDeviceName') && !$('extTtsSinkDeviceName').value.trim()) $('extTtsSinkDeviceName').value = 'CABLE Input';
  };

  // Bind controls before asynchronous startup work. Previously, a failed IPC or
  // health request could abort initialization before Start/Stop handlers existed.
  try {
    await loadAppInfo();
    const settings = await window.lmt.load();
    apply(settings || {});
    await refreshSubtitleStatus();
    await loadCandidateProfile();
    log('[INIT] Settings and candidate profile loaded; controls are ready.');
  } catch (e) {
    log(`[INIT ERROR] Settings load failed: ${String(e && (e.message || e) || e)}`);
  }
  try {
    await refreshHealth();
  } catch (e) {
    log(`[INIT WARN] Health check failed: ${String(e && (e.message || e) || e)}`);
  }
});
