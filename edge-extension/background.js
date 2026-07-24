let offscreenCreated = false;
let running = false;
let desktopExtensionToken = "";
let desktopExtensionClientId = "";
let desktopSessionId = "";
let desktopCommandSeq = 0;

const DESKTOP_BASE_URL = "http://127.0.0.1:18798";

function normalizePairingCode(code) {
  return String(code || "").trim().replace(/[\s-]+/g, "").toUpperCase();
}

async function loadDesktopIdentity() {
  const obj = await chrome.storage.local.get([
    "desktopExtensionToken",
    "desktopExtensionClientId",
    "desktopExtensionSessionId",
    "desktopExtensionCommandSeq"
  ]);
  desktopExtensionToken = String(obj.desktopExtensionToken || desktopExtensionToken || "");
  desktopExtensionClientId = String(obj.desktopExtensionClientId || desktopExtensionClientId || "");
  desktopSessionId = String(obj.desktopExtensionSessionId || desktopSessionId || "");
  desktopCommandSeq = Number(obj.desktopExtensionCommandSeq || desktopCommandSeq || 0) || 0;
  if (!desktopExtensionClientId) {
    desktopExtensionClientId = (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function")
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    await chrome.storage.local.set({ desktopExtensionClientId });
  }
  return {
    ok: true,
    paired: !!desktopExtensionToken,
    clientId: desktopExtensionClientId,
    sessionId: desktopSessionId,
    seq: desktopCommandSeq
  };
}

async function storeDesktopIdentity(next) {
  if (next.desktopExtensionToken !== undefined) desktopExtensionToken = String(next.desktopExtensionToken || "");
  if (next.desktopExtensionClientId !== undefined) desktopExtensionClientId = String(next.desktopExtensionClientId || "");
  if (next.desktopExtensionSessionId !== undefined) desktopSessionId = String(next.desktopExtensionSessionId || "");
  if (next.desktopExtensionCommandSeq !== undefined) desktopCommandSeq = Number(next.desktopExtensionCommandSeq || 0) || 0;
  await chrome.storage.local.set({
    ...(next.desktopExtensionToken !== undefined ? { desktopExtensionToken } : {}),
    ...(next.desktopExtensionClientId !== undefined ? { desktopExtensionClientId } : {}),
    ...(next.desktopExtensionSessionId !== undefined ? { desktopExtensionSessionId: desktopSessionId } : {}),
    ...(next.desktopExtensionCommandSeq !== undefined ? { desktopExtensionCommandSeq } : {})
  });
}

function authHeaders() {
  return desktopExtensionToken ? { "X-Desktop-Extension-Token": desktopExtensionToken } : {};
}

async function postDesktopJson(path, body, allowNoToken = false) {
  if (!allowNoToken && !desktopExtensionToken) {
    throw new Error("Desktop extension token is missing. Pair the extension first.");
  }
  // Pairing is intentionally unauthenticated. Do not send a stale desktop
  // token during /extension/pair, otherwise the browser may preflight with
  // X-Desktop-Extension-Token and older desktop builds can reject it.
  const headers = {
    "Content-Type": "application/json",
    ...(!allowNoToken ? authHeaders() : {})
  };
  const resp = await fetch(`${DESKTOP_BASE_URL}${path}`, {
    method: "POST",
    cache: "no-store",
    headers,
    body: JSON.stringify(body || {})
  });
  const data = await resp.json().catch(() => ({}));
  return { ok: resp.ok && data.ok !== false, status: resp.status, data };
}

async function getDesktopJson(path, params = {}) {
  if (!desktopExtensionToken) {
    throw new Error("Desktop extension token is missing. Pair the extension first.");
  }
  const url = new URL(`${DESKTOP_BASE_URL}${path}`);
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    url.searchParams.set(key, String(value));
  }
  const resp = await fetch(url.toString(), {
    method: "GET",
    cache: "no-store",
    headers: authHeaders()
  });
  const data = await resp.json().catch(() => ({}));
  return { ok: resp.ok && data.ok !== false, status: resp.status, data };
}

async function getDesktopPublicJson(path, params = {}) {
  const url = new URL(`${DESKTOP_BASE_URL}${path}`);
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    url.searchParams.set(key, String(value));
  }
  const resp = await fetch(url.toString(), { cache: "no-store" });
  const data = await resp.json().catch(() => ({}));
  return { ok: resp.ok && data.ok !== false, status: resp.status, data };
}

