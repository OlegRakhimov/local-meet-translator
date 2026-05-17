// Patch v10.3: Restore tab audio playback and harden chunk handling.
// Replace edge-extension/offscreen.js with this file.

let tabStream = null;
let tabRecorder = null;

let micStream = null;
let micRecorder = null;

let serverUrl = "";
let authToken = "";

let tabSourceLang = "auto";
let tabTargetLang = "en";
let tabChunkSeconds = 5;

let ttsEnabled = false;
let ttsVoice = "onyx";
let ttsSpeed = 1.0;

let micTxEnabled = false;
let micTxSourceLang = "en";
let micTxTargetLang = "en";
let micTxChunkSeconds = 5;
let micDeviceId = "";
let micDeviceName = "";
let ttsSinkDeviceId = "";
let ttsSinkDeviceName = "";

// Outgoing voice mode
let outVoiceStyle = "openai"; // openai | rvc
let rvcModelTag = "";

// UI preference: avoid mixing outgoing debug subtitles with incoming.
let showOutgoingSubtitles = false;

// Reduce hallucinations on silence and prevent self-feedback.
const VAD_ENABLED = true;
const VAD_THRESHOLD = 0.015; // RMS in [0..1] (heuristic) for incoming tab audio
const MIC_VAD_THRESHOLD = 0.006; // softer threshold for user microphone endpointing
const MUTE_MIC_DURING_TTS = true;
const MIN_AUDIO_BLOB_BYTES = 900;

let tabAudioMonitor = null;
let tabMeter = null;
let micMeter = null;
let ttsPlaying = false;
let keepAliveAudioEl = null;

let tabId = null;

let tabStopTimer = null;
let micStopTimer = null;
let running = false;

// Outgoing voice endpointing: collect speech until a short silence, then translate/TTS once.
// This avoids sending half-sentences every fixed 5 seconds.
const MIC_TIMESLICE_MS = 500;
const MIC_SILENCE_FLUSH_MS = 1100;
const MIC_MIN_SEGMENT_MS = 1200;
const MIC_MAX_SEGMENT_MS = 12000;
let micSegmentParts = [];
let micSegmentMime = "";
let micSegmentStartedAt = 0;
let micLastSpeechAt = 0;
let micFlushChain = Promise.resolve();
let micRecorderStartedAt = 0;
let micSpeechMonitorTimer = null;
let micCurrentMimeType = "";

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
  // Drop a shorter repeated fragment, but do NOT drop a longer completion that contains
  // the previous partial phrase. Example: keep "I want to explain the issue" after "I want".
  if (lastNorm.includes(norm)) return true;
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


function createTabAudioMonitor(stream) {
  // chrome.tabCapture removes the captured tab from the browser's normal
  // speaker path. Restore it exactly once. The previous build used both an
  // AudioContext graph and an <audio> fallback at the same time, which caused
  // the echo/double remote voice reported in Meet.
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (AudioCtx && stream) {
      const ctx = new AudioCtx();
      const src = ctx.createMediaStreamSource(stream);
      const gain = ctx.createGain();
      gain.gain.value = 1.0;
      src.connect(gain);
      gain.connect(ctx.destination);

      const resume = () => {
        try { if (ctx.state === "suspended") ctx.resume().catch(() => {}); } catch (_) {}
      };
      resume();
      const timer = setInterval(resume, 1000);
      status("run", "Running", "Tab audio playback restored through one AudioContext path.");
      return { stop: () => {
        try { clearInterval(timer); } catch (_) {}
        try { src.disconnect(); } catch (_) {}
        try { gain.disconnect(); } catch (_) {}
        try { ctx.close(); } catch (_) {}
      }};
    }
  } catch (e) {
    status("err", "Tab audio monitor", "AudioContext restore failed, trying HTMLAudioElement fallback: " + String(e));
  }

  try {
    keepAliveAudioEl = document.createElement("audio");
    keepAliveAudioEl.autoplay = true;
    keepAliveAudioEl.controls = false;
    keepAliveAudioEl.muted = false;
    keepAliveAudioEl.volume = 1.0;
    keepAliveAudioEl.srcObject = stream;
    document.body.appendChild(keepAliveAudioEl);
    const play = () => keepAliveAudioEl && keepAliveAudioEl.play().catch(() => {});
    play();
    const timer = setInterval(play, 1000);
    status("run", "Running", "Tab audio playback restored through one HTMLAudioElement fallback path.");
    return { stop: () => {
      try { clearInterval(timer); } catch (_) {}
      try { keepAliveAudioEl.pause(); } catch (_) {}
      try { keepAliveAudioEl.srcObject = null; } catch (_) {}
      try { keepAliveAudioEl.remove(); } catch (_) {}
      keepAliveAudioEl = null;
    }};
  } catch (e) {
    status("err", "Tab audio monitor", "Could not restore tab audio playback: " + String(e));
    return null;
  }
}
async function listAudioDevices() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return [];
  try {
    return await navigator.mediaDevices.enumerateDevices();
  } catch (e) {
    status("err", "Audio devices", "Could not enumerate devices: " + String(e));
    return [];
  }
}

