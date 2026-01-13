// Offscreen document for capturing tab audio and sending chunks to localhost bridge.
// STRICT + DEDUPE mode: minimize false positives AND prevent repeated phrases.
// - Segment-by-segment recording => each chunk is a complete container file.
// - VAD (loudness threshold) drops silent/noisy segments.
// - Transcript filter drops very short/gibberish.
// - Dedupe filter suppresses near-duplicate transcripts/translations within a time window.
// - Optional TTS playback via /tts endpoint (played locally).

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

// TTS playback state
let audioEl = null;
let ttsInFlight = false;

// -------------------- Strict filtering knobs --------------------
const VAD_MIN_DBFS = -42;          // higher (e.g. -38) => stricter; lower (e.g. -46) => more sensitive
const VAD_MIN_BYTES = 6000;        // ignore tiny blobs
const VAD_SAMPLE_STRIDE = 8;       // larger = faster but less accurate

const TEXT_MIN_LETTERS = 6;        // require some letters
const TEXT_MIN_CHARS = 10;         // minimum length
const TEXT_MIN_WORDS = 2;          // require at least 2 words unless text is long
const TEXT_SINGLE_WORD_MIN_CHARS = 16; // allow long single words
const DROP_COMMON_SINGLE_WORDS = new Set([
  "you","i","yes","no","ok","okay","thanks","thank","hey","hi",
  "да","нет","ок","угу","привет","спасибо","хорошо"
]);

// Dedupe (prevents repeated phrases near chunk boundaries)
const DEDUPE_WINDOW_MS = 12000;    // suppress duplicates within last 12s
const DEDUPE_MIN_NORM_CHARS = 12;  // very short strings already filtered above, but keep safe
const DEDUPE_JACCARD = 0.85;       // token similarity threshold

let droppedSilent = 0;

// Last emitted items (normalized)
let lastTranscriptNorm = "";
let lastTranscriptAt = 0;
let lastTranslationNorm = "";
let lastTranslationAt = 0;

// -------------------- Logging --------------------
function logStatus(kind, text, log) {
  chrome.runtime.sendMessage({ type: "STATUS", kind, text, log }).catch(() => {});
}

// -------------------- Helpers --------------------
function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onerror = () => reject(r.error);
    r.onload = () => {
      const dataUrl = r.result; // data:...;base64,XXXX
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

function base64ToBytes(base64) {
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
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

function countLetters(s) {
  const m = (s || "").match(/[A-Za-zА-Яа-яЁё]/g);
  return m ? m.length : 0;
}

function normalizeForDedupe(s) {
  // Lowercase, remove punctuation/symbols, collapse whitespace.
  // Keep letters/digits/spaces only.
  const t = (s || "")
    .toLowerCase()
    .replace(/[\p{P}\p{S}]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  return t;
}

function jaccardTokens(a, b) {
  const A = new Set(a.split(/\s+/).filter(Boolean));
  const B = new Set(b.split(/\s+/).filter(Boolean));
  if (A.size === 0 || B.size === 0) return 0;

  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  const union = A.size + B.size - inter;
  return union ? inter / union : 0;
}

function isNearDuplicate(norm, lastNorm, now, lastAt) {
  if (!norm || !lastNorm) return false;
  if (now - lastAt > DEDUPE_WINDOW_MS) return false;
  if (norm.length < DEDUPE_MIN_NORM_CHARS || lastNorm.length < DEDUPE_MIN_NORM_CHARS) return false;

  if (norm === lastNorm) return true;

  // Substring overlap helps near-boundary repeats
  if (norm.includes(lastNorm) || lastNorm.includes(norm)) return true;

  const jac = jaccardTokens(norm, lastNorm);
  return jac >= DEDUPE_JACCARD;
}

function isLikelySpeechText(t) {
  const text = (t || "").trim();
  if (!text) return false;

  const letters = countLetters(text);
  if (letters < TEXT_MIN_LETTERS) return false;

  const chars = text.length;
  if (chars < TEXT_MIN_CHARS) return false;

  const words = text.split(/\s+/).filter(Boolean);
  if (words.length < TEXT_MIN_WORDS && chars < TEXT_SINGLE_WORD_MIN_CHARS) {
    return false;
  }

  if (words.length === 1) {
    const w = words[0].toLowerCase();
    if (DROP_COMMON_SINGLE_WORDS.has(w)) return false;
  }

  // Reject strings that are mostly punctuation
  const nonPunct = text.replace(/[\p{P}\p{S}\s]/gu, "");
  if (nonPunct.length < TEXT_MIN_LETTERS) return false;

  return true;
}

// -------------------- VAD (simple RMS dBFS) --------------------
let audioCtx = null;

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
  if (!ctx) return 0; // can't estimate => don't block

  const ab = await blob.arrayBuffer();
  let buf;
  try {
    buf = await ctx.decodeAudioData(ab.slice(0));
  } catch (e) {
    // If decoding fails, don't block (avoid breaking transcription)
    logStatus("err", "VAD decode failed", String(e));
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
  const db = await estimateDbfsFromBlob(blob);
  if (db < VAD_MIN_DBFS) {
    droppedSilent++;
    if (droppedSilent % 10 === 0) {
      logStatus("run", "Running", `Dropped ${droppedSilent} silent/noisy chunks (db=${db.toFixed(1)}).`);
    }
    return false;
  }
  return true;
}

// -------------------- TTS --------------------
async function speak(text) {
  if (!ttsEnabled) return;
  const t = (text || "").trim();
  if (!t) return;

  const now = Date.now();
  const norm = normalizeForDedupe(t);

  if (isNearDuplicate(norm, lastTranslationNorm, now, lastTranslationAt)) return;

  // Mark before request to avoid race duplicates
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
      headers: {
        "Content-Type": "application/json",
        "X-Auth-Token": authToken
      },
      body: JSON.stringify(payload)
    });

    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      logStatus("err", "TTS error", `HTTP ${resp.status}: ${JSON.stringify(data)}`);
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
    audioEl.onended = () => {
      try { URL.revokeObjectURL(url); } catch (_) {}
    };

    await audioEl.play().catch((e) => {
      logStatus("err", "TTS play blocked", String(e));
      try { URL.revokeObjectURL(url); } catch (_) {}
    });
  } catch (e) {
    logStatus("err", "TTS failed", String(e));
  } finally {
    ttsInFlight = false;
  }
}