async function getDesktopPairingCode() {
  try {
    const result = await getDesktopPublicJson("/extension/pairing-code");
    if (result.ok && result.data && result.data.pairingCode) {
      try {
        await chrome.storage.local.set({ desktopExtensionPairingCode: String(result.data.pairingCode || "") });
      } catch (_) {}
      return result.data;
    }
    return { ok: false, error: String(result.data && (result.data.error || result.data.message) || "Could not load pairing code.") };
  } catch (e) {
    try {
      const cached = await chrome.storage.local.get("desktopExtensionPairingCode");
      if (cached && cached.desktopExtensionPairingCode) {
        return { ok: true, pairingCode: String(cached.desktopExtensionPairingCode || ""), cached: true };
      }
    } catch (_) {}
    return { ok: false, error: String(e && (e.message || e) || "Could not load pairing code.") };
  }
}

async function pairWithDesktop(pairingCode) {
  const identity = await loadDesktopIdentity();
  const result = await postDesktopJson("/extension/pair", {
    pairingCode: normalizePairingCode(pairingCode),
    clientId: identity.clientId
  }, true);
  if (!result.ok || !result.data || !result.data.token) {
    return { ok: false, error: String(result.data && (result.data.error || result.data.message) || "Pairing failed.") };
  }
  await storeDesktopIdentity({
    desktopExtensionToken: String(result.data.token || ""),
    desktopExtensionSessionId: String(result.data.sessionId || ""),
    desktopExtensionCommandSeq: 0
  });
  return { ok: true, tokenStored: true, sessionId: String(result.data.sessionId || ""), clientId: identity.clientId };
}


async function ensureDesktopToken(force = false) {
  await loadDesktopIdentity();
  if (!force && desktopExtensionToken) {
    return { ok: true, paired: true, tokenPresent: true };
  }
  const codeResult = await getDesktopPairingCode();
  if (!codeResult || !codeResult.ok || !codeResult.pairingCode) {
    return { ok: false, error: String(codeResult && (codeResult.error || codeResult.message) || "Desktop pairing code is unavailable.") };
  }
  return await pairWithDesktop(codeResult.pairingCode);
}

async function ensureContentScriptsInjected(tabId) {
  if (!tabId || !chrome.scripting || typeof chrome.scripting.executeScript !== "function") return;
  // Existing tabs opened before extension installation/reload do not automatically get content_script.js.
  // Injecting manually makes "Connect this meeting tab" work without forcing the user to reload the meeting.
  try { await chrome.scripting.executeScript({ target: { tabId }, files: ["i18n.js"] }); } catch (_) {}
  try { await chrome.scripting.executeScript({ target: { tabId }, files: ["content_script.js"] }); } catch (_) {}
}

async function armDesktopClient(payload) {
  const paired = await ensureDesktopToken(false);
  if (!paired.ok) return paired;
  const body = {
    clientId: String(payload && payload.clientId || desktopExtensionClientId || ""),
    url: String(payload && payload.url || ""),
    visible: payload && payload.visible === undefined ? true : !!payload.visible
  };
  let result = await postDesktopJson("/extension-client/armed", body);
  if (!result.ok && (result.status === 401 || result.status === 403)) {
    const repaired = await ensureDesktopToken(true);
    if (!repaired.ok) return repaired;
    result = await postDesktopJson("/extension-client/armed", body);
  }
  return result;
}

async function pollDesktopCommand(payload) {
  const paired = await ensureDesktopToken(false);
  if (!paired.ok) return paired;
  const params = {
    lastSeq: payload && payload.lastSeq || 0,
    sessionId: payload && payload.sessionId || "",
    clientId: payload && payload.clientId || desktopExtensionClientId || "",
    visible: !!(payload && payload.visible),
    url: payload && payload.url || ""
  };
  let result = await getDesktopJson("/extension-command", params);
  if (!result.ok && (result.status === 401 || result.status === 403)) {
    const repaired = await ensureDesktopToken(true);
    if (!repaired.ok) return repaired;
    result = await getDesktopJson("/extension-command", params);
  }
  return result.ok ? result.data : { ok: false, error: String(result.data && (result.data.error || result.data.message) || "Desktop command poll failed.") };
}

