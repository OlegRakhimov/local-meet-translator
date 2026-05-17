const logEl = document.getElementById('log');
const stateEl = document.getElementById('state');
const btn = document.getElementById('btnReq');

function log(msg) {
  const now = new Date().toISOString().replace('T', ' ').replace('Z', '');
  logEl.textContent += `[${now}] ${msg}\n`;
  logEl.scrollTop = logEl.scrollHeight;
}

function formatErr(e) {
  if (!e) return '';
  const name = e.name ? String(e.name) : '';
  const msg = e.message ? String(e.message) : String(e);
  return name && msg && !msg.startsWith(name) ? `${name}: ${msg}` : (msg || name);
}

async function updatePermissionState() {
  // Best-effort only; permissions API support varies by context.
  try {
    if (navigator.permissions && navigator.permissions.query) {
      const p = await navigator.permissions.query({ name: 'microphone' });
      stateEl.textContent = `Current permission state: ${p.state}`;
      return;
    }
  } catch (_) {}
  stateEl.textContent = 'Current permission state: (unavailable)';
}

function isCableOutputLabel(label) {
  const s = String(label || '').toLowerCase();
  return s.includes('cable input') || s.includes('vb-audio') || s.includes('virtual cable');
}

async function rememberTtsOutputDevice(device) {
  if (!device || !device.deviceId) return;
  const obj = await chrome.storage.local.get('settings');
  const settings = { ...(obj.settings || {}) };
  settings.ttsSinkDeviceId = device.deviceId;
  if (device.label) settings.ttsSinkDeviceName = device.label;
  await chrome.storage.local.set({ settings, audioOutputPermissionGranted: true });
  log('Saved translated voice output: ' + (device.label || device.deviceId));
}

async function requestTtsOutputAccess() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) {
    log('Audio output device enumeration is not available in this browser.');
    return;
  }

  const devices = await navigator.mediaDevices.enumerateDevices();
  const outputs = devices.filter(d => d.kind === 'audiooutput');
  const preferred = outputs.find(d => isCableOutputLabel(d.label));

  if (navigator.mediaDevices.selectAudioOutput) {
    try {
      const selected = await navigator.mediaDevices.selectAudioOutput(
        preferred && preferred.deviceId ? { deviceId: preferred.deviceId } : undefined
      );
      await rememberTtsOutputDevice(selected);
      return;
    } catch (e) {
      log('Audio output selection skipped/failed: ' + formatErr(e));
    }
  }

  if (preferred) {
    await rememberTtsOutputDevice(preferred);
  } else {
    log('CABLE Input output was not visible. Install/enable VB-Cable, then reopen this page and grant access again.');
  }
}

async function requestMic() {
  try {
    log('Requesting microphone access...');
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    for (const t of stream.getTracks()) t.stop();

    // Remember that we successfully obtained mic permission at least once.
    await chrome.storage.local.set({ micPermissionGranted: true });

    log('Granted. You can close this tab and reopen the extension popup.');
    stateEl.innerHTML = '<span class="ok">Granted</span>';
    await requestTtsOutputAccess();

    // Optional: try to close the tab after a short delay.
    try {
      const tab = await chrome.tabs.getCurrent();
      if (tab && tab.id) setTimeout(() => chrome.tabs.remove(tab.id).catch(() => {}), 800);
    } catch (_) {}
  } catch (e) {
    // Common case: user dismissed the prompt or browser refuses to show it.
    log('Failed: ' + formatErr(e));
    stateEl.innerHTML = '<span class="err">Not granted</span>';

    // If the prompt is not shown, advise the user where to look.
    log('If you did not see a prompt: check the camera/mic icon in the browser address bar and allow microphone.');
    log('Also verify Windows microphone privacy settings and Edge microphone settings.');
  }
}

btn.addEventListener('click', requestMic);
updatePermissionState();
