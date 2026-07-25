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

let currentView = 'home';
let suppressCandidateDirty = false;
let candidateProfileBaseline = '';
let candidateProfileStoredProfile = {};
let candidateProfileStoragePath = '';
let candidateProfileDirty = false;
let answerLibraryState = { schemaVersion: 1, entries: [], updatedAt: '' };
let selectedAnswerId = '';
let answerEditorDirty = false;
let suppressAnswerDirty = false;
let assistantState = { status: 'idle', question: null, suggestion: null, settings: {}, protection: {} };
let assistantQuestionHistory = [];
let interviewTrainingState = { schemaVersion: 1, sessions: [], updatedAt: '' };
let interviewTrainingPath = '';
let activeTrainingSessionId = '';
let trainerReferenceVisible = false;

function stableJson(value) {
  return JSON.stringify(value || {});
}

function notifyWorkspaceDirtyState() {
  try {
    if (window.lmt && typeof window.lmt.setWorkspaceDirty === 'function') {
      window.lmt.setWorkspaceDirty({ candidateProfile: candidateProfileDirty, answerLibrary: answerEditorDirty });
    }
  } catch (_) {}
}

function setCandidateProfileDirty(dirty) {
  candidateProfileDirty = !!dirty;
  const banner = $('candidateProfileDirtyBanner');
  if (banner) banner.hidden = !candidateProfileDirty;
  notifyWorkspaceDirtyState();
}

function setAnswerEditorDirty(dirty) {
  answerEditorDirty = !!dirty;
  const banner = $('answerLibraryDirtyBanner');
  if (banner) banner.hidden = !answerEditorDirty;
  notifyWorkspaceDirtyState();
}

function confirmDiscardCurrentView() {
  if (currentView === 'candidate-profile' && candidateProfileDirty) {
    if (!window.confirm(t('discardUnsavedProfileChanges'))) return false;
    applyCandidateProfile(candidateProfileStoredProfile, { markClean: true });
    renderCandidateProfileStatus({ ok: true, profile: candidateProfileStoredProfile, path: candidateProfileStoragePath });
  }
  if (currentView === 'answer-library' && answerEditorDirty) {
    if (!window.confirm(t('discardUnsavedAnswerChanges'))) return false;
    const savedEntry = (answerLibraryState.entries || []).find(entry => entry.id === selectedAnswerId);
    applyAnswerEntry(savedEntry || emptyAnswerEntry(), { markClean: true });
    renderAnswerEntryList();
  }
  return true;
}

function showView(view, options = {}) {
  const targetView = String(view || 'home');
  if (!options.force && targetView !== currentView && !confirmDiscardCurrentView()) return false;
  document.querySelectorAll('.appView').forEach(element => {
    const active = element.dataset.view === targetView;
    element.hidden = !active;
    element.classList.toggle('active', active);
  });
  currentView = targetView;
  document.body.classList.toggle('focusedMode', targetView !== 'home');
  window.scrollTo({ top: 0, behavior: 'auto' });
  return true;
}