async function checkDesktopHealth() {
  const paired = await ensureDesktopToken(false);
  if (!paired.ok) return paired;
  let result = await getDesktopJson("/health");
  if (!result.ok && (result.status === 401 || result.status === 403)) {
    const repaired = await ensureDesktopToken(true);
    if (!repaired.ok) return repaired;
    result = await getDesktopJson("/health");
  }
  return result.ok ? result.data : { ok: false, error: String(result.data && (result.data.error || result.data.message) || "Desktop health check failed.") };
}

async function ackDesktopCommand(payload) {
  const paired = await ensureDesktopToken(false);
  if (!paired.ok) return paired;
  const body = {
    clientId: String(payload && payload.clientId || desktopExtensionClientId || ""),
    sessionId: String(payload && payload.sessionId || desktopSessionId || ""),
    seq: Number(payload && payload.seq || 0),
    action: String(payload && payload.action || ""),
    ok: !!(payload && payload.ok),
    message: String(payload && payload.message || ""),
    error: String(payload && payload.error || ""),
    details: payload && payload.details
  };
  let result = await postDesktopJson("/extension-command/ack", body);
  if (!result.ok && (result.status === 401 || result.status === 403)) {
    const repaired = await ensureDesktopToken(true);
    if (!repaired.ok) return repaired;
    result = await postDesktopJson("/extension-command/ack", body);
  }
  return result.ok ? { ok: true } : { ok: false, error: String(result.data && (result.data.error || result.data.message) || "ACK failed.") };
}

async function ensureOffscreen() {
  if (offscreenCreated) return;
  try {
    if (chrome.offscreen && typeof chrome.offscreen.hasDocument === "function") {
      const has = await chrome.offscreen.hasDocument();
      if (has) { offscreenCreated = true; return; }
    }
  } catch (_) {}
  try {
    await chrome.offscreen.createDocument({
      url: "offscreen.html",
      reasons: ["USER_MEDIA"],
      justification: "Capture tab audio and (optionally) microphone audio in an offscreen document."
    });
    offscreenCreated = true;
  } catch (e) {
    const msg = String((e && (e.message || e)) || "");
    if (msg.toLowerCase().includes("only a single offscreen document")) {
      offscreenCreated = true;
      return;
    }
    throw e;
  }
}

async function closeOffscreenIfPossible() {
  try {
    if (chrome.offscreen && typeof chrome.offscreen.closeDocument === "function") {
      await chrome.offscreen.closeDocument();
    }
  } catch (_) {} finally {
    offscreenCreated = false;
  }
}

async function stopCaptureForRestart() {
  if (running || offscreenCreated) {
    try { await chrome.runtime.sendMessage({ type: "OFFSCREEN_STOP" }); } catch (_) {}
    await closeOffscreenIfPossible();
  }
  running = false;
}

async function ensureTabNotMuted(tabId) {
  try {
    const tab = await chrome.tabs.get(tabId);
    if (tab && tab.mutedInfo && tab.mutedInfo.muted) await chrome.tabs.update(tabId, { muted: false });
  } catch (_) {}
}

function status(kind, text, log) {
  chrome.runtime.sendMessage({ type: "STATUS", kind, text, log }).catch(() => {});
}

function friendlyError(e) {
  const text = String(e && (e.message || e) || "");
  if (text.includes("Extension has not been invoked") || text.includes("activeTab permission")) {
    return "Open the Meet tab, click the Local Meet Translator extension icon, and press 'Connect this meeting tab' once. Browser security requires this before tab audio can be captured.";
  }
  if (text.includes("Chrome pages cannot be captured")) {
    return "This tab cannot be captured. Open a real Meet/Zoom/Teams meeting tab and connect it from the extension popup.";
  }
  return text || "Unknown extension error";
}

function isSupportedMeetingUrl(url) {
  const u = String(url || "").toLowerCase();
  return u.startsWith("https://meet.google.com/")
    || u.includes(".zoom.us/")
    || u.startsWith("https://app.zoom.us/")
    || u.startsWith("https://teams.microsoft.com/")
    || u.startsWith("https://teams.live.com/");
}

