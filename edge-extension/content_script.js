// Movable subtitles overlay (Meet / Zoom / Teams)
const OVERLAY_ID = "local-meet-translator-overlay";
const STORAGE_KEY = "lmt_overlay_pos_" + location.host;

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

  const text = document.createElement("div");
  text.id = OVERLAY_ID + "-text";
  text.style.fontSize = "18px";
  text.style.lineHeight = "1.35";
  text.textContent = "—";

  const small = document.createElement("div");
  small.id = OVERLAY_ID + "-small";
  small.style.fontSize = "12px";
  small.style.opacity = "0.75";
  small.textContent = "";

  body.appendChild(text);
  body.appendChild(small);

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

function setSubtitle(translation, transcript) {
  ensureOverlay();
  const text = document.getElementById(OVERLAY_ID + "-text");
  const small = document.getElementById(OVERLAY_ID + "-small");
  if (text) text.textContent = translation || "—";
  if (small) small.textContent = transcript ? `Heard: ${transcript}` : "";
}

chrome.runtime.onMessage.addListener((msg) => {
  if (!msg || msg.type !== "SUBTITLE") return;
  setSubtitle(msg.translation || "", msg.transcript || "");
});

ensureOverlay();