function createClientId(prefix = 'entry') {
  if (window.crypto && typeof window.crypto.randomUUID === 'function') return window.crypto.randomUUID();
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
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
  if ($('assistantEnabled')) $('assistantEnabled').checked = String(s.INTERVIEW_ASSISTANT_ENABLED || 'true') === 'true';
  if ($('assistantAutoAnalyze')) $('assistantAutoAnalyze').checked = String(s.INTERVIEW_ASSISTANT_AUTO_ANALYZE || 'false') === 'true';
  if ($('assistantContentProtection')) $('assistantContentProtection').checked = String(s.INTERVIEW_ASSISTANT_CONTENT_PROTECTION || 'true') === 'true';
  if ($('assistantAlwaysOnTop')) $('assistantAlwaysOnTop').checked = String(s.INTERVIEW_ASSISTANT_ALWAYS_ON_TOP || 'true') === 'true';
  if ($('assistantClickThrough')) $('assistantClickThrough').checked = String(s.INTERVIEW_ASSISTANT_CLICK_THROUGH || 'false') === 'true';
  if ($('assistantLanguageLevel')) $('assistantLanguageLevel').value = s.INTERVIEW_ASSISTANT_LANGUAGE_LEVEL || 'B1';
  if ($('assistantAnswerStyle')) $('assistantAnswerStyle').value = s.INTERVIEW_ASSISTANT_ANSWER_STYLE || 'simple';
  if ($('assistantFontSize')) $('assistantFontSize').value = s.INTERVIEW_ASSISTANT_FONT_SIZE || '20';
  if ($('assistantBackgroundOpacity')) $('assistantBackgroundOpacity').value = s.INTERVIEW_ASSISTANT_BACKGROUND_OPACITY || '0.94';
  if ($('assistantHotkey')) $('assistantHotkey').value = s.INTERVIEW_ASSISTANT_HOTKEY || 'CommandOrControl+Shift+A';
  if ($('assistantMoveHotkey')) $('assistantMoveHotkey').value = s.INTERVIEW_ASSISTANT_MOVE_HOTKEY || 'CommandOrControl+Shift+M';
  if ($('assistantTeleprompterEnabled')) $('assistantTeleprompterEnabled').checked = String(s.INTERVIEW_TELEPROMPTER_ENABLED || 'true') === 'true';
  if ($('assistantTeleprompterFrozen')) $('assistantTeleprompterFrozen').checked = String(s.INTERVIEW_TELEPROMPTER_FROZEN || 'false') === 'true';
  if ($('assistantTeleprompterAutoStart')) $('assistantTeleprompterAutoStart').checked = String(s.INTERVIEW_TELEPROMPTER_AUTO_START || 'true') === 'true';
  if ($('assistantTeleprompterShowPlan')) $('assistantTeleprompterShowPlan').checked = String(s.INTERVIEW_TELEPROMPTER_SHOW_PLAN || 'true') === 'true';
  if ($('assistantTeleprompterShowKeywords')) $('assistantTeleprompterShowKeywords').checked = String(s.INTERVIEW_TELEPROMPTER_SHOW_KEYWORDS || 'true') === 'true';
  if ($('assistantTeleprompterChunkMode')) $('assistantTeleprompterChunkMode').value = s.INTERVIEW_TELEPROMPTER_CHUNK_MODE || 'medium';
  if ($('assistantTeleprompterNextHotkey')) $('assistantTeleprompterNextHotkey').value = s.INTERVIEW_TELEPROMPTER_NEXT_HOTKEY || 'CommandOrControl+Shift+Right';
  if ($('assistantTeleprompterPreviousHotkey')) $('assistantTeleprompterPreviousHotkey').value = s.INTERVIEW_TELEPROMPTER_PREVIOUS_HOTKEY || 'CommandOrControl+Shift+Left';
  if ($('assistantTeleprompterFreezeHotkey')) $('assistantTeleprompterFreezeHotkey').value = s.INTERVIEW_TELEPROMPTER_FREEZE_HOTKEY || 'CommandOrControl+Shift+F';
  if ($('assistantTeleprompterPendingHotkey')) $('assistantTeleprompterPendingHotkey').value = s.INTERVIEW_TELEPROMPTER_LOAD_PENDING_HOTKEY || 'CommandOrControl+Shift+Enter';
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
    SUBTITLE_WINDOW_HOTKEY: val('subtitleHotkey') || 'CommandOrControl+Shift+S',
    INTERVIEW_ASSISTANT_ENABLED: $('assistantEnabled') && checked('assistantEnabled') ? 'true' : 'false',
    INTERVIEW_ASSISTANT_AUTO_ANALYZE: $('assistantAutoAnalyze') && checked('assistantAutoAnalyze') ? 'true' : 'false',
    INTERVIEW_ASSISTANT_CONTENT_PROTECTION: $('assistantContentProtection') && checked('assistantContentProtection') ? 'true' : 'false',
    INTERVIEW_ASSISTANT_ALWAYS_ON_TOP: $('assistantAlwaysOnTop') && checked('assistantAlwaysOnTop') ? 'true' : 'false',
    INTERVIEW_ASSISTANT_CLICK_THROUGH: $('assistantClickThrough') && checked('assistantClickThrough') ? 'true' : 'false',
    INTERVIEW_ASSISTANT_LANGUAGE_LEVEL: $('assistantLanguageLevel') ? val('assistantLanguageLevel') || 'B1' : 'B1',
    INTERVIEW_ASSISTANT_ANSWER_STYLE: $('assistantAnswerStyle') ? val('assistantAnswerStyle') || 'simple' : 'simple',
    INTERVIEW_ASSISTANT_FONT_SIZE: $('assistantFontSize') ? val('assistantFontSize') || '20' : '20',
    INTERVIEW_ASSISTANT_BACKGROUND_OPACITY: $('assistantBackgroundOpacity') ? val('assistantBackgroundOpacity') || '0.94' : '0.94',
    INTERVIEW_ASSISTANT_HOTKEY: $('assistantHotkey') ? val('assistantHotkey') || 'CommandOrControl+Shift+A' : 'CommandOrControl+Shift+A',
    INTERVIEW_ASSISTANT_MOVE_HOTKEY: $('assistantMoveHotkey') ? val('assistantMoveHotkey') || 'CommandOrControl+Shift+M' : 'CommandOrControl+Shift+M',
    INTERVIEW_TELEPROMPTER_ENABLED: $('assistantTeleprompterEnabled') && checked('assistantTeleprompterEnabled') ? 'true' : 'false',
    INTERVIEW_TELEPROMPTER_FROZEN: $('assistantTeleprompterFrozen') && checked('assistantTeleprompterFrozen') ? 'true' : 'false',
    INTERVIEW_TELEPROMPTER_AUTO_START: $('assistantTeleprompterAutoStart') && checked('assistantTeleprompterAutoStart') ? 'true' : 'false',
    INTERVIEW_TELEPROMPTER_SHOW_PLAN: $('assistantTeleprompterShowPlan') && checked('assistantTeleprompterShowPlan') ? 'true' : 'false',
    INTERVIEW_TELEPROMPTER_SHOW_KEYWORDS: $('assistantTeleprompterShowKeywords') && checked('assistantTeleprompterShowKeywords') ? 'true' : 'false',
    INTERVIEW_TELEPROMPTER_CHUNK_MODE: $('assistantTeleprompterChunkMode') ? val('assistantTeleprompterChunkMode') || 'medium' : 'medium',
    INTERVIEW_TELEPROMPTER_NEXT_HOTKEY: $('assistantTeleprompterNextHotkey') ? val('assistantTeleprompterNextHotkey') || 'CommandOrControl+Shift+Right' : 'CommandOrControl+Shift+Right',
    INTERVIEW_TELEPROMPTER_PREVIOUS_HOTKEY: $('assistantTeleprompterPreviousHotkey') ? val('assistantTeleprompterPreviousHotkey') || 'CommandOrControl+Shift+Left' : 'CommandOrControl+Shift+Left',
    INTERVIEW_TELEPROMPTER_FREEZE_HOTKEY: $('assistantTeleprompterFreezeHotkey') ? val('assistantTeleprompterFreezeHotkey') || 'CommandOrControl+Shift+F' : 'CommandOrControl+Shift+F',
    INTERVIEW_TELEPROMPTER_LOAD_PENDING_HOTKEY: $('assistantTeleprompterPendingHotkey') ? val('assistantTeleprompterPendingHotkey') || 'CommandOrControl+Shift+Enter' : 'CommandOrControl+Shift+Enter'
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

function applyCandidateProfile(profile = {}, options = {}) {
  suppressCandidateDirty = true;
  try {
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
  } finally {
    suppressCandidateDirty = false;
  }
  if (options.markClean !== false) {
    candidateProfileBaseline = stableJson(candidateProfileFromUi());
    candidateProfileStoredProfile = JSON.parse(candidateProfileBaseline || '{}');
    setCandidateProfileDirty(false);
  } else {
    setCandidateProfileDirty(stableJson(candidateProfileFromUi()) !== candidateProfileBaseline);
  }
}

function renderCandidateProfileStatus(result = {}) {
  const profile = result.profile || result || {};
  const facts = Array.isArray(profile.confirmedFacts) ? profile.confirmedFacts : [];
  const confirmedCount = facts.filter(item => item && item.confirmed !== false).length;
  const loaded = !!(profile.fullName || profile.targetRole || profile.resumeText || facts.length);
  const statusText = loaded
    ? `${t('candidateProfileLoaded')} · ${confirmedCount} ${t('candidateConfirmedFactsCount')}`
    : t('candidateProfileEmpty');
  for (const dotId of ['candidateProfileDot', 'candidateProfileScreenDot']) {
    if ($(dotId)) dot(dotId, loaded || result.ok !== false, false);
  }
  for (const statusId of ['candidateProfileStatusText', 'candidateProfileScreenStatusText']) {
    if ($(statusId)) $(statusId).textContent = statusText;
  }
  const profilePath = result.path || candidateProfileStoragePath || '';
  for (const pathId of ['candidateProfilePath', 'candidateProfileScreenPath']) {
    if ($(pathId)) $(pathId).textContent = profilePath;
  }
  if ($('candidateProfileIdentity')) {
    const identity = [profile.fullName, profile.targetRole].filter(Boolean).join(' · ');
    $('candidateProfileIdentity').textContent = identity || t('candidateProfileNoIdentity');
  }
  if ($('candidateProfileFactSummary')) {
    $('candidateProfileFactSummary').textContent = confirmedCount
      ? `${confirmedCount} ${t('candidateConfirmedFactsCount')}`
      : t('candidateProfileNoFacts');
  }
  if (result.warning) log(`[PROFILE WARNING] ${result.warning}`);
}

async function loadCandidateProfile() {
  const result = await window.lmt.candidateProfileLoad();
  candidateProfileStoragePath = result.path || candidateProfileStoragePath;
  applyCandidateProfile(result.profile || {}, { markClean: true });
  renderCandidateProfileStatus(result);
  return result;
}

function emptyAnswerEntry() {
  return {
    id: '',
    question: '',
    intent: '',
    level: 'B1',
    style: 'simple',
    answer: '',
    firstSentence: '',
    keywords: [],
    groundingFacts: [],
    locked: false,
    createdAt: '',
    updatedAt: ''
  };
}

function answerEntryFromUi() {
  return {
    id: val('answerEntryId'),
    question: val('answerQuestion'),
    intent: val('answerIntent'),
    level: val('answerLevel') || 'B1',
    style: val('answerStyle') || 'simple',
    answer: val('answerText'),
    firstSentence: val('answerFirstSentence'),
    keywords: splitProfileLines(val('answerKeywords')),
    groundingFacts: splitProfileLines(val('answerGroundingFacts')),
    locked: checked('answerLocked')
  };
}

function applyAnswerEntry(entry = {}, options = {}) {
  const value = { ...emptyAnswerEntry(), ...entry };
  suppressAnswerDirty = true;
  try {
    $('answerEntryId').value = value.id || '';
    $('answerQuestion').value = value.question || '';
    $('answerIntent').value = value.intent || '';
    $('answerLevel').value = value.level || 'B1';
    $('answerStyle').value = value.style || 'simple';
    $('answerText').value = value.answer || '';
    $('answerFirstSentence').value = value.firstSentence || '';
    $('answerKeywords').value = Array.isArray(value.keywords) ? value.keywords.join('\n') : String(value.keywords || '');
    $('answerGroundingFacts').value = Array.isArray(value.groundingFacts) ? value.groundingFacts.join('\n') : String(value.groundingFacts || '');
    $('answerLocked').checked = value.locked === true;
  } finally {
    suppressAnswerDirty = false;
  }
  selectedAnswerId = value.id || '';
  if (options.markClean !== false) setAnswerEditorDirty(false);
}

function renderAnswerLibraryStatus(result = {}) {
  const library = result.library || result || answerLibraryState;
  const entries = Array.isArray(library.entries) ? library.entries : [];
  const lockedCount = entries.filter(entry => entry && entry.locked === true).length;
  if ($('answerLibraryDot')) dot('answerLibraryDot', result.ok !== false, false);
  if ($('answerLibraryStatusText')) {
    $('answerLibraryStatusText').textContent = entries.length
      ? `${t('answerLibraryLoaded')} · ${entries.length} ${t('savedAnswersCount')}`
      : t('answerLibraryEmpty');
  }
  if ($('answerLibraryPath')) $('answerLibraryPath').textContent = result.path || result.filePath || '';
  if ($('answerLibraryCount')) {
    $('answerLibraryCount').textContent = entries.length
      ? `${entries.length} ${t('savedAnswersCount')}`
      : t('answerLibraryEmpty');
  }
  if ($('answerLibraryLockedCount')) {
    $('answerLibraryLockedCount').textContent = lockedCount
      ? `${lockedCount} ${t('lockedAnswersCount')}`
      : t('answerLibraryNoLocked');
  }
  if ($('answerLibraryScreenCount')) $('answerLibraryScreenCount').textContent = String(entries.length);
  if (result.warning) log(`[ANSWER LIBRARY WARNING] ${result.warning}`);
}

function renderAnswerEntryList() {
  const list = $('answerEntryList');
  const empty = $('answerEmptyState');
  if (!list) return;
  const entries = Array.isArray(answerLibraryState.entries) ? answerLibraryState.entries : [];
  list.innerHTML = '';
  if (empty) empty.hidden = entries.length > 0;
  for (const entry of entries) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `answerListItem${entry.id === selectedAnswerId ? ' selected' : ''}`;
    button.dataset.answerId = entry.id;
    const question = document.createElement('strong');
    question.textContent = entry.question || t('untitledAnswer');
    const meta = document.createElement('span');
    meta.textContent = [entry.level || 'B1', t(`answerStyle_${entry.style || 'simple'}`), entry.locked ? t('lockedLabel') : ''].filter(Boolean).join(' · ');
    button.append(question, meta);
    button.onclick = () => selectAnswerEntry(entry.id);
    list.appendChild(button);
  }
}

