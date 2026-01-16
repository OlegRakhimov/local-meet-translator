// Patch v10.2: Prefer OGG/Opus and keep full mime to reduce OpenAI decode errors.
// Replace edge-extension/offscreen.js with this file.

let tabStream = null;
let tabRecorder = null;

let micStream = null;
let micRecorder = null;

let serverUrl = "";
let authToken = "";

let tabSourceLang = "auto";
let tabTargetLang = "ru";
let tabChunkSeconds = 5;

let ttsEnabled = false;
let ttsVoice = "onyx";
let ttsSpeed = 1.0;

let micTxEnabled = false;
let micTxSourceLang = "ru";
let micTxTargetLang = "en";
let micTxChunkSeconds = 5;
let micDeviceId = "";
let ttsSinkDeviceId = "";

// UI preference: avoid mixing outgoing debug subtitles with incoming.
let showOutgoingSubtitles = false;

// Reduce hallucinations on silence and prevent self-feedback.
const VAD_ENABLED = true;
const VAD_THRESHOLD = 0.015; // RMS in [0..1] (heuristic)
const MUTE_MIC_DURING_TTS = true;

let tabMeter = null;
let micMeter = null;
let ttsPlaying = false;

let tabId = null;

let tabStopTimer = null;
let micStopTimer = null;
let running = false;

// Dedupe
const DEDUPE_WINDOW_MS = 12000;
const DEDUPE_JACCARD = 0.85;

let lastTabNorm = "";
let lastTabAt = 0;

let lastMicNorm = "";
let lastMicAt = 0;

let lastSpokenNorm = "";
let lastSpokenAt = 0;

function status(kind, text, log) {
  chrome.runtime.sendMessage({ type: "STATUS", kind, text, log }).catch(() => {});
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onerror = () => reject(r.error);
    r.onload = () => {
      const dataUrl = r.result;
      const base64 = String(dataUrl).split(",")[1] || "";
      resolve(base64);
    };
    r.readAsDataURL(blob);
  });
}

