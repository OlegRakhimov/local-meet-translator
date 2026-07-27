// Patch v10.7: Restore microphone capture while keeping own-TTS feedback protection.
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
const VAD_THRESHOLD = 0.010;
const TAB_MIN_AVERAGE_RMS = 0.0025;
const TAB_MIN_SPEECH_RATIO = 0.06;
const MIN_AUDIO_BLOB_BYTES = 900;

let tabAudioMonitor = null;
let tabMeter = null;
let micMeter = null;
let ttsPlaying = false;
let outgoingTtsActive = false;
let outgoingTtsNorm = "";
let outgoingTtsAt = 0;
let outgoingTtsReleaseTimer = null;
let keepAliveAudioEl = null;

let tabId = null;

let tabStopTimer = null;
let micStopTimer = null;
let running = false;
let armed = false;
let armedTabId = null;
let armedReleaseTimer = null;

// Outgoing voice endpointing: collect speech until a short silence, then translate/TTS once.
// This avoids sending half-sentences every fixed 5 seconds.
const MIC_SILENCE_FLUSH_MS = 650;
const MIC_MIN_SEGMENT_MS = 500;
const MIC_MAX_SEGMENT_MS = 6500;
const MIC_MONITOR_INTERVAL_MS = 100;
const MIC_MIN_SPEECH_TICKS = 2;
const MIC_MIN_SPEECH_RATIO = 0.12;

// Own-TTS safety. Block only while our translated voice is playing and for a
// short tail afterwards. Do not block the microphone merely because the remote
// participant is speaking: that over-aggressive half-duplex gate could keep the
// microphone disabled for the entire call.
const MIC_TTS_COOLDOWN_MS = 900;

// Adaptive VAD. Browser auto-gain can lift room noise above a fixed threshold,
// so estimate the current noise floor and require a clear margin above it.
const MIC_CALIBRATION_MS = 650;
const MIC_START_MIN_RMS = 0.010;
const MIC_CONTINUE_MIN_RMS = 0.006;
const MIC_NOISE_START_MULTIPLIER = 2.0;
const MIC_NOISE_CONTINUE_MULTIPLIER = 1.35;
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
let micSegmentTotalTicks = 0;
let micNoiseFloor = 0.003;
let micCalibrationUntil = 0;
let micSuppressedUntil = 0;
let lastMicGateLogAt = 0;

// Keep a short history rather than comparing only with the immediately previous
// phrase. This blocks A -> B -> A feedback cycles and delayed duplicate chunks.
const OUTGOING_HISTORY_MS = 30000;
let recentMicHistory = [];
let recentSpokenHistory = [];
let recentTabHistory = [];

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

function status(kind, text, log) {
  chrome.runtime.sendMessage({ type: "STATUS", kind, text, log }).catch(() => {});
}

