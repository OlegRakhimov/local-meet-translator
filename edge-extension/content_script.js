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
      if (nextSessionId !== state.sessionId) {
        state.sessionId = nextSessionId;
        state.lastSeq = 0;
        state.lastCommandKey = "";
      }
      state.identityReady = true;
      persistIdentity();
      return true;
    } catch (_) {
      state.identityReady = false;
      return false;
    }
  }

  async function notifyDesktopArmed() {
    if (state.disposed) return { ok: false };
    try {
      await syncDesktopIdentity();
      return await withTimeout(
        chrome.runtime.sendMessage({
          type: "DESKTOP_ARMED",
          clientId: state.clientId,
          url: location.href,
          visible: document.visibilityState === "visible"
        }),
        5000,
        "Desktop armed heartbeat timed out."
      );
    } catch (_) {
      return { ok: false };
    }
  }

  async function sendCommandAck(command, result) {
    try {
      await withTimeout(
        chrome.runtime.sendMessage({
          type: "DESKTOP_COMMAND_ACK",
          clientId: state.clientId,
          sessionId: state.sessionId,
          seq: Number(command.seq || 0),
          action: String(command.action || ""),
          ok: !!(result && result.ok),
          message: String(result && (result.message || (result.already ? "already running/stopped" : "")) || ""),
          error: String(result && result.error || ""),
          details: result && result.details
        }),
        5000,
        "Desktop ACK request timed out."
      );
    } catch (_) {}
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
    let pendingCommand = null;
    try {
      await syncDesktopIdentity();
      const data = await withTimeout(
        chrome.runtime.sendMessage({
          type: "DESKTOP_COMMAND_POLL",
          clientId: state.clientId,
          sessionId: state.sessionId,
          lastSeq: 0,
          visible: document.visibilityState === "visible",
          url: location.href
        }),
        7000,
        "Desktop command poll timed out."
      );
      if (!data || !data.ok) return;

      const nextSessionId = String(data.sessionId || state.sessionId || "");
      if (nextSessionId !== state.sessionId) {
        state.sessionId = nextSessionId;
        state.lastSeq = 0;
        state.lastCommandKey = "";
        persistIdentity();
      }
      if (!data.hasCommand || !data.command) return;

      const command = data.command;
      pendingCommand = command;
      const commandKey = [
        data.sessionId || state.sessionId || "",
        command.seq || 0,
        command.action || "",
        command.issuedAt || "",
        command.micTxEnabled ? "voice" : "subtitles"
      ].join(":");
      if (!command.seq || commandKey === state.lastCommandKey) return;

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

      await sendCommandAck(command, result || { ok: false, error: "No response from extension background." });
      state.lastSeq = Number(command.seq || 0);
      state.lastCommandKey = commandKey;
      persistIdentity();
    } catch (error) {
      if (pendingCommand && pendingCommand.seq) {
        await sendCommandAck(pendingCommand, {
          ok: false,
          error: String(error && (error.message || error) || error)
        });
      }
      // Force the next poll to reload the service-worker identity after a
      // desktop restart or extension context recovery.
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
    const armed = await notifyDesktopArmed();
    await pollDesktopCommand();
    return {
      ok: !!identityOk && !!(armed && armed.ok !== false),
      clientId: state.clientId,
      sessionId: state.sessionId
    };
  }

  const onFocus = () => { restart().catch(() => {}); };
  const onVisibility = () => { if (!document.hidden) restart().catch(() => {}); };
  const onPageShow = () => { restart().catch(() => {}); };
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
    try { window.removeEventListener("pageshow", onPageShow); } catch (_) {}
    try { document.removeEventListener("visibilitychange", onVisibility); } catch (_) {}
    try { chrome.runtime.onMessage.removeListener(onRuntimeMessage); } catch (_) {}
  }

  root.__LMT_CONTENT_SCRIPT_LOADED__ = true;
  root.__LMT_CONTENT_SCRIPT_CONTROLLER__ = { restart, dispose, poll: pollDesktopCommand };

  try { chrome.runtime.onMessage.addListener(onRuntimeMessage); } catch (_) {}
  window.addEventListener("focus", onFocus);
  window.addEventListener("pageshow", onPageShow);
  document.addEventListener("visibilitychange", onVisibility);

  state.intervals.push(setInterval(() => { pollDesktopCommand().catch(() => {}); }, 500));
  state.intervals.push(setInterval(() => {
    if (!document.hidden) notifyDesktopArmed().catch(() => {});
  }, 3000));
  state.timeouts.push(setTimeout(() => { restart().catch(() => {}); }, 50));
})();
