// Movable subtitles overlay (Meet / Zoom / Teams)
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
  header.textContent = "Local Meet Translator (drag me)";
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
  if (small) small.textContent = transcript ? `Heard: ${transcript}` : "";
}

function setOutgoingSubtitle(translation, transcript) {
  ensureOverlay();
  updateOutgoingVisibility();
  if (!showOutgoing) return;

  const text = document.getElementById(OVERLAY_ID + "-out-text");
  const small = document.getElementById(OVERLAY_ID + "-out-small");
  if (text) text.textContent = translation ? `You → ${translation}` : "";
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
  if (!msg || msg.type !== "SUBTITLE") return;

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
