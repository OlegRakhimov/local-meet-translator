const $ = (id) => document.getElementById(id);
const VOICES = ["onyx", "alloy", "ash", "ballad", "coral", "echo", "fable", "nova", "sage", "shimmer", "verse"];

function log(msg) {
  const el = $("log");
  const now = new Date().toISOString().replace("T", " ").replace("Z", "");
  el.textContent += `[${now}] ${msg}\n`;
  el.scrollTop = el.scrollHeight;
}

function formatErr(e) {
  if (!e) return "";
  const name = e.name ? String(e.name) : "";
  const msg = e.message ? String(e.message) : String(e);
  return name && msg && !msg.startsWith(name) ? `${name}: ${msg}` : (msg || name);
}

function setStatus(kind, text) {
  const dot = $("statusDot");
  const t = $("statusText");
  t.textContent = text;
  if (kind === "ok") dot.style.background = "#3fb950";
  else if (kind === "run") dot.style.background = "#58a6ff";
  else if (kind === "err") dot.style.background = "#f85149";
  else dot.style.background = "#999";
}

function initVoices() {
  const sel = $("ttsVoice");
  sel.innerHTML = "";
  for (const v of VOICES) {
    const opt = document.createElement("option");
    opt.value = v;
    opt.textContent = v;
    sel.appendChild(opt);
  }
}

function labelOrFallback(kind, d) {
  const id = d.deviceId || "";
  if (d.label && d.label.trim()) return d.label;
  if (id === "default" || id === "") {
    return kind === "audioinput" ? "Default microphone" : "Default output";
  }
  const short = id.slice(0, 8);
  return (kind === "audioinput" ? "Mic: " : "Out: ") + short;
}

async function enumerateDevices() {
  let devices = [];
  try {
    devices = await navigator.mediaDevices.enumerateDevices();
  } catch (e) {
    log("enumerateDevices failed: " + String(e));
  }

  const mics = devices.filter(d => d.kind === "audioinput");
  const outs = devices.filter(d => d.kind === "audiooutput");

  const micSel = $("micDevice");
  micSel.innerHTML = "";
  for (const d of mics) {
    const opt = document.createElement("option");
    opt.value = d.deviceId || "";
    opt.textContent = labelOrFallback("audioinput", d);
    micSel.appendChild(opt);
  }
  if (mics.length === 0) {
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = "No microphones detected (grant permission first)";
    micSel.appendChild(opt);
  }

  const outSel = $("ttsSink");
  outSel.innerHTML = "";
  const def = document.createElement("option");
  def.value = "";
  def.textContent = "Default system output";
  outSel.appendChild(def);

  for (const d of outs) {
    const opt = document.createElement("option");
    opt.value = d.deviceId || "";
    opt.textContent = labelOrFallback("audiooutput", d);
    outSel.appendChild(opt);
  }
}

async function grantMicAccess() {
  try {
    setStatus("run", "Opening mic permission page...");
    log("Opening mic permission page in a new tab...");
    await chrome.tabs.create({ url: chrome.runtime.getURL("mic_permission.html") });
    log("In the new tab, click 'Request microphone access' and choose Allow. Then reopen this popup.");
    setStatus("ok", "Awaiting permission");
  } catch (e) {
    setStatus("err", "Cannot open permission page");
    log("Failed to open mic permission page: " + formatErr(e));
  }
}


async function saveSettings() {
  const settings = {
    serverUrl: $("serverUrl").value.trim(),
    authToken: $("authToken").value.trim(),
    sourceLang: $("sourceLang").value.trim() || "auto",
    targetLang: $("targetLang").value.trim() || "ru",
    chunkSeconds: parseInt($("chunkSeconds").value, 10) || 5,
    ttsEnabled: $("ttsEnabled").checked,
    ttsVoice: $("ttsVoice").value || "onyx",
    ttsSpeed: parseFloat($("ttsSpeed").value) || 1.0,
    micTxEnabled: $("micTxEnabled").checked,
    micTxSourceLang: $("micTxSourceLang").value.trim() || "ru",
    micTxTargetLang: $("micTxTargetLang").value.trim() || "en",
    micTxChunkSeconds: parseInt($("micTxChunkSeconds").value, 10) || 5,
    micDeviceId: $("micDevice").value || "",
    ttsSinkDeviceId: $("ttsSink").value || "",
    showOutgoingSubtitles: $("showOutgoingSubtitles").checked
  };
  await chrome.storage.local.set({ settings });
  return settings;
}