function normalizeForDedupe(s) {
  return (s || "")
    .toLowerCase()
    .replace(/[\p{P}\p{S}]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function jaccardTokens(a, b) {
  const A = new Set(a.split(/\s+/).filter(Boolean));
  const B = new Set(b.split(/\s+/).filter(Boolean));
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  const union = A.size + B.size - inter;
  return union ? inter / union : 0;
}

function isNearDuplicate(norm, lastNorm, now, lastAt) {
  if (!norm || !lastNorm) return false;
  if (now - lastAt > DEDUPE_WINDOW_MS) return false;
  if (norm === lastNorm) return true;
  if (norm.includes(lastNorm) || lastNorm.includes(norm)) return true;
  return jaccardTokens(norm, lastNorm) >= DEDUPE_JACCARD;
}

function base64ToBytes(base64) {
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

let audioEl = null;

function createLevelMeter(stream) {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return null;

    const ctx = new AudioCtx();
    const src = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    src.connect(analyser);

    const buf = new Uint8Array(analyser.fftSize);
    let peak = 0;

    const timer = setInterval(() => {
      try {
        analyser.getByteTimeDomainData(buf);
        let sum = 0;
        for (let i = 0; i < buf.length; i++) {
          const v = (buf[i] - 128) / 128;
          sum += v * v;
        }
        const rms = Math.sqrt(sum / buf.length);
        // peak-hold with decay so we capture speech occurring within the last ~1s.
        peak = Math.max(rms, peak * 0.85);
      } catch (_) {
        // ignore
      }
    }, 200);

    return {
      getPeak: () => peak,
      stop: () => {
        try { clearInterval(timer); } catch (_) {}
        try { src.disconnect(); } catch (_) {}
        try { analyser.disconnect(); } catch (_) {}
        try { ctx.close(); } catch (_) {}
      }
    };
  } catch (_) {
    return null;
  }
}

async function setSinkIfSupported(el, deviceId) {
  if (!deviceId) return;
  if (typeof el.setSinkId !== "function") {
    status("err", "TTS sink", "setSinkId not supported; using default output.");
    return;
  }
  try { await el.setSinkId(deviceId); }
  catch (e) { status("err", "TTS sink", "Failed to set sink device: " + String(e)); }
}

async function playTtsAudio(base64, mime, sinkDeviceId) {
  if (!base64) return;

  try {
    if (audioEl) { audioEl.pause(); audioEl.src = ""; audioEl = null; }
  } catch (_) {}

  const bytes = base64ToBytes(base64);
  const blob = new Blob([bytes], { type: mime || "audio/mpeg" });
  const url = URL.createObjectURL(blob);

  audioEl = new Audio(url);
  await setSinkIfSupported(audioEl, sinkDeviceId);
  audioEl.onended = () => { try { URL.revokeObjectURL(url); } catch (_) {} };

  // Guard against feedback loops: if mic is capturing a virtual cable output, it can hear its own TTS.
  ttsPlaying = true;
  audioEl.onended = () => {
    ttsPlaying = false;
    try { URL.revokeObjectURL(url); } catch (_) {}
  };
  audioEl.onerror = () => {
    ttsPlaying = false;
    try { URL.revokeObjectURL(url); } catch (_) {}
  };

  await audioEl.play().catch((e) => {
    status("err", "TTS play blocked", String(e));
    ttsPlaying = false;
    try { URL.revokeObjectURL(url); } catch (_) {}
  });
}

async function requestTts(text) {
  const payload = {
    text: text,
    voice: ttsVoice || "onyx",
    model: "gpt-4o-mini-tts",
    response_format: "mp3",
    speed: ttsSpeed || 1.0,
    instructions: "Speak in a calm, low male voice."
  };

  const resp = await fetch(`${serverUrl}/tts`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Auth-Token": authToken },
    body: JSON.stringify(payload)
  });

  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    status("err", "TTS error", `HTTP ${resp.status}: ${JSON.stringify(data)}`);
    return null;
  }
  return data;
}

async function transcribeAndTranslate(blob, sourceLang, targetLang) {
  const base64 = await blobToBase64(blob);

  // Keep full mime; server will normalize it (and choose extension).
  const mime = (blob && blob.type) ? blob.type : "audio/ogg;codecs=opus";

  status("run", "Running", `Sending: ${blob.size} bytes, type=${mime || "?"}`);

  const payload = {
    audioBase64: base64,
    audioMime: mime,
    sourceLang: sourceLang || "auto",
    targetLang: targetLang || "ru"
  };

  const resp = await fetch(`${serverUrl}/transcribe-and-translate`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Auth-Token": authToken },
    body: JSON.stringify(payload)
  });

  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    status("err", "Bridge/API error", `HTTP ${resp.status}: ${JSON.stringify(data)}`);
    return null;
  }
  status("run", "Running", `Received: transcriptLen=${(data.transcript||"").length}, translationLen=${(data.translation||"").length}`);
  return data;
}

// Prefer OGG/Opus first, then WebM/Opus.
function pickMimeType() {
  const candidates = [
    "audio/ogg;codecs=opus",
    "audio/ogg",
    "audio/webm;codecs=opus",
    "audio/webm"
  ];
  for (const m of candidates) {
    try { if (MediaRecorder.isTypeSupported(m)) return m; } catch (_) {}
  }
  return "";
}

async function startTabCapture(streamId) {
  const constraints = { audio: { mandatory: { chromeMediaSource: "tab", chromeMediaSourceId: streamId } }, video: false };
  tabStream = await navigator.mediaDevices.getUserMedia(constraints);
  tabMeter = createLevelMeter(tabStream);
  await startTabRecorder();
}

