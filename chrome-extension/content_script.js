(() => {
  if (window.__LMT_CONTENT_SCRIPT_LOADED__) return;
  window.__LMT_CONTENT_SCRIPT_LOADED__ = true;

// Stage 2: this content script only polls desktop commands.
// Subtitles are delivered to a separate protected Electron BrowserWindow and
// are never injected into the Meet/Zoom/Teams page DOM.
const LMT_CLIENT_ID_KEY = "lmt_desktop_client_id";
let lmtDesktopClientId = sessionStorage.getItem(LMT_CLIENT_ID_KEY) || "";
let lmtLastDesktopSeq = Number(sessionStorage.getItem("lmt_last_desktop_seq") || "0");
let lmtLastDesktopCommandKey = sessionStorage.getItem("lmt_last_desktop_command_key") || "";
let lmtDesktopSessionId = sessionStorage.getItem("lmt_desktop_session_id") || "";
let lmtDesktopPollBusy = false;
let lmtDesktopIdentityReady = false;

async function syncDesktopIdentity() {
  try {
    const identity = await chrome.runtime.sendMessage({ type: "DESKTOP_IDENTITY_GET" });
    if (identity && identity.ok) {
      if (identity.clientId) lmtDesktopClientId = identity.clientId;
      if (identity.sessionId !== undefined) lmtDesktopSessionId = identity.sessionId || "";
      if (identity.seq !== undefined) lmtLastDesktopSeq = Number(identity.seq || 0) || 0;
      if (!lmtDesktopClientId) {
        lmtDesktopClientId = (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function")
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
      }
      sessionStorage.setItem(LMT_CLIENT_ID_KEY, lmtDesktopClientId);
      sessionStorage.setItem("lmt_desktop_session_id", lmtDesktopSessionId);
      sessionStorage.setItem("lmt_last_desktop_seq", String(lmtLastDesktopSeq));
      sessionStorage.setItem("lmt_last_desktop_command_key", lmtLastDesktopCommandKey);
      lmtDesktopIdentityReady = true;
    }
  } catch (_) {}
}

async function notifyDesktopArmed() {
  try {
    if (!lmtDesktopIdentityReady) await syncDesktopIdentity();
    await chrome.runtime.sendMessage({
      type: "DESKTOP_ARMED",
      clientId: lmtDesktopClientId,
      url: location.href,
      visible: document.visibilityState === "visible"
    });
  } catch (_) {}
}

async function pollDesktopCommand() {
  if (lmtDesktopPollBusy) return;
  lmtDesktopPollBusy = true;
  let pendingCommand = null;
  try {
    if (!lmtDesktopIdentityReady) await syncDesktopIdentity();
    const visible = document.visibilityState === "visible";
    const data = await chrome.runtime.sendMessage({
      type: "DESKTOP_COMMAND_POLL",
      clientId: lmtDesktopClientId,
      sessionId: lmtDesktopSessionId,
      lastSeq: 0, // Deliberately poll with 0. The desktop app may restart and reuse low seq numbers; the content script deduplicates by command key below.
      visible,
      url: location.href
    });
    if (!data || !data.ok) return;
    if (data.sessionId && data.sessionId !== lmtDesktopSessionId) {
      lmtDesktopSessionId = data.sessionId;
      lmtLastDesktopSeq = 0;
      sessionStorage.setItem("lmt_desktop_session_id", lmtDesktopSessionId);
      sessionStorage.setItem("lmt_last_desktop_seq", "0");
    }
    if (!data.hasCommand || !data.command) return;
    const command = data.command;
    pendingCommand = command;
    const commandKey = [data.sessionId || lmtDesktopSessionId || "", command.seq || 0, command.action || "", command.issuedAt || "", command.micTxEnabled ? "voice" : "subtitles"].join(":");
    if (!command.seq || commandKey === lmtLastDesktopCommandKey) return;
    console.info("[LMT] desktop command", { seq: command.seq, action: command.action, micTxEnabled: command.micTxEnabled, ttsSinkDeviceName: command.ttsSinkDeviceName });
    const result = await chrome.runtime.sendMessage({
      type: "DESKTOP_COMMAND",
      clientId: lmtDesktopClientId,
      sessionId: lmtDesktopSessionId,
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
    });
    lmtLastDesktopSeq = command.seq;
    lmtLastDesktopCommandKey = commandKey;
    sessionStorage.setItem("lmt_last_desktop_seq", String(lmtLastDesktopSeq));
    sessionStorage.setItem("lmt_last_desktop_command_key", lmtLastDesktopCommandKey);
    await chrome.runtime.sendMessage({
      type: "DESKTOP_COMMAND_ACK",
      clientId: lmtDesktopClientId,
      sessionId: lmtDesktopSessionId,
      seq: command.seq,
      action: command.action,
      ok: !!(result && result.ok),
      message: result && (result.message || (result.already ? "already running/stopped" : "")),
      error: result && result.error,
      details: result && result.details
    });
  } catch (e) {
    // When a command was fetched but could not be executed, report the error
    // instead of leaving the desktop app waiting forever for an ACK.
    if (pendingCommand && pendingCommand.seq) {
      try {
        await chrome.runtime.sendMessage({
          type: "DESKTOP_COMMAND_ACK",
          clientId: lmtDesktopClientId,
          sessionId: lmtDesktopSessionId,
          seq: pendingCommand.seq,
          action: pendingCommand.action,
          ok: false,
          error: String(e && (e.message || e) || e)
        });
      } catch (_) {}
    }
  } finally {
    lmtDesktopPollBusy = false;
  }
}

syncDesktopIdentity();
setInterval(pollDesktopCommand, 250);
// Keep the desktop app aware that this exact meeting tab is still connected.
// This prevents stale "meeting tab not connected" states when the popup has
// been closed but the Meet/Zoom/Teams tab is still alive and polling commands.
setInterval(() => {
  if (!document.hidden) notifyDesktopArmed();
}, 3000);
setTimeout(pollDesktopCommand, 50);
setTimeout(notifyDesktopArmed, 500);
window.addEventListener("focus", () => { pollDesktopCommand(); notifyDesktopArmed(); });
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) { pollDesktopCommand(); notifyDesktopArmed(); }
});

})();
