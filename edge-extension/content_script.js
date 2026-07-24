(() => {
  if (window.__LMT_CONTENT_SCRIPT_LOADED__) return;
  window.__LMT_CONTENT_SCRIPT_LOADED__ = true;
// Movable subtitles overlay (Meet / Zoom / Teams)
// Safe localized strings for subtitles overlay.
// Keep this local fallback so subtitles never disappear if i18n.js is not injected.
function lmtText(key) {
  try {
    if (window.LMT_I18N && typeof window.LMT_I18N.t === "function") return window.LMT_I18N.t(key);
  } catch (_) {}
  const fallback = {
    drag: "Local Meet Translator — drag",
    heard: "Heard",
    you: "You"
  };
  return fallback[key] || key;
}

const OVERLAY_ID = "local-meet-translator-overlay";
const STORAGE_KEY = "lmt_overlay_pos_" + location.host;
let showOutgoing = false;

function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }
function px(n) { return `${Math.round(n)}px`; }

async function loadPos() {
  try {
    const obj = await chrome.storage.local.get(STORAGE_KEY);
    return obj[STORAGE_KEY] || null;
  } catch (_) { return null; }
}
async function savePos(pos) {
  try { await chrome.storage.local.set({ [STORAGE_KEY]: pos }); } catch (_) {}
}

function ensureOverlay() {
  let root = document.getElementById(OVERLAY_ID);
  if (root) return root;

  root = document.createElement("div");
  root.id = OVERLAY_ID;
  root.style.position = "fixed";
  root.style.left = "24px";
  root.style.bottom = "24px";
  root.style.zIndex = "2147483647";
  root.style.maxWidth = "900px";
  root.style.width = "min(900px, calc(100% - 48px))";
  root.style.userSelect = "none";

  const box = document.createElement("div");
  box.style.background = "rgba(0,0,0,0.72)";
  box.style.color = "#fff";
  box.style.borderRadius = "12px";
  box.style.boxShadow = "0 6px 20px rgba(0,0,0,0.35)";
  box.style.backdropFilter = "blur(6px)";
  box.style.webkitBackdropFilter = "blur(6px)";
  box.style.overflow = "hidden";

  const header = document.createElement("div");
  header.textContent = lmtText("drag");
  header.style.fontSize = "12px";
  header.style.opacity = "0.9";
  header.style.padding = "8px 10px";
  header.style.cursor = "move";
  header.style.background = "rgba(255,255,255,0.08)";
  header.style.borderBottom = "1px solid rgba(255,255,255,0.08)";

  const body = document.createElement("div");
  body.style.padding = "10px 12px";
  body.style.display = "flex";
  body.style.flexDirection = "column";
  body.style.gap = "6px";

  // Incoming (tab audio) - this is the primary user-facing subtitle.
  const inText = document.createElement("div");
  inText.id = OVERLAY_ID + "-in-text";
  inText.style.fontSize = "18px";
  inText.style.lineHeight = "1.35";
  inText.textContent = "—";

  const inSmall = document.createElement("div");
  inSmall.id = OVERLAY_ID + "-in-small";
  inSmall.style.fontSize = "12px";
  inSmall.style.opacity = "0.75";
  inSmall.textContent = "";

  // Outgoing (mic) - optional debug view.
  const outWrap = document.createElement("div");
  outWrap.id = OVERLAY_ID + "-out-wrap";
  outWrap.style.display = "none";
  outWrap.style.marginTop = "4px";
  outWrap.style.paddingTop = "6px";
  outWrap.style.borderTop = "1px solid rgba(255,255,255,0.12)";

  const outText = document.createElement("div");
  outText.id = OVERLAY_ID + "-out-text";
  outText.style.fontSize = "14px";
  outText.style.opacity = "0.95";
  outText.textContent = "";

  const outSmall = document.createElement("div");
  outSmall.id = OVERLAY_ID + "-out-small";
  outSmall.style.fontSize = "12px";
  outSmall.style.opacity = "0.65";
  outSmall.textContent = "";

  outWrap.appendChild(outText);
  outWrap.appendChild(outSmall);

  body.appendChild(inText);
  body.appendChild(inSmall);
  body.appendChild(outWrap);

  box.appendChild(header);
  box.appendChild(body);
  root.appendChild(box);
  document.documentElement.appendChild(root);

  (async () => {
    const pos = await loadPos();
    if (!pos) return;
    if (typeof pos.left === "number") root.style.left = px(pos.left);
    if (typeof pos.top === "number") { root.style.top = px(pos.top); root.style.bottom = "auto"; }
  })();

  let dragging = false;
  let startX = 0, startY = 0;
  let startLeft = 0, startTop = 0;

  function getRect() { return root.getBoundingClientRect(); }

  header.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    dragging = true;
    const rect = getRect();
    startX = e.clientX; startY = e.clientY;
    startLeft = rect.left; startTop = rect.top;
    root.style.left = px(startLeft);
    root.style.top = px(startTop);
    root.style.bottom = "auto";
    header.setPointerCapture(e.pointerId);
  });

  header.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    const rect = getRect();
    const w = rect.width, h = rect.height;
    const left = clamp(startLeft + dx, 0, window.innerWidth - w);
    const top = clamp(startTop + dy, 0, window.innerHeight - h);
    root.style.left = px(left);
    root.style.top = px(top);
  });

  header.addEventListener("pointerup", async () => {
    if (!dragging) return;
    dragging = false;
    const rect = getRect();
    await savePos({ left: rect.left, top: rect.top });
  });

  header.addEventListener("dblclick", async () => {
    root.style.left = "24px";
    root.style.bottom = "24px";
    root.style.top = "auto";
    await savePos({ left: 24, top: null });
  });

  return root;
}