async function startTabRecorder() {
  if (!tabStream) return;
  const mimeType = pickMimeType();
  status("run", "Running", "Tab recorder mime=" + (mimeType || "default"));
  tabRecorder = new MediaRecorder(tabStream, mimeType ? { mimeType } : undefined);

  tabRecorder.ondataavailable = async (ev) => {
    if (!ev.data || ev.data.size === 0) return;

    if (VAD_ENABLED && tabMeter && tabMeter.getPeak() < VAD_THRESHOLD) {
      // Skip likely silence chunks to reduce random hallucinations.
      return;
    }

    const data = await transcribeAndTranslate(ev.data, tabSourceLang, tabTargetLang);
    if (!data) return;

    const transcript = (data.transcript || "").trim();
    const translation = (data.translation || "").trim();
    if (!transcript && !translation) return;

    const now = Date.now();
    const norm = normalizeForDedupe(transcript);
    if (isNearDuplicate(norm, lastTabNorm, now, lastTabAt)) return;
    lastTabNorm = norm; lastTabAt = now;

    chrome.runtime.sendMessage({ type: "SUBTITLE", tabId, channel: "incoming", translation, transcript, ts: now }).catch(() => {});
  };

  tabRecorder.onstop = () => {
    if (running) setTimeout(() => { if (running) startTabRecorder().catch(e => status("err", "Tab restart failed", String(e))); }, 50);
  };

  tabRecorder.start();
  if (tabStopTimer) clearTimeout(tabStopTimer);
  tabStopTimer = setTimeout(() => { try { if (tabRecorder && tabRecorder.state !== "inactive") tabRecorder.stop(); } catch (_) {} },
    Math.max(2000, Math.min(15000, tabChunkSeconds * 1000)));
}

async function startMicCapture() {
  const audio = {};
  if (micDeviceId) audio.deviceId = { exact: micDeviceId };
  micStream = await navigator.mediaDevices.getUserMedia({ audio, video: false });
  micMeter = createLevelMeter(micStream);
  await startMicRecorder();
}

function formatErr(e) {
  if (!e) return "";
  const name = e.name ? String(e.name) : "";
  const msg = e.message ? String(e.message) : String(e);
  return name && msg && !msg.startsWith(name) ? `${name}: ${msg}` : (msg || name);
}

async function startMicRecorder() {
  if (!micStream) return;
  const mimeType = pickMimeType();
  status("run", "Running", "Mic recorder mime=" + (mimeType || "default"));
  micRecorder = new MediaRecorder(micStream, mimeType ? { mimeType } : undefined);

  micRecorder.ondataavailable = async (ev) => {
    if (!ev.data || ev.data.size === 0) return;

    if (MUTE_MIC_DURING_TTS && ttsPlaying) {
      // Prevent "talking to itself" loops.
      return;
    }

    if (VAD_ENABLED && micMeter && micMeter.getPeak() < VAD_THRESHOLD) {
      return;
    }

    const data = await transcribeAndTranslate(ev.data, micTxSourceLang, micTxTargetLang);
    if (!data) return;

    const transcript = (data.transcript || "").trim();
    const translation = (data.translation || "").trim();
    if (!transcript && !translation) return;

    const now = Date.now();
    const norm = normalizeForDedupe(transcript);
    if (isNearDuplicate(norm, lastMicNorm, now, lastMicAt)) return;
    lastMicNorm = norm; lastMicAt = now;

    if (showOutgoingSubtitles) {
      chrome.runtime.sendMessage({ type: "SUBTITLE", tabId, channel: "outgoing", translation, transcript: "YOU: " + transcript, ts: now }).catch(() => {});
    }

    if (!translation) return;
    const tNorm = normalizeForDedupe(translation);
    if (isNearDuplicate(tNorm, lastSpokenNorm, now, lastSpokenAt)) return;
    lastSpokenNorm = tNorm; lastSpokenAt = now;

    const tts = await requestTts(translation);
    if (tts) await playTtsAudio(tts.audioBase64, tts.audioMime, ttsSinkDeviceId);
  };

  micRecorder.onstop = () => {
    if (running && micTxEnabled) setTimeout(() => { if (running && micTxEnabled) startMicRecorder().catch(e => status("err", "Mic restart failed", String(e))); }, 50);
  };

  micRecorder.start();
  if (micStopTimer) clearTimeout(micStopTimer);
  micStopTimer = setTimeout(() => { try { if (micRecorder && micRecorder.state !== "inactive") micRecorder.stop(); } catch (_) {} },
    Math.max(2000, Math.min(15000, micTxChunkSeconds * 1000)));
}

