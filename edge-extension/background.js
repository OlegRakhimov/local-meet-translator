let offscreenCreated = false;
let running = false;

/**
 * Offscreen documents are global per-extension. In MV3 the service worker can be restarted at any time,
 * which resets in-memory flags (offscreenCreated=false) while the offscreen document still exists.
 * If we call createDocument again, Chrome/Edge throws:
 *   "Only a single offscreen document may be created."
 *
 * Fix:
 * - Prefer chrome.offscreen.hasDocument() when available.
 * - Fallback: treat the "single offscreen" error as "already exists".
 * - On STOP, close the offscreen document.
 */
async function ensureOffscreen() {
  if (offscreenCreated) return;

  // If supported, check whether an offscreen document already exists.
  try {
    if (chrome.offscreen && typeof chrome.offscreen.hasDocument === "function") {
      const has = await chrome.offscreen.hasDocument();
      if (has) {
        offscreenCreated = true;
        return;
      }
    }
  } catch (_) {
    // ignore
  }

  try {
    await chrome.offscreen.createDocument({
      url: "offscreen.html",
      reasons: ["USER_MEDIA"],
      justification: "Need to capture tab audio and record chunks (MediaRecorder not available in service worker)."
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
  } catch (_) {
    // ignore
  } finally {
    offscreenCreated = false;
  }
}

function status(kind, text, log) {
  chrome.runtime.sendMessage({ type: "STATUS", kind, text, log }).catch(() => {});
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    try {
      if (msg?.type === "START") {
        if (running) {
          sendResponse({ ok: true, already: true });
          return;
        }

        const tabId = msg.tabId;
        if (!tabId) {
          sendResponse({ ok: false, error: "No tabId" });
          return;
        }

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
          ttsSpeed: msg.ttsSpeed
        });

        running = true;
        status("run", "Running", "Started tab audio capture.");
        sendResponse({ ok: true });
        return;
      }

      if (msg?.type === "STOP") {
        if (!running) {
          await closeOffscreenIfPossible();
          sendResponse({ ok: true, already: true });
          return;
        }

        await chrome.runtime.sendMessage({ type: "OFFSCREEN_STOP" });
        running = false;

        // Important: close offscreen so next START won't hit the single-document limitation.
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
