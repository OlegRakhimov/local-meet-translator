const $ = (id) => document.getElementById(id);

const VOICES = ["onyx", "alloy", "ash", "ballad", "coral", "echo", "fable", "nova", "sage", "shimmer", "verse", "marin", "cedar"];

function log(msg) {
  const el = $("log");
  const now = new Date().toISOString().replace("T", " ").replace("Z", "");
  el.textContent += `[${now}] ${msg}\n`;
  el.scrollTop = el.scrollHeight;
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

async function saveSettings() {
  const settings = {
    serverUrl: $("serverUrl").value.trim(),
    authToken: $("authToken").value.trim(),
    sourceLang: $("sourceLang").value.trim() || "auto",
    targetLang: $("targetLang").value.trim() || "ru",
    chunkSeconds: parseInt($("chunkSeconds").value, 10) || 4,
    ttsEnabled: $("ttsEnabled").checked,
    ttsVoice: $("ttsVoice").value || "onyx",
    ttsSpeed: parseFloat($("ttsSpeed").value) || 1.0
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
    chunkSeconds: 4,
    ttsEnabled: false,
    ttsVoice: "onyx",
    ttsSpeed: 1.0
  };

  $("serverUrl").value = s.serverUrl;
  $("authToken").value = s.authToken;
  $("sourceLang").value = s.sourceLang;
  $("targetLang").value = s.targetLang;
  $("chunkSeconds").value = s.chunkSeconds;

  $("ttsEnabled").checked = !!s.ttsEnabled;
  $("ttsVoice").value = s.ttsVoice || "onyx";
  $("ttsSpeed").value = s.ttsSpeed || 1.0;

  return s;
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
    const resp = await fetch(`${s.serverUrl}/health`, {
      method: "GET",
      headers: { "X-Auth-Token": s.authToken }
    });
    const data = await resp.json().catch(() => ({}));
    if (resp.ok && data.ok) {
      setStatus("ok", "Server OK");
      log("Server OK: " + JSON.stringify(data));
    } else {
      setStatus("err", "Server error");
      log(`HTTP ${resp.status}: ${JSON.stringify(data)}`);
    }
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

  setStatus("run", "Starting...");

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) {
    setStatus("err", "No active tab");
    log("No active tab found.");
    return;
  }

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
    ttsSpeed: s.ttsSpeed
  }).catch((e) => ({ ok: false, error: String(e) }));

  if (res?.ok) {
    setStatus("run", "Running");
    log("Capture started.");
  } else {
    setStatus("err", "Failed to start");
    log("Start failed: " + (res?.error || "unknown"));
  }
}

async function stop() {
  setStatus("run", "Stopping...");
  const res = await chrome.runtime.sendMessage({ type: "STOP" }).catch((e) => ({ ok: false, error: String(e) }));
  if (res?.ok) {
    setStatus("ok", "Stopped");
    log("Stopped.");
  } else {
    setStatus("err", "Stop failed");
    log("Stop failed: " + (res?.error || "unknown"));
  }
}

document.addEventListener("DOMContentLoaded", async () => {
  initVoices();
  await loadSettings();
  setStatus("idle", "Idle");

  $("btnHealth").addEventListener("click", checkServer);
  $("btnStart").addEventListener("click", start);
  $("btnStop").addEventListener("click", stop);

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type === "STATUS") {
      setStatus(msg.kind || "idle", msg.text || "");
      if (msg.log) log(msg.log);
    }
  });
});