function selectAnswerEntry(id, options = {}) {
  if (!options.force && answerEditorDirty && !window.confirm(t('discardUnsavedAnswerChanges'))) return false;
  const entry = (answerLibraryState.entries || []).find(item => item.id === id);
  if (!entry) return false;
  applyAnswerEntry(entry, { markClean: true });
  renderAnswerEntryList();
  return true;
}

function applyAnswerLibrary(library = {}, options = {}) {
  answerLibraryState = {
    schemaVersion: Number(library.schemaVersion) || 1,
    entries: Array.isArray(library.entries) ? library.entries.map(entry => ({ ...entry })) : [],
    updatedAt: library.updatedAt || ''
  };
  const selectedExists = answerLibraryState.entries.some(entry => entry.id === selectedAnswerId);
  if (!selectedExists) selectedAnswerId = answerLibraryState.entries[0]?.id || '';
  if (selectedAnswerId) {
    const selected = answerLibraryState.entries.find(entry => entry.id === selectedAnswerId);
    applyAnswerEntry(selected || emptyAnswerEntry(), { markClean: options.markClean !== false });
  } else {
    applyAnswerEntry(emptyAnswerEntry(), { markClean: options.markClean !== false });
  }
  renderAnswerEntryList();
  renderAnswerLibraryStatus({ ...options, library: answerLibraryState, ok: options.ok !== false, path: options.path || '' });
}

async function loadAnswerLibrary() {
  const result = await window.lmt.answerLibraryLoad();
  applyAnswerLibrary(result.library || {}, { ...result, markClean: true });
  return result;
}

async function persistAnswerLibrary(messageKey = 'answerLibrarySaved') {
  const result = await window.lmt.answerLibrarySave(answerLibraryState);
  applyAnswerLibrary(result.library || {}, { ...result, markClean: true });
  log(`[ANSWER LIBRARY] ${t(messageKey)}`);
  return result;
}

