// Firefox persistent-background audio pipeline.
// Incoming meeting audio is recorded in the page-level WebRTC bridge and
// delivered here as ArrayBuffer chunks. Firefox does not expose Chromium's
// privileged tab-audio and offscreen-document APIs.

let micStream = null;
let micRecorder = null;

let serverUrl = "";
let authToken = "";

let tabSourceLang = "auto";
let tabTargetLang = "en";
let tabChunkSeconds = 5;

let audioIsolationMode = true;
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
const MIC_START_THRESHOLD = 0.014;
const MIC_CONTINUE_THRESHOLD = 0.008;
const MIN_AUDIO_BLOB_BYTES = 900;

let micMeter = null;
let ttsPlaying = false;
let outgoingTtsActive = false;
let outgoingTtsNorm = "";
let outgoingTtsAt = 0;
let outgoingTtsReleaseTimer = null;

let tabId = null;

let micStopTimer = null;
let running = false;
let incomingFlushChain = Promise.resolve();
let incomingQueueDepth = 0;
let audioGeneration = 0;
const MAX_INCOMING_QUEUE_DEPTH = 4;

// Outgoing voice endpointing: collect speech until a short silence, then translate/TTS once.
// This avoids sending half-sentences every fixed 5 seconds.
const MIC_SILENCE_FLUSH_MS = 650;
const MIC_MIN_SEGMENT_MS = 550;
const MIC_MAX_SEGMENT_MS = 6500;
const MIC_MONITOR_INTERVAL_MS = 100;
const MIC_MIN_SPEECH_TICKS = 2;
let micSegmentParts = [];
let micSegmentMime = "";
let micSegmentStartedAt = 0;
let micLastSpeechAt = 0;
let micFlushChain = Promise.resolve();
let micRecorderStartedAt = 0;
let micSpeechMonitorTimer = null;
let micCurrentMimeType = "";
let micSegmentPeakRms = 0;
let micSegmentSpeechTicks = 0;

// Dedupe
const DEDUPE_WINDOW_MS = 12000;
const DEDUPE_JACCARD = 0.85;
const ECHO_MATCH_JACCARD = 0.72;
const OUTGOING_TTS_SUPPRESS_MS = 2500;
const INCOMING_TO_OUTGOING_ECHO_MS = 7000;

let lastTabNorm = "";
let lastTabAt = 0;
let lastIncomingTranscriptNorm = "";
let lastIncomingTranslationNorm = "";
let lastIncomingAt = 0;

let lastMicNorm = "";
let lastMicAt = 0;

let lastSpokenNorm = "";
let lastSpokenAt = 0;
let recentTabHistory = [];

function status(kind, text, log) {
  browser.runtime.sendMessage({ type: "STATUS", kind, text, log }).catch(() => {});
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
  if (norm.includes(lastNorm) && norm.length >= lastNorm.length + 5) return false;
  const currentWords = normTokens(norm).length;
  const previousWords = normTokens(lastNorm).length;
  const sizeClose = Math.abs(currentWords - previousWords) <= Math.max(2, Math.ceil(previousWords * 0.3));
  return sizeClose && jaccardTokens(norm, lastNorm) >= DEDUPE_JACCARD;
}

function isLikelyRepeatForTts(norm, lastNorm, now, lastAt) {
  if (!norm || !lastNorm) return false;
  if (now - lastAt > DEDUPE_WINDOW_MS) return false;
  if (norm === lastNorm) return true;
  return isNearPureEcho(norm, lastNorm, 0.72);
}

function normTokens(norm) {
  return String(norm || "").split(/\s+/).filter(Boolean);
}