async function loadSettings() {
  const { settings } = await chrome.storage.local.get("settings");
  const s = settings || {
    serverUrl: "http://127.0.0.1:8799",
    authToken: "",
    sourceLang: "auto",
    targetLang: "ru",
    chunkSeconds: 5,
    ttsEnabled: false,
    ttsVoice: "onyx",
    ttsSpeed: 1.0,
    micTxEnabled: false,
    micTxSourceLang: "ru",
    micTxTargetLang: "en",
    micTxChunkSeconds: 5,
    micDeviceId: "",
    ttsSinkDeviceId: "",
    showOutgoingSubtitles: false
  };

  $("serverUrl").value = s.serverUrl;
  $("authToken").value = s.authToken;
  $("sourceLang").value = s.sourceLang;
  $("targetLang").value = s.targetLang;
  $("chunkSeconds").value = s.chunkSeconds;

  $("ttsEnabled").checked = !!s.ttsEnabled;
  $("ttsVoice").value = s.ttsVoice || "onyx";
  $("ttsSpeed").value = s.ttsSpeed || 1.0;

  $("micTxEnabled").checked = !!s.micTxEnabled;
  $("micTxSourceLang").value = s.micTxSourceLang || "ru";
  $("micTxTargetLang").value = s.micTxTargetLang || "en";
  $("micTxChunkSeconds").value = s.micTxChunkSeconds || 5;
  $("showOutgoingSubtitles").checked = !!s.showOutgoingSubtitles;
  return s;
}

function setSelectValueIfPresent(selectEl, value) {
  if (!selectEl) return;
  const v = value || "";
  for (const opt of Array.from(selectEl.options || [])) {
    if (opt.value === v) {
      selectEl.value = v;
      return;
    }
  }
}

function getSelectedText(selectEl) {
  try {
    const opt = selectEl && selectEl.selectedOptions && selectEl.selectedOptions[0];
    return opt ? String(opt.textContent || "") : "";
  } catch (_) { return ""; }
}

function looksLikeVirtualCable(label) {
  const s = (label || "").toLowerCase();
  return s.includes("vb-audio") || s.includes("virtual cable") || s.includes("cable input") || s.includes("cable output");
}

function validateOutgoingRouting(s) {
  if (!s || !s.micTxEnabled) return;

  const micLabel = getSelectedText($("micDevice"));
  const sinkLabel = getSelectedText($("ttsSink"));

  if (!s.ttsSinkDeviceId) {
    log("WARNING: Outgoing translated voice is enabled, but TTS output device is still 'Default system output'.");
    log("         In this mode, YOU will hear the translated voice, but the OTHER participant will NOT.");
    log("         To send it into the meeting: choose a virtual cable playback device (e.g. 'CABLE Input') as the sink,");
    log("         then in Google Meet settings select the matching virtual microphone (e.g. 'CABLE Output') as the meeting mic.");
  }

  // Common feedback-loop trap: selecting the virtual cable output as the MIC source.
  if (looksLikeVirtualCable(micLabel) && micLabel.toLowerCase().includes("output")) {
    log("WARNING: Your selected microphone input looks like a VIRTUAL CABLE output.");
    log("         This often creates a feedback loop where the extension transcribes its own TTS and 'talks to itself'.");
    log("         Select your REAL hardware microphone here (e.g. Realtek Microphone), and keep the virtual cable only as the TTS sink.");
  }

  if (sinkLabel && !looksLikeVirtualCable(sinkLabel) && s.ttsSinkDeviceId) {
    log("NOTE: Your TTS sink does not look like a virtual cable device.");
    log("      If you expected the other participant to hear the translated voice, pick the virtual cable playback device as sink.");
  }
}

