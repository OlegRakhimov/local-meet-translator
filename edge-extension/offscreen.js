// Offscreen recorder (diagnostic build):
// - Segment-by-segment recording (valid container chunks)
// - Dedupe to avoid repeats
// - Extra logs so it's clear whether we are: sending chunks / receiving transcripts.
// Optional VAD hooks exist but are disabled by default.

let mediaStream = null;
let recorder = null;

let serverUrl = "";
let authToken = "";
let sourceLang = "auto";
let targetLang = "ru";
let chunkSeconds = 5;
let tabId = null;

let ttsEnabled = false;
let ttsVoice = "onyx";
let ttsSpeed = 1.0;

let inFlight = false;
let queue = [];
let stopTimer = null;
let running = false;

// Dedupe
const DEDUPE_WINDOW_MS = 12000;
const DEDUPE_JACCARD = 0.85;

// Optional VAD (disabled by default)
const ENABLE_VAD = false;
const VAD_MIN_DBFS = -42;
const VAD_MIN_BYTES = 6000;
const VAD_SAMPLE_STRIDE = 8;

let lastTranscriptNorm = "";
let lastTranscriptAt = 0;
let lastTranslationNorm = "";
let lastTranslationAt = 0;

// TTS
let audioEl = null;
let ttsInFlight = false;

// VAD audio context
let audioCtx = null;

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

function normalizeAudioMime(mime) {
  const m = (mime || "audio/webm").toLowerCase();
  return m.split(";")[0] || "audio/webm";
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

async function ensureAudioCtx() {
  if (audioCtx) return audioCtx;
  const Ctx = self.AudioContext || self.webkitAudioContext;
  if (!Ctx) return null;
  audioCtx = new Ctx();
  return audioCtx;
}

async function estimateDbfsFromBlob(blob) {
  if (!blob || blob.size < VAD_MIN_BYTES) return -120;

  const ctx = await ensureAudioCtx();
  if (!ctx) return 0;

  const ab = await blob.arrayBuffer();
  let buf;
  try {
    buf = await ctx.decodeAudioData(ab.slice(0));
  } catch (e) {
    status("err", "VAD decode failed", String(e));
    return 0;
  }

  const channels = buf.numberOfChannels || 1;
  const length = buf.length || 0;
  if (!length) return -120;

  let sum = 0;
  let count = 0;

  for (let ch = 0; ch < channels; ch++) {
    const data = buf.getChannelData(ch);
    for (let i = 0; i < length; i += VAD_SAMPLE_STRIDE) {
      const x = data[i];
      sum += x * x;
      count++;
    }
  }

  const rms = Math.sqrt(sum / Math.max(1, count));
  const db = 20 * Math.log10(rms + 1e-12);
  return db;
}

async function shouldSendBlob(blob) {
  if (!ENABLE_VAD) return true;
  const db = await estimateDbfsFromBlob(blob);
  if (db < VAD_MIN_DBFS) {
    status("run", "Running", `Dropped chunk (VAD db=${db.toFixed(1)} < ${VAD_MIN_DBFS}).`);
    return false;
  }
  status("run", "Running", `Accepted chunk (VAD db=${db.toFixed(1)}).`);
  return true;
}

function stopAudio() {
  try {
    if (audioEl) {
      audioEl.pause();
      audioEl.src = "";
      audioEl = null;
    }
  } catch (_) {}
}

function base64ToBytes(base64) {
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function speak(text) {
  if (!ttsEnabled) return;
  const t = (text || "").trim();
  if (!t) return;

  const now = Date.now();
  const norm = normalizeForDedupe(t);
  if (isNearDuplicate(norm, lastTranslationNorm, now, lastTranslationAt)) {
    status("run", "Running", "TTS suppressed (duplicate).");
    return;
  }
  lastTranslationNorm = norm;
  lastTranslationAt = now;

  stopAudio();
  if (ttsInFlight) return;
  ttsInFlight = true;

  try {
    const payload = {
      text: t,
      voice: ttsVoice,
      model: "gpt-4o-mini-tts",
      response_format: "mp3",
      speed: ttsSpeed,
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
      return;
    }

    const b64 = data.audioBase64 || "";
    const mime = data.audioMime || "audio/mpeg";
    if (!b64) return;

    const bytes = base64ToBytes(b64);
    const aBlob = new Blob([bytes], { type: mime });
    const url = URL.createObjectURL(aBlob);

    audioEl = new Audio(url);
    audioEl.volume = 1.0;
    audioEl.onended = () => { try { URL.revokeObjectURL(url); } catch (_) {} };

    await audioEl.play().catch((e) => {
      status("err", "TTS play blocked", String(e));
      try { URL.revokeObjectURL(url); } catch (_) {}
    });
  } catch (e) {
    status("err", "TTS failed", String(e));
  } finally {
    ttsInFlight = false;
  }
}

async function postChunk(blob) {
  const okToSend = await shouldSendBlob(blob);
  if (!okToSend) return;

  queue.push(blob);
  if (inFlight) return;
  inFlight = true;

  while (queue.length) {
    const b = queue.shift();
    try {
      if (!b || b.size === 0) continue;

      status("run", "Running", `Sending chunk: ${b.size} bytes, mime=${normalizeAudioMime(b.type || "audio/webm")}`);

      const base64 = await blobToBase64(b);
      const payload = {
        audioBase64: base64,
        audioMime: normalizeAudioMime(b.type || "audio/webm"),
        sourceLang,
        targetLang
      };

      const resp = await fetch(`${serverUrl}/transcribe-and-translate`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Auth-Token": authToken },
        body: JSON.stringify(payload)
      });

      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        status("err", "Bridge/API error", `HTTP ${resp.status}: ${JSON.stringify(data)}`);
        continue;
      }

      const translation = (data.translation || "").trim();
      const transcript = (data.transcript || "").trim();

      status("run", "Running", `Received: transcriptLen=${transcript.length}, translationLen=${translation.length}`);

      if (!transcript && !translation) continue;

      const now = Date.now();
      const tNorm = normalizeForDedupe(transcript);
      if (isNearDuplicate(tNorm, lastTranscriptNorm, now, lastTranscriptAt)) {
        status("run", "Running", "Subtitle suppressed (duplicate transcript).");
        continue;
      }
      lastTranscriptNorm = tNorm;
      lastTranscriptAt = now;

      chrome.runtime.sendMessage({ type: "SUBTITLE", tabId, translation, transcript, ts: now }).catch(() => {});
      if (translation) await speak(translation);

    } catch (e) {
      status("err", "Chunk failed", String(e));
    }
  }

  inFlight = false;
}

