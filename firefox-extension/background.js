let running = false;
let activeTabId = null;
let activeSessionId = "";
let activeTabUrl = "";
let activeTabVisible = false;
let extensionClientId = "";
let desktopExtensionToken = "";
let desktopSessionId = "";
let desktopCommandSeq = 0;
let desktopPollTimer = null;
let desktopPollBusy = false;

function status(kind, text, log) {
  browser.runtime.sendMessage({ type: "STATUS", kind, text, log }).catch(() => {});
}

function desktopBaseUrl() {
  return "http://127.0.0.1:18798";
}

function normalizePairingCode(code) {
  return String(code || "").trim().replace(/[\s-]+/g, "").toUpperCase();
}

function normalizeOrigin(origin) {
  return String(origin || "").trim();
}

function getActiveCommandPayload() {
  return {
    clientId: extensionClientId,
    sessionId: desktopSessionId,
    lastSeq: desktopCommandSeq,
    visible: activeTabVisible,
    url: activeTabUrl
  };
}

async function loadExtensionIdentity() {
  const obj = await browser.storage.local.get([
    "desktopExtensionToken",
    "desktopExtensionClientId",
    "desktopExtensionSessionId",
    "desktopExtensionCommandSeq",
    "desktopExtensionPairedAt"
  ]);
  desktopExtensionToken = String(obj.desktopExtensionToken || "");
  extensionClientId = String(obj.desktopExtensionClientId || "");
  desktopSessionId = String(obj.desktopExtensionSessionId || "");
  desktopCommandSeq = Number(obj.desktopExtensionCommandSeq || 0) || 0;
  if (!extensionClientId) {
    extensionClientId = typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    await browser.storage.local.set({ desktopExtensionClientId: extensionClientId });
  }
  return {
    paired: !!desktopExtensionToken,
    desktopExtensionToken,
    extensionClientId,
    desktopSessionId,
    desktopCommandSeq
  };
}

async function storeDesktopIdentity(next) {
  if (next.desktopExtensionToken !== undefined) desktopExtensionToken = String(next.desktopExtensionToken || "");
  if (next.desktopSessionId !== undefined) desktopSessionId = String(next.desktopSessionId || "");
  if (next.desktopCommandSeq !== undefined) desktopCommandSeq = Number(next.desktopCommandSeq || 0) || 0;
  await browser.storage.local.set({
    ...(next.desktopExtensionToken !== undefined ? { desktopExtensionToken } : {}),
    ...(next.desktopSessionId !== undefined ? { desktopExtensionSessionId: desktopSessionId } : {}),
    ...(next.desktopCommandSeq !== undefined ? { desktopExtensionCommandSeq: desktopCommandSeq } : {})
  });
}

function authHeaders() {
  return desktopExtensionToken ? { "X-Desktop-Extension-Token": desktopExtensionToken } : {};
}

function isPairingCodeValid(value) {
  return normalizePairingCode(value).length >= 6;
}

async function postDesktopJson(path, body, allowNoToken = false) {
  if (!allowNoToken && !desktopExtensionToken) {
    throw new Error("Desktop extension token is missing. Pair the extension first.");
  }
  const resp = await fetch(`${desktopBaseUrl()}${path}`, {
    method: "POST",
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders()
    },
    body: JSON.stringify(body || {})
  });
  const data = await resp.json().catch(() => ({}));
  return { ok: resp.ok && data.ok !== false, status: resp.status, data };
}

