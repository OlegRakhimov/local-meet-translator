# local-meet-translator

A self-hosted prototype that provides **near real-time subtitles and translation** for web calls (Google Meet / Zoom Web / Microsoft Teams Web) by capturing **tab audio**, transcribing it, translating it, and showing an on-page overlay. Optional: **local TTS** (the translated speech is played on your own device).

This repository is designed so that the **OpenAI API key is not stored in the browser extension**. The key stays on your machine in a local bridge service.

---

## What this project does

- Captures **tab audio output** (what you hear in the call).
- Sends short audio segments to a **localhost Java bridge**.
- The bridge calls OpenAI for:
  - transcription (audio → text),
  - translation (text → target language),
  - optional TTS (text → speech audio).
- Displays translated subtitles as an overlay on supported sites.
- Optional: plays translated speech **locally** (your speakers/headphones).

---

## Architecture

**Two components:**

1) **Browser extension (MV3)**
- Captures tab audio (`tabCapture` + `offscreen`)
- Shows overlay subtitles via content script
- (Optional) Requests TTS audio from the bridge and plays it locally

2) **Local Java bridge (localhost)**
- Runs on your machine (default `http://127.0.0.1:8799`)
- Holds your OpenAI API key in environment variables
- Exposes endpoints to the extension:
  - `GET /health`
  - `POST /transcribe-and-translate`
  - `POST /translate-text` (testing)
  - `POST /tts` (optional)

---

## Supported platforms

- Google Meet (web)
- Zoom (web)
- Microsoft Teams (web)

Note: The overlay depends on `content_scripts` match patterns. If a site changes its URL structure, the manifest may need an update.

---

## Security model (important)

- **Never commit secrets** to Git.
- The bridge reads the OpenAI key from `OPENAI_API_KEY`.
- The extension authenticates to the local bridge using a local token (`LOCAL_MEET_TRANSLATOR_TOKEN`) sent as header `X-Auth-Token`.
- Keep the bridge bound to `127.0.0.1` only.

---

## Requirements

- Windows 11 (tested; macOS/Linux should work with minor path changes)
- Microsoft Edge (or Chrome/Chromium)
- Java 21+
- Maven 3.9+
- OpenAI API key

---

## Quick start (on-demand: run only during calls)

### 1) Prepare local configuration (no secrets committed)

This repo includes `.env.example`. Do this:

1. Copy `.env.example` → `.env` (local only)
2. Fill your values into `.env`

`.env` **must not** be committed. Ensure `.gitignore` contains:

```gitignore
.env
```

**Tip (recommended):** put a stable `LOCAL_MEET_TRANSLATOR_TOKEN` in `.env`.  
Then you won’t need to change the token in the extension popup each time you start the bridge.

### 2) Build the bridge once

```powershell
cd local-meet-bridge
mvn -q -DskipTests package
```

### 3) Start the bridge when you join a call

From the repo root:

#### Option A (recommended): run the PowerShell script
```powershell
powershell -ExecutionPolicy Bypass -File scripts\windows\run-bridge.ps1
```

#### Option B: run the .cmd wrapper (double-click or from terminal)
```powershell
scripts\windows\run-bridge.cmd
```

**What the .cmd does:** it simply calls the PowerShell script.  
You do not put your key into the .cmd. Secrets live in `.env` (or you paste the key when prompted).

The script prints:
- URL (port)
- TOKEN

Keep that window open while you translate. Close it (or press `Ctrl+C`) when the call ends.

### 4) Load the extension into Edge

1. Open: `edge://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select folder: `edge-extension`

### 5) Use in Meet / Zoom / Teams

1. Join a call in the browser tab.
2. Click the extension icon (popup).
3. Fill:
   - Server URL: `http://127.0.0.1:8799`
   - Auth token: your `LOCAL_MEET_TRANSLATOR_TOKEN`
   - Source language: `auto` (or fixed: `en`, `de`, `pl`, ...)
   - Target language: e.g. `ru` / `en` / `de` / `pl`
   - Chunk seconds: start with `5` (stable)
4. Click **Check server**
5. Click **Start** (while the call tab is active)

Stop:
- Click **Stop** in the popup
- Then stop the bridge (close PowerShell window or `Ctrl+C`)

---

## Languages

- `sourceLang`: spoken language in the call (`auto` or fixed: `en`, `de`, `pl`, ...)
- `targetLang`: language you want to read/hear (`ru`, `en`, `de`, `pl`, ...)

`auto` is convenient but may mis-detect in mixed/noisy calls. If your calls are consistently one language, set it explicitly.

---

## Optional: local TTS (voice)

If enabled, the extension can request `/tts` and play translated speech **locally**.

- This does **not** send audio into the meeting.
- To route TTS into a meeting, you need a virtual microphone/virtual audio cable setup (out of scope by default).

Enable in `.env`:
```ini
ENABLE_TTS=true
OPENAI_TTS_MODEL=gpt-4o-mini-tts
OPENAI_TTS_VOICE=onyx
OPENAI_TTS_FORMAT=mp3
OPENAI_TTS_SPEED=1.0
```

---

## Troubleshooting

### “Failed to fetch” in the extension
- The bridge is not running, or the port is wrong, or URL in popup is wrong.
- Verify:
```powershell
curl.exe http://127.0.0.1:8799/health -H "X-Auth-Token: <YOUR_TOKEN>"
```

### “Missing or invalid X-Auth-Token”
- Your popup token does not match the bridge token.
- If you let the script generate a new token each time, you must paste the new token into the popup each run.
- Recommended: set a stable `LOCAL_MEET_TRANSLATOR_TOKEN` in `.env`.

### No subtitles / unclear behavior
- Increase `Chunk seconds` to `5–6`
- Ensure the call tab is active when you click **Start**
- Ensure the call actually has audio output (you can hear participants)
- Reload the extension after updating files: `edge://extensions` → **Reload**

### Repeats
- Segment boundaries can repeat phrases; dedupe helps but is not perfect.
- Increase chunk seconds (5–6) to reduce boundary frequency.

---

## What to commit vs what NOT to commit

Commit (safe):
- `.env.example`
- `scripts/`
- `docs/`
- code in `edge-extension/` and `local-meet-bridge/`

Do NOT commit:
- `.env`
- anything containing real `OPENAI_API_KEY=...`
- build outputs like `**/target/` and `**/build/`

---

## How to add the on-demand scripts to your GitHub repo

1) Unzip the provided pack into the repo root so you have:
- `.env.example`
- `scripts/windows/run-bridge.ps1`
- `scripts/windows/run-bridge.cmd`
- `docs/RUN_ON_DEMAND_WINDOWS.md`

2) Ensure `.env` is in `.gitignore` (already recommended above).

3) Commit and push:

```powershell
git add -A
git commit -m "Add on-demand bridge run scripts (no secrets)"
git push
```

---

## License

See `LICENSE`.

---

*Updated: 2026-01-13*