function pickMimeType() {
  const candidates = ["audio/webm", "audio/webm;codecs=opus", "audio/ogg;codecs=opus", "audio/ogg"];
  for (const m of candidates) {
    try { if (MediaRecorder.isTypeSupported(m)) return m; } catch (_) {}
  }
  return "";
}

async function startSegmentRecorder() {
  if (!mediaStream) throw new Error("mediaStream is null");

  const mimeType = pickMimeType();
  recorder = new MediaRecorder(mediaStream, mimeType ? { mimeType } : undefined);

  recorder.ondataavailable = (ev) => {
    if (!ev.data || ev.data.size === 0) return;
    postChunk(ev.data);
  };

  recorder.onerror = (ev) => status("err", "Recorder error", String(ev?.error || ev));
  recorder.onstart = () => status("run", "Running", "Recorder started.");

  recorder.onstop = () => {
    if (running) {
      setTimeout(() => { if (running) startSegmentRecorder().catch(e => status("err", "Restart failed", String(e))); }, 50);
    } else {
      status("ok", "Stopped", "Recorder stopped.");
    }
  };

  recorder.start();

  if (stopTimer) clearTimeout(stopTimer);
  stopTimer = setTimeout(() => {
    try { if (recorder && recorder.state !== "inactive") recorder.stop(); } catch (_) {}
  }, Math.max(2000, Math.min(15000, chunkSeconds * 1000)));
}

async function startWithStreamId(streamId) {
  const constraints = { audio: { mandatory: { chromeMediaSource: "tab", chromeMediaSourceId: streamId } }, video: false };
  mediaStream = await navigator.mediaDevices.getUserMedia(constraints);
  running = true;
  await startSegmentRecorder();
}

async function stopAll() {
  running = false;
  try { if (stopTimer) clearTimeout(stopTimer); } catch (_) {}
  stopTimer = null;

  try { if (recorder && recorder.state !== "inactive") recorder.stop(); } catch (_) {}
  try { if (mediaStream) for (const t of mediaStream.getTracks()) t.stop(); } catch (_) {}

  stopAudio();
  mediaStream = null;
  recorder = null;
  queue = [];
  inFlight = false;
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    try {
      if (msg?.type === "OFFSCREEN_START") {
        await stopAll();

        tabId = msg.tabId;
        serverUrl = msg.serverUrl;
        authToken = msg.authToken;
        sourceLang = msg.sourceLang || "auto";
        targetLang = msg.targetLang || "ru";
        chunkSeconds = msg.chunkSeconds || 5;

        ttsEnabled = !!msg.ttsEnabled;
        ttsVoice = msg.ttsVoice || "onyx";
        ttsSpeed = typeof msg.ttsSpeed === "number" ? msg.ttsSpeed : 1.0;

        lastTranscriptNorm = ""; lastTranscriptAt = 0;
        lastTranslationNorm = ""; lastTranslationAt = 0;

        if (!serverUrl || !authToken || !msg.streamId) {
          status("err", "Missing config", "serverUrl/authToken/streamId is missing.");
          sendResponse({ ok: false, error: "Missing config" });
          return;
        }

        status("run", "Starting...", "Capturing tab audio...");
        await startWithStreamId(msg.streamId);

        sendResponse({ ok: true });
        return;
      }

      if (msg?.type === "OFFSCREEN_STOP") {
        await stopAll();
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