function withTimeout(promise, timeoutMs, label) {
  let timer = null;
  return Promise.race([
    Promise.resolve(promise),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(label || `Timed out after ${timeoutMs} ms`)), timeoutMs);
    })
  ]).finally(() => { if (timer) clearTimeout(timer); });
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
    let windowPeak = 0;
    let windowSum = 0;
    let windowSamples = 0;
    let windowSpeechSamples = 0;

    const timer = setInterval(() => {
      try {
        analyser.getByteTimeDomainData(buf);
        let sum = 0;
        for (let i = 0; i < buf.length; i++) {
          const v = (buf[i] - 128) / 128;
          sum += v * v;
        }
        rms = Math.sqrt(sum / buf.length);
        peak = Math.max(rms, peak * 0.85);
        windowPeak = Math.max(windowPeak, rms);
        windowSum += rms;
        windowSamples += 1;
        if (rms >= VAD_THRESHOLD) windowSpeechSamples += 1;
      } catch (_) {
        // ignore
      }
    }, 200);

    return {
      getRms: () => rms,
      getPeak: () => peak,
      consumeWindowStats: () => {
        const samples = windowSamples;
        const stats = {
          peak: windowPeak,
          average: samples ? windowSum / samples : 0,
          samples,
          speechSamples: windowSpeechSamples,
          speechRatio: samples ? windowSpeechSamples / samples : 0
        };
        peak = 0;
        windowPeak = 0;
        windowSum = 0;
        windowSamples = 0;
        windowSpeechSamples = 0;
        return stats;
      },
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

function pruneHistory(history, now, windowMs = OUTGOING_HISTORY_MS) {
  while (history.length && now - history[0].at > windowMs) history.shift();
}

function isHistoryDuplicate(norm, history, now) {
  if (!norm) return false;
  pruneHistory(history, now);
  return history.some(item => isNearPureEcho(norm, item.norm, 0.82));
}

function rememberHistory(norm, history, now) {
  if (!norm) return;
  pruneHistory(history, now);
  history.push({ norm, at: now });
  if (history.length > 12) history.splice(0, history.length - 12);
}

function isIncomingHistoryDuplicate(norm, now) {
  if (!norm) return false;
  pruneHistory(recentTabHistory, now, 20000);
  return recentTabHistory.some(item => {
    if (norm === item.norm || item.norm.includes(norm)) return true;
    // Keep a genuine longer completion instead of discarding the completed sentence.
    if (norm.includes(item.norm) && norm.length >= item.norm.length + 5) return false;
    const currentWords = normTokens(norm).length;
    const previousWords = normTokens(item.norm).length;
    const sizeClose = Math.abs(currentWords - previousWords) <= Math.max(2, Math.ceil(previousWords * 0.3));
    return sizeClose && jaccardTokens(norm, item.norm) >= 0.86;
  });
}

function stopAndDiscardCurrentMicSegment(reason) {
  const recorder = micRecorder;
  if (!recorder || recorder.state !== "recording") return;
  recorder.__discardForIsolation = true;
  try { recorder.stop(); } catch (_) {}
  const now = Date.now();
  if (now - lastMicGateLogAt > 1500) {
    lastMicGateLogAt = now;
    status("run", "Audio isolation", "Discarded microphone segment: " + reason);
  }
}

function blockMicForOwnTts() {
  micSuppressedUntil = Math.max(micSuppressedUntil, Date.now() + MIC_TTS_COOLDOWN_MS);
  stopAndDiscardCurrentMicSegment("translated TTS is playing");
}

function isMicTemporarilyBlocked(now = Date.now()) {
  return ttsPlaying || outgoingTtsActive || now < micSuppressedUntil;
}

function markOutgoingTtsStarted(text) {
  outgoingTtsNorm = normalizeForDedupe(text);
  outgoingTtsAt = Date.now();
  outgoingTtsActive = true;
  ttsPlaying = true;
  blockMicForOwnTts();
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
    micSuppressedUntil = Math.max(micSuppressedUntil, Date.now() + MIC_TTS_COOLDOWN_MS);
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
  // Keep the outgoing pipeline serialized until playback actually finishes.
  // HTMLMediaElement.play() resolves when playback starts, not when it ends;
  // returning early allowed several delayed phrases to overlap and replace each
  // other, which sounded like endless random/repeated speech.
  await withTimeout(new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      markOutgoingTtsEnded();
      try { URL.revokeObjectURL(url); } catch (_) {}
      resolve();
    };

    audioEl.onended = finish;
    audioEl.onerror = finish;
    audioEl.play().catch((e) => {
      status("err", "TTS play blocked", String(e));
      finish();
    });
  }), 120000, "TTS playback timed out.").catch((e) => {
    status("err", "TTS playback failed", String(e));
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
    if (data.transcriptDropped) {
      const reason = String(data.dropReason || "").toLowerCase();
      const message = reason === "prompt-echo"
        ? "[TRANSCRIPT DROPPED] prompt echo detected"
        : "[TRANSCRIPT DROPPED] no speech detected";
      status("run", "Transcript guard", message);
      return null;
    }
    if (data.transcriptionRetried) {
      status("run", "English expected", "Automatic strict-English retry was used for this audio chunk.");
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

async function startTabStream(streamId) {
  const constraints = { audio: { mandatory: { chromeMediaSource: "tab", chromeMediaSourceId: streamId } }, video: false };
  tabStream = await navigator.mediaDevices.getUserMedia(constraints);
  const audioTrack = tabStream && tabStream.getAudioTracks ? tabStream.getAudioTracks()[0] : null;
  if (audioTrack) {
    audioTrack.addEventListener("ended", () => {
      running = false;
      armed = false;
      armedTabId = null;
      status("err", "Browser audio ended", "The meeting-tab audio stream ended. The next desktop start will try to re-arm it automatically.");
    }, { once: true });
  }
  tabAudioMonitor = createTabAudioMonitor(tabStream);
  tabMeter = createLevelMeter(tabStream);
}

async function startTabCapture(streamId) {
  await startTabStream(streamId);
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

    if (VAD_ENABLED && tabMeter) {
      const stats = typeof tabMeter.consumeWindowStats === "function"
        ? tabMeter.consumeWindowStats()
        : { peak: tabMeter.getPeak(), average: tabMeter.getRms(), samples: 1, speechRatio: tabMeter.getPeak() >= VAD_THRESHOLD ? 1 : 0 };
      const silent = stats.samples < 2
        || stats.peak < VAD_THRESHOLD
        || (stats.average < TAB_MIN_AVERAGE_RMS && stats.speechRatio < TAB_MIN_SPEECH_RATIO);
      if (silent) {
        status("run", "Transcript guard", "[TRANSCRIPT DROPPED] silence detected");
        return;
      }
    }

    const data = await transcribeAndTranslate(ev.data, tabSourceLang, tabTargetLang);
    if (!data) return;

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
    rememberHistory(norm, recentTabHistory, now);
    lastIncomingTranscriptNorm = norm;
    lastIncomingTranslationNorm = normalizeForDedupe(translation);
    lastIncomingAt = now;

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

  micStream = await withTimeout(
    navigator.mediaDevices.getUserMedia({ audio, video: false }),
    12000,
    "Microphone access timed out. Open the extension audio-access page, allow the microphone, then retry."
  );
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
  if (isNearDuplicate(norm, lastMicNorm, now, lastMicAt) || isHistoryDuplicate(norm, recentMicHistory, now)) {
    status("run", "Outgoing voice", "Skipped duplicate microphone transcript.");
    return;
  }
  lastMicNorm = norm; lastMicAt = now;
  rememberHistory(norm, recentMicHistory, now);

  if (showOutgoingSubtitles) {
    chrome.runtime.sendMessage({ type: "SUBTITLE", tabId, channel: "outgoing", translation, transcript: "YOU: " + transcript, ts: now }).catch(() => {});
  }

  if (!translation) return;
  const tNorm = normalizeForDedupe(translation);
  if (isLikelyRepeatForTts(tNorm, lastSpokenNorm, now, lastSpokenAt) || isHistoryDuplicate(tNorm, recentSpokenHistory, now)) {
    status("run", "Outgoing voice", "Skipped repeated completed phrase.");
    return;
  }
  lastSpokenNorm = tNorm; lastSpokenAt = now;
  rememberHistory(tNorm, recentSpokenHistory, now);

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
  micSegmentTotalTicks = 0;
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
  micNoiseFloor = 0.003;
  micCalibrationUntil = Date.now() + MIC_CALIBRATION_MS;
  micSuppressedUntil = 0;
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

    const recorderForSegment = micRecorder;
    micRecorder.ondataavailable = (ev) => {
      if (recorderForSegment.__discardForIsolation || isMicTemporarilyBlocked()) return;
      if (!ev.data || ev.data.size === 0) return;
      if (ev.data.size < MIN_AUDIO_BLOB_BYTES) return;
      const speechRatio = micSegmentTotalTicks > 0 ? micSegmentSpeechTicks / micSegmentTotalTicks : 0;
      const continueThreshold = Math.max(MIC_CONTINUE_MIN_RMS, micNoiseFloor * MIC_NOISE_CONTINUE_MULTIPLIER);
      if (micSegmentSpeechTicks < MIC_MIN_SPEECH_TICKS || speechRatio < MIC_MIN_SPEECH_RATIO || micSegmentPeakRms < continueThreshold) {
        status("run", "Outgoing voice", `Skipped mic segment with too little speech (ticks=${micSegmentSpeechTicks}/${micSegmentTotalTicks}, peak=${micSegmentPeakRms.toFixed(3)}).`);
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
      const rms = micMeter && typeof micMeter.getRms === "function" ? micMeter.getRms() : (micMeter ? micMeter.getPeak() : 0);

      // Never transcribe our generated TTS. Remote meeting audio by itself does
      // not close the microphone: echoCancellation plus transcript echo matching
      // handle speaker leakage without making voice mode permanently silent.
      if (ttsPlaying || outgoingTtsActive || now < micSuppressedUntil) {
        stopAndDiscardCurrentMicSegment("translated TTS/cooldown");
        return;
      }

      const isRecording = !!(micRecorder && micRecorder.state === "recording");

      // Calibrate/track room noise only while idle. Disable auto-gain pumping from
      // turning silence into fake speech segments.
      if (!isRecording && now < micCalibrationUntil) {
        micNoiseFloor = Math.max(0.001, micNoiseFloor * 0.85 + (rms || 0) * 0.15);
        return;
      }
      if (!isRecording && rms < Math.max(MIC_START_MIN_RMS, micNoiseFloor * MIC_NOISE_START_MULTIPLIER)) {
        micNoiseFloor = Math.max(0.001, micNoiseFloor * 0.98 + (rms || 0) * 0.02);
      }

      const startThreshold = Math.max(MIC_START_MIN_RMS, micNoiseFloor * MIC_NOISE_START_MULTIPLIER);
      const continueThreshold = Math.max(MIC_CONTINUE_MIN_RMS, micNoiseFloor * MIC_NOISE_CONTINUE_MULTIPLIER);
      const speech = !VAD_ENABLED || !micMeter || rms >= (isRecording ? continueThreshold : startThreshold);

      if (!speech && !isRecording && now - lastMicGateLogAt > 4000) {
        lastMicGateLogAt = now;
        status("run", "Outgoing voice", `Waiting for speech: micRms=${(rms || 0).toFixed(3)}, threshold=${startThreshold.toFixed(3)}.`);
      }

      if (speech) {
        if (!micRecorder || micRecorder.state !== "recording") startSpeechRecording();
        micLastSpeechAt = now;
      }

      if (micRecorder && micRecorder.state === "recording") {
        micSegmentTotalTicks += 1;
        micSegmentPeakRms = Math.max(micSegmentPeakRms, rms || 0);
        if (!VAD_ENABLED || !micMeter || rms >= continueThreshold) micSegmentSpeechTicks += 1;
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

async function stopMicCaptureOnly() {
  try { if (micStopTimer) clearInterval(micStopTimer); } catch (_) {}
  try { if (micSpeechMonitorTimer) clearInterval(micSpeechMonitorTimer); } catch (_) {}
  micStopTimer = null;
  micSpeechMonitorTimer = null;
  resetMicSegment();

  try { if (micRecorder && micRecorder.state !== "inactive") micRecorder.stop(); } catch (_) {}
  micRecorder = null;
  try { if (micStream) for (const t of micStream.getTracks()) t.stop(); } catch (_) {}
  micStream = null;
  try { if (micMeter) micMeter.stop(); } catch (_) {}
  micMeter = null;
}

async function updateRunningMode(msg) {
  audioIsolationMode = msg.audioIsolationMode !== false;
  ttsEnabled = audioIsolationMode ? false : !!msg.ttsEnabled;
  ttsVoice = msg.ttsVoice || ttsVoice || "onyx";
  ttsSpeed = typeof msg.ttsSpeed === "number" ? msg.ttsSpeed : (ttsSpeed || 1.0);

  micTxSourceLang = msg.micTxSourceLang || micTxSourceLang || "en";
  micTxTargetLang = msg.micTxTargetLang || micTxTargetLang || "en";
  micDeviceId = msg.micDeviceId || "";
  micDeviceName = msg.micDeviceName || "";
  ttsSinkDeviceId = msg.ttsSinkDeviceId || "";
  ttsSinkDeviceName = msg.ttsSinkDeviceName || (audioIsolationMode && !!msg.micTxEnabled ? "CABLE Input" : "");
  micTxChunkSeconds = msg.micTxChunkSeconds || 5;
  outVoiceStyle = msg.outVoiceStyle || "openai";
  rvcModelTag = msg.rvcModelTag || "";
  showOutgoingSubtitles = !!msg.showOutgoingSubtitles;

  const enableMic = !!msg.micTxEnabled;
  if (!enableMic) {
    micTxEnabled = false;
    await stopMicCaptureOnly();
    const details = { incomingReady: !!tabStream, micTxEnabled: false, micTxReady: false, sinkReady: false };
    status("run", "Running", "Switched to subtitles-only mode without restarting tab capture.");
    return { ok: true, message: "Incoming translation is ready; outgoing voice is off.", details };
  }

  // Restart only the microphone path. Keep tab capture/subtitles alive.
  micTxEnabled = false;
  await stopMicCaptureOnly();
  status("run", "Starting...", "Enabling microphone for outgoing translation without restarting subtitles...");
  try {
    micTxEnabled = true;
    const microphoneLabel = await startMicCapture();
    const sinkProbe = new Audio();
    const sinkReady = await withTimeout(
      setSinkIfSupported(sinkProbe, ttsSinkDeviceId, ttsSinkDeviceName),
      8000,
      "Selecting CABLE Input timed out."
    );
    if (!sinkReady) throw new Error("Translated voice output CABLE Input is unavailable.");
    const outputLabel = ttsSinkDeviceName || "CABLE Input";
    const details = {
      incomingReady: !!tabStream,
      micTxEnabled: true,
      micTxReady: true,
      microphoneLabel,
      sinkReady: true,
      outputLabel
    };
    const message = `Voice translation is ready. Microphone: ${microphoneLabel}; output: ${outputLabel}.`;
    status("run", "Voice ready", message);
    return { ok: true, message, details };
  } catch (e) {
    micTxEnabled = false;
    await stopMicCaptureOnly();
    const error = "Outgoing voice is not ready: " + formatErr(e);
    status("err", "Outgoing voice unavailable", error);
    return { ok: false, error, details: { incomingReady: !!tabStream, micTxReady: false, sinkReady: false } };
  }
}

async function stopAll({ keepTabStream = false } = {}) {
  running = false;
  try { if (tabStopTimer) clearTimeout(tabStopTimer); } catch (_) {}
  try { if (micStopTimer) clearInterval(micStopTimer); } catch (_) {}
  try { if (micSpeechMonitorTimer) clearInterval(micSpeechMonitorTimer); } catch (_) {}
  try { if (outgoingTtsReleaseTimer) clearTimeout(outgoingTtsReleaseTimer); } catch (_) {}
  tabStopTimer = null; micStopTimer = null; micSpeechMonitorTimer = null;
  outgoingTtsReleaseTimer = null;
  outgoingTtsActive = false;
  ttsPlaying = false;
  micSuppressedUntil = 0;
  recentMicHistory = [];
  recentSpokenHistory = [];
  resetMicSegment();

  try { if (tabRecorder && tabRecorder.state !== "inactive") tabRecorder.stop(); } catch (_) {}
  try { if (micRecorder && micRecorder.state !== "inactive") micRecorder.stop(); } catch (_) {}
  tabRecorder = null;
  micRecorder = null;

  try { if (micStream) for (const t of micStream.getTracks()) t.stop(); } catch (_) {}
  micStream = null;
  try { if (micMeter) micMeter.stop(); } catch (_) {}
  micMeter = null;

  if (!keepTabStream) {
    try { if (tabStream) for (const t of tabStream.getTracks()) t.stop(); } catch (_) {}
    try { if (tabAudioMonitor) tabAudioMonitor.stop(); } catch (_) {}
    try { if (tabMeter) tabMeter.stop(); } catch (_) {}
    tabStream = null;
    tabAudioMonitor = null;
    tabMeter = null;
    armed = false;
    armedTabId = null;
    try { if (armedReleaseTimer) clearTimeout(armedReleaseTimer); } catch (_) {}
    armedReleaseTimer = null;
  } else {
    const liveTrack = tabStream && tabStream.getAudioTracks && tabStream.getAudioTracks().some(track => track.readyState === "live");
    armed = !!liveTrack;
    armedTabId = armed ? tabId : null;
  }

  try { if (audioEl) { audioEl.pause(); audioEl.src = ""; audioEl = null; } } catch (_) {}
}

function scheduleArmedAutoRelease() {
  try { if (armedReleaseTimer) clearTimeout(armedReleaseTimer); } catch (_) {}
  armedReleaseTimer = setTimeout(() => {
    if (!running && armed) {
      stopAll().then(() => status("ok", "Audio released", "Idle armed audio capture was released after 10 minutes.")).catch(() => {});
    }
  }, 10 * 60 * 1000);
}

function applyCaptureConfig(msg) {
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
  ttsSinkDeviceName = msg.ttsSinkDeviceName || (audioIsolationMode && !!msg.micTxEnabled ? "CABLE Input" : "");
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
  micSuppressedUntil = 0;
  recentMicHistory = [];
  recentSpokenHistory = [];
}

async function activateConfiguredCapture(msg, useArmedStream) {
  applyCaptureConfig(msg);
  if (!serverUrl || !authToken) throw new Error("Missing config");
  if (useArmedStream) {
    const liveTrack = tabStream && tabStream.getAudioTracks && tabStream.getAudioTracks().some(track => track.readyState === "live");
    if (!armed || !liveTrack || Number(armedTabId) !== Number(msg.tabId)) {
      throw new Error("Armed tab audio stream is unavailable for this meeting tab.");
    }
  }
  try { if (armedReleaseTimer) clearTimeout(armedReleaseTimer); } catch (_) {}
  armedReleaseTimer = null;
  running = true;
  let incomingReady = false;
  let microphoneLabel = "";
  let outputLabel = "";
  if (useArmedStream) {
    status("run", "Starting...", "Activating the already armed tab audio stream...");
    await startTabRecorder();
    incomingReady = true;
  } else if (msg.streamId) {
    status("run", "Starting...", "Capturing tab audio...");
    await startTabCapture(msg.streamId);
    armed = true;
    armedTabId = Number(msg.tabId);
    incomingReady = true;
  } else {
    throw new Error("No tab audio streamId.");
  }

  if (micTxEnabled) {
    status("run", "Starting...", "Capturing microphone for outgoing translation...");
    microphoneLabel = await startMicCapture();
    const sinkProbe = new Audio();
    const sinkReady = await setSinkIfSupported(sinkProbe, ttsSinkDeviceId, ttsSinkDeviceName);
    if (!sinkReady) throw new Error("Translated voice output CABLE Input is unavailable.");
    outputLabel = ttsSinkDeviceName || "CABLE Input";
  }

  const details = {
    incomingReady,
    armed: true,
    tabId: Number(msg.tabId),
    micTxEnabled,
    micTxReady: micTxEnabled ? !!microphoneLabel : false,
    microphoneLabel,
    sinkReady: micTxEnabled ? !!outputLabel : false,
    outputLabel
  };
  const message = micTxEnabled
    ? `Voice translation is ready. Microphone: ${microphoneLabel}; output: ${outputLabel}.`
    : "Incoming translation is ready.";
  return { ok: true, message, details };
}

const OFFSCREEN_MESSAGE_TYPES = new Set([
  "OFFSCREEN_STATUS",
  "OFFSCREEN_ARM",
  "OFFSCREEN_UPDATE_MODE",
  "OFFSCREEN_ACTIVATE",
  "OFFSCREEN_START",
  "OFFSCREEN_PAUSE",
  "OFFSCREEN_RELEASE",
  "OFFSCREEN_STOP"
]);

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // The offscreen document shares chrome.runtime messaging with the service
  // worker. It must ignore desktop/control messages completely; otherwise it
  // can answer DESKTOP_COMMAND or DESKTOP_COMMAND_ACK before background.js,
  // leaving the desktop command without a real acknowledgement.
  if (!msg || !OFFSCREEN_MESSAGE_TYPES.has(String(msg.type || ""))) {
    return false;
  }

  (async () => {
    try {
      if (msg?.type === "OFFSCREEN_STATUS") {
        const liveTrack = tabStream && tabStream.getAudioTracks && tabStream.getAudioTracks().some(track => track.readyState === "live");
        if (!liveTrack) { armed = false; armedTabId = null; }
        sendResponse({ ok: true, armed: !!armed, running: !!running, tabId: armedTabId });
        return;
      }

      if (msg?.type === "OFFSCREEN_ARM") {
        await stopAll();
        if (!msg.streamId || !msg.tabId) {
          sendResponse({ ok: false, error: "Missing streamId or tabId for audio arming." });
          return;
        }
        tabId = Number(msg.tabId);
        status("run", "Arming audio...", "Opening the meeting tab audio stream from the popup user action...");
        await startTabStream(msg.streamId);
        armed = true;
        armedTabId = Number(msg.tabId);
        running = false;
        scheduleArmedAutoRelease();
        status("ok", "Audio armed", "Meeting tab audio is armed locally. Start subtitles from the desktop app.");
        sendResponse({ ok: true, armed: true, running: false, tabId: armedTabId });
        return;
      }

      if (msg?.type === "OFFSCREEN_UPDATE_MODE") {
        if (!running) {
          sendResponse({ ok: false, error: "Translation capture is not running yet." });
          return;
        }
        const result = await updateRunningMode(msg);
        sendResponse(result);
        return;
      }

      if (msg?.type === "OFFSCREEN_ACTIVATE") {
        try {
          const result = await activateConfiguredCapture(msg, true);
          status("run", micTxEnabled ? "Voice ready" : "Running", result.message);
          sendResponse(result);
        } catch (error) {
          const text = formatErr(error);
          await stopAll({ keepTabStream: true });
          scheduleArmedAutoRelease();
          const details = { incomingReady: false, armed: !!armed, tabId: armedTabId, micTxReady: false, sinkReady: false };
          status("err", "Activation failed", text);
          sendResponse({ ok: false, error: text, details });
        }
        return;
      }

      if (msg?.type === "OFFSCREEN_START") {
        await stopAll();
        try {
          const result = await activateConfiguredCapture(msg, false);
          status("run", micTxEnabled ? "Voice ready" : "Running", result.message);
          sendResponse(result);
        } catch (error) {
          const text = formatErr(error);
          await stopAll();
          status("err", "Offscreen error", text);
          sendResponse({ ok: false, error: text });
        }
        return;
      }

      if (msg?.type === "OFFSCREEN_PAUSE") {
        await stopAll({ keepTabStream: true });
        if (armed) scheduleArmedAutoRelease();
        status("ok", "Paused", armed
          ? "Translation processing stopped; meeting tab audio stays armed locally for restart."
          : "Translation stopped.");
        sendResponse({ ok: true, armed: !!armed, running: false, tabId: armedTabId });
        return;
      }

      if (msg?.type === "OFFSCREEN_RELEASE" || msg?.type === "OFFSCREEN_STOP") {
        await stopAll();
        status("ok", "Stopped", "Stopped and released meeting tab audio.");
        sendResponse({ ok: true, armed: false, running: false });
        return;
      }

      sendResponse({ ok: false, error: "Unsupported offscreen message." });
    } catch (e) {
      await stopAll();
      status("err", "Offscreen error", String(e));
      sendResponse({ ok: false, error: String(e) });
    }
  })();
  return true;
});
