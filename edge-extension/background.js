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

async function ensureTabNotMuted(tabId) {
  try {
    const tab = await chrome.tabs.get(tabId);
    if (tab && tab.mutedInfo && tab.mutedInfo.muted) {
      await chrome.tabs.update(tabId, { muted: false });
    }
  } catch (_) {}
}

function status(kind, text, log) {
  chrome.runtime.sendMessage({ type: "STATUS", kind, text, log }).catch(() => {});
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    try {
      if (msg?.type === "START") {
        if (running) return sendResponse({ ok: true, already: true });

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

          // incoming (tab audio)
          sourceLang: msg.sourceLang,
          targetLang: msg.targetLang,
          chunkSeconds: msg.chunkSeconds,

          // local TTS for incoming
          ttsEnabled: msg.ttsEnabled,
          ttsVoice: msg.ttsVoice,
          ttsSpeed: msg.ttsSpeed,

          // outgoing mic->translated voice (optional)
          micTxEnabled: msg.micTxEnabled,
          micTxSourceLang: msg.micTxSourceLang,
          micTxTargetLang: msg.micTxTargetLang,
          micDeviceId: msg.micDeviceId,
          ttsSinkDeviceId: msg.ttsSinkDeviceId,
          micTxChunkSeconds: msg.micTxChunkSeconds,

          // UI preference: do not mix outgoing debug subtitles into the incoming overlay unless explicitly enabled.
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
      status("err", "Error", String(e));
      sendResponse({ ok: false, error: String(e) });
    }
  })();

  return true;
});
