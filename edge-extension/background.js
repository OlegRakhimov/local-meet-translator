let offscreenCreated = false;
let running = false;
let captureArmed = false;
let armedTabId = null;
let desktopExtensionToken = "";
let desktopExtensionClientId = "";
let desktopSessionId = "";
let desktopCommandSeq = 0;

const DESKTOP_BASE_URL = "http://127.0.0.1:18798";
const EXPECTED_DESKTOP_PRODUCT_ID = "local.meet.translator.desktop";

function normalizeCommandSeq(value) {
  const seq = Number(value || 0);
  return Number.isFinite(seq) && seq > 0 ? Math.floor(seq) : 0;
}

async function updateDesktopCommandCursor(sessionId, seq) {
  const normalizedSessionId = String(sessionId || "");
  const normalizedSeq = normalizeCommandSeq(seq);
  const sessionChanged = !!normalizedSessionId && normalizedSessionId !== desktopSessionId;
  const nextSessionId = normalizedSessionId || desktopSessionId;
  const nextSeq = sessionChanged
    ? normalizedSeq
    : Math.max(desktopCommandSeq, normalizedSeq);

  const update = {};
  if (nextSessionId !== desktopSessionId) {
    update.desktopExtensionSessionId = nextSessionId;
  }
  if (nextSeq !== desktopCommandSeq || sessionChanged) {
    update.desktopExtensionCommandSeq = nextSeq;
  }
  if (Object.keys(update).length) {
    await storeDesktopIdentity(update);
  }
  return { sessionId: desktopSessionId, seq: desktopCommandSeq };
}

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
  desktopCommandSeq = normalizeCommandSeq(obj.desktopExtensionCommandSeq || desktopCommandSeq || 0);
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
  if (next.desktopExtensionCommandSeq !== undefined) desktopCommandSeq = normalizeCommandSeq(next.desktopExtensionCommandSeq);
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
      if (String(result.data.desktopProductId || "") !== EXPECTED_DESKTOP_PRODUCT_ID) {
        return { ok: false, error: "The local pairing server does not belong to Local Meet Translator." };
      }
      return result.data;
    }
    return { ok: false, error: String(result.data && (result.data.error || result.data.message) || "Could not load pairing code.") };
  } catch (e) {
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
  if (String(result.data.desktopProductId || "") !== EXPECTED_DESKTOP_PRODUCT_ID) {
    return { ok: false, error: "The local pairing server does not belong to Local Meet Translator." };
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
  // Always inject a fresh controller. content_script.js disposes any previous
  // polling loop before starting a new one, so reconnecting the popup repairs
  // stale or invalidated extension contexts without reloading the Meet page.
  try { await chrome.scripting.executeScript({ target: { tabId }, files: ["content_script.js"] }); } catch (_) {}
}

async function restartContentPolling(tabId) {
  if (!tabId) return { ok: false, error: "No tabId" };
  try {
    const result = await Promise.race([
      chrome.tabs.sendMessage(tabId, { type: "LMT_RESTART_POLLING" }),
      new Promise((_, reject) => setTimeout(() => reject(new Error("Content-script restart timed out.")), 4000))
    ]);
    return result && result.ok ? result : { ok: false, error: String(result && (result.error || result.message) || "Content-script restart failed.") };
  } catch (error) {
    return { ok: false, error: String(error && (error.message || error) || error) };
  }
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

  const requestedSessionId = String(payload && payload.sessionId || "");
  const callerLastSeq = normalizeCommandSeq(payload && payload.lastSeq);
  const sameSession = !requestedSessionId || !desktopSessionId || requestedSessionId === desktopSessionId;
  const effectiveLastSeq = sameSession
    ? Math.max(callerLastSeq, desktopCommandSeq)
    : callerLastSeq;

  const params = {
    lastSeq: effectiveLastSeq,
    sessionId: requestedSessionId,
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
  if (!result.ok) {
    return { ok: false, error: String(result.data && (result.data.error || result.data.message) || "Desktop command poll failed.") };
  }

  const responseSessionId = String(result.data && result.data.sessionId || requestedSessionId || desktopSessionId || "");
  if (responseSessionId && responseSessionId !== desktopSessionId) {
    await updateDesktopCommandCursor(responseSessionId, 0);
  }

  return {
    ...(result.data || {}),
    ok: result.data && result.data.ok === false ? false : true,
    sessionId: responseSessionId,
    lastProcessedSeq: desktopCommandSeq
  };
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
  if (!result.ok) {
    return { ok: false, error: String(result.data && (result.data.error || result.data.message) || "Desktop health check failed.") };
  }
  if (String(result.data && result.data.desktopProductId || "") !== EXPECTED_DESKTOP_PRODUCT_ID) {
    return { ok: false, error: "The running desktop app is not Local Meet Translator." };
  }
  return result.data;
}
async function forwardSubtitleToDesktop(message) {
  const paired = await ensureDesktopToken(false);
  if (!paired.ok) return paired;
  let tabUrl = "";
  if (message && message.tabId) {
    try {
      const tab = await chrome.tabs.get(Number(message.tabId));
      tabUrl = String(tab && tab.url || "");
    } catch (_) {}
  }
  const body = {
    id: String(message && message.id || ""),
    channel: message && message.channel === "outgoing" ? "outgoing" : "incoming",
    translation: String(message && message.translation || ""),
    transcript: String(message && message.transcript || ""),
    transcriptionTrusted: message && message.transcriptionTrusted !== false,
    transcriptionUncertain: !!(message && message.transcriptionUncertain),
    transcriptionConfidence: String(message && message.transcriptionConfidence || "unknown"),
    transcriptionAgreement: Number(message && message.transcriptionAgreement || 0),
    detectedLanguage: String(message && message.detectedLanguage || ""),
    alternativeTranscript: String(message && message.alternativeTranscript || ""),
    ts: Number(message && message.ts || Date.now()),
    tabId: message && message.tabId !== undefined ? String(message.tabId) : "",
    url: tabUrl,
    clientId: desktopExtensionClientId || ""
  };
  let result = await postDesktopJson("/extension/subtitle", body);
  if (!result.ok && (result.status === 401 || result.status === 403)) {
    const repaired = await ensureDesktopToken(true);
    if (!repaired.ok) return repaired;
    result = await postDesktopJson("/extension/subtitle", body);
  }
  return result.ok
    ? { ok: true, eventId: String(result.data && result.data.eventId || "") }
    : { ok: false, error: String(result.data && (result.data.error || result.data.message) || "Desktop subtitle delivery failed.") };
}

async function ackDesktopCommand(payload) {
  const paired = await ensureDesktopToken(false);
  if (!paired.ok) return paired;
  const body = {
    clientId: String(payload && payload.clientId || desktopExtensionClientId || ""),
    sessionId: String(payload && payload.sessionId || desktopSessionId || ""),
    seq: normalizeCommandSeq(payload && payload.seq),
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
  if (!result.ok) {
    return { ok: false, error: String(result.data && (result.data.error || result.data.message) || "ACK failed.") };
  }

  // The cursor advances only after the desktop accepted the ACK. This keeps
  // retries possible when the local server is temporarily unavailable.
  await updateDesktopCommandCursor(body.sessionId, body.seq);
  return { ok: true, sessionId: desktopSessionId, seq: desktopCommandSeq };
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
    running = false;
    captureArmed = false;
    armedTabId = null;
  }
}

async function getOffscreenCaptureStatus() {
  try {
    if (!chrome.offscreen || typeof chrome.offscreen.hasDocument !== "function") {
      return { ok: true, exists: !!offscreenCreated, armed: captureArmed, running, tabId: armedTabId };
    }
    const has = await chrome.offscreen.hasDocument();
    if (!has) {
      offscreenCreated = false;
      running = false;
      captureArmed = false;
      armedTabId = null;
      return { ok: true, exists: false, armed: false, running: false, tabId: null };
    }
    offscreenCreated = true;
    const state = await sendRuntimeMessageWithTimeout({ type: "OFFSCREEN_STATUS" }, 4000);
    if (state && state.ok) {
      running = !!state.running;
      captureArmed = !!state.armed;
      armedTabId = state.tabId === undefined || state.tabId === null ? null : Number(state.tabId);
    }
    return state || { ok: false, error: "Offscreen status unavailable." };
  } catch (error) {
    return { ok: false, error: String(error && (error.message || error) || error) };
  }
}

async function releaseCaptureCompletely() {
  try {
    const state = await getOffscreenCaptureStatus();
    if ((state && state.exists) || offscreenCreated) {
      try { await sendRuntimeMessageWithTimeout({ type: "OFFSCREEN_RELEASE" }, 8000); } catch (_) {}
    }
  } finally {
    await closeOffscreenIfPossible();
  }
}

async function pauseCaptureKeepArmed() {
  const state = await getOffscreenCaptureStatus();
  if (!state || !state.exists) {
    running = false;
    captureArmed = false;
    armedTabId = null;
    return { ok: true, already: true, armed: false };
  }
  const result = await sendRuntimeMessageWithTimeout({ type: "OFFSCREEN_PAUSE" }, 8000);
  running = false;
  captureArmed = !!(result && result.armed);
  armedTabId = result && result.tabId !== undefined && result.tabId !== null ? Number(result.tabId) : armedTabId;
  return result || { ok: false, error: "Could not pause translation capture." };
}

async function armTabCapture(tabId) {
  if (!tabId) return { ok: false, error: "No tabId" };
  const state = await getOffscreenCaptureStatus();
  if (state && state.ok && state.armed && Number(state.tabId) === Number(tabId)) {
    captureArmed = true;
    armedTabId = Number(tabId);
    running = !!state.running;
    return { ok: true, armed: true, running, tabId: Number(tabId), reused: true };
  }
  if ((state && state.exists) || offscreenCreated) await releaseCaptureCompletely();
  const streamId = await getTabStreamIdWithTimeout(tabId, 10000);
  await ensureOffscreen();
  const result = await sendRuntimeMessageWithTimeout({
    type: "OFFSCREEN_ARM",
    streamId,
    tabId
  }, 18000);
  if (!result || !result.ok) {
    await releaseCaptureCompletely();
    return result || { ok: false, error: "Browser audio could not be armed." };
  }
  running = false;
  captureArmed = true;
  armedTabId = Number(tabId);
  return { ...result, armed: true, tabId: Number(tabId) };
}

async function recoverArmedTabCapture(tabId) {
  status("run", "Recovering audio", "The previously armed stream ended before startup. Re-arming the active meeting tab automatically...");
  try {
    const recovered = await armTabCapture(tabId);
    if (recovered && recovered.ok && recovered.armed && Number(recovered.tabId) === Number(tabId)) {
      status("ok", "Audio re-armed", "Browser audio was re-armed automatically for this meeting tab.");
      return recovered;
    }
    return {
      ok: false,
      error: String(recovered && (recovered.error || recovered.message) || "Browser audio could not be re-armed automatically.")
    };
  } catch (error) {
    return { ok: false, error: friendlyError(error) };
  }
}

async function stopCaptureForRestart() {
  await releaseCaptureCompletely();
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
    chunkSeconds: s.chunkSeconds || 7,
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

async function getTabStreamIdWithTimeout(tabId, timeoutMs = 10000) {
  let timer = null;
  return Promise.race([
    chrome.tabCapture.getMediaStreamId({ targetTabId: tabId }),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`Tab audio permission timed out after ${timeoutMs} ms.`)), timeoutMs);
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
      clientId: String(msg.clientId || ""),
      sessionId: String(msg.sessionId || ""),
      seq: normalizeCommandSeq(msg.seq),
      action: String(msg.action || "")
    } : null;

    async function finalizeDesktopCommandResult(result) {
      const normalized = result && typeof result === "object"
        ? { ...result }
        : { ok: false, error: "Desktop command returned no result." };
      if (!desktopAckInfo || !desktopAckInfo.seq || !desktopAckInfo.action) return normalized;
      try {
        const ack = await ackDesktopCommand({
          ...desktopAckInfo,
          ok: !!normalized.ok,
          message: String(normalized.message || (normalized.already ? "already running/stopped" : "")),
          error: String(normalized.error || ""),
          details: normalized.details || {}
        });
        if (!ack || !ack.ok) {
          return {
            ...normalized,
            acknowledged: false,
            ackError: String(ack && (ack.error || ack.message) || "Desktop ACK was rejected.")
          };
        }
        return {
          ...normalized,
          acknowledged: true,
          ackSeq: normalizeCommandSeq(ack.seq || desktopAckInfo.seq)
        };
      } catch (error) {
        return {
          ...normalized,
          acknowledged: false,
          ackError: String(error && (error.message || error) || error)
        };
      }
    }

    async function respond(result) {
      sendResponse(await finalizeDesktopCommandResult(result));
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
        const capture = await armTabCapture(tabId);
        if (!capture || !capture.ok) {
          const error = (capture && (capture.error || capture.message)) || "Browser audio could not be armed.";
          status("err", "Audio capture not armed", error);
          sendResponse({ ok:false, error, tabId, url: tab.url });
          return;
        }
        await ensureContentScriptsInjected(tabId);
        const polling = await restartContentPolling(tabId);
        const arm = await armDesktopClient({ clientId: desktopExtensionClientId, url: tab.url, visible: true });
        try { await chrome.tabs.sendMessage(tabId, { type: "LMT_ARMED" }); } catch (_) {}
        if (!arm || !arm.ok) {
          const error = (arm && (arm.error || arm.message)) || "Desktop command server is not paired/ready.";
          await releaseCaptureCompletely();
          status("err", "Desktop not ready", error);
          sendResponse({ ok:false, error });
          return;
        }
        if (!polling.ok) {
          const error = `Meeting tab was registered, but command polling did not start: ${polling.error}`;
          await releaseCaptureCompletely();
          status("err", "Meeting tab not ready", error);
          sendResponse({ ok:false, error, tabId, url: tab.url });
          return;
        }
        status("ok", "Meeting tab connected", "Meeting tab connected, command polling is active, and browser audio is armed locally.");
        sendResponse({ ok:true, tabId, url: tab.url, polling:true, armed:true });
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
        await ensureTabNotMuted(tabId);
        const capture = await armTabCapture(tabId);
        if (!capture || !capture.ok) return sendResponse({ ok:false, error:(capture && (capture.error || capture.message)) || "Browser audio could not be armed." });
        await ensureContentScriptsInjected(tabId);
        const polling = await restartContentPolling(tabId);
        if (!polling.ok) return sendResponse({ ok:false, error:polling.error || "Command polling did not start." });
        await armDesktopClient({ clientId: desktopExtensionClientId, url: tab.url, visible: true });
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

      if (msg?.type === "DESKTOP_BLUR_STATE") {
        sendResponse(await armDesktopClient({
          clientId: msg.clientId,
          url: msg.url,
          visible: msg.visible === undefined ? false : !!msg.visible
        }));
        return;
      }

      if (msg?.type === "DESKTOP_COMMAND_POLL") {
        sendResponse(await pollDesktopCommand(msg));
        return;
      }

      if (msg?.type === "DESKTOP_COMMAND_ACK") {
        // Compatibility with an already-open tab that still runs an older
        // content script. Do not forward it: background owns the only ACK.
        sendResponse({ ok: true, ignored: true, owner: "background" });
        return;
      }

      if (msg?.type === "DESKTOP_COMMAND") {
        const tabId = sender && sender.tab && sender.tab.id;
        if (!tabId) {
          await respond({ ok: false, error: "Desktop command came without sender tab" });
          return;
        }
        if (msg.action === "start") {
          msg = await getStartMessageFromStorage(msg, tabId);
          status("run", "Desktop command", `start: micTx=${!!msg.micTxEnabled}; sink=${msg.ttsSinkDeviceName || "default"}; mic=${msg.micDeviceName || msg.micDeviceId || "default"}`);
          try {
            const { type, tabId: _tabId, ...settings } = msg;
            await chrome.storage.local.set({ settings });
          } catch (_) {}

          // Recover the offscreen state after a Manifest V3 service-worker restart.
          await getOffscreenCaptureStatus();

          // Switching subtitles <-> outgoing voice must not reacquire tabCapture.
          // Reacquiring the tab stream from a desktop command is fragile because
          // activeTab permission is user-gesture scoped. Update only the mic/TTS path.
          if (running) {
            const updated = await updateRunningCaptureMode(msg);
            if (!updated || !updated.ok) {
              const error = (updated && updated.error) || "Could not update voice mode.";
              const details = (updated && updated.details) || {};
              status("err", "Voice mode", error);
              await respond({ ok: false, error, details });
              return;
            }
            const readyMessage = updated.message || (msg.micTxEnabled ? "Voice translation is ready." : "Subtitles-only mode is ready.");
            const details = updated.details || {};
            status("run", msg.micTxEnabled ? "Voice ready" : "Running", readyMessage);
            await respond({ ok: true, message: readyMessage, details });
            return;
          }

          let captureState = await getOffscreenCaptureStatus();
          if (!captureState || !captureState.ok || !captureState.armed || Number(captureState.tabId) !== Number(tabId)) {
            const recovered = await recoverArmedTabCapture(tabId);
            if (recovered && recovered.ok) {
              captureState = await getOffscreenCaptureStatus();
            }
          }
          if (!captureState || !captureState.ok || !captureState.armed || Number(captureState.tabId) !== Number(tabId)) {
            const error = "Browser audio could not be armed for this meeting tab. Open the extension popup on the active meeting tab and press Connect this meeting tab once.";
            const details = { incomingReady: false, armed: false, tabId };
            status("err", "Audio capture not armed", error);
            await respond({ ok: false, error, details });
            return;
          }

          const activated = await sendRuntimeMessageWithTimeout({
            type: "OFFSCREEN_ACTIVATE",
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
          }, 24000);
          if (!activated || !activated.ok) {
            const error = (activated && activated.error) || "Armed browser audio could not be activated.";
            const details = (activated && activated.details) || { incomingReady: false, armed: true };
            running = false;
            captureArmed = true;
            armedTabId = Number(tabId);
            status("err", "Audio activation failed", error);
            await respond({ ok: false, error, details });
            return;
          }
          running = true;
          captureArmed = true;
          armedTabId = Number(tabId);
          const readyMessage = activated.message || "Incoming translation is ready.";
          const details = activated.details || { incomingReady: true, armed: true };
          status("run", msg.micTxEnabled ? "Voice ready" : "Running", readyMessage);
          await respond({ ok: true, message: readyMessage, details });
          return;
        } else if (msg.action === "stop") {
          msg = { type: "PAUSE" };
        } else if (msg.action === "release") {
          msg = { type: "RELEASE" };
        } else {
          await respond({ ok: false, error: "Unknown desktop command: " + String(msg.action) });
          return;
        }
      }

      if (msg?.type === "START") {
        if (running) await stopCaptureForRestart();
        const tabId = msg.tabId;
        if (!tabId) return sendResponse({ ok: false, error: "No tabId" });
        await ensureTabNotMuted(tabId);
        const streamId = await getTabStreamIdWithTimeout(tabId, 10000);
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
          await respond({ ok: false, error, details });
          return;
        }
        running = true;
        const readyMessage = offscreenResult.message || "Translation capture is ready.";
        const details = offscreenResult.details || {};
        status("run", "Running", readyMessage);
        await respond({ ok: true, message: readyMessage, details });
        return;
      }

      if (msg?.type === "PAUSE") {
        const paused = await pauseCaptureKeepArmed();
        if (!paused || !paused.ok) {
          const error = (paused && paused.error) || "Could not pause translation capture.";
          await respond({ ok: false, error });
          return;
        }
        status("ok", "Paused", paused.armed
          ? "Translation stopped. Browser audio remains armed locally for a fast restart."
          : "Translation stopped.");
        const message = paused.armed
          ? "Translation stopped. Meeting tab remains armed for a fast restart."
          : "Translation stopped.";
        await respond({
          ok: true,
          message,
          armed: !!paused.armed,
          tabId: paused.tabId,
          details: { armed: !!paused.armed, tabId: paused.tabId }
        });
        return;
      }

      if (msg?.type === "RELEASE") {
        await releaseCaptureCompletely();
        status("ok", "Disconnected", "Stopped translation and released browser audio capture.");
        await respond({ ok: true, message: "Browser audio capture released." });
        return;
      }

      if (msg?.type === "STOP") {
        if (!running && !captureArmed) {
          await closeOffscreenIfPossible();
          await respond({ ok: true, already: true, message: "Already stopped." });
          return;
        }
        try {
          await sendRuntimeMessageWithTimeout({ type: "OFFSCREEN_RELEASE" }, 8000);
        } finally {
          await closeOffscreenIfPossible();
        }
        status("ok", "Stopped", "Stopped capture.");
        await respond({ ok: true, message: "Stopped capture." });
        return;
      }

      if (msg?.type === "SUBTITLE") {
        const delivered = await forwardSubtitleToDesktop(msg);
        sendResponse(delivered);
        return;
      }
      sendResponse({ ok: true });
    } catch (e) {
      running = false;
      const error = friendlyError(e);
      status("err", "Error", error);
      await respond({ ok: false, error });
    }
  })();
  return true;
});

