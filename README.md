# Local Call Translator (Edge Extension + Local Java Bridge)

Local Call Translator is a self-hosted prototype that provides **near real-time speech translation** for web-based video calls (e.g., **Google Meet**, **Zoom Web**, **Microsoft Teams Web**) by capturing the **tab audio**, transcribing it, translating it, and showing subtitles (and optionally **speaking the translation** locally).

This repository is intended for developers who want a transparent, auditable setup where the **OpenAI API key is never stored inside the browser extension**.

---

## What problem it solves

- You attend calls where people speak a language you do not understand.
- You want **subtitles/translation in your browser** while keeping your API key under your control.
- You want an approach you can audit and modify (open-source).

---

## How it works (architecture)

**Two components:**

### 1) Edge/Chrome extension (Manifest V3)
- Captures **tab audio output** (what you hear in the call).
- Splits audio into short segments.
- Sends each segment to a local HTTP service on `127.0.0.1`.
- Displays translated subtitles as a simple overlay on supported sites.
- Optional: requests TTS audio from the local service and plays it **locally** (your speakers/headphones).

### 2) Local Java bridge (localhost)
- Runs on your machine only, typically: `http://127.0.0.1:8799`
- Holds the **OpenAI API key** in environment variables (not in the extension).
- Endpoints used by the extension:
  - `GET /health`
  - `POST /transcribe-and-translate` (audio -> text -> translation)
  - `POST /translate-text` (text -> translation; useful for testing)
  - `POST /tts` (optional; text -> speech audio)

**Important:** Audio segments are sent from your machine to the OpenAI API for transcription/translation (this is not offline).

---

## Supported platforms

- Google Meet (web)
- Zoom (web)
- Microsoft Teams (web)

Notes:
- Overlay injection depends on the extension’s `content_scripts` match patterns.
- Audio capture depends on browser support for `tabCapture` + `offscreen` documents.

---

## Key security properties

- **API key never lives in the extension.** It is only in the local Java process environment.
- The extension authenticates to localhost using a **local token** (`LOCAL_SOKUJI_TOKEN` / `X-Auth-Token` header).
- **Do not expose** the local bridge on non-local interfaces. Keep it bound to `127.0.0.1`.

Threat model notes:
- If a malicious process on your machine can call your localhost service and knows the local token, it could spend your API quota.
- Treat both the OpenAI API key and the local token as secrets.

---

## Tokens & Languages

### Local token (`LOCAL_SOKUJI_TOKEN`)
- Each user should generate their **own** `LOCAL_SOKUJI_TOKEN`. This token authorizes the extension to call the localhost bridge (header `X-Auth-Token`).
- Do **not** commit the token to GitHub. Set it via environment variables on the machine running the bridge.

Example (PowerShell):

```powershell
$env:LOCAL_SOKUJI_TOKEN=([guid]::NewGuid().ToString("N"))
```

### Languages (`sourceLang` / `targetLang`)
The popup lets you choose:
- **Source language** (`sourceLang`) — language spoken in the call
- **Target language** (`targetLang`) — language you want to read/hear

#### What `auto` means
`auto` asks the backend/model to infer the source language. It is convenient for mixed-language calls, but can be slightly less stable than setting a fixed language.

#### Examples
- English → Russian:
  - Source: `en`
  - Target: `ru`

- German → English:
  - Source: `de`
  - Target: `en`

- Polish → Russian:
  - Source: `pl`
  - Target: `ru`

Tip: If your calls are consistently in one language (e.g., always English), set Source to that language instead of `auto` to reduce mis-detections.

## Requirements

### Runtime
- Windows 11 (tested), should also work on macOS/Linux with minor path differences
- Microsoft Edge (or Chrome/Chromium)

### Development / build
- Java 21+
- Gradle (or use `gradlew` wrapper)
- An OpenAI API key with API access enabled

---

## Quick start

### A) Start the local Java bridge

1) Set environment variables (PowerShell example):

```powershell
$env:OPENAI_API_KEY="sk-..."
$env:LOCAL_SOKUJI_PORT="8799"
$env:LOCAL_SOKUJI_TOKEN=([guid]::NewGuid().ToString("N"))

# Recommended models
$env:OPENAI_TRANSCRIBE_MODEL="whisper-1"
$env:OPENAI_TEXT_MODEL="gpt-4o-mini"

# Optional TTS (only if you want local voice playback)
$env:ENABLE_TTS="true"
$env:OPENAI_TTS_MODEL="gpt-4o-mini-tts"
$env:OPENAI_TTS_VOICE="onyx"
$env:OPENAI_TTS_FORMAT="mp3"
$env:OPENAI_TTS_SPEED="1.0"
```

2) Run the bridge from `local-sokuji-bridge`:

```powershell
cd .\local-sokuji-bridge
.\gradlew run
```

The console prints:

- URL: `http://127.0.0.1:8799`
- TOKEN: (copy this into the extension popup)

3) Health check:

```powershell
$token=$env:LOCAL_SOKUJI_TOKEN
curl.exe http://127.0.0.1:8799/health -H "X-Auth-Token: $token"
```

Expected: `{"ok":true,...}`

---

### B) Load the extension into Edge

1) Open: `edge://extensions`
2) Enable **Developer mode**
3) Click **Load unpacked**
4) Select the folder: `edge-extension`

---

### C) Use it in a call (Meet/Zoom/Teams)

1) Join a web meeting (and make sure you can hear participants).
2) Click the extension icon to open the popup.
3) Fill:
   - Server URL: `http://127.0.0.1:8799`
   - Auth token: the token printed by the bridge
   - Source language: `auto` (or a fixed language code)
   - Target language: e.g. `ru`
   - Chunk seconds: start with `5` for stability (lower = faster, higher = fewer repeats)
4) Click **Check server**
5) Click **Start** while the meeting tab is active.

You should see an overlay subtitle box on supported sites.

---

## Optional: local voice playback (TTS)

If enabled, the extension can request `/tts` and play translated speech **locally**.

- This does **not** send audio into the meeting.
- To route it to the meeting, you would need a virtual audio cable/virtual microphone setup (not included here).

In the popup:
- Enable **Speak translations (TTS)**
- Choose a voice (e.g. `onyx`)
- Set speed (e.g. `1.0`)

---

## Quality and false positives

This project includes a “strict mode” option (VAD + filtering) to minimize false translations:
- Drops silent/noisy chunks before calling transcription
- Filters extremely short / likely-gibberish transcripts
- Deduplicates near-identical phrases across chunk boundaries

If you miss quiet speech:
- Reduce the VAD threshold (make it less strict)
- Increase chunk seconds (fewer boundaries)

---

## Troubleshooting

### “Only a single offscreen document may be created”
- MV3 service workers restart; offscreen docs can persist.
- Use the included offscreen handling fix, and reload the extension in `edge://extensions`.

### HTTP 401 from localhost
- Wrong token in popup. Ensure it matches the bridge’s current `LOCAL_SOKUJI_TOKEN`.

### HTTP 400 “Invalid file format”
- Happens when sending non-container fragments.
- Use segment-by-segment recording (stop/start) so each chunk is a complete file.

### No subtitles on Zoom/Teams
- Ensure the extension’s `manifest.json` includes correct `matches` for Zoom/Teams.
- Reload the extension after manifest changes.

### Transcription returns empty text
- Often means silence; increase chunk seconds and/or use a stricter VAD threshold.

---

## Privacy & compliance

- Audio from your calls is transmitted to the OpenAI API for processing.
- Ensure you have the right to record/translate the audio in your jurisdiction and under the platform’s terms.
- Inform participants where required.

---

## Repository layout

- `local-sokuji-bridge/` — Java localhost bridge (Gradle/Maven project)
- `edge-extension/` — Edge/Chrome MV3 extension

---

## Contributing

PRs are welcome. Suggestions:
- Improve VAD and dedupe logic
- Add per-site UI tweaks for Meet/Zoom/Teams
- Add configuration profiles (language presets)
- Add safer local auth (rate limits, per-session tokens)

---

## Roadmap

- Per-site UI improvements (Meet/Zoom/Teams layouts, better positioning, compact mode)
- Better streaming UX (partial hypotheses, smoother updates, fewer boundary artifacts)
- Speaker separation options (where technically feasible)
- Optional “route TTS to meeting mic” mode (requires virtual audio device configuration)
- Configuration profiles (saved presets per language/call type)

## Known issues

- **Boundary repeats:** segmenting audio can repeat phrases near boundaries. Dedupe mitigations help, but are not perfect.
- **False positives:** noise can be transcribed as speech; strict mode reduces this but may miss quiet speakers.
- **Autoplay restrictions:** some browsers block programmatic audio playback; TTS may require user interaction.
- **Site variability:** Zoom/Teams web UIs change often; content-script overlay may require updates.
- **Mixed audio:** tab audio can include system sounds and (in some setups) your own voice via echo/monitoring.

## FAQ

### Does this send audio into the meeting so others can hear it?
No. By default, TTS is played **locally** (your speakers/headphones). Sending TTS into the meeting requires a virtual microphone/virtual audio cable setup, which is not included by default.

### Why do I sometimes see repeated translations?
Because the same words can appear in adjacent segments. Use larger chunk sizes (5–6s) and dedupe logic to reduce repeats.

### Why am I getting translations when nobody is speaking?
Background noise/system sounds can be transcribed as speech. Enable strict mode (VAD) and increase chunk size.

### Is the OpenAI API key stored in the extension?
No. The key is stored only in the local bridge process environment. The extension talks to localhost using a separate local token.

### Can I use languages other than Russian?
Yes. Set `targetLang` to any language code you want (e.g. `en`, `de`, `pl`, `ru`), and set `sourceLang` to `auto` or a fixed language code.

## License

Choose a license before publishing publicly (MIT/Apache-2.0 are common). Until you add a license file, default copyright rules apply.

---

*README generated on 2026-01-13*