async function getDesktopJson(path, params = {}) {
  if (!desktopExtensionToken) {
    throw new Error("Desktop extension token is missing. Pair the extension first.");
  }
  const url = new URL(`${desktopBaseUrl()}${path}`);
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

async function forwardSubtitleToDesktop(message) {
  const paired = desktopExtensionToken ? { ok: true } : await loadExtensionIdentity();
  if (!desktopExtensionToken && !(paired && paired.paired)) {
    return { ok: false, error: "Desktop extension token is missing. Pair the extension first." };
  }
  const body = {
    id: String(message && message.id || ""),
    channel: message && message.channel === "outgoing" ? "outgoing" : "incoming",
    translation: String(message && message.translation || ""),
    transcript: String(message && message.transcript || ""),
    ts: Number(message && message.ts || Date.now()),
    tabId: message && message.tabId !== undefined ? String(message.tabId) : String(activeTabId || ""),
    url: String(message && message.url || activeTabUrl || ""),
    clientId: String(extensionClientId || "")
  };
  let result = await postDesktopJson("/extension/subtitle", body);
  if (!result.ok && (result.status === 401 || result.status === 403)) {
    await loadExtensionIdentity();
    result = await postDesktopJson("/extension/subtitle", body);
  }
  return result.ok
    ? { ok: true, eventId: String(result.data && result.data.eventId || "") }
    : { ok: false, error: String(result.data && (result.data.error || result.data.message) || "Desktop subtitle delivery failed.") };
}

globalThis.LMTDesktopSubtitles = Object.freeze({ send: forwardSubtitleToDesktop });

function friendlyError(error) {
  const text = String(error && (error.message || error) || "");
  if (text.includes("Could not establish connection") || text.includes("Receiving end does not exist")) {
    return "Firefox meeting bridge is not connected. Reload the Meet/Zoom/Teams tab after loading the extension.";
  }
  return text || "Unknown Firefox extension error";
}

function isSupportedMeetingUrl(url) {
  const value = String(url || "").toLowerCase();
  return value.startsWith("https://meet.google.com/")
    || value.includes(".zoom.us/")
    || value.startsWith("https://app.zoom.us/")
    || value.startsWith("https://teams.microsoft.com/")
    || value.startsWith("https://teams.live.com/");
}

async function getStartSettings(overrides, tabId) {
  const storedObject = await browser.storage.local.get("settings");
  const stored = storedObject.settings || {};
  const incoming = overrides || {};
  const settings = { ...stored, ...incoming };

  if (!incoming.ttsSinkDeviceId && stored.ttsSinkDeviceId) settings.ttsSinkDeviceId = stored.ttsSinkDeviceId;
  if (!incoming.ttsSinkDeviceName && stored.ttsSinkDeviceName) settings.ttsSinkDeviceName = stored.ttsSinkDeviceName;

  const audioIsolationMode = settings.audioIsolationMode !== false;
  return {
    tabId,
    serverUrl: settings.serverUrl || "http://127.0.0.1:8799",
    authToken: settings.authToken || "",
    sourceLang: settings.sourceLang || "auto",
    targetLang: settings.targetLang || "en",
    chunkSeconds: settings.chunkSeconds || 3,
    audioIsolationMode,
    ttsEnabled: audioIsolationMode ? false : !!settings.ttsEnabled,
    ttsVoice: settings.ttsVoice || "onyx",
    ttsSpeed: settings.ttsSpeed || 1.0,
    micTxEnabled: !!settings.micTxEnabled,
    micTxSourceLang: settings.micTxSourceLang || "en",
    micTxTargetLang: settings.micTxTargetLang || "en",
    micDeviceId: settings.micDeviceId || "",
    micDeviceName: settings.micDeviceName || "",
    ttsSinkDeviceId: settings.ttsSinkDeviceId || "",
    ttsSinkDeviceName: settings.ttsSinkDeviceName || (audioIsolationMode && !!settings.micTxEnabled ? "CABLE Input" : ""),
    micTxChunkSeconds: settings.micTxChunkSeconds || 5,
    outVoiceStyle: settings.outVoiceStyle || "openai",
    rvcModelTag: settings.rvcModelTag || "",
    showOutgoingSubtitles: !!settings.showOutgoingSubtitles
  };
}

async function rememberActiveTab(tabId) {
  if (!tabId) return null;
  const tab = await browser.tabs.get(tabId);
  if (!tab || !isSupportedMeetingUrl(tab.url)) {
    return null;
  }
  activeTabId = tabId;
  activeTabUrl = String(tab.url || "");
  activeTabVisible = !!tab.active;
  return tab;
}

async function notifyDesktopArmed(tab) {
  if (!desktopExtensionToken || !tab) return { ok: false, skipped: true };
  const clientId = extensionClientId || (await loadExtensionIdentity()).extensionClientId;
  const result = await postDesktopJson("/extension-client/armed", {
    clientId,
    url: String(tab.url || activeTabUrl || ""),
    visible: !!tab.active
  });
  if (result.ok) {
    status("ok", "Meeting tab connected", "Desktop pairing is ready for the selected meeting tab.");
  }
  return result;
}

async function pairWithDesktop(pairingCode) {
  const code = normalizePairingCode(pairingCode);
  if (!isPairingCodeValid(code)) {
    return { ok: false, error: "Enter the pairing code shown in the desktop app." };
  }
  const clientId = extensionClientId || (await loadExtensionIdentity()).extensionClientId;
  const result = await postDesktopJson("/extension/pair", { pairingCode: code, clientId }, true);
  if (!result.ok || !result.data || !result.data.token) {
    return { ok: false, error: result.data && (result.data.error || result.data.message) || "Pairing failed." };
  }
  await storeDesktopIdentity({
    desktopExtensionToken: String(result.data.token || ""),
    desktopSessionId: String(result.data.sessionId || desktopSessionId || ""),
    desktopCommandSeq: 0
  });
  desktopCommandSeq = 0;
  desktopSessionId = String(result.data.sessionId || desktopSessionId || "");
  if (activeTabId) {
    const tab = await browser.tabs.get(activeTabId).catch(() => null);
    if (tab && isSupportedMeetingUrl(tab.url)) {
      activeTabUrl = String(tab.url || activeTabUrl || "");
      activeTabVisible = !!tab.active;
      await notifyDesktopArmed(tab).catch(() => {});
    }
  }
  status("ok", "Paired", "Desktop extension token stored in browser.storage.local.");
  return { ok: true, tokenStored: true };
}

async function ackDesktopCommand(command, result) {
  if (!desktopExtensionToken || !command) return;
  const payload = {
    clientId: extensionClientId,
    sessionId: desktopSessionId,
    seq: command.seq,
    action: command.action,
    ok: !!(result && result.ok),
    message: result && (result.message || (result.already ? "already running/stopped" : "")),
    error: result && result.error,
    details: result && result.details
  };
  const ack = await postDesktopJson("/extension-command/ack", payload);
  if (!ack.ok) {
    status("err", "Desktop ACK rejected", String(ack.data && (ack.data.error || ack.data.message) || "ACK failed"));
  }
}

async function runDesktopCommand(command, tabId) {
  if (!command || !command.action) return { ok: false, error: "Unknown desktop command." };
  if (command.action === "start") return startCapture(tabId, command);
  if (command.action === "stop") {
    await stopCapture();
    status("ok", "Stopped", "Firefox capture stopped.");
    return { ok: true };
  }
  return { ok: false, error: "Unknown desktop command: " + String(command.action) };
}

async function syncDesktopCommand() {
  if (desktopPollBusy || !desktopExtensionToken || !activeTabId) return;
  desktopPollBusy = true;
  try {
    const tab = await browser.tabs.get(activeTabId).catch(() => null);
    if (!tab || !isSupportedMeetingUrl(tab.url)) {
      await stopCapture();
      activeTabId = null;
      activeTabUrl = "";
      activeTabVisible = false;
      return;
    }
    activeTabUrl = String(tab.url || activeTabUrl || "");
    activeTabVisible = !!tab.active;
    const result = await getDesktopJson("/extension-command", {
      ...getActiveCommandPayload()
    });
    if (!result.ok || !result.data || !result.data.ok) return;
    if (result.data.sessionId && result.data.sessionId !== desktopSessionId) {
      desktopSessionId = String(result.data.sessionId || "");
      desktopCommandSeq = 0;
      await storeDesktopIdentity({ desktopSessionId, desktopCommandSeq: 0 });
    }
    if (!result.data.hasCommand || !result.data.command) return;
    const command = result.data.command;
    if (!command.seq || command.seq <= desktopCommandSeq) return;
    const outcome = await runDesktopCommand(command, activeTabId);
    desktopCommandSeq = command.seq;
    await storeDesktopIdentity({ desktopCommandSeq });
    await ackDesktopCommand({
      seq: command.seq,
      action: command.action,
      targetClientId: result.data.clientId || command.targetClientId || extensionClientId
    }, outcome);
  } catch (error) {
    status("err", "Desktop control", String(error && (error.message || error)));
  } finally {
    desktopPollBusy = false;
  }
}

function ensureDesktopPolling() {
  if (desktopPollTimer) return;
  desktopPollTimer = setInterval(() => {
    syncDesktopCommand().catch(() => {});
  }, 400);
}

function stopDesktopPolling() {
  if (!desktopPollTimer) return;
  clearInterval(desktopPollTimer);
  desktopPollTimer = null;
}

async function stopCapture() {
  const tabId = activeTabId;
  activeTabId = null;
  activeTabUrl = "";
  activeTabVisible = false;
  activeSessionId = "";
  running = false;

  if (tabId) {
    try {
      await browser.tabs.sendMessage(tabId, { type: "FIREFOX_CAPTURE_STOP" });
    } catch (_) {}
  }
  if (globalThis.LMTFirefoxAudio) {
    await globalThis.LMTFirefoxAudio.stop();
  }
}

async function armTab(tabId) {
  if (!tabId) return { ok: false, error: "No active meeting tab." };
  const tab = await rememberActiveTab(tabId);
  if (!tab || !isSupportedMeetingUrl(tab.url)) {
    return { ok: false, error: "Open the popup from a Meet/Zoom/Teams meeting tab." };
  }
  if (desktopExtensionToken) {
    await notifyDesktopArmed(tab).catch(() => {});
  } else {
    status("warn", "Pair extension first", "Open the pairing popup and enter the desktop pairing code.");
  }
  return { ok: true, tabId, url: tab.url, paired: !!desktopExtensionToken };
}

async function startCapture(tabId, overrides) {
  if (!globalThis.LMTFirefoxAudio) {
    return { ok: false, error: "Firefox background audio pipeline was not loaded." };
  }
  const tab = await browser.tabs.get(tabId);
  if (!tab || !isSupportedMeetingUrl(tab.url)) {
    return { ok: false, error: "The selected tab is not a supported Meet/Zoom/Teams page." };
  }

  await stopCapture();
  const settings = await getStartSettings(overrides, tabId);
  await browser.storage.local.set({ settings });

  const sessionId = typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

  try {
    const audioResult = await globalThis.LMTFirefoxAudio.start(settings);
    activeTabId = tabId;
    activeSessionId = sessionId;
    running = true;
    const pageResult = await browser.tabs.sendMessage(tabId, {
      type: "FIREFOX_CAPTURE_START",
      sessionId,
      chunkSeconds: settings.chunkSeconds
    });
    if (!pageResult || !pageResult.ok) {
      throw new Error(pageResult && pageResult.error || "Firefox page audio bridge did not start.");
    }

    const details = {
      ...(audioResult.details || {}),
      incomingReady: true,
      firefoxWebRtcTracks: Number(pageResult.trackCount || 0)
    };
    const message = settings.micTxEnabled
      ? "Firefox WebRTC capture and outgoing voice translation are ready."
      : "Firefox WebRTC incoming translation is ready.";
    status("run", settings.micTxEnabled ? "Voice ready" : "Running", message);
    return { ok: true, message, details };
  } catch (error) {
    await stopCapture();
    const text = friendlyError(error);
    status("err", "Firefox capture failed", text);
    return { ok: false, error: text, details: { incomingReady: false, micTxReady: false, sinkReady: false } };
  }
}

async function handleRemoteAudio(message, sender) {
  const senderTabId = sender && sender.tab && sender.tab.id;
  if (!running || senderTabId !== activeTabId || message.sessionId !== activeSessionId) {
    return { ok: false, ignored: true };
  }
  return globalThis.LMTFirefoxAudio.enqueueIncomingAudio(message.arrayBuffer, message.mimeType);
}

browser.runtime.onMessage.addListener((message, sender) => {
  if (!message) return undefined;
  if (message.type === "ARM_CURRENT_TAB") return armTab(message.tabId);
  if (message.type === "PAIR_DESKTOP") return pairWithDesktop(message.pairingCode);
  if (message.type === "GET_PAIR_STATUS") {
    return loadExtensionIdentity().then((state) => ({ ok: true, ...state, activeTabId, activeTabUrl }));
  }
  if (message.type === "DESKTOP_COMMAND") {
    const tabId = sender && sender.tab && sender.tab.id;
    if (!tabId) return Promise.resolve({ ok: false, error: "Desktop command came without a meeting tab." });
    return runDesktopCommand(message, tabId);
  }
  if (message.type === "FIREFOX_REMOTE_AUDIO_CHUNK") return handleRemoteAudio(message, sender);
  if (message.type === "FIREFOX_CAPTURE_ERROR") {
    if (message.sessionId === activeSessionId) {
      status("err", "Firefox capture error", String(message.error || "Unknown page capture error"));
    }
    return Promise.resolve({ ok: true });
  }
  if (message.type === "STOP") {
    return stopCapture().then(() => ({ ok: true }));
  }
  return undefined;
});

browser.tabs.onRemoved.addListener((tabId) => {
  if (tabId === activeTabId) stopCapture().catch(() => {});
});

browser.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (tabId === activeTabId && changeInfo.status === "loading") {
    stopCapture().catch(() => {});
  }
});