function isVirtualCableLabel(label) {
  const s = String(label || "").toLowerCase();
  return s.includes("cable") || s.includes("vb-audio") || s.includes("virtual cable") || s.includes("stereo mix") || s.includes("stereomix") || s.includes("микшер") || s.includes("микс stereo") || s.includes("miks stereo");
}

function isLikelyPhysicalMicLabel(label) {
  const s = String(label || "").toLowerCase();
  return s.includes("microphone") || s.includes("microfoon") || s.includes("mikrofon") || s.includes("микрофон") || s.includes("realtek") || s.includes("usb") || s.includes("headset") || s.includes("гарнитур") || s.includes("array");
}

async function findDeviceIdByName(kind, namePart) {
  const needle = String(namePart || "").trim().toLowerCase();
  if (!needle) return "";
  const devices = await listAudioDevices();
  const found = devices.find(d => d.kind === kind && String(d.label || "").toLowerCase().includes(needle));
  return found ? found.deviceId : "";
}

async function findSafePhysicalMicDeviceId() {
  const devices = (await listAudioDevices()).filter(d => d.kind === "audioinput");
  if (!devices.length) return "";

  const nonCable = devices.filter(d => !isVirtualCableLabel(d.label));
  const preferred = nonCable.find(d => isLikelyPhysicalMicLabel(d.label));
  if (preferred) {
    status("run", "Microphone", "Auto-selected physical microphone: " + (preferred.label || "audioinput"));
    return preferred.deviceId;
  }

  if (nonCable[0]) {
    status("run", "Microphone", "Auto-selected non-cable microphone: " + (nonCable[0].label || "audioinput"));
    return nonCable[0].deviceId;
  }

  status("err", "Microphone", "Only virtual cable/stereo-mix inputs are visible. Outgoing voice needs your real microphone as input, and CABLE Output only in Meet.");
  return "";
}

async function setSinkIfSupported(el, deviceId, deviceName) {
  let resolved = deviceId || "";
  if (!resolved && deviceName) resolved = await findDeviceIdByName("audiooutput", deviceName);
  if (!resolved) {
    status("err", "TTS sink", "Translated voice output not found. Set 'Translated voice output name contains' to CABLE Input and choose CABLE Output as microphone in Meet. Refusing to play translated voice into your speakers.");
    return false;
  }
  if (typeof el.setSinkId !== "function") {
    status("err", "TTS sink", "setSinkId not supported by this browser. Use Chrome/Edge for sending translated voice into VB-Cable, or route audio at Windows level.");
    return false;
  }
  try { await el.setSinkId(resolved); return true; }
  catch (e) {
    if (deviceName) {
      const byName = await findDeviceIdByName("audiooutput", deviceName);
      if (byName && byName !== resolved) {
        try { await el.setSinkId(byName); return true; } catch (_) {}
      }
    }
    status("err", "TTS sink", "Failed to set sink device: " + String(e) + ". Open the extension options / microphone permission page and grant/select CABLE Input.");
    return false;
  }
}