async function saveCurrentAnswer() {
  const entry = answerEntryFromUi();
  if (!entry.question) throw new Error(t('answerQuestionRequired'));
  if (!entry.answer) throw new Error(t('answerTextRequired'));
  const now = new Date().toISOString();
  if (!entry.id) entry.id = createClientId('answer');
  const previous = (answerLibraryState.entries || []).find(item => item.id === entry.id);
  const stored = {
    ...previous,
    ...entry,
    createdAt: previous?.createdAt || now,
    updatedAt: now,
    order: previous?.order ?? answerLibraryState.entries.length
  };
  const index = answerLibraryState.entries.findIndex(item => item.id === stored.id);
  if (index >= 0) answerLibraryState.entries[index] = stored;
  else answerLibraryState.entries.push(stored);
  selectedAnswerId = stored.id;
  return persistAnswerLibrary('answerSaved');
}

async function deleteCurrentAnswer() {
  if (!selectedAnswerId) return { ok: true };
  if (!window.confirm(t('deleteAnswerConfirm'))) return { ok: false, canceled: true };
  answerLibraryState.entries = (answerLibraryState.entries || []).filter(entry => entry.id !== selectedAnswerId);
  selectedAnswerId = answerLibraryState.entries[0]?.id || '';
  return persistAnswerLibrary('answerDeleted');
}


function assistantProtectionSummary(protection = {}) {
  if (!protection.supported) return t('assistantProtectionUnsupported');
  if (protection.applied) return t('assistantProtectionApplied');
  if (protection.requested) return t('assistantProtectionFailed');
  return t('assistantProtectionDisabled');
}

function renderAssistantQuestionHistory() {
  const root = $('assistantQuestionHistory');
  const empty = $('assistantQuestionHistoryEmpty');
  if (!root) return;
  root.innerHTML = '';
  const items = assistantQuestionHistory.slice().reverse();
  if (empty) empty.hidden = items.length > 0;
  for (const item of items) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'questionHistoryItem';
    button.textContent = item.text;
    button.onclick = () => {
      if ($('assistantQuestionInput')) $('assistantQuestionInput').value = item.text;
      showView('live-assistant');
    };
    root.appendChild(button);
  }
}

function rememberDetectedQuestion(question) {
  if (!question || !question.text) return;
  const normalized = String(question.normalized || question.text).toLowerCase();
  assistantQuestionHistory = assistantQuestionHistory.filter(item => String(item.normalized || item.text).toLowerCase() !== normalized);
  assistantQuestionHistory.push({ ...question });
  if (assistantQuestionHistory.length > 30) assistantQuestionHistory.splice(0, assistantQuestionHistory.length - 30);
  if ($('assistantQuestionInput')) $('assistantQuestionInput').value = question.text;
  renderAssistantQuestionHistory();
}

function renderAssistantSuggestion(suggestion) {
  const value = suggestion || {};
  if ($('assistantResultSource')) $('assistantResultSource').textContent = value.source === 'library' ? t('assistantSourceLibrary') : value.answer ? t('assistantSourceAi') : '—';
  if ($('assistantResultConfidence')) $('assistantResultConfidence').textContent = value.confidence ? `${t('assistantConfidence')}: ${String(value.confidence).toUpperCase()}` : '—';
  if ($('assistantResultFirstSentence')) $('assistantResultFirstSentence').value = value.firstSentence || '';
  if ($('assistantResultAnswer')) $('assistantResultAnswer').value = value.answer || '';
  if ($('assistantResultKeyPoints')) $('assistantResultKeyPoints').value = Array.isArray(value.keyPoints) ? value.keyPoints.join('\n') : '';
  if ($('assistantResultBasis')) $('assistantResultBasis').value = Array.isArray(value.basis) ? value.basis.join('\n') : '';
  if ($('assistantResultFallback')) $('assistantResultFallback').value = value.safeFallback || '';
}

function renderTeleprompterState(teleprompter = {}) {
  const current = teleprompter.current || {};
  const document = current.document || {};
  const chunks = Array.isArray(document.chunks) ? document.chunks : [];
  const activeIndex = Math.max(0, Math.min(chunks.length - 1, Number(teleprompter.activeChunkIndex || 0)));
  if ($('assistantTeleprompterChunk')) $('assistantTeleprompterChunk').value = chunks[activeIndex] || current.suggestion?.answer || '';
  if ($('assistantTeleprompterProgress')) $('assistantTeleprompterProgress').textContent = chunks.length ? `${activeIndex + 1} / ${chunks.length}` : '0 / 0';
  if ($('assistantPreviousChunk')) $('assistantPreviousChunk').disabled = activeIndex <= 0;
  if ($('assistantNextChunk')) $('assistantNextChunk').disabled = !chunks.length || activeIndex >= chunks.length - 1;
  if ($('assistantToggleFreeze')) $('assistantToggleFreeze').textContent = teleprompter.frozen ? t('teleprompterUnfreeze') : t('teleprompterFreeze');
  if ($('assistantTeleprompterFrozen')) $('assistantTeleprompterFrozen').checked = !!teleprompter.frozen;
  const pendingQuestion = teleprompter.pendingQuestion?.text || teleprompter.pending?.question?.text || '';
  if ($('assistantTeleprompterPending')) {
    $('assistantTeleprompterPending').hidden = !pendingQuestion;
    $('assistantTeleprompterPending').textContent = pendingQuestion ? `${t('teleprompterPendingQuestion')}: ${pendingQuestion}` : '';
  }
  if ($('assistantLoadPending')) $('assistantLoadPending').disabled = !teleprompter.pending;
}

function renderAssistantState(state = {}) {
  assistantState = { ...assistantState, ...(state || {}) };
  const status = assistantState.status || 'idle';
  const visible = !!assistantState.visible;
  const protection = assistantState.protection || {};
  if ($('liveAssistantDot')) dot('liveAssistantDot', status !== 'error', visible || status === 'analyzing');
  const statusLabels = {
    idle: t('liveAssistantWaiting'),
    question: t('liveAssistantQuestionDetected'),
    analyzing: t('liveAssistantAnalyzing'),
    ready: t('liveAssistantReady'),
    error: t('liveAssistantError')
  };
  if ($('liveAssistantStatusText')) $('liveAssistantStatusText').textContent = statusLabels[status] || status;
  if ($('liveAssistantProtectionText')) $('liveAssistantProtectionText').textContent = assistantProtectionSummary(protection);
  if ($('liveAssistantQuestionSummary')) {
    $('liveAssistantQuestionSummary').textContent = assistantState.teleprompter?.pendingQuestion?.text || assistantState.question?.text || t('noQuestionDetected');
  }
  if ($('liveAssistantSourceSummary')) {
    $('liveAssistantSourceSummary').textContent = assistantState.suggestion
      ? (assistantState.suggestion.source === 'library' ? t('assistantSourceLibrary') : t('assistantSourceAi'))
      : (assistantState.settings?.autoAnalyze ? t('automaticAnalysisOn') : t('manualAnalysisDefault'));
  }
  if ($('assistantAnalysisMessage')) {
    $('assistantAnalysisMessage').textContent = status === 'analyzing'
      ? t('liveAssistantAnalyzing')
      : status === 'error'
        ? (assistantState.error || t('liveAssistantError'))
        : status === 'ready'
          ? t('liveAssistantReady')
          : status === 'question'
            ? t('liveAssistantQuestionDetected')
            : t('assistantWaitingForQuestion');
  }
  if (assistantState.settings) {
    if ($('assistantClickThrough')) $('assistantClickThrough').checked = !!assistantState.settings.clickThrough;
  }
  if ($('moveAssistantWindow')) $('moveAssistantWindow').textContent = assistantState.moveMode ? t('finishMovingAssistantWindow') : t('moveAssistantWindow');
  if (assistantState.question) rememberDetectedQuestion(assistantState.question);
  renderAssistantSuggestion(assistantState.suggestion || assistantState.teleprompter?.current?.suggestion);
  renderTeleprompterState(assistantState.teleprompter || {});
}

