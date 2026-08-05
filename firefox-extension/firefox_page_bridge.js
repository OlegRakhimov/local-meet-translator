(() => {
  "use strict";

  if (window.__LMT_FIREFOX_PAGE_BRIDGE__) return;
  window.__LMT_FIREFOX_PAGE_BRIDGE__ = true;

  const PAGE_SOURCE = "lmt-firefox-page";
  const CONTENT_SOURCE = "lmt-firefox-content";
  const peerConnections = new Set();
  const remoteTracks = new Map();
  let running = false;
  let sessionId = "";
  let chunkMs = 3000;

  function post(type, payload = {}, transfer = []) {
    const targetOrigin = location.origin && location.origin !== "null" ? location.origin : "*";
    window.postMessage({ source: PAGE_SOURCE, type, sessionId, ...payload }, targetOrigin, transfer);
  }

  function pickMimeType() {
    const candidates = [
      "audio/webm;codecs=opus",
      "audio/webm",
      "audio/ogg;codecs=opus",
      "audio/ogg"
    ];
    for (const mime of candidates) {
      try {
        if (MediaRecorder.isTypeSupported(mime)) return mime;
      } catch (_) {}
    }
    return "";
  }

  async function emitChunk(blob, trackId) {
    if (!running || !blob || blob.size < 900) return;
    try {
      const buffer = await blob.arrayBuffer();
      if (!running || !buffer.byteLength) return;
      post("audio-chunk", {
        trackId,
        mimeType: blob.type || "audio/ogg;codecs=opus",
        arrayBuffer: buffer
      }, [buffer]);
    } catch (error) {
      post("capture-error", { error: String(error && (error.message || error)) });
    }
  }

  function stopRecorder(state) {
    if (!state) return;
    try {
      if (state.timer) clearTimeout(state.timer);
    } catch (_) {}
    state.timer = null;
    try {
      if (state.recorder && state.recorder.state !== "inactive") state.recorder.stop();
    } catch (_) {}
    state.recorder = null;
  }

  function startRecorder(state) {
    if (!running || !state || state.track.readyState === "ended") return;
    if (state.recorder && state.recorder.state !== "inactive") return;

    const mimeType = pickMimeType();
    try {
      const stream = new MediaStream([state.track]);
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      state.recorder = recorder;
      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size) emitChunk(event.data, state.id);
      };
      recorder.onerror = (event) => {
        post("capture-error", { error: String(event.error || "Firefox remote audio recorder failed") });
      };
      recorder.onstop = () => {
        state.recorder = null;
        if (running && state.track.readyState !== "ended") {
          setTimeout(() => startRecorder(state), 30);
        }
      };
      recorder.start();
      state.timer = setTimeout(() => {
        try {
          if (recorder.state !== "inactive") recorder.stop();
        } catch (_) {}
      }, chunkMs);
    } catch (error) {
      post("capture-error", { error: String(error && (error.message || error)) });
    }
  }

  function removeTrack(id) {
    const state = remoteTracks.get(id);
    if (!state) return;
    stopRecorder(state);
    try {
      state.track.stop();
    } catch (_) {}
    remoteTracks.delete(id);
  }

  function observeTrack(track) {
    if (!track || track.kind !== "audio") return;
    const id = track.id || `track-${remoteTracks.size + 1}`;
    if (remoteTracks.has(id)) return;

    let capturedTrack = track;
    try {
      capturedTrack = track.clone();
    } catch (_) {}
    const state = { id, track: capturedTrack, recorder: null, timer: null };
    remoteTracks.set(id, state);
    track.addEventListener("ended", () => removeTrack(id), { once: true });
    capturedTrack.addEventListener("ended", () => removeTrack(id), { once: true });
    if (running) startRecorder(state);
    post("track-found", { trackId: id, trackCount: remoteTracks.size });
  }

  function inspectReceivers(pc) {
    try {
      for (const receiver of pc.getReceivers()) observeTrack(receiver && receiver.track);
    } catch (_) {}
  }

  function observePeerConnection(pc) {
    if (!pc || peerConnections.has(pc)) return pc;
    peerConnections.add(pc);
    pc.addEventListener("track", (event) => observeTrack(event.track));
    pc.addEventListener("connectionstatechange", () => {
      if (pc.connectionState === "closed" || pc.connectionState === "failed") {
        peerConnections.delete(pc);
      }
    });
    inspectReceivers(pc);
    return pc;
  }

  function patchConstructor(name) {
    const Original = window[name];
    if (typeof Original !== "function" || Original.__LMT_FIREFOX_PATCHED__) return;

    function WrappedRTCPeerConnection(...args) {
      return observePeerConnection(new Original(...args));
    }
    WrappedRTCPeerConnection.prototype = Original.prototype;
    Object.setPrototypeOf(WrappedRTCPeerConnection, Original);
    Object.defineProperty(WrappedRTCPeerConnection, "__LMT_FIREFOX_PATCHED__", { value: true });
    window[name] = WrappedRTCPeerConnection;
  }

  patchConstructor("RTCPeerConnection");
  if (window.webkitRTCPeerConnection && window.webkitRTCPeerConnection !== window.RTCPeerConnection) {
    patchConstructor("webkitRTCPeerConnection");
  }
  if (window.mozRTCPeerConnection && window.mozRTCPeerConnection !== window.RTCPeerConnection) {
    patchConstructor("mozRTCPeerConnection");
  }

  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    const message = event.data;
    if (!message || message.source !== CONTENT_SOURCE) return;

    if (message.type === "start") {
      sessionId = String(message.sessionId || "");
      chunkMs = Math.max(2000, Math.min(15000, Number(message.chunkSeconds || 3) * 1000));
      running = true;
      for (const pc of peerConnections) inspectReceivers(pc);
      for (const state of remoteTracks.values()) startRecorder(state);
      post("capture-started", { trackCount: remoteTracks.size });
      return;
    }

    if (message.type === "stop") {
      running = false;
      for (const state of remoteTracks.values()) stopRecorder(state);
      post("capture-stopped", { trackCount: remoteTracks.size });
    }
  });

  post("bridge-ready");
})();