async function playTtsAudio(base64, mime, sinkDeviceId, sinkDeviceName) {
  if (!base64) return;

  try {
    if (audioEl) { audioEl.pause(); audioEl.src = ""; audioEl = null; }
  } catch (_) {}

  const bytes = base64ToBytes(base64);
  const blob = new Blob([bytes], { type: mime || "audio/mpeg" });
  const url = URL.createObjectURL(blob);

  audioEl = new Audio(url);
  const sinkOk = await setSinkIfSupported(audioEl, sinkDeviceId, sinkDeviceName);
  if (!sinkOk) { try { URL.revokeObjectURL(url); } catch (_) {} return; }
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

  // Voice conversion is ONLY for outgoing (mic -> translated voice).
  // If enabled, force WAV from the bridge and request conversion.
  if ((outVoiceStyle || "openai") === "rvc") {
    const tag = (rvcModelTag || "").trim();
    if (tag) {
      payload.response_format = "wav";
      payload.voiceConversion = { type: "rvc", modelTag: tag };
    } else {
      // Style is RVC but no tag provided => no conversion.
      payload.response_format = "mp3";
      delete payload.voiceConversion;
    }
  }

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

async function translateTextFallback(text, sourceLang, targetLang) {
  const cleanText = String(text || "").trim();
  if (!cleanText) return "";
  try {
    const resp = await fetch(`${serverUrl}/translate-text`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Auth-Token": authToken },
      body: JSON.stringify({ text: cleanText, sourceLang: sourceLang || "auto", targetLang: targetLang || "en" })
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      status("err", "Translate fallback error", `HTTP ${resp.status}: ${JSON.stringify(data)}`);
      return "";
    }
    return String(data.translation || "").trim();
  } catch (e) {
    status("err", "Translate fallback failed", String(e));
    return "";
  }
}

async function transcribeAndTranslate(blob, sourceLang, targetLang) {
  try {
    if (!blob || blob.size < MIN_AUDIO_BLOB_BYTES) {
      status("run", "Running", `Skipping tiny audio chunk: ${blob ? blob.size : 0} bytes`);
      return null;
    }

    const base64 = await blobToBase64(blob);
    if (!base64 || base64.length < 1000) {
      status("run", "Running", "Skipping empty audio payload.");
      return null;
    }

    const mime = (blob && blob.type) ? blob.type : "audio/webm;codecs=opus";
    status("run", "Running", `Sending: ${blob.size} bytes, type=${mime || "?"}`);

    const payload = {
      audioBase64: base64,
      audioMime: mime,
      sourceLang: sourceLang || "auto",
      targetLang: targetLang || "en"
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
    if ((data.transcript || "").trim() && !(data.translation || "").trim()) {
      const fallbackTranslation = await translateTextFallback(data.transcript, sourceLang, targetLang);
      if (fallbackTranslation) data.translation = fallbackTranslation;
    }
    status("run", "Running", `Received: transcriptLen=${(data.transcript||"").length}, translationLen=${(data.translation||"").length}`);
    return data;
  } catch (e) {
    status("err", "Bridge request failed", String(e));
    return null;
  }
}

// Prefer WebM/Opus for OpenAI transcription. Some Chromium builds can record
// OGG/Opus, but the transcription API may reject those chunks as unsupported.
function pickMimeType() {
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/ogg;codecs=opus",
    "audio/ogg"
  ];
  for (const m of candidates) {
    try { if (MediaRecorder.isTypeSupported(m)) return m; } catch (_) {}
  }
  return "";
}

async function startTabCapture(streamId) {
  const constraints = { audio: { mandatory: { chromeMediaSource: "tab", chromeMediaSourceId: streamId } }, video: false };
  tabStream = await navigator.mediaDevices.getUserMedia(constraints);
  tabAudioMonitor = createTabAudioMonitor(tabStream);
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
    if (ev.data.size < MIN_AUDIO_BLOB_BYTES) return;

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
  if (micDeviceId) {
    audio.deviceId = { exact: micDeviceId };
  } else if (micDeviceName) {
    const resolvedMic = await findDeviceIdByName("audioinput", micDeviceName);
    if (resolvedMic) {
      audio.deviceId = { exact: resolvedMic };
    } else {
      status("err", "Microphone", "Microphone matching name not found: " + micDeviceName + ". Auto-selecting a real non-cable microphone instead of using browser default.");
      const safeMic = await findSafePhysicalMicDeviceId();
      if (safeMic) audio.deviceId = { exact: safeMic };
    }
  } else {
    // Do not use browser/system default here: the user often sets Meet's microphone to CABLE Output,
    // and then browser default may also become CABLE Output. That creates silence/feedback instead of
    // capturing the real microphone for outgoing translation.
    const safeMic = await findSafePhysicalMicDeviceId();
    if (safeMic) audio.deviceId = { exact: safeMic };
  }

  micStream = await navigator.mediaDevices.getUserMedia({ audio, video: false });
  const track = micStream.getAudioTracks()[0];
  const label = track && track.label ? track.label : "";
  if (isVirtualCableLabel(label)) {
    try { for (const t of micStream.getTracks()) t.stop(); } catch (_) {}
    throw new Error("Outgoing translation captured a virtual cable input instead of your real microphone: " + label + ". Set 'Название моего микрофона содержит' to Realtek / USB / Mikrofon, and keep CABLE Output only as the microphone inside Meet.");
  }
  status("run", "Microphone", "Capturing outgoing speech from: " + (label || "selected microphone"));
  micMeter = createLevelMeter(micStream);
  await startMicRecorder();
}

function formatErr(e) {
  if (!e) return "";
  const name = e.name ? String(e.name) : "";
  const msg = e.message ? String(e.message) : String(e);
  return name && msg && !msg.startsWith(name) ? `${name}: ${msg}` : (msg || name);
}

async function processMicSpeechBlob(blob, reason) {
  const data = await transcribeAndTranslate(blob, micTxSourceLang, micTxTargetLang);
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

  status("run", "Outgoing voice", `Speaking completed phrase (${reason}): transcriptLen=${transcript.length}, translationLen=${translation.length}`);
  const tts = await requestTts(translation);
  if (tts) await playTtsAudio(tts.audioBase64, tts.audioMime, ttsSinkDeviceId, ttsSinkDeviceName);
}

function resetMicSegment() {
  micSegmentParts = [];
  micSegmentMime = "";
  micSegmentStartedAt = 0;
  micLastSpeechAt = 0;
}

function flushMicSegment(reason) {
  if (!micSegmentParts.length || !micSegmentStartedAt) {
    resetMicSegment();
    return;
  }
  const mime = micSegmentMime || micSegmentParts[0]?.type || "audio/webm";
  const blob = new Blob(micSegmentParts, { type: mime });
  const durationMs = Date.now() - micSegmentStartedAt;
  resetMicSegment();

  if (blob.size < MIN_AUDIO_BLOB_BYTES || durationMs < MIC_MIN_SEGMENT_MS) return;

  // Keep outgoing TTS in order. A later phrase must not overtake an earlier one.
  micFlushChain = micFlushChain
    .then(() => processMicSpeechBlob(blob, reason))
    .catch((e) => status("err", "Outgoing voice failed", String(e)));
}

async function startMicRecorder() {
  if (!micStream) return;
  const mimeType = pickMimeType();
  micCurrentMimeType = mimeType;
  status("run", "Running", "Mic recorder mime=" + (mimeType || "default") + "; endpointing=whole-phrase");
  resetMicSegment();
  if (micSpeechMonitorTimer) clearInterval(micSpeechMonitorTimer);

  const startSpeechRecording = () => {
    if (!running || !micTxEnabled || !micStream) return;
    if (micRecorder && micRecorder.state === "recording") return;
    resetMicSegment();
    const now = Date.now();
    micSegmentStartedAt = now;
    micLastSpeechAt = now;
    micRecorderStartedAt = now;

    try {
      micRecorder = new MediaRecorder(micStream, micCurrentMimeType ? { mimeType: micCurrentMimeType } : undefined);
    } catch (e) {
      status("err", "Mic recorder failed", String(e));
      return;
    }

    micRecorder.ondataavailable = (ev) => {
      if (!ev.data || ev.data.size === 0) return;
      if (ev.data.size < MIN_AUDIO_BLOB_BYTES) return;
      const mime = ev.data.type || micCurrentMimeType || "audio/webm";
      const blob = ev.data.type ? ev.data : new Blob([ev.data], { type: mime });
      micFlushChain = micFlushChain
        .then(() => processMicSpeechBlob(blob, "whole-phrase"))
        .catch((e) => status("err", "Outgoing voice failed", String(e)));
    };
    micRecorder.onstop = () => {
      micRecorder = null;
      resetMicSegment();
    };

    try {
      micRecorder.start();
      status("run", "Outgoing voice", "Speech started; recording whole phrase.");
    } catch (e) {
      status("err", "Mic recorder start failed", String(e));
      micRecorder = null;
    }
  };

  const stopSpeechRecording = (reason) => {
    if (!micRecorder || micRecorder.state !== "recording") return;
    status("run", "Outgoing voice", "Speech ended; sending phrase (" + reason + ").");
    try { micRecorder.stop(); } catch (_) {}
  };

  micSpeechMonitorTimer = setInterval(() => {
    try {
      if (!running || !micTxEnabled || !micStream) return;
      const now = Date.now();
      const peak = micMeter ? micMeter.getPeak() : 1;
      const speech = !VAD_ENABLED || !micMeter || peak >= MIC_VAD_THRESHOLD;

      if (MUTE_MIC_DURING_TTS && ttsPlaying) {
        stopSpeechRecording("tts-playing");
        return;
      }

      if (speech) {
        if (!micRecorder || micRecorder.state !== "recording") startSpeechRecording();
        micLastSpeechAt = now;
      }

      if (micRecorder && micRecorder.state === "recording") {
        const durationMs = now - (micSegmentStartedAt || now);
        const silenceMs = now - (micLastSpeechAt || now);
        if (durationMs >= MIC_MIN_SEGMENT_MS && silenceMs >= MIC_SILENCE_FLUSH_MS) {
          stopSpeechRecording("silence");
        } else if (durationMs >= MIC_MAX_SEGMENT_MS) {
          stopSpeechRecording("max-duration");
        }
      }
    } catch (e) {
      status("err", "Mic monitor failed", String(e));
    }
  }, 200);
}

async function stopAll() {
  running = false;
  try { if (tabStopTimer) clearTimeout(tabStopTimer); } catch (_) {}
  try { if (micStopTimer) clearInterval(micStopTimer); } catch (_) {}
  try { if (micSpeechMonitorTimer) clearInterval(micSpeechMonitorTimer); } catch (_) {}
  tabStopTimer = null; micStopTimer = null; micSpeechMonitorTimer = null;
  resetMicSegment();

  try { if (tabRecorder && tabRecorder.state !== "inactive") tabRecorder.stop(); } catch (_) {}
  try { if (micRecorder && micRecorder.state !== "inactive") micRecorder.stop(); } catch (_) {}

  try { if (tabStream) for (const t of tabStream.getTracks()) t.stop(); } catch (_) {}
  try { if (micStream) for (const t of micStream.getTracks()) t.stop(); } catch (_) {}

  try { if (tabAudioMonitor) tabAudioMonitor.stop(); } catch (_) {}
  try { if (tabMeter) tabMeter.stop(); } catch (_) {}
  try { if (micMeter) micMeter.stop(); } catch (_) {}
  tabAudioMonitor = null;
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
        tabTargetLang = msg.targetLang || "en";
        tabChunkSeconds = msg.chunkSeconds || 3;

        ttsEnabled = !!msg.ttsEnabled;
        ttsVoice = msg.ttsVoice || "onyx";
        ttsSpeed = typeof msg.ttsSpeed === "number" ? msg.ttsSpeed : 1.0;

        micTxEnabled = !!msg.micTxEnabled;
        micTxSourceLang = msg.micTxSourceLang || "en";
        micTxTargetLang = msg.micTxTargetLang || "en";
        micDeviceId = msg.micDeviceId || "";
        micDeviceName = msg.micDeviceName || "";
        ttsSinkDeviceId = msg.ttsSinkDeviceId || "";
        ttsSinkDeviceName = msg.ttsSinkDeviceName || "";
        micTxChunkSeconds = msg.micTxChunkSeconds || 5;

        outVoiceStyle = msg.outVoiceStyle || "openai";
        rvcModelTag = msg.rvcModelTag || "";

        showOutgoingSubtitles = !!msg.showOutgoingSubtitles;

        lastTabNorm = ""; lastTabAt = 0;
        lastMicNorm = ""; lastMicAt = 0;
        lastSpokenNorm = ""; lastSpokenAt = 0;

        if (!serverUrl || !authToken) {
          status("err", "Missing config", "serverUrl/authToken is missing.");
          sendResponse({ ok: false, error: "Missing config" });
          return;
        }

        running = true;
        if (msg.streamId) {
          status("run", "Starting...", "Capturing tab audio...");
          await startTabCapture(msg.streamId);
        } else {
          status("err", "Incoming subtitles unavailable", "No tab audio streamId. Browser did not allow tab capture for this page/start action. Outgoing voice will still run if enabled.");
        }

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