async function checkServer() {
  const s = await saveSettings();
  if (!s.serverUrl || !s.authToken) {
    setStatus("err", "Missing serverUrl/token");
    log("Fill Server URL and Auth token first.");
    return;
  }
  setStatus("run", "Checking...");
  try {
    const resp = await fetch(`${s.serverUrl}/health`, { method: "GET", headers: { "X-Auth-Token": s.authToken } });
    const data = await resp.json().catch(() => ({}));
    if (resp.ok && data.ok) { setStatus("ok", "Server OK"); log("Server OK"); }
    else { setStatus("err", "Server error"); log(`HTTP ${resp.status}: ${JSON.stringify(data)}`); }
  } catch (e) {
    setStatus("err", "Cannot reach server");
    log("Fetch failed: " + String(e));
  }
}

async function start() {
  const s = await saveSettings();
  if (!s.serverUrl || !s.authToken) {
    setStatus("err", "Missing serverUrl/token");
    log("Fill Server URL and Auth token first.");
    return;
  }

  // Outgoing mic translation requires that mic permission was granted earlier from mic_permission.html.
  if (s.micTxEnabled) {
    const { micPermissionGranted } = await chrome.storage.local.get("micPermissionGranted");
    if (!micPermissionGranted) {
      log("Outgoing mic translation is enabled, but microphone permission is not granted yet.");
      log("Click 'Grant mic access' and allow microphone in the permission tab, then reopen the popup.");
      // Start without outgoing mic translation to keep incoming translation working.
      s.micTxEnabled = false;
    }
  }

  validateOutgoingRouting(s);

  setStatus("run", "Starting...");
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) { setStatus("err", "No active tab"); log("No active tab found."); return; }

  const res = await chrome.runtime.sendMessage({
    type: "START",
    tabId: tab.id,
    serverUrl: s.serverUrl,
    authToken: s.authToken,
    sourceLang: s.sourceLang,
    targetLang: s.targetLang,
    chunkSeconds: s.chunkSeconds,
    ttsEnabled: s.ttsEnabled,
    ttsVoice: s.ttsVoice,
    ttsSpeed: s.ttsSpeed,
    micTxEnabled: s.micTxEnabled,
    micTxSourceLang: s.micTxSourceLang,
    micTxTargetLang: s.micTxTargetLang,
    micDeviceId: s.micDeviceId,
    ttsSinkDeviceId: s.ttsSinkDeviceId,
    micTxChunkSeconds: s.micTxChunkSeconds,
    showOutgoingSubtitles: !!s.showOutgoingSubtitles
  }).catch((e) => ({ ok: false, error: String(e) }));

  if (res?.ok) { setStatus("run", "Running"); log("Capture started."); }
  else { setStatus("err", "Failed to start"); log("Start failed: " + (res?.error || "unknown")); }
}

async function stop() {
  setStatus("run", "Stopping...");
  const res = await chrome.runtime.sendMessage({ type: "STOP" }).catch((e) => ({ ok: false, error: String(e) }));
  if (res?.ok) { setStatus("ok", "Stopped"); log("Stopped."); }
  else { setStatus("err", "Stop failed"); log("Stop failed: " + (res?.error || "unknown")); }
}

document.addEventListener("DOMContentLoaded", async () => {
  initVoices();
  const s = await loadSettings();
  await enumerateDevices();
  // Restore saved device selections after we populate device lists.
  setSelectValueIfPresent($("micDevice"), s.micDeviceId);
  setSelectValueIfPresent($("ttsSink"), s.ttsSinkDeviceId);
  setStatus("idle", "Idle");

  $("btnGrantMic").addEventListener("click", grantMicAccess);
  $("btnHealth").addEventListener("click", checkServer);
  $("btnStart").addEventListener("click", start);
  $("btnStop").addEventListener("click", stop);

  chrome.runtime.onMessage.addEventListener((msg) => {
    if (msg?.type === "STATUS") {
      setStatus(msg.kind || "idle", msg.text || "");
      if (msg.log) log(msg.log);
    }
  });
});
