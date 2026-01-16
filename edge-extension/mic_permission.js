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

async function requestMic() {
  try {
    log('Requesting microphone access...');
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    for (const t of stream.getTracks()) t.stop();

    // Remember that we successfully obtained mic permission at least once.
    await chrome.storage.local.set({ micPermissionGranted: true });

    log('Granted. You can close this tab and reopen the extension popup.');
    stateEl.innerHTML = '<span class="ok">Granted</span>';

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