function isNearPureEcho(candidateNorm, echoNorm, threshold = ECHO_MATCH_JACCARD) {
  if (!candidateNorm || !echoNorm) return false;
  if (candidateNorm === echoNorm) return true;

  const candidateTokens = normTokens(candidateNorm);
  const echoTokens = normTokens(echoNorm);
  if (!candidateTokens.length || !echoTokens.length) return false;

  const candidateSet = new Set(candidateTokens);
  const echoSet = new Set(echoTokens);
  let common = 0;
  for (const token of candidateSet) if (echoSet.has(token)) common++;

  const candidateCoverage = common / candidateSet.size;
  const echoCoverage = common / echoSet.size;
  const extraCandidateTokens = Math.max(0, candidateSet.size - common);
  const sizeClose = candidateSet.size <= echoSet.size + Math.max(2, Math.ceil(echoSet.size * 0.25));

  if (candidateNorm.length >= 8 && echoNorm.length >= 8) {
    if (echoNorm.includes(candidateNorm)) return true;
    if (candidateNorm.includes(echoNorm) && extraCandidateTokens <= 2) return true;
  }

  // Suppress only if the candidate is mostly the echo. If the user speaks over
  // the remote voice/TTS and adds meaningful new words, keep translating it.
  return echoCoverage >= 0.85 && candidateCoverage >= 0.75 && sizeClose
    || (jaccardTokens(candidateNorm, echoNorm) >= threshold && sizeClose);
}

function isRecentPureEcho(norm, otherNorm, now, otherAt, windowMs, threshold = ECHO_MATCH_JACCARD) {
  if (!norm || !otherNorm || !otherAt) return false;
  if (now - otherAt > windowMs) return false;
  return isNearPureEcho(norm, otherNorm, threshold);
}

function pruneIncomingHistory(now, windowMs = 20000) {
  recentTabHistory = recentTabHistory.filter(item => now - item.at <= windowMs);
  if (recentTabHistory.length > 12) recentTabHistory.splice(0, recentTabHistory.length - 12);
}

function isIncomingHistoryDuplicate(norm, now) {
  if (!norm) return false;
  pruneIncomingHistory(now);
  return recentTabHistory.some(item => {
    if (norm === item.norm || item.norm.includes(norm)) return true;
    if (norm.includes(item.norm) && norm.length >= item.norm.length + 5) return false;
    const currentWords = normTokens(norm).length;
    const previousWords = normTokens(item.norm).length;
    const sizeClose = Math.abs(currentWords - previousWords) <= Math.max(2, Math.ceil(previousWords * 0.3));
    return sizeClose && jaccardTokens(norm, item.norm) >= 0.86;
  });
}

function rememberIncomingHistory(norm, now) {
  if (!norm) return;
  pruneIncomingHistory(now);
  recentTabHistory.push({ norm, at: now });
}

function shouldSuppressIncoming(transcript, translation, now) {
  if (!audioIsolationMode || !outgoingTtsNorm) return false;
  if (!outgoingTtsActive && now - outgoingTtsAt > OUTGOING_TTS_SUPPRESS_MS) return false;
  const tNorm = normalizeForDedupe(transcript);
  const trNorm = normalizeForDedupe(translation);
  return isNearPureEcho(tNorm, outgoingTtsNorm) || isNearPureEcho(trNorm, outgoingTtsNorm);
}

