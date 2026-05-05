const $ = (id) => document.getElementById(id);
function log(line) { const el = $('log'); el.textContent += line + '\n'; el.scrollTop = el.scrollHeight; }
function dot(id, ok, running=false) { const el=$(id); el.className='dot ' + (running ? 'run' : ok ? 'ok' : 'err'); }
function val(id) { return $(id).value.trim(); }
function checked(id) { return $(id).checked; }
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
  if ($('envPath')) $('envPath').textContent = s.__ENV_PATH || '';
  $('extSourceLang').value = s.EXT_SOURCE_LANG || 'auto';
  $('extTargetLang').value = s.EXT_TARGET_LANG || systemLanguageCode();
  $('extChunkSeconds').value = s.EXT_CHUNK_SECONDS || '5';
  $('extTtsEnabled').checked = String(s.EXT_TTS_ENABLED || 'false') === 'true';
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
    EXT_CHUNK_SECONDS: val('extChunkSeconds') || '5',
    EXT_TTS_ENABLED: checked('extTtsEnabled') ? 'true' : 'false',
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
    EXT_SHOW_OUTGOING_SUBTITLES: checked('extShowOutgoingSubtitles') ? 'true' : 'false'
  };
}
async function refreshHealth() {
  const h = await window.lmt.health();
  dot('bridgeDot', h.bridge.ok); $('bridgeText').textContent = h.bridge.text;
  dot('voiceDot', h.voice.ok); $('voiceText').textContent = h.voice.text;
}
window.lmt.onLog(log);
window.addEventListener('DOMContentLoaded', async () => {
  applyI18n();
  initVoices();
  apply(await window.lmt.load());
  await refreshHealth();
  $('save').onclick = async () => { const r = await window.lmt.save(readSettings()); apply(r.settings); log(r.message); };
  $('openEnv').onclick = () => window.lmt.openEnv();
  if ($('enableOutgoingVoice')) $('enableOutgoingVoice').onclick = async () => {
    $('extMicTxEnabled').checked = true;
    $('enableTts').checked = true;
    if ($('extTtsEnabled')) $('extTtsEnabled').checked = false;
    if ($('extTtsSinkDeviceName') && !$('extTtsSinkDeviceName').value.trim()) $('extTtsSinkDeviceName').value = 'CABLE Input';
    await window.lmt.save(readSettings());
    log('Outgoing voice to meeting ENABLED. Now choose VB-Cable/CABLE Output as microphone in Meet, then press Start translation.');
  };
  if ($('disableOutgoingVoice')) $('disableOutgoingVoice').onclick = async () => {
    $('extMicTxEnabled').checked = false;
    await window.lmt.save(readSettings());
    log('Outgoing voice to meeting DISABLED.');
  };
  $('startBridge').onclick = async () => { await window.lmt.save(readSettings()); log((await window.lmt.startBridge()).message); setTimeout(refreshHealth, 1200); };
  $('stopBridge').onclick = async () => { log((await window.lmt.stopBridge()).message); setTimeout(refreshHealth, 500); };
  $('startVoice').onclick = async () => { await window.lmt.save(readSettings()); log((await window.lmt.startVoice()).message); setTimeout(refreshHealth, 1200); };
  $('stopVoice').onclick = async () => { log((await window.lmt.stopVoice()).message); setTimeout(refreshHealth, 500); };
  $('health').onclick = refreshHealth;
  $('checkCable').onclick = async () => { const r = await window.lmt.checkCable(); dot('cableDot', r.ok); $('cableText').textContent = r.text; log(r.text); };
  $('openExtension').onclick = async () => log((await window.lmt.openExtension()).message);
  $("startTranslation").onclick = async () => { await window.lmt.save(readSettings()); log((await window.lmt.startTranslation()).message); };
  $("stopTranslation").onclick = async () => log((await window.lmt.stopTranslation()).message);
});