async function stopAll() {
  running = false;
  try { if (tabStopTimer) clearTimeout(tabStopTimer); } catch (_) {}
  try { if (micStopTimer) clearTimeout(micStopTimer); } catch (_) {}
  tabStopTimer = null; micStopTimer = null;

  try { if (tabRecorder && tabRecorder.state !== "inactive") tabRecorder.stop(); } catch (_) {}
  try { if (micRecorder && micRecorder.state !== "inactive") micRecorder.stop(); } catch (_) {}

  try { if (tabStream) for (const t of tabStream.getTracks()) t.stop(); } catch (_) {}
  try { if (micStream) for (const t of micStream.getTracks()) t.stop(); } catch (_) {}

  try { if (tabMeter) tabMeter.stop(); } catch (_) {}
  try { if (micMeter) micMeter.stop(); } catch (_) {}
  tabMeter = null;
  micMeter = null;

  tabStream = null; tabRecorder = null;
  micStream = null; micRecorder = null;

  try { if (audioEl) { audioEl.pause(); audioEl.src = ""; audioEl = null; } } catch (_) {}
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    try {
      if (msg?.type === "OFFSCREEN_START") {
        await stopAll();

        tabId = msg.tabId;
        serverUrl = msg.serverUrl;
        authToken = msg.authToken;

        tabSourceLang = msg.sourceLang || "auto";
        tabTargetLang = msg.targetLang || "ru";
        tabChunkSeconds = msg.chunkSeconds || 5;

        ttsEnabled = !!msg.ttsEnabled;
        ttsVoice = msg.ttsVoice || "onyx";
        ttsSpeed = typeof msg.ttsSpeed === "number" ? msg.ttsSpeed : 1.0;

        micTxEnabled = !!msg.micTxEnabled;
        micTxSourceLang = msg.micTxSourceLang || "ru";
        micTxTargetLang = msg.micTxTargetLang || "en";
        micDeviceId = msg.micDeviceId || "";
        ttsSinkDeviceId = msg.ttsSinkDeviceId || "";
        micTxChunkSeconds = msg.micTxChunkSeconds || 5;

        showOutgoingSubtitles = !!msg.showOutgoingSubtitles;

        lastTabNorm = ""; lastTabAt = 0;
        lastMicNorm = ""; lastMicAt = 0;
        lastSpokenNorm = ""; lastSpokenAt = 0;

        if (!serverUrl || !authToken || !msg.streamId) {
          status("err", "Missing config", "serverUrl/authToken/streamId is missing.");
          sendResponse({ ok: false, error: "Missing config" });
          return;
        }

        running = true;
        status("run", "Starting...", "Capturing tab audio...");
        await startTabCapture(msg.streamId);

        if (micTxEnabled) {
          status("run", "Starting...", "Capturing microphone for outgoing translation...");
          try {
            await startMicCapture();
          } catch (e) {
            // Offscreen documents may not be able to surface permission prompts; rely on popup preflight.
            status("err", "Mic unavailable", "Microphone capture failed: " + formatErr(e) + ". Click 'Grant mic access' in the popup and ensure audioCapture permission is allowed.");
            micTxEnabled = false;
          }
        }

        sendResponse({ ok: true });
        return;
      }

      if (msg?.type === "OFFSCREEN_STOP") {
        await stopAll();
        status("ok", "Stopped", "Stopped.");
        sendResponse({ ok: true });
        return;
      }

      sendResponse({ ok: true });
    } catch (e) {
      await stopAll();
      status("err", "Offscreen error", String(e));
      sendResponse({ ok: false, error: String(e) });
    }
  })();

  return true;
});