async function getStartMessageFromStorage(overrides, tabId) {
  const obj = await chrome.storage.local.get("settings");
  const stored = obj.settings || {};
  const incoming = overrides || {};
  const s = { ...stored, ...incoming };

  // The desktop app can configure the output by name, but it cannot know the
  // browser-only deviceId returned after the user grants speaker selection.
  // Keep that saved id instead of overwriting it with an empty desktop value.
  if (!incoming.ttsSinkDeviceId && stored.ttsSinkDeviceId) {
    s.ttsSinkDeviceId = stored.ttsSinkDeviceId;
  }
  if (!incoming.ttsSinkDeviceName && stored.ttsSinkDeviceName) {
    s.ttsSinkDeviceName = stored.ttsSinkDeviceName;
  }
  const audioIsolationMode = s.audioIsolationMode !== false;
  return {
    type: "START",
    tabId,
    serverUrl: s.serverUrl || "http://127.0.0.1:8799",
    authToken: s.authToken || "",
    sourceLang: s.sourceLang || "auto",
    targetLang: s.targetLang || "en",
    chunkSeconds: s.chunkSeconds || 3,
    audioIsolationMode,
    ttsEnabled: audioIsolationMode ? false : !!s.ttsEnabled,
    ttsVoice: s.ttsVoice || "onyx",
    ttsSpeed: s.ttsSpeed || 1.0,
    micTxEnabled: !!s.micTxEnabled,
    micTxSourceLang: s.micTxSourceLang || "en",
    micTxTargetLang: s.micTxTargetLang || "en",
    micDeviceId: s.micDeviceId || "",
    micDeviceName: s.micDeviceName || "",
    ttsSinkDeviceId: s.ttsSinkDeviceId || "",
    ttsSinkDeviceName: s.ttsSinkDeviceName || (audioIsolationMode && !!s.micTxEnabled ? "CABLE Input" : ""),
    micTxChunkSeconds: s.micTxChunkSeconds || 5,
    outVoiceStyle: s.outVoiceStyle || "openai",
    rvcModelTag: s.rvcModelTag || "",
    showOutgoingSubtitles: !!s.showOutgoingSubtitles
  };
}

async function sendRuntimeMessageWithTimeout(message, timeoutMs = 15000) {
  let timer = null;
  return Promise.race([
    chrome.runtime.sendMessage(message),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`Offscreen audio operation timed out after ${timeoutMs} ms.`)), timeoutMs);
    })
  ]).finally(() => { if (timer) clearTimeout(timer); });
}

async function updateRunningCaptureMode(msg) {
  await ensureOffscreen();
  return await sendRuntimeMessageWithTimeout({
    type: "OFFSCREEN_UPDATE_MODE",
    audioIsolationMode: msg.audioIsolationMode,
    ttsEnabled: msg.ttsEnabled,
    ttsVoice: msg.ttsVoice,
    ttsSpeed: msg.ttsSpeed,
    micTxEnabled: msg.micTxEnabled,
    micTxSourceLang: msg.micTxSourceLang,
    micTxTargetLang: msg.micTxTargetLang,
    micDeviceId: msg.micDeviceId,
    micDeviceName: msg.micDeviceName,
    ttsSinkDeviceId: msg.ttsSinkDeviceId,
    ttsSinkDeviceName: msg.ttsSinkDeviceName,
    micTxChunkSeconds: msg.micTxChunkSeconds,
    outVoiceStyle: msg.outVoiceStyle,
    rvcModelTag: msg.rvcModelTag,
    showOutgoingSubtitles: msg.showOutgoingSubtitles
  }, 18000);
}

