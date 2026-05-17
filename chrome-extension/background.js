let offscreenCreated = false;
let running = false;

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
  return {
    type: "START",
    tabId,
    serverUrl: s.serverUrl || "http://127.0.0.1:8799",
    authToken: s.authToken || "",
    sourceLang: s.sourceLang || "auto",
    targetLang: s.targetLang || "en",
    chunkSeconds: s.chunkSeconds || 3,
    ttsEnabled: !!s.ttsEnabled,
    ttsVoice: s.ttsVoice || "onyx",
    ttsSpeed: s.ttsSpeed || 1.0,
    micTxEnabled: !!s.micTxEnabled,
    micTxSourceLang: s.micTxSourceLang || "en",
    micTxTargetLang: s.micTxTargetLang || "en",
    micDeviceId: s.micDeviceId || "",
    ttsSinkDeviceId: s.ttsSinkDeviceId || "",
    ttsSinkDeviceName: s.ttsSinkDeviceName || "",
    micTxChunkSeconds: s.micTxChunkSeconds || 5,
    outVoiceStyle: s.outVoiceStyle || "openai",
    rvcModelTag: s.rvcModelTag || "",
    showOutgoingSubtitles: !!s.showOutgoingSubtitles
  };
}

chrome.runtime.onMessage.addListener((incomingMsg, sender, sendResponse) => {
  (async () => {
    let msg = incomingMsg;
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
        status("ok", "Meeting tab connected", "Meeting tab connected. Now use Start/Stop from the desktop app.");
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
        if (running) await stopCaptureForRestart();
        msg = await getStartMessageFromStorage(msg, tabId);
        try {
          const { type, tabId: _tabId, ...settings } = msg;
          await chrome.storage.local.set({ settings });
        } catch (_) {}
      }

      if (msg?.type === "DESKTOP_COMMAND") {
        const tabId = sender && sender.tab && sender.tab.id;
        if (!tabId) return sendResponse({ ok:false, error:"Desktop command came without sender tab" });
        if (msg.action === "start") {
          if (running) await stopCaptureForRestart();
          msg = await getStartMessageFromStorage(msg, tabId);
          try {
            const { type, tabId: _tabId, ...settings } = msg;
            await chrome.storage.local.set({ settings });
          } catch (_) {}
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
        await chrome.runtime.sendMessage({
          type: "OFFSCREEN_START",
          streamId,
          tabId,
          serverUrl: msg.serverUrl,
          authToken: msg.authToken,
          sourceLang: msg.sourceLang,
          targetLang: msg.targetLang,
          chunkSeconds: msg.chunkSeconds,
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
        });
        running = true;
        status("run", "Running", "Started capture.");
        sendResponse({ ok: true });
        return;
      }

      if (msg?.type === "STOP") {
        if (!running) {
          await closeOffscreenIfPossible();
          return sendResponse({ ok: true, already: true });
        }
        await chrome.runtime.sendMessage({ type: "OFFSCREEN_STOP" });
        running = false;
        await closeOffscreenIfPossible();
        status("ok", "Stopped", "Stopped capture.");
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
      status("err", "Error", error);
      sendResponse({ ok: false, error });
    }
  })();
  return true;
});