async function refreshAssistantStatus() {
  const status = await window.lmt.interviewAssistantStatus();
  renderAssistantState(status);
  return status;
}

async function saveAssistantSettings() {
  const saved = await window.lmt.save(readSettings());
  apply(saved.settings || {});
  renderAssistantState(saved.assistant || await window.lmt.interviewAssistantStatus());
  log(`[ASSISTANT] ${t('assistantSettingsSaved')}`);
  return saved;
}

async function analyzeAssistantQuestion() {
  const question = $('assistantQuestionInput') ? val('assistantQuestionInput') : '';
  if (!question) throw new Error(t('assistantQuestionRequired'));
  if ($('assistantAnalysisMessage')) $('assistantAnalysisMessage').textContent = t('liveAssistantAnalyzing');
  const result = await window.lmt.interviewAssistantAnalyze(question);
  if (!result || !result.ok) throw new Error(result?.message || t('liveAssistantError'));
  if (result.suggestion) renderAssistantSuggestion(result.suggestion);
  await refreshAssistantStatus();
  log(`[ASSISTANT] ${result.source === 'library' ? t('assistantMatchedLibrary') : t('assistantGeneratedGrounded')}`);
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
try {
  window.lmt.onInterviewQuestion(question => {
    rememberDetectedQuestion(question);
    renderAssistantState({ ...assistantState, question, status: 'question', suggestion: null, error: '' });
  });
  window.lmt.onInterviewAssistantState(renderAssistantState);
} catch (e) {
  log(`[INIT ERROR] Cannot attach interview assistant events: ${String(e && (e.message || e) || e)}`);
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

function bindDirtyTracking() {
  const profileRoot = $('candidateProfileScreen');
  if (profileRoot) {
    profileRoot.querySelectorAll('input, textarea, select').forEach(control => {
      if (control.id === 'candidateResumeText') return;
      const mark = () => {
        if (suppressCandidateDirty) return;
        setCandidateProfileDirty(stableJson(candidateProfileFromUi()) !== candidateProfileBaseline);
      };
      control.addEventListener('input', mark);
      control.addEventListener('change', mark);
    });
  }
  const answerRoot = $('answerLibraryScreen');
  if (answerRoot) {
    answerRoot.querySelectorAll('.answerEditor input, .answerEditor textarea, .answerEditor select').forEach(control => {
      if (control.id === 'answerEntryId') return;
      const mark = () => { if (!suppressAnswerDirty) setAnswerEditorDirty(true); };
      control.addEventListener('input', mark);
      control.addEventListener('change', mark);
    });
  }
}

window.addEventListener('beforeunload', (event) => {
  if (!candidateProfileDirty && !answerEditorDirty) return;
  event.preventDefault();
  event.returnValue = '';
});


function trainingSummaryLocal() {
  const completed = (interviewTrainingState.sessions || []).filter(session => session.status === 'completed');
  const attempts = completed.flatMap(session => Array.isArray(session.attempts) ? session.attempts : []);
  const average = values => values.length ? (values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(2) : '—';
  const ratings = attempts.map(item => Number(item.rating || 0)).filter(value => value > 0);
  const confidence = attempts.map(item => Number(item.confidence || 0)).filter(value => value > 0);
  return {
    totalSessions: completed.length,
    totalAttempts: attempts.length,
    averageRating: average(ratings),
    averageConfidence: average(confidence),
    needsPracticeCount: attempts.filter(item => item.needsPractice).length
  };
}

function activeTrainingSession() {
  const sessions = interviewTrainingState.sessions || [];
  if (activeTrainingSessionId) {
    const selected = sessions.find(session => session.id === activeTrainingSessionId && session.status === 'active');
    if (selected) return selected;
  }
  return sessions.find(session => session.status === 'active') || null;
}

function currentTrainingEntry(session = activeTrainingSession()) {
  if (!session) return null;
  const id = (session.selectedQuestionIds || [])[Number(session.currentIndex || 0)];
  return (answerLibraryState.entries || []).find(entry => entry.id === id) || null;
}

function renderTrainingSummary() {
  const summary = trainingSummaryLocal();
  if ($('interviewTrainerDot')) $('interviewTrainerDot').className = `dot ${interviewTrainingPath ? 'ok' : ''}`;
  if ($('interviewTrainerStatusText')) $('interviewTrainerStatusText').textContent = interviewTrainingPath ? t('interviewTrainerLoaded') : t('interviewTrainerNotLoaded');
  if ($('interviewTrainerPath')) $('interviewTrainerPath').textContent = interviewTrainingPath;
  if ($('interviewTrainerSessionCount')) $('interviewTrainerSessionCount').textContent = `${summary.totalSessions} ${t('trainingSessionsMetric').toLowerCase()}`;
  if ($('interviewTrainerAttemptCount')) $('interviewTrainerAttemptCount').textContent = `${summary.totalAttempts} ${t('trainingAttemptsMetric').toLowerCase()}`;
  if ($('trainingMetricSessions')) $('trainingMetricSessions').textContent = String(summary.totalSessions);
  if ($('trainingMetricAttempts')) $('trainingMetricAttempts').textContent = String(summary.totalAttempts);
  if ($('trainingMetricRating')) $('trainingMetricRating').textContent = summary.averageRating === '—' ? '—' : `${summary.averageRating} / 5`;
  if ($('trainingMetricConfidence')) $('trainingMetricConfidence').textContent = summary.averageConfidence === '—' ? '—' : `${summary.averageConfidence} / 5`;
  if ($('trainingMetricNeedsPractice')) $('trainingMetricNeedsPractice').textContent = String(summary.needsPracticeCount);
  renderTrainingHistory();
  renderTrainingPractice();
}

function renderTrainingHistory() {
  const root = $('trainingSessionHistory');
  const empty = $('trainingHistoryEmpty');
  if (!root || !empty) return;
  root.innerHTML = '';
  const sessions = (interviewTrainingState.sessions || []).filter(session => session.status === 'completed');
  empty.hidden = sessions.length > 0;
  for (const session of sessions) {
    const card = document.createElement('article');
    card.className = 'trainingHistoryItem';
    const attempts = Array.isArray(session.attempts) ? session.attempts : [];
    const ratings = attempts.map(item => Number(item.rating || 0)).filter(value => value > 0);
    const average = ratings.length ? (ratings.reduce((sum, value) => sum + value, 0) / ratings.length).toFixed(1) : '—';
    const header = document.createElement('div');
    header.className = 'trainingHistoryHeader';
    const title = document.createElement('strong'); title.textContent = session.title || t('interviewTrainerTitle');
    const meta = document.createElement('span'); meta.textContent = `${attempts.length} · ${average}/5 · ${new Date(session.completedAt || session.startedAt).toLocaleString()}`;
    header.append(title, meta);
    const list = document.createElement('ul');
    for (const attempt of attempts.filter(item => item.needsPractice).slice(0, 5)) {
      const item = document.createElement('li'); item.textContent = `${attempt.question}${attempt.rating ? ` — ${attempt.rating}/5` : ''}`; list.appendChild(item);
    }
    card.appendChild(header);
    if (list.children.length) card.appendChild(list);
    root.appendChild(card);
  }
}

function clearTrainingAttemptFields() {
  if ($('trainerPracticeAnswer')) $('trainerPracticeAnswer').value = '';
  if ($('trainerAnswerRating')) $('trainerAnswerRating').value = '0';
  if ($('trainerConfidenceRating')) $('trainerConfidenceRating').value = '0';
  if ($('trainerNeedsPractice')) $('trainerNeedsPractice').checked = false;
  if ($('trainerNotes')) $('trainerNotes').value = '';
  trainerReferenceVisible = false;
}

function renderTrainingPractice() {
  const session = activeTrainingSession();
  const entry = currentTrainingEntry(session);
  if ($('resumeTrainingSession')) $('resumeTrainingSession').disabled = !session;
  if (!session || !entry) {
    if ($('trainerProgress')) $('trainerProgress').textContent = '0 / 0';
    if ($('trainerSessionStatus')) $('trainerSessionStatus').textContent = t('trainerIdle');
    if ($('trainerQuestionText')) $('trainerQuestionText').textContent = t('trainerNoQuestion');
    if ($('trainerReferencePanel')) $('trainerReferencePanel').hidden = true;
    for (const id of ['saveTrainingAttempt','finishTrainingSession','showTrainerReference']) if ($(id)) $(id).disabled = true;
    return;
  }
  activeTrainingSessionId = session.id;
  const index = Math.max(0, Number(session.currentIndex || 0));
  if ($('trainerProgress')) $('trainerProgress').textContent = `${index + 1} / ${(session.selectedQuestionIds || []).length}`;
  if ($('trainerSessionStatus')) $('trainerSessionStatus').textContent = session.title || t('interviewTrainerTitle');
  if ($('trainerQuestionText')) $('trainerQuestionText').textContent = entry.question || t('trainerNoQuestion');
  if ($('trainerReferenceFirstSentence')) $('trainerReferenceFirstSentence').textContent = entry.firstSentence || '';
  if ($('trainerReferenceAnswer')) $('trainerReferenceAnswer').textContent = entry.answer || '';
  if ($('trainerReferencePanel')) $('trainerReferencePanel').hidden = !trainerReferenceVisible;
  if ($('showTrainerReference')) $('showTrainerReference').textContent = trainerReferenceVisible ? t('hideTrainerReference') : t('showTrainerReference');
  for (const id of ['saveTrainingAttempt','finishTrainingSession','showTrainerReference']) if ($(id)) $(id).disabled = false;
}

async function saveInterviewTraining() {
  const result = await window.lmt.interviewTrainingSave(interviewTrainingState);
  interviewTrainingState = result.data || interviewTrainingState;
  interviewTrainingPath = result.path || interviewTrainingPath;
  renderTrainingSummary();
  return result;
}

async function loadInterviewTraining() {
  const result = await window.lmt.interviewTrainingLoad();
  interviewTrainingState = result.data || { schemaVersion: 1, sessions: [], updatedAt: '' };
  interviewTrainingPath = result.path || '';
  const active = activeTrainingSession();
  activeTrainingSessionId = active?.id || '';
  renderTrainingSummary();
  if (result.warning) log(`[TRAINER] ${result.warning}`);
  return result;
}

function shuffled(values) {
  const output = [...values];
  for (let index = output.length - 1; index > 0; index -= 1) {
    const target = Math.floor(Math.random() * (index + 1));
    [output[index], output[target]] = [output[target], output[index]];
  }
  return output;
}

function trainingQuestionIds(order, count) {
  const entries = (answerLibraryState.entries || []).filter(entry => entry.question && entry.answer);
  let ordered = [...entries];
  if (order === 'random') ordered = shuffled(ordered);
  if (order === 'needs-practice') {
    const difficult = new Set((interviewTrainingState.sessions || []).flatMap(session => session.attempts || []).filter(attempt => attempt.needsPractice).map(attempt => attempt.answerEntryId));
    ordered.sort((a, b) => Number(difficult.has(b.id)) - Number(difficult.has(a.id)));
  }
  return ordered.slice(0, Math.max(1, Math.min(50, count))).map(entry => entry.id);
}

async function startTrainingSession() {
  const count = Number.parseInt(val('trainerQuestionCount'), 10) || 5;
  const ids = trainingQuestionIds(val('trainerQuestionOrder') || 'random', count);
  if (!ids.length) {
    if ($('trainerSetupMessage')) $('trainerSetupMessage').textContent = t('trainerNeedsAnswers');
    return;
  }
  for (const session of interviewTrainingState.sessions || []) {
    if (session.status === 'active') {
      session.status = 'completed';
      session.completedAt = new Date().toISOString();
    }
  }
  const session = {
    id: createClientId('training-session'),
    title: val('trainerSessionTitle') || `${t('interviewTrainerTitle')} ${new Date().toLocaleDateString()}`,
    status: 'active',
    startedAt: new Date().toISOString(),
    completedAt: '',
    selectedQuestionIds: ids,
    currentIndex: 0,
    attempts: []
  };
  interviewTrainingState.sessions = [session, ...(interviewTrainingState.sessions || [])];
  activeTrainingSessionId = session.id;
  clearTrainingAttemptFields();
  if ($('trainerSetupMessage')) $('trainerSetupMessage').textContent = t('trainerSessionStarted');
  await saveInterviewTraining();
}

async function saveTrainingAttempt() {
  const session = activeTrainingSession();
  const entry = currentTrainingEntry(session);
  if (!session || !entry) return;
  const attempt = {
    id: createClientId('training-attempt'),
    answerEntryId: entry.id,
    question: entry.question,
    referenceAnswer: entry.answer,
    firstSentence: entry.firstSentence || '',
    practiceAnswer: val('trainerPracticeAnswer'),
    notes: val('trainerNotes'),
    rating: Number.parseInt(val('trainerAnswerRating'), 10) || 0,
    confidence: Number.parseInt(val('trainerConfidenceRating'), 10) || 0,
    needsPractice: checked('trainerNeedsPractice'),
    completedAt: new Date().toISOString(),
    order: Number(session.currentIndex || 0)
  };
  session.attempts = [...(session.attempts || []).filter(item => item.answerEntryId !== entry.id), attempt];
  session.currentIndex = Number(session.currentIndex || 0) + 1;
  if (session.currentIndex >= (session.selectedQuestionIds || []).length) {
    session.status = 'completed';
    session.completedAt = new Date().toISOString();
    activeTrainingSessionId = '';
  }
  clearTrainingAttemptFields();
  await saveInterviewTraining();
}

async function finishTrainingSession() {
  const session = activeTrainingSession();
  if (!session) return;
  session.status = 'completed';
  session.completedAt = new Date().toISOString();
  activeTrainingSessionId = '';
  clearTrainingAttemptFields();
  await saveInterviewTraining();
}

async function exportTraining(format) {
  const result = await window.lmt.interviewTrainingExport(format, interviewTrainingState);
  if (result && !result.canceled && !result.ok) throw new Error(result.error || 'Training report export failed.');
  if (result?.ok) log(`[TRAINER] ${t('trainingReportExported')}: ${result.filePath || ''}`);
  return result;
}

window.addEventListener('DOMContentLoaded', async () => {
  applyI18n();
  initVoices();
  resetOutgoingSteps();
  bindDirtyTracking();
  $('save').onclick = async () => {
    const r = await window.lmt.save(readSettings());
    apply(r.settings || {});
    renderSubtitleStatus(r.subtitle || await window.lmt.subtitleStatus());
    renderAssistantState(r.assistant || await window.lmt.interviewAssistantStatus());
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
  if ($('openCandidateProfile')) $('openCandidateProfile').onclick = () => showView('candidate-profile');
  if ($('backFromCandidateProfile')) $('backFromCandidateProfile').onclick = () => showView('home');
  if ($('openAnswerLibrary')) $('openAnswerLibrary').onclick = () => showView('answer-library');
  if ($('backFromAnswerLibrary')) $('backFromAnswerLibrary').onclick = () => showView('home');
  if ($('openLiveAssistant')) $('openLiveAssistant').onclick = () => showView('live-assistant');
  if ($('openInterviewTrainer')) $('openInterviewTrainer').onclick = () => showView('interview-trainer');
  if ($('backFromInterviewTrainer')) $('backFromInterviewTrainer').onclick = () => showView('home');
  if ($('backFromLiveAssistant')) $('backFromLiveAssistant').onclick = () => showView('home');
  const saveProfileAction = async (buttonId) => {
    await runUiAction('Save candidate profile clicked.', buttonId, async () => {
      const result = await window.lmt.candidateProfileSave(candidateProfileFromUi());
      candidateProfileStoragePath = result.path || candidateProfileStoragePath;
      applyCandidateProfile(result.profile || {}, { markClean: true });
      renderCandidateProfileStatus(result);
      log(`[PROFILE] ${t('candidateProfileSaved')}`);
      return result;
    });
  };
  if ($('saveCandidateProfileTop')) $('saveCandidateProfileTop').onclick = () => saveProfileAction('saveCandidateProfileTop');
  if ($('saveCandidateProfile')) $('saveCandidateProfile').onclick = () => saveProfileAction('saveCandidateProfile');
  if ($('importCandidateProfile')) $('importCandidateProfile').onclick = async () => {
    await runUiAction('Import candidate profile clicked.', 'importCandidateProfile', async () => {
      const result = await window.lmt.candidateProfileImport();
      if (!result || result.canceled) return result;
      if (!result.ok) throw new Error(result.error || 'Candidate profile import failed.');
      applyCandidateProfile(result.profile || {}, { markClean: false });
      renderCandidateProfileStatus(result);
      setCandidateProfileDirty(true);
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
      candidateProfileStoragePath = result.path || candidateProfileStoragePath;
      applyCandidateProfile(result.profile || {}, { markClean: true });
      renderCandidateProfileStatus(result);
      log(`[PROFILE] ${t('candidateProfileCleared')}`);
      return result;
    });
  };

  if ($('newAnswerEntry')) $('newAnswerEntry').onclick = () => {
    if (answerEditorDirty && !window.confirm(t('discardUnsavedAnswerChanges'))) return;
    selectedAnswerId = '';
    applyAnswerEntry(emptyAnswerEntry(), { markClean: true });
    renderAnswerEntryList();
  };
  if ($('saveAnswerEntry')) $('saveAnswerEntry').onclick = async () => {
    await runUiAction('Save Answer Library entry clicked.', 'saveAnswerEntry', saveCurrentAnswer);
  };
  if ($('deleteAnswerEntry')) $('deleteAnswerEntry').onclick = async () => {
    await runUiAction('Delete Answer Library entry clicked.', 'deleteAnswerEntry', deleteCurrentAnswer);
  };
  if ($('importAnswerLibrary')) $('importAnswerLibrary').onclick = async () => {
    await runUiAction('Import Answer Library clicked.', 'importAnswerLibrary', async () => {
      if (answerEditorDirty && !window.confirm(t('discardUnsavedAnswerChanges'))) return { ok: false, canceled: true };
      const imported = await window.lmt.answerLibraryImport();
      if (!imported || imported.canceled) return imported;
      if (!imported.ok) throw new Error(imported.error || 'Answer Library import failed.');
      if (!window.confirm(t('replaceAnswerLibraryConfirm'))) return { ok: false, canceled: true };
      answerLibraryState = imported.library || { entries: [] };
      selectedAnswerId = answerLibraryState.entries?.[0]?.id || '';
      const saved = await window.lmt.answerLibrarySave(answerLibraryState);
      applyAnswerLibrary(saved.library || {}, { ...saved, markClean: true });
      log(`[ANSWER LIBRARY] ${t('answerLibraryImported')}`);
      return saved;
    });
  };
  if ($('exportAnswerLibrary')) $('exportAnswerLibrary').onclick = async () => {
    await runUiAction('Export Answer Library clicked.', 'exportAnswerLibrary', async () => {
      const result = await window.lmt.answerLibraryExport(answerLibraryState);
      if (result && !result.canceled && !result.ok) throw new Error(result.error || 'Answer Library export failed.');
      if (result && result.ok) log(`[ANSWER LIBRARY] ${t('answerLibraryExported')}: ${result.filePath || ''}`);
      return result;
    });
  };
  if ($('resetAnswerLibrary')) $('resetAnswerLibrary').onclick = async () => {
    if (!window.confirm(t('resetAnswerLibraryConfirm'))) return;
    await runUiAction('Reset Answer Library clicked.', 'resetAnswerLibrary', async () => {
      const result = await window.lmt.answerLibraryReset();
      selectedAnswerId = '';
      applyAnswerLibrary(result.library || {}, { ...result, markClean: true });
      log(`[ANSWER LIBRARY] ${t('answerLibraryCleared')}`);
      return result;
    });
  };

  if ($('saveAssistantSettings')) $('saveAssistantSettings').onclick = async () => {
    await runUiAction('Save Live Assistant settings clicked.', 'saveAssistantSettings', saveAssistantSettings);
  };
  if ($('showAssistantWindowTop')) $('showAssistantWindowTop').onclick = async () => renderAssistantState(await window.lmt.interviewAssistantControl('show'));
  if ($('showAssistantWindow')) $('showAssistantWindow').onclick = async () => renderAssistantState(await window.lmt.interviewAssistantControl('show'));
  if ($('hideAssistantWindow')) $('hideAssistantWindow').onclick = async () => renderAssistantState(await window.lmt.interviewAssistantControl('hide'));
  if ($('moveAssistantWindow')) $('moveAssistantWindow').onclick = async () => renderAssistantState(await window.lmt.interviewAssistantControl('moveMode'));
  if ($('clearAssistantSession')) $('clearAssistantSession').onclick = async () => {
    renderAssistantState(await window.lmt.interviewAssistantControl('clear'));
    assistantQuestionHistory = [];
    renderAssistantQuestionHistory();
    if ($('assistantQuestionInput')) $('assistantQuestionInput').value = '';
  };
  if ($('analyzeAssistantQuestion')) $('analyzeAssistantQuestion').onclick = async () => {
    await runUiAction('Analyze interview question clicked.', 'analyzeAssistantQuestion', analyzeAssistantQuestion);
  };
  if ($('useLastDetectedQuestion')) $('useLastDetectedQuestion').onclick = async () => {
    const result = await window.lmt.interviewAssistantLastQuestion();
    if (result?.question?.text) {
      rememberDetectedQuestion(result.question);
      if ($('assistantQuestionInput')) $('assistantQuestionInput').value = result.question.text;
    } else if ($('assistantAnalysisMessage')) {
      $('assistantAnalysisMessage').textContent = t('noQuestionDetected');
    }
  };
  if ($('assistantPreviousChunk')) $('assistantPreviousChunk').onclick = async () => renderAssistantState(await window.lmt.interviewAssistantControl('previousChunk'));
  if ($('assistantNextChunk')) $('assistantNextChunk').onclick = async () => renderAssistantState(await window.lmt.interviewAssistantControl('nextChunk'));
  if ($('assistantToggleFreeze')) $('assistantToggleFreeze').onclick = async () => {
    const enabled = !(assistantState.teleprompter?.frozen);
    renderAssistantState(await window.lmt.interviewAssistantControl('freezeTeleprompter', { enabled }));
  };
  if ($('assistantLoadPending')) $('assistantLoadPending').onclick = async () => renderAssistantState(await window.lmt.interviewAssistantControl('loadPending'));
  if ($('assistantTeleprompterFrozen')) $('assistantTeleprompterFrozen').onchange = async () => {
    renderAssistantState(await window.lmt.interviewAssistantControl('freezeTeleprompter', { enabled: checked('assistantTeleprompterFrozen') }));
  };
  if ($('assistantClickThrough')) $('assistantClickThrough').onchange = async () => {
    const saved = await saveAssistantSettings();
    renderAssistantState(saved.assistant || await window.lmt.interviewAssistantStatus());
  };

  if ($('startTrainingSession')) $('startTrainingSession').onclick = async () => runUiAction('Start interview training session clicked.', 'startTrainingSession', startTrainingSession);
  if ($('resumeTrainingSession')) $('resumeTrainingSession').onclick = () => { const session = activeTrainingSession(); if (session) { activeTrainingSessionId = session.id; clearTrainingAttemptFields(); renderTrainingPractice(); } };
  if ($('showTrainerReference')) $('showTrainerReference').onclick = () => { trainerReferenceVisible = !trainerReferenceVisible; renderTrainingPractice(); };
  if ($('saveTrainingAttempt')) $('saveTrainingAttempt').onclick = async () => runUiAction('Save interview training attempt clicked.', 'saveTrainingAttempt', saveTrainingAttempt);
  if ($('finishTrainingSession')) $('finishTrainingSession').onclick = async () => runUiAction('Finish interview training session clicked.', 'finishTrainingSession', finishTrainingSession);
  if ($('exportTrainingMarkdown')) $('exportTrainingMarkdown').onclick = async () => runUiAction('Export training Markdown report clicked.', 'exportTrainingMarkdown', () => exportTraining('md'));
  if ($('exportTrainingJson')) $('exportTrainingJson').onclick = async () => runUiAction('Export training JSON clicked.', 'exportTrainingJson', () => exportTraining('json'));
  if ($('exportTrainingReportTop')) $('exportTrainingReportTop').onclick = async () => runUiAction('Export training report clicked.', 'exportTrainingReportTop', () => exportTraining('md'));
  if ($('resetTrainingHistory')) $('resetTrainingHistory').onclick = async () => {
    if (!window.confirm(t('resetTrainingHistoryConfirm'))) return;
    await runUiAction('Reset interview training history clicked.', 'resetTrainingHistory', async () => {
      const result = await window.lmt.interviewTrainingReset();
      interviewTrainingState = result.data || { schemaVersion: 1, sessions: [], updatedAt: '' };
      interviewTrainingPath = result.path || interviewTrainingPath;
      activeTrainingSessionId = '';
      clearTrainingAttemptFields();
      renderTrainingSummary();
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
    await refreshAssistantStatus();
    await loadCandidateProfile();
    await loadAnswerLibrary();
    await loadInterviewTraining();
    renderAssistantQuestionHistory();
    log('[INIT] Settings, candidate profile, Answer Library, Interview Trainer and Live Assistant loaded; controls are ready.');
  } catch (e) {
    log(`[INIT ERROR] Settings load failed: ${String(e && (e.message || e) || e)}`);
  }
  try {
    await refreshHealth();
  } catch (e) {
    log(`[INIT WARN] Health check failed: ${String(e && (e.message || e) || e)}`);
  }
});
