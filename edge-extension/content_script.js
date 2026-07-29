(() => {
  const root = globalThis;
  const previous = root.__LMT_CONTENT_SCRIPT_CONTROLLER__;
  try { if (previous && typeof previous.dispose === "function") previous.dispose(); } catch (_) {}

  const LMT_CLIENT_ID_KEY = "lmt_desktop_client_id";
  const state = {
    disposed: false,
    clientId: sessionStorage.getItem(LMT_CLIENT_ID_KEY) || "",
    sessionId: sessionStorage.getItem("lmt_desktop_session_id") || "",
    lastSeq: Number(sessionStorage.getItem("lmt_last_desktop_seq") || "0") || 0,
    lastCommandKey: sessionStorage.getItem("lmt_last_desktop_command_key") || "",
    identityReady: false,
    pollBusy: false,
    pollStartedAt: 0,
    lastReportedVisibility: null,
    intervals: [],
    timeouts: []
  };

  function withTimeout(promise, timeoutMs, message) {
    let timer = null;
    return Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs);
      })
    ]).finally(() => { if (timer) clearTimeout(timer); });
  }

  function persistIdentity() {
    try {
      sessionStorage.setItem(LMT_CLIENT_ID_KEY, state.clientId || "");
      sessionStorage.setItem("lmt_desktop_session_id", state.sessionId || "");
      sessionStorage.setItem("lmt_last_desktop_seq", String(state.lastSeq || 0));
      sessionStorage.setItem("lmt_last_desktop_command_key", state.lastCommandKey || "");
    } catch (_) {}
  }

  async function syncDesktopIdentity(force = false) {
    if (state.disposed) return false;
    if (state.identityReady && !force) return true;
    try {
      const identity = await withTimeout(
        chrome.runtime.sendMessage({ type: "DESKTOP_IDENTITY_GET" }),
        5000,
        "Desktop identity request timed out."
      );
      if (!identity || !identity.ok) return false;
      if (identity.clientId) state.clientId = String(identity.clientId);
      if (!state.clientId) {
        state.clientId = (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function")
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
      }
      const nextSessionId = String(identity.sessionId || "");
      const identitySeq = Number(identity.seq || 0) || 0;
      if (nextSessionId !== state.sessionId) {
        state.sessionId = nextSessionId;
        state.lastSeq = identitySeq;
        state.lastCommandKey = "";
      } else if (identitySeq > state.lastSeq) {
        state.lastSeq = identitySeq;
      }
      state.identityReady = true;
      persistIdentity();
      return true;
    } catch (_) {
      state.identityReady = false;
      return false;
    }
  }

  function isMeetingTabVisible() {
    return document.visibilityState === "visible" && document.hasFocus();
  }

  async function notifyDesktopVisibility(visible = isMeetingTabVisible(), force = false) {
    if (state.disposed) return { ok: false };
    const normalizedVisible = !!visible;
    if (!force && state.lastReportedVisibility === normalizedVisible) {
      return { ok: true, unchanged: true, visible: normalizedVisible };
    }
    try {
      await syncDesktopIdentity();
      const response = await withTimeout(
        chrome.runtime.sendMessage({
          type: normalizedVisible ? "DESKTOP_ARMED" : "DESKTOP_BLUR_STATE",
          clientId: state.clientId,
          url: location.href,
          visible: normalizedVisible
        }),
        5000,
        "Desktop visibility update timed out."
      );
      if (response && response.ok !== false) {
        state.lastReportedVisibility = normalizedVisible;
      }
      return response || { ok: false };
    } catch (_) {
      return { ok: false };
    }
  }

  async function notifyDesktopArmed(force = false) {
    return await notifyDesktopVisibility(isMeetingTabVisible(), force);
  }

  async function pollDesktopCommand() {
    if (state.disposed) return;
    if (state.pollBusy) {
      if (state.pollStartedAt && Date.now() - state.pollStartedAt > 25000) {
        // A stale runtime message must not block every later start command.
        state.pollBusy = false;
        state.pollStartedAt = 0;
      } else {
        return;
      }
    }

    state.pollBusy = true;
    state.pollStartedAt = Date.now();
    try {
      await syncDesktopIdentity();
      const data = await withTimeout(
        chrome.runtime.sendMessage({
          type: "DESKTOP_COMMAND_POLL",
          clientId: state.clientId,
          sessionId: state.sessionId,
          lastSeq: state.lastSeq,
          visible: isMeetingTabVisible(),
          url: location.href
        }),
        7000,
        "Desktop command poll timed out."
      );
      if (!data || !data.ok) return;

      const nextSessionId = String(data.sessionId || state.sessionId || "");
      if (nextSessionId !== state.sessionId) {
        state.sessionId = nextSessionId;
        state.lastSeq = Number(data.lastProcessedSeq || 0) || 0;
        state.lastCommandKey = "";
        persistIdentity();
      } else {
        const backgroundSeq = Number(data.lastProcessedSeq || 0) || 0;
        if (backgroundSeq > state.lastSeq) {
          state.lastSeq = backgroundSeq;
          persistIdentity();
        }
      }
      if (!data.hasCommand || !data.command) return;

      const command = data.command;
      const commandKey = [
        data.sessionId || state.sessionId || "",
        command.seq || 0,
        command.action || "",
        command.issuedAt || "",
        command.micTxEnabled ? "voice" : "subtitles"
      ].join(":");
      const commandSeq = Number(command.seq || 0) || 0;
      if (!commandSeq || commandSeq <= state.lastSeq || commandKey === state.lastCommandKey) return;

      console.info("[LMT] desktop command", {
        seq: command.seq,
        action: command.action,
        micTxEnabled: command.micTxEnabled,
        ttsSinkDeviceName: command.ttsSinkDeviceName
      });

      const result = await withTimeout(
        chrome.runtime.sendMessage({
          type: "DESKTOP_COMMAND",
          clientId: state.clientId,
          sessionId: state.sessionId,
          seq: command.seq,
          action: command.action,
          serverUrl: command.serverUrl || data.serverUrl,
          authToken: command.authToken || data.authToken,
          sourceLang: command.sourceLang,
          targetLang: command.targetLang,
          chunkSeconds: command.chunkSeconds,
          audioIsolationMode: command.audioIsolationMode,
          ttsEnabled: command.ttsEnabled,
          ttsVoice: command.ttsVoice,
          ttsSpeed: command.ttsSpeed,
          micTxEnabled: command.micTxEnabled,
          micTxSourceLang: command.micTxSourceLang,
          micTxTargetLang: command.micTxTargetLang,
          micDeviceId: command.micDeviceId,
          micDeviceName: command.micDeviceName,
          ttsSinkDeviceId: command.ttsSinkDeviceId,
          ttsSinkDeviceName: command.ttsSinkDeviceName,
          micTxChunkSeconds: command.micTxChunkSeconds,
          outVoiceStyle: command.outVoiceStyle,
          rvcModelTag: command.rvcModelTag,
          showOutgoingSubtitles: command.showOutgoingSubtitles
        }),
        32000,
        "Browser audio start/stop operation timed out."
      );

      if (!result || result.acknowledged === false) {
        throw new Error(String(result && (result.ackError || result.error) || "Extension background did not acknowledge the desktop command."));
      }
      state.lastSeq = Math.max(commandSeq, Number(result.ackSeq || 0) || 0);
      state.lastCommandKey = commandKey;
      persistIdentity();
    } catch (error) {
      console.warn("[LMT] desktop command was not finalized", String(error && (error.message || error) || error));
      // Force the next poll to reload the durable background cursor. If the
      // background delivered the ACK but its response was lost, the next poll
      // advances from lastProcessedSeq without executing the command twice.
      state.identityReady = false;
    } finally {
      state.pollBusy = false;
      state.pollStartedAt = 0;
    }
  }

  async function restart() {
    if (state.disposed) return { ok: false, error: "Content script is disposed." };
    state.pollBusy = false;
    state.pollStartedAt = 0;
    state.identityReady = false;
    const identityOk = await syncDesktopIdentity(true);
    const armed = await notifyDesktopArmed(true);
    await pollDesktopCommand();
    return {
      ok: !!identityOk && !!(armed && armed.ok !== false),
      clientId: state.clientId,
      sessionId: state.sessionId
    };
  }

  const onFocus = () => { restart().catch(() => {}); };
  const onBlur = () => { notifyDesktopVisibility(false, true).catch(() => {}); };
  const onVisibility = () => {
    if (document.hidden) {
      notifyDesktopVisibility(false, true).catch(() => {});
    } else {
      restart().catch(() => {});
    }
  };
  const onPageShow = () => { restart().catch(() => {}); };
  const onPageHide = () => { notifyDesktopVisibility(false, true).catch(() => {}); };
  const onRuntimeMessage = (msg, _sender, sendResponse) => {
    if (msg && (msg.type === "LMT_RESTART_POLLING" || msg.type === "LMT_ARMED")) {
      restart()
        .then(result => sendResponse(result))
        .catch(error => sendResponse({ ok: false, error: String(error && (error.message || error) || error) }));
      return true;
    }
    return false;
  };

  function dispose() {
    if (state.disposed) return;
    state.disposed = true;
    for (const id of state.intervals) clearInterval(id);
    for (const id of state.timeouts) clearTimeout(id);
    state.intervals = [];
    state.timeouts = [];
    try { window.removeEventListener("focus", onFocus); } catch (_) {}
    try { window.removeEventListener("blur", onBlur); } catch (_) {}
    try { window.removeEventListener("pageshow", onPageShow); } catch (_) {}
    try { window.removeEventListener("pagehide", onPageHide); } catch (_) {}
    try { document.removeEventListener("visibilitychange", onVisibility); } catch (_) {}
    try { chrome.runtime.onMessage.removeListener(onRuntimeMessage); } catch (_) {}
  }

  root.__LMT_CONTENT_SCRIPT_LOADED__ = true;
  root.__LMT_CONTENT_SCRIPT_CONTROLLER__ = { restart, dispose, poll: pollDesktopCommand };

  try { chrome.runtime.onMessage.addListener(onRuntimeMessage); } catch (_) {}
  window.addEventListener("focus", onFocus);
  window.addEventListener("blur", onBlur);
  window.addEventListener("pageshow", onPageShow);
  window.addEventListener("pagehide", onPageHide);
  document.addEventListener("visibilitychange", onVisibility);

  state.intervals.push(setInterval(() => { pollDesktopCommand().catch(() => {}); }, 500));
  state.intervals.push(setInterval(() => {
    notifyDesktopVisibility(isMeetingTabVisible(), true).catch(() => {});
  }, 3000));
  state.timeouts.push(setTimeout(() => { restart().catch(() => {}); }, 50));
})();
