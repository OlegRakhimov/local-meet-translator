(() => {
  "use strict";

  const PAGE_SOURCE = "lmt-firefox-page";
  const CONTENT_SOURCE = "lmt-firefox-content";
  let bridgeReady = false;
  let activeSessionId = "";
  const readyWaiters = new Set();
  const startWaiters = new Map();
  let bridgeProbeTimer = null;

  function postToPage(type, payload = {}) {
    const targetOrigin = location.origin && location.origin !== "null" ? location.origin : "*";
    window.postMessage({ source: CONTENT_SOURCE, type, ...payload }, targetOrigin);
  }

  function stopBridgeProbe() {
    if (!bridgeProbeTimer) return;
    clearInterval(bridgeProbeTimer);
    bridgeProbeTimer = null;
  }

  function probeBridge() {
    postToPage("probe");
  }

  function waitForBridge(timeoutMs = 3000) {
    if (bridgeReady) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const waiter = { resolve, reject };
      readyWaiters.add(waiter);
      probeBridge();
      if (!bridgeProbeTimer) {
        bridgeProbeTimer = setInterval(probeBridge, 100);
      }
      setTimeout(() => {
        if (!readyWaiters.delete(waiter)) return;
        if (!readyWaiters.size) stopBridgeProbe();
        reject(new Error("Firefox page audio bridge did not initialize."));
      }, timeoutMs);
    });
  }

  function waitForStart(sessionId, timeoutMs = 4000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        startWaiters.delete(sessionId);
        reject(new Error("Firefox page audio capture did not acknowledge startup."));
      }, timeoutMs);
      startWaiters.set(sessionId, {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        }
      });
    });
  }

  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    const message = event.data;
    if (!message || message.source !== PAGE_SOURCE) return;

    if (message.type === "bridge-ready") {
      bridgeReady = true;
      stopBridgeProbe();
      for (const waiter of readyWaiters) waiter.resolve();
      readyWaiters.clear();
      return;
    }

    if (message.type === "capture-started") {
      const waiter = startWaiters.get(String(message.sessionId || ""));
      if (waiter) {
        startWaiters.delete(String(message.sessionId || ""));
        waiter.resolve({ ok: true, trackCount: Number(message.trackCount || 0) });
      }
      return;
    }

    if (message.type === "audio-chunk" && message.sessionId === activeSessionId && message.arrayBuffer) {
      browser.runtime.sendMessage({
        type: "FIREFOX_REMOTE_AUDIO_CHUNK",
        sessionId: activeSessionId,
        mimeType: message.mimeType || "audio/ogg;codecs=opus",
        arrayBuffer: message.arrayBuffer
      }).catch(() => {});
      return;
    }

    if (message.type === "capture-error") {
      browser.runtime.sendMessage({
        type: "FIREFOX_CAPTURE_ERROR",
        sessionId: activeSessionId,
        error: String(message.error || "Firefox page audio capture failed")
      }).catch(() => {});
    }
  });

  browser.runtime.onMessage.addListener((message) => {
    if (!message) return undefined;

    if (message.type === "FIREFOX_CAPTURE_START") {
      return (async () => {
        await waitForBridge();
        activeSessionId = String(message.sessionId || "");
        const started = waitForStart(activeSessionId);
        postToPage("start", {
          sessionId: activeSessionId,
          chunkSeconds: message.chunkSeconds || 7
        });
        return started;
      })();
    }

    if (message.type === "FIREFOX_CAPTURE_STOP") {
      postToPage("stop", { sessionId: activeSessionId });
      activeSessionId = "";
      return Promise.resolve({ ok: true });
    }

    return undefined;
  });

  // The page bridge is declared as a MAIN-world content script in manifest.json.
  // A probe/ready handshake avoids a startup race between the MAIN and ISOLATED
  // content-script worlds, including after reloading the temporary extension.
  probeBridge();
})();