function updateOutgoingVisibility() {
  const outWrap = document.getElementById(OVERLAY_ID + "-out-wrap");
  if (!outWrap) return;
  outWrap.style.display = showOutgoing ? "block" : "none";
}

function setIncomingSubtitle(translation, transcript) {
  ensureOverlay();
  const text = document.getElementById(OVERLAY_ID + "-in-text");
  const small = document.getElementById(OVERLAY_ID + "-in-small");
  if (text) text.textContent = translation || "—";
  if (small) small.textContent = transcript ? `${lmtText("heard")}: ${transcript}` : "";
}

function setOutgoingSubtitle(translation, transcript) {
  ensureOverlay();
  updateOutgoingVisibility();
  if (!showOutgoing) return;

  const text = document.getElementById(OVERLAY_ID + "-out-text");
  const small = document.getElementById(OVERLAY_ID + "-out-small");
  if (text) text.textContent = translation ? `${lmtText("you")} → ${translation}` : "";
  if (small) small.textContent = transcript ? `Mic: ${transcript}` : "";
}

async function loadShowOutgoingSetting() {
  try {
    const { settings } = await chrome.storage.local.get("settings");
    showOutgoing = !!(settings && settings.showOutgoingSubtitles);
    updateOutgoingVisibility();
  } catch (_) {
    showOutgoing = false;
  }
}

chrome.runtime.onMessage.addListener((msg) => {
  if (!msg) return;

  if (msg.type === "LMT_ARMED") {
    notifyDesktopArmed();
    return;
  }
  if (msg.type !== "SUBTITLE") return;

  const ch = msg.channel || "incoming";
  if (ch === "outgoing") {
    setOutgoingSubtitle(msg.translation || "", msg.transcript || "");
  } else {
    setIncomingSubtitle(msg.translation || "", msg.transcript || "");
  }
});

ensureOverlay();
loadShowOutgoingSetting();

try {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (!changes || !changes.settings) return;
    const next = changes.settings.newValue;
    showOutgoing = !!(next && next.showOutgoingSubtitles);
    updateOutgoingVisibility();
  });
} catch (_) {}

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