chrome.tabs.onRemoved.addListener((tabId) => {
  if (armedTabId !== null && Number(tabId) === Number(armedTabId)) {
    releaseCaptureCompletely().catch(() => {});
  }
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (armedTabId === null || Number(tabId) !== Number(armedTabId)) return;
  const changedUrl = String(changeInfo && changeInfo.url || "");
  const currentUrl = String(tab && tab.url || "");
  if (changedUrl && !isSupportedMeetingUrl(changedUrl)) {
    releaseCaptureCompletely().catch(() => {});
    return;
  }
  // Do not release merely because Meet reports a transient "loading" state.
  // Meet can refresh its document state after the popup has armed audio. The
  // offscreen stream itself is the source of truth, and start-time recovery
  // will re-arm it if the browser actually ended the track.
  if (currentUrl && !isSupportedMeetingUrl(currentUrl)) {
    releaseCaptureCompletely().catch(() => {});
  }
});

// Keep the latest payload until a newly-created side panel finishes loading.
let pendingSidePanelTranslation = null;

chrome.commands.onCommand.addListener(async (command, tab) => {
  if (command !== "translate-selection") return;

  const tabId = tab && tab.id;
  if (!tabId) return;

  try {
    // The keyboard command is a user gesture, so Chromium permits opening the panel.
    await chrome.sidePanel.open({ tabId });

    // Read only the selection: no Clipboard API, synthetic events, or DOM writes.
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => window.getSelection().toString()
    });

    pendingSidePanelTranslation = {
      type: "LMT_TRANSLATE_SELECTION",
      text: String(results && results[0] && results[0].result || "")
    };
  } catch (error) {
    pendingSidePanelTranslation = {
      type: "LMT_TRANSLATE_SELECTION",
      text: "",
      error: String(error && (error.message || error) || "Could not read the selection.")
    };
  }

  chrome.runtime.sendMessage(pendingSidePanelTranslation).catch(() => {});
});

chrome.runtime.onMessage.addListener((message) => {
  if (message && message.type === "LMT_SIDE_PANEL_READY" && pendingSidePanelTranslation) {
    chrome.runtime.sendMessage(pendingSidePanelTranslation).catch(() => {});
  }
});