chrome.runtime.onMessage.addListener((incomingMsg, sender, sendResponse) => {
  (async () => {
    let msg = incomingMsg;
    const desktopAckInfo = msg?.type === "DESKTOP_COMMAND" ? {
      clientId: msg.clientId || "",
      sessionId: msg.sessionId || "",
      seq: Number(msg.seq || 0),
      action: String(msg.action || "")
    } : null;
    async function ackDesktopFromBackground(ok, payload = {}) {
      if (!desktopAckInfo || !desktopAckInfo.seq || !desktopAckInfo.action) return;
      try {
        await ackDesktopCommand({
          ...desktopAckInfo,
          ok: !!ok,
          message: payload.message || "",
          error: payload.error || "",
          details: payload.details || {}
        });
      } catch (_) {}
    }
    try {
      if (msg?.type === "ARM_CURRENT_TAB") {
        const tabId = msg.tabId;
        if (!tabId) return sendResponse({ ok:false, error:"No active meeting tab. Open Meet/Zoom/Teams tab first." });
        let tab = null;
        try { tab = await chrome.tabs.get(tabId); } catch (_) {}
        if (!tab || !isSupportedMeetingUrl(tab.url)) {
          return sendResponse({ ok:false, error:"Open the popup from a Meet/Zoom/Teams meeting tab, not from this page: " + String(tab && tab.url || "unknown") });
        }
        await ensureTabNotMuted(tabId);
        await ensureContentScriptsInjected(tabId);
        const arm = await armDesktopClient({ clientId: desktopExtensionClientId, url: tab.url, visible: true });
        try { await chrome.tabs.sendMessage(tabId, { type: "LMT_ARMED" }); } catch (_) {}
        if (!arm || !arm.ok) {
          const error = (arm && (arm.error || arm.message)) || "Desktop command server is not paired/ready.";
          status("err", "Desktop not ready", error);
          sendResponse({ ok:false, error });
          return;
        }
        status("ok", "Meeting tab connected", "Meeting tab connected. Return to the desktop app and choose voice translation or subtitles.");
        sendResponse({ ok:true, tabId, url: tab.url });
        return;
      }

      if (msg?.type === "CONNECT_AND_START") {
        const tabId = msg.tabId;
        if (!tabId) return sendResponse({ ok:false, error:"No active meeting tab. Open Meet/Zoom/Teams tab first." });
        let tab = null;
        try { tab = await chrome.tabs.get(tabId); } catch (_) {}
        if (!tab || !isSupportedMeetingUrl(tab.url)) {
          return sendResponse({ ok:false, error:"Open the popup from a Meet/Zoom/Teams meeting tab, not from this page: " + String(tab && tab.url || "unknown") });
        }
        await ensureContentScriptsInjected(tabId);
        await armDesktopClient({ clientId: desktopExtensionClientId, url: tab.url, visible: true });
        if (running) await stopCaptureForRestart();
        msg = await getStartMessageFromStorage(msg, tabId);
        try {
          const { type, tabId: _tabId, ...settings } = msg;
          await chrome.storage.local.set({ settings });
        } catch (_) {}
      }

      if (msg?.type === "DESKTOP_IDENTITY_GET") {
        sendResponse(await loadDesktopIdentity());
        return;
      }

      if (msg?.type === "DESKTOP_HEALTH") {
        sendResponse(await checkDesktopHealth());
        return;
      }

      if (msg?.type === "DESKTOP_PAIRING_CODE") {
        sendResponse(await getDesktopPairingCode());
        return;
      }

      if (msg?.type === "PAIR_WITH_DESKTOP") {
        sendResponse(await pairWithDesktop(msg.pairingCode));
        return;
      }

      if (msg?.type === "DESKTOP_ARMED") {
        sendResponse(await armDesktopClient(msg));
        return;
      }

      if (msg?.type === "DESKTOP_COMMAND_POLL") {
        sendResponse(await pollDesktopCommand(msg));
        return;
      }

      if (msg?.type === "DESKTOP_COMMAND_ACK") {
        sendResponse(await ackDesktopCommand(msg));
        return;
      }

      if (msg?.type === "DESKTOP_COMMAND") {
        const tabId = sender && sender.tab && sender.tab.id;
        if (!tabId) return sendResponse({ ok:false, error:"Desktop command came without sender tab" });
        if (msg.action === "start") {
          msg = await getStartMessageFromStorage(msg, tabId);
          status("run", "Desktop command", `start: micTx=${!!msg.micTxEnabled}; sink=${msg.ttsSinkDeviceName || "default"}; mic=${msg.micDeviceName || msg.micDeviceId || "default"}`);
          try {
            const { type, tabId: _tabId, ...settings } = msg;
            await chrome.storage.local.set({ settings });
          } catch (_) {}

          // Switching subtitles <-> outgoing voice must not reacquire tabCapture.
          // Reacquiring the tab stream from a desktop command is fragile because
          // activeTab permission is user-gesture scoped. Update only the mic/TTS path.
          if (running) {
            const updated = await updateRunningCaptureMode(msg);
            if (!updated || !updated.ok) {
              const error = (updated && updated.error) || "Could not update voice mode.";
              const details = (updated && updated.details) || {};
              status("err", "Voice mode", error);
              await ackDesktopFromBackground(false, { error, details });
              sendResponse({ ok: false, error, details });
              return;
            }
            const readyMessage = updated.message || (msg.micTxEnabled ? "Voice translation is ready." : "Subtitles-only mode is ready.");
            const details = updated.details || {};
            status("run", msg.micTxEnabled ? "Voice ready" : "Running", readyMessage);
            await ackDesktopFromBackground(true, { message: readyMessage, details });
            sendResponse({ ok: true, message: readyMessage, details });
            return;
          }
        } else if (msg.action === "stop") {
          msg = { type: "STOP" };
        } else {
          return sendResponse({ ok:false, error:"Unknown desktop command: " + String(msg.action) });
        }
      }

      if (msg?.type === "START") {
        if (running) await stopCaptureForRestart();
        const tabId = msg.tabId;
        if (!tabId) return sendResponse({ ok: false, error: "No tabId" });
        await ensureTabNotMuted(tabId);
        const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tabId });
        await ensureOffscreen();
        const offscreenResult = await sendRuntimeMessageWithTimeout({
          type: "OFFSCREEN_START",
          streamId,
          tabId,
          serverUrl: msg.serverUrl,
          authToken: msg.authToken,
          sourceLang: msg.sourceLang,
          targetLang: msg.targetLang,
          chunkSeconds: msg.chunkSeconds,
          audioIsolationMode: msg.audioIsolationMode,
          ttsEnabled: msg.ttsEnabled,
          ttsVoice: msg.ttsVoice,
          ttsSpeed: msg.ttsSpeed,
          micTxEnabled: msg.micTxEnabled,
          micTxSourceLang: msg.micTxSourceLang,
          micTxTargetLang: msg.micTxTargetLang,
          micDeviceId: msg.micDeviceId,
          micDeviceName: msg.micDeviceName,
          ttsSinkDeviceId: msg.ttsSinkDeviceId,
          ttsSinkDeviceName: msg.ttsSinkDeviceName,
          micTxChunkSeconds: msg.micTxChunkSeconds,
          outVoiceStyle: msg.outVoiceStyle,
          rvcModelTag: msg.rvcModelTag,
          showOutgoingSubtitles: msg.showOutgoingSubtitles
        }, 22000);
        if (!offscreenResult || !offscreenResult.ok) {
          const error = (offscreenResult && offscreenResult.error) || "Audio capture did not become ready.";
          const details = (offscreenResult && offscreenResult.details) || {};
          running = false;
          status("err", "Error", error);
          await ackDesktopFromBackground(false, { error, details });
          sendResponse({ ok: false, error, details });
          return;
        }
        running = true;
        const readyMessage = offscreenResult.message || "Translation capture is ready.";
        const details = offscreenResult.details || {};
        status("run", "Running", readyMessage);
        await ackDesktopFromBackground(true, { message: readyMessage, details });
        sendResponse({ ok: true, message: readyMessage, details });
        return;
      }

      if (msg?.type === "STOP") {
        if (!running) {
          await closeOffscreenIfPossible();
          await ackDesktopFromBackground(true, { message: "Already stopped." });
          return sendResponse({ ok: true, already: true });
        }
        await chrome.runtime.sendMessage({ type: "OFFSCREEN_STOP" });
        running = false;
        await closeOffscreenIfPossible();
        status("ok", "Stopped", "Stopped capture.");
        await ackDesktopFromBackground(true, { message: "Stopped capture." });
        sendResponse({ ok: true });
        return;
      }

      if (msg?.type === "SUBTITLE" && msg.tabId) {
        chrome.tabs.sendMessage(msg.tabId, msg).catch(() => {});
        sendResponse({ ok: true });
        return;
      }
      sendResponse({ ok: true });
    } catch (e) {
      running = false;
      const error = friendlyError(e);
      try { await ackDesktopFromBackground(false, { error }); } catch (_) {}
      status("err", "Error", error);
      sendResponse({ ok: false, error });
    }
  })();
  return true;
});