// -------------------- Posting --------------------
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

      const base64 = await blobToBase64(b);
      const payload = {
        audioBase64: base64,
        audioMime: normalizeAudioMime(b.type || "audio/webm"),
        sourceLang,
        targetLang
      };

      const resp = await fetch(`${serverUrl}/transcribe-and-translate`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Auth-Token": authToken
        },
        body: JSON.stringify(payload)
      });

      const data = await resp.json().catch(() => ({}));

      if (!resp.ok) {
        logStatus("err", "Bridge/API error", `HTTP ${resp.status}: ${JSON.stringify(data)}`);
        continue;
      }

      const translation = (data.translation || "").trim();
      const transcript = (data.transcript || "").trim();

      if (!isLikelySpeechText(transcript)) {
        continue;
      }

      const now = Date.now();
      const tNorm = normalizeForDedupe(transcript);

      if (isNearDuplicate(tNorm, lastTranscriptNorm, now, lastTranscriptAt)) {
        continue;
      }

      // Mark emitted transcript
      lastTranscriptNorm = tNorm;
      lastTranscriptAt = now;

      chrome.runtime.sendMessage({
        type: "SUBTITLE",
        tabId,
        translation,
        transcript,
        ts: now
      }).catch(() => {});

      if (translation) {
        await speak(translation);
      }
    } catch (e) {
      logStatus("err", "Chunk failed", String(e));
    }
  }

  inFlight = false;
}

// -------------------- Recorder (segment-by-segment) --------------------
function pickMimeType() {
  const candidates = [
    "audio/webm",
    "audio/webm;codecs=opus",
    "audio/ogg;codecs=opus",
    "audio/ogg"
  ];
  for (const m of candidates) {
    try {
      if (MediaRecorder.isTypeSupported(m)) return m;
    } catch (_) {}
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

  recorder.onerror = (ev) => {
    logStatus("err", "Recorder error", String(ev?.error || ev));
  };

  recorder.onstart = () => {
    logStatus("run", "Running", "Recorder started.");
  };

  recorder.onstop = () => {
    if (running) {
      setTimeout(() => {
        if (!running) return;
        try {
          startSegmentRecorder();
        } catch (e) {
          logStatus("err", "Restart failed", String(e));
        }
      }, 50);
    } else {
      logStatus("ok", "Stopped", "Recorder stopped.");
    }
  };

  recorder.start();

  if (stopTimer) clearTimeout(stopTimer);
  stopTimer = setTimeout(() => {
    try {
      if (recorder && recorder.state !== "inactive") recorder.stop();
    } catch (_) {}
  }, Math.max(2000, Math.min(15000, chunkSeconds * 1000)));
}

async function startWithStreamId(streamId) {
  const constraints = {
    audio: {
      mandatory: {
        chromeMediaSource: "tab",
        chromeMediaSourceId: streamId
      }
    },
    video: false
  };

  mediaStream = await navigator.mediaDevices.getUserMedia(constraints);
  running = true;

  await startSegmentRecorder();
}

async function stopAll() {
  running = false;

  try {
    if (stopTimer) clearTimeout(stopTimer);
  } catch (_) {}
  stopTimer = null;

  try {
    if (recorder && recorder.state !== "inactive") recorder.stop();
  } catch (_) {}

  try {
    if (mediaStream) {
      for (const t of mediaStream.getTracks()) t.stop();
    }
  } catch (_) {}

  stopAudio();

  mediaStream = null;
  recorder = null;

  queue = [];
  inFlight = false;
}

// -------------------- Messages from background --------------------
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

        // Reset dedupe state on start
        lastTranscriptNorm = "";
        lastTranscriptAt = 0;
        lastTranslationNorm = "";
        lastTranslationAt = 0;
        droppedSilent = 0;

        if (!serverUrl || !authToken || !msg.streamId) {
          logStatus("err", "Missing config", "serverUrl/authToken/streamId is missing.");
          sendResponse({ ok: false, error: "Missing config" });
          return;
        }

        logStatus("run", "Starting...", "Capturing tab audio...");
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
      logStatus("err", "Offscreen error", String(e));
      sendResponse({ ok: false, error: String(e) });
    }
  })();

  return true;
});