function shouldSuppressOutgoing(transcript, now) {
  if (!audioIsolationMode) return false;
  const norm = normalizeForDedupe(transcript);
  const recentOwnTts = outgoingTtsNorm
    && (outgoingTtsActive || now - outgoingTtsAt <= OUTGOING_TTS_SUPPRESS_MS)
    && isNearPureEcho(norm, outgoingTtsNorm);
  return recentOwnTts
    || isRecentPureEcho(norm, lastIncomingTranscriptNorm, now, lastIncomingAt, INCOMING_TO_OUTGOING_ECHO_MS)
    || isRecentPureEcho(norm, lastIncomingTranslationNorm, now, lastIncomingAt, INCOMING_TO_OUTGOING_ECHO_MS);
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
    let rms = 0;
    let peak = 0;

    const timer = setInterval(() => {
      try {
        analyser.getByteTimeDomainData(buf);
        let sum = 0;
        for (let i = 0; i < buf.length; i++) {
          const v = (buf[i] - 128) / 128;
          sum += v * v;
        }
        rms = Math.sqrt(sum / buf.length);
        // peak-hold with decay so we capture speech occurring within the last ~1s.
        peak = Math.max(rms, peak * 0.85);
      } catch (_) {
        // ignore
      }
    }, 200);

    return {
      getRms: () => rms,
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

function isUnsafeMicSelection(value) {
  const s = String(value || "").trim().toLowerCase();
  if (!s) return false;
  return s === "default"
    || s.includes("default")
    || s.includes("cable")
    || s.includes("vb-audio")
    || s.includes("stereo mix")
    || s.includes("stereomix")
    || s.includes("what u hear")
    || s.includes("loopback")
    || s.includes("monitor");
}

function isUnsafeMicLabel(label) {
  return isVirtualCableLabel(label) || isUnsafeMicSelection(label);
}

function isCableInputLabel(label) {
  const s = String(label || "").toLowerCase();
  if (!s) return false;
  return s.includes("cable input") || (s.includes("vb-audio") && s.includes("cable")) || s.includes("virtual cable");
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

async function findDeviceById(kind, deviceId) {
  const id = String(deviceId || "");
  if (!id) return null;
  const devices = await listAudioDevices();
  return devices.find(d => d.kind === kind && d.deviceId === id) || null;
}

async function findSafePhysicalMicDeviceId() {
  const devices = (await listAudioDevices()).filter(d => d.kind === "audioinput");
  if (!devices.length) return "";

  const nonCable = devices.filter(d => !isUnsafeMicLabel(d.label));
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
  if (audioIsolationMode) {
    const requestedOutput = String(deviceName || "").toLowerCase();
    if (String(resolved || "").toLowerCase() === "default" || requestedOutput.includes("default") || requestedOutput.includes("speaker") || requestedOutput.includes("headphone")) {
      status("err", "TTS sink", "Audio isolation blocks this TTS output. Use CABLE Input only, never default speakers.");
      return false;
    }
    if (deviceName && !isCableInputLabel(deviceName)) {
      status("err", "TTS sink", "Audio isolation requires translated voice output to be CABLE Input.");
      return false;
    }
  }
  if (!resolved && deviceName) resolved = await findDeviceIdByName("audiooutput", deviceName);
  if (!resolved) {
    status("err", "TTS sink", "Translated voice output not found. Set 'Translated voice output name contains' to CABLE Input and choose CABLE Output as microphone in Meet. Refusing to play translated voice into your speakers.");
    return false;
  }
  if (audioIsolationMode) {
    const selectedOutput = await findDeviceById("audiooutput", resolved);
    const label = selectedOutput && selectedOutput.label ? selectedOutput.label : deviceName;
    if (!isCableInputLabel(label)) {
      status("err", "TTS sink", "Audio isolation blocked non-CABLE output: " + (label || resolved) + ". Select CABLE Input.");
      return false;
    }
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

function markOutgoingTtsStarted(text) {
  outgoingTtsNorm = normalizeForDedupe(text);
  outgoingTtsAt = Date.now();
  outgoingTtsActive = true;
  ttsPlaying = true;
  if (outgoingTtsReleaseTimer) {
    try { clearTimeout(outgoingTtsReleaseTimer); } catch (_) {}
  }
}

function markOutgoingTtsEnded() {
  if (outgoingTtsReleaseTimer) {
    try { clearTimeout(outgoingTtsReleaseTimer); } catch (_) {}
  }
  outgoingTtsReleaseTimer = setTimeout(() => {
    outgoingTtsActive = false;
    ttsPlaying = false;
  }, 800);
}

async function playTtsAudio(base64, mime, sinkDeviceId, sinkDeviceName, spokenText) {
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

  // Guard against feedback loops: if mic or tab audio hears our own TTS, suppress it.
  markOutgoingTtsStarted(spokenText || "");
  audioEl.onended = () => {
    markOutgoingTtsEnded();
    try { URL.revokeObjectURL(url); } catch (_) {}
  };
  audioEl.onerror = () => {
    markOutgoingTtsEnded();
    try { URL.revokeObjectURL(url); } catch (_) {}
  };

  await audioEl.play().catch((e) => {
    status("err", "TTS play blocked", String(e));
    markOutgoingTtsEnded();
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

async function processIncomingAudioChunk(arrayBuffer, mimeType, generation) {
  if (!running || generation !== audioGeneration || !arrayBuffer) return;
  const blob = new Blob([arrayBuffer], { type: mimeType || "audio/ogg;codecs=opus" });
  if (blob.size < MIN_AUDIO_BLOB_BYTES) return;

  const data = await transcribeAndTranslate(blob, tabSourceLang, tabTargetLang);
  if (!running || generation !== audioGeneration || !data) return;

  const transcript = (data.transcript || "").trim();
  const translation = (data.translation || "").trim();
  if (!transcript && !translation) return;

  const now = Date.now();
  if (shouldSuppressIncoming(transcript, translation, now)) {
    status("run", "Audio isolation", "Suppressed incoming subtitle that matched our outgoing TTS.");
    return;
  }

  const norm = normalizeForDedupe(transcript);
  if (isNearDuplicate(norm, lastTabNorm, now, lastTabAt) || isIncomingHistoryDuplicate(norm, now)) {
    status("run", "Incoming subtitles", "Skipped repeated incoming phrase.");
    return;
  }
  lastTabNorm = norm; lastTabAt = now;
  rememberIncomingHistory(norm, now);
  lastIncomingTranscriptNorm = norm;
  lastIncomingTranslationNorm = normalizeForDedupe(translation);
  lastIncomingAt = now;

  const desktopSubtitle = globalThis.LMTDesktopSubtitles;
  if (!desktopSubtitle || typeof desktopSubtitle.send !== "function") {
    status("err", "Local subtitle window", "Desktop subtitle transport is unavailable.");
    return;
  }
  const delivered = await desktopSubtitle.send({
    channel: "incoming",
    translation,
    transcript,
    ts: now,
    tabId
  }).catch(error => ({ ok: false, error: String(error && (error.message || error) || error) }));
  if (!delivered || !delivered.ok) {
    status("err", "Local subtitle window", String(delivered && delivered.error || "Could not deliver subtitles to desktop."));
  }
}

async function startMicCapture() {
  const audio = audioIsolationMode ? {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
    channelCount: 1
  } : {};
  const isolationMicError = "Audio isolation requires a real physical microphone for outgoing recognition. Do not use Default, CABLE Output, Stereo Mix, What U Hear, loopback, or monitor devices.";

  if (audioIsolationMode && (isUnsafeMicSelection(micDeviceId) || isUnsafeMicSelection(micDeviceName))) {
    throw new Error(isolationMicError + " Current setting: " + (micDeviceName || micDeviceId));
  }

  if (micDeviceId) {
    if (audioIsolationMode) {
      const selectedMic = await findDeviceById("audioinput", micDeviceId);
      if (selectedMic && selectedMic.label && isUnsafeMicLabel(selectedMic.label)) {
        throw new Error(isolationMicError + " Selected device: " + selectedMic.label);
      }
    }
    audio.deviceId = { exact: micDeviceId };
  } else if (micDeviceName) {
    const resolvedMic = await findDeviceIdByName("audioinput", micDeviceName);
    if (resolvedMic) {
      if (audioIsolationMode) {
        const selectedMic = await findDeviceById("audioinput", resolvedMic);
        if (selectedMic && selectedMic.label && isUnsafeMicLabel(selectedMic.label)) {
          throw new Error(isolationMicError + " Selected device: " + selectedMic.label);
        }
      }
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

  if (audioIsolationMode && !audio.deviceId) {
    throw new Error(isolationMicError + " No safe physical microphone was found.");
  }

  micStream = await navigator.mediaDevices.getUserMedia({ audio, video: false });
  const track = micStream.getAudioTracks()[0];
  const label = track && track.label ? track.label : "";
  if (audioIsolationMode ? isUnsafeMicLabel(label) : isVirtualCableLabel(label)) {
    try { for (const t of micStream.getTracks()) t.stop(); } catch (_) {}
    throw new Error(isolationMicError + " Captured device: " + label + ". Set 'Название моего микрофона содержит' to Realtek / USB / Mikrofon, and keep CABLE Output only as the microphone inside Meet.");
  }
  status("run", "Microphone", "Capturing outgoing speech from: " + (label || "selected microphone"));
  micMeter = createLevelMeter(micStream);
  await startMicRecorder();
  return label || "selected microphone";
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
  if (shouldSuppressOutgoing(transcript, now)) {
    status("run", "Audio isolation", "Suppressed outgoing voice: mic matched recent incoming speaker audio.");
    return;
  }
  if (isNearDuplicate(norm, lastMicNorm, now, lastMicAt)) return;
  lastMicNorm = norm; lastMicAt = now;

  if (showOutgoingSubtitles) {
    const desktopSubtitle = globalThis.LMTDesktopSubtitles;
    if (desktopSubtitle && typeof desktopSubtitle.send === "function") {
      desktopSubtitle.send({ channel: "outgoing", translation, transcript: "YOU: " + transcript, ts: now, tabId }).catch(() => {});
    }
  }

  if (!translation) return;
  const tNorm = normalizeForDedupe(translation);
  if (isLikelyRepeatForTts(tNorm, lastSpokenNorm, now, lastSpokenAt)) {
    status("run", "Outgoing voice", "Skipped repeated completed phrase.");
    return;
  }
  lastSpokenNorm = tNorm; lastSpokenAt = now;

  status("run", "Outgoing voice", `Speaking completed phrase (${reason}): transcriptLen=${transcript.length}, translationLen=${translation.length}`);
  const tts = await requestTts(translation);
  if (tts) await playTtsAudio(tts.audioBase64, tts.audioMime, ttsSinkDeviceId, ttsSinkDeviceName, translation);
}

function resetMicSegment() {
  micSegmentParts = [];
  micSegmentMime = "";
  micSegmentStartedAt = 0;
  micLastSpeechAt = 0;
  micSegmentPeakRms = 0;
  micSegmentSpeechTicks = 0;
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
    micSegmentPeakRms = 0;
    micSegmentSpeechTicks = 0;

    try {
      micRecorder = new MediaRecorder(micStream, micCurrentMimeType ? { mimeType: micCurrentMimeType } : undefined);
    } catch (e) {
      status("err", "Mic recorder failed", String(e));
      return;
    }

    micRecorder.ondataavailable = (ev) => {
      if (!ev.data || ev.data.size === 0) return;
      if (ev.data.size < MIN_AUDIO_BLOB_BYTES) return;
      if (micSegmentSpeechTicks < MIC_MIN_SPEECH_TICKS || micSegmentPeakRms < MIC_CONTINUE_THRESHOLD) {
        status("run", "Outgoing voice", "Skipped mic segment with too little speech.");
        return;
      }
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
      const rms = micMeter && typeof micMeter.getRms === "function" ? micMeter.getRms() : (micMeter ? micMeter.getPeak() : 1);
      const isRecording = !!(micRecorder && micRecorder.state === "recording");
      const speech = !VAD_ENABLED || !micMeter || rms >= (isRecording ? MIC_CONTINUE_THRESHOLD : MIC_START_THRESHOLD);

      if (speech) {
        if (!micRecorder || micRecorder.state !== "recording") startSpeechRecording();
        micLastSpeechAt = now;
      }

      if (micRecorder && micRecorder.state === "recording") {
        micSegmentPeakRms = Math.max(micSegmentPeakRms, rms || 0);
        if (!VAD_ENABLED || !micMeter || rms >= MIC_CONTINUE_THRESHOLD) micSegmentSpeechTicks += 1;
        const durationMs = now - (micSegmentStartedAt || now);
        const silenceMs = now - (micLastSpeechAt || now);
        const maxSegmentMs = Math.max(2500, Math.min(MIC_MAX_SEGMENT_MS, (micTxChunkSeconds || 5) * 1000));
        if (durationMs >= MIC_MIN_SEGMENT_MS && silenceMs >= MIC_SILENCE_FLUSH_MS) {
          stopSpeechRecording("silence");
        } else if (durationMs >= maxSegmentMs) {
          stopSpeechRecording("max-duration");
        }
      }
    } catch (e) {
      status("err", "Mic monitor failed", String(e));
    }
  }, MIC_MONITOR_INTERVAL_MS);
}

async function stopAll() {
  running = false;
  audioGeneration += 1;
  try { if (micStopTimer) clearInterval(micStopTimer); } catch (_) {}
  try { if (micSpeechMonitorTimer) clearInterval(micSpeechMonitorTimer); } catch (_) {}
  try { if (outgoingTtsReleaseTimer) clearTimeout(outgoingTtsReleaseTimer); } catch (_) {}
  micStopTimer = null; micSpeechMonitorTimer = null;
  outgoingTtsReleaseTimer = null;
  outgoingTtsActive = false;
  ttsPlaying = false;
  resetMicSegment();

  try { if (micRecorder && micRecorder.state !== "inactive") micRecorder.stop(); } catch (_) {}

  try { if (micStream) for (const t of micStream.getTracks()) t.stop(); } catch (_) {}

  try { if (micMeter) micMeter.stop(); } catch (_) {}
  micMeter = null;

  micStream = null; micRecorder = null;

  try { if (audioEl) { audioEl.pause(); audioEl.src = ""; audioEl = null; } } catch (_) {}
}

async function startFirefoxAudio(msg) {
  await stopAll();

  audioIsolationMode = msg.audioIsolationMode !== false;
  tabId = msg.tabId;
  serverUrl = msg.serverUrl;
  authToken = msg.authToken;

  tabSourceLang = msg.sourceLang || "auto";
  tabTargetLang = msg.targetLang || "en";
  tabChunkSeconds = msg.chunkSeconds || 3;

  ttsEnabled = audioIsolationMode ? false : !!msg.ttsEnabled;
  ttsVoice = msg.ttsVoice || "onyx";
  ttsSpeed = typeof msg.ttsSpeed === "number" ? msg.ttsSpeed : 1.0;

  micTxEnabled = !!msg.micTxEnabled;
  micTxSourceLang = msg.micTxSourceLang || "en";
  micTxTargetLang = msg.micTxTargetLang || "en";
  micDeviceId = msg.micDeviceId || "";
  micDeviceName = msg.micDeviceName || "";
  ttsSinkDeviceId = msg.ttsSinkDeviceId || "";
  ttsSinkDeviceName = msg.ttsSinkDeviceName || (audioIsolationMode && micTxEnabled ? "CABLE Input" : "");
  micTxChunkSeconds = msg.micTxChunkSeconds || 5;

  outVoiceStyle = msg.outVoiceStyle || "openai";
  rvcModelTag = msg.rvcModelTag || "";
  showOutgoingSubtitles = !!msg.showOutgoingSubtitles;

  lastTabNorm = ""; lastTabAt = 0;
  lastMicNorm = ""; lastMicAt = 0;
  lastSpokenNorm = ""; lastSpokenAt = 0;
  lastIncomingTranscriptNorm = "";
  lastIncomingTranslationNorm = "";
  lastIncomingAt = 0;
  outgoingTtsNorm = "";
  outgoingTtsAt = 0;
  outgoingTtsActive = false;

  if (!tabId || !serverUrl || !authToken) {
    throw new Error("tabId/serverUrl/authToken is missing.");
  }

  running = true;
  let microphoneLabel = "";
  let outputLabel = "";
  if (micTxEnabled) {
    status("run", "Starting...", "Capturing microphone for outgoing translation...");
    try {
      microphoneLabel = await startMicCapture();
      const sinkProbe = new Audio();
      const sinkReady = await setSinkIfSupported(sinkProbe, ttsSinkDeviceId, ttsSinkDeviceName);
      if (!sinkReady) throw new Error("Translated voice output CABLE Input is unavailable.");
      outputLabel = ttsSinkDeviceName || "CABLE Input";
    } catch (e) {
      const error = "Outgoing voice is not ready: " + formatErr(e) + ". Open the extension audio-access page, grant microphone/output access, and try again.";
      await stopAll();
      throw new Error(error);
    }
  }

  return {
    ok: true,
    details: {
      micTxEnabled,
      micTxReady: micTxEnabled ? !!microphoneLabel : false,
      microphoneLabel,
      sinkReady: micTxEnabled ? !!outputLabel : false,
      outputLabel
    }
  };
}

function enqueueIncomingAudio(arrayBuffer, mimeType) {
  if (!running || !arrayBuffer) return { ok: false, ignored: true };
  if (incomingQueueDepth >= MAX_INCOMING_QUEUE_DEPTH) {
    status("run", "Firefox incoming audio", "Dropped an audio chunk because transcription is behind.");
    return { ok: false, dropped: true };
  }
  const generation = audioGeneration;
  incomingQueueDepth += 1;
  incomingFlushChain = incomingFlushChain
    .then(() => processIncomingAudioChunk(arrayBuffer, mimeType, generation))
    .catch((e) => status("err", "Firefox incoming audio failed", formatErr(e)))
    .finally(() => { incomingQueueDepth = Math.max(0, incomingQueueDepth - 1); });
  return { ok: true };
}

globalThis.LMTFirefoxAudio = Object.freeze({
  start: startFirefoxAudio,
  enqueueIncomingAudio,
  stop: stopAll,
  isRunning: () => running
});