loadExtensionIdentity().then(() => {
  ensureDesktopPolling();
  if (desktopExtensionToken && activeTabId) {
    syncDesktopCommand().catch(() => {});
  }
}).catch(() => {});

// Keep the latest payload until a newly-created Firefox sidebar is ready.
let pendingSidebarTranslation = null;

browser.commands.onCommand.addListener((command, tab) => {
  if (command !== "translate-selection") return;

  // Call open() synchronously inside the shortcut handler. Firefox requires
  // sidebarAction.open() to run while the user-action permission is active.
  const openingSidebar = browser.sidebarAction.open();
  const tabId = tab && tab.id;

  Promise.resolve(openingSidebar)
    .then(async () => {
      if (!tabId) throw new Error("No active page tab is available.");

      // Manifest V2 uses tabs.executeScript. This expression only reads the
      // current selection and does not write to the page DOM.
      const results = await browser.tabs.executeScript(tabId, {
        code: "window.getSelection().toString()"
      });

      pendingSidebarTranslation = {
        type: "LMT_TRANSLATE_SELECTION",
        text: String(results && results[0] || "")
      };
    })
    .catch((error) => {
      pendingSidebarTranslation = {
        type: "LMT_TRANSLATE_SELECTION",
        text: "",
        error: String(error && (error.message || error) || "Could not read the selection.")
      };
    })
    .then(() => browser.runtime.sendMessage(pendingSidebarTranslation).catch(() => {}));
});

browser.runtime.onMessage.addListener((message) => {
  if (message && message.type === "LMT_SIDE_PANEL_READY" && pendingSidebarTranslation) {
    browser.runtime.sendMessage(pendingSidebarTranslation).catch(() => {});
  }
  return undefined;
});
