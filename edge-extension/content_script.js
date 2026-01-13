// Overlay subtitles for Meet / Zoom / Teams pages
const OVERLAY_ID = "local-call-translator-overlay";

function ensureOverlay() {
  let el = document.getElementById(OVERLAY_ID);
  if (el) return el;

  el = document.createElement("div");
  el.id = OVERLAY_ID;
  el.style.position = "fixed";
  el.style.left = "50%";
  el.style.bottom = "24px";
  el.style.transform = "translateX(-50%)";
  el.style.maxWidth = "900px";
  el.style.width = "calc(100% - 48px)";
  el.style.zIndex = "2147483647";
  el.style.pointerEvents = "none";

  const box = document.createElement("div");
  box.style.background = "rgba(0,0,0,0.72)";
  box.style.color = "#fff";
  box.style.padding = "10px 12px";
  box.style.borderRadius = "12px";
  box.style.fontSize = "18px";
  box.style.lineHeight = "1.35";
  box.style.boxShadow = "0 6px 20px rgba(0,0,0,0.35)";
  box.style.backdropFilter = "blur(6px)";
  box.style.webkitBackdropFilter = "blur(6px)";
  box.style.display = "flex";
  box.style.flexDirection = "column";
  box.style.gap = "6px";

  const top = document.createElement("div");
  top.style.fontSize = "12px";
  top.style.opacity = "0.85";
  top.textContent = "Local Call Translator (subtitles)";

  const text = document.createElement("div");
  text.id = OVERLAY_ID + "-text";
  text.textContent = "—";

  const small = document.createElement("div");
  small.id = OVERLAY_ID + "-small";
  small.style.fontSize = "12px";
  small.style.opacity = "0.75";
  small.textContent = "";

  box.appendChild(top);
  box.appendChild(text);
  box.appendChild(small);
  el.appendChild(box);
  document.documentElement.appendChild(el);

  return el;
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
