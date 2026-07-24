# Local Meet Translator — English guide

Local Meet Translator is a local translator for web meetings. The desktop app is the control center. The browser extension is a thin client: it shows status, receives commands from the desktop app, and renders subtitles over Meet / Zoom / Teams.

## 1. What the app does

- Shows translated subtitles for the other participant over the meeting page.
- Can optionally speak incoming translations locally for you.
- Can translate your own speech for the other participant: your microphone → transcription → translation → TTS → virtual audio cable → meeting microphone.
- Supports Chrome, Edge, and Firefox through separate extension folders.
- Keeps the OpenAI API key locally in the desktop app, not in the browser extension.
- Supports normal OpenAI TTS and a bundled voice-conversion service; actual RVC additionally requires a trained model and a configured external inference command.

## 2. Project structure

```text
local-meet-translator/
  desktop-app/              Electron desktop app
  local-meet-bridge/         Java bridge for OpenAI API
  chrome-extension/          Chrome extension
  edge-extension/            Edge extension
  firefox-extension/         Firefox extension
  voice-conversion/          optional RVC / voice conversion server
  docs/                      additional materials / landing page
  BUILD_DESKTOP_WINDOWS.cmd
  INSTALL_DESKTOP_WINDOWS.cmd
  RUN_DESKTOP_DEV.cmd
  README_RU.md
  README_EN.md
```

## 3. Requirements

For normal Windows usage:

- Windows 10 / 11.
- Google Chrome, Microsoft Edge, or Firefox 142+.
- OpenAI API key.
- VB-Audio Virtual Cable or a similar virtual audio cable — required only if the other participant must hear your translated voice.
- Java and Python do not need to be installed: the installer contains a minimal Java runtime and a standalone voice-conversion service.

To build from source:

- Node.js 20+.
- JDK 21 with `jdeps` and `jlink`.
- Python x64 3.11, 3.12, or 3.13.
- Maven does not need to be installed: Maven Wrapper pins and downloads Maven 3.9.16.

Run the complete build with one command from the project root:

```text
BUILD_DESKTOP_WINDOWS.cmd
```

It builds the bridge through Maven Wrapper, creates a minimal Java runtime with `jdeps`/`jlink`, packages the Python service as an `.exe` with PyInstaller, installs the exact npm dependency tree with `npm ci`, and only then starts electron-builder. `INSTALL_DESKTOP_WINDOWS.cmd` invokes the same build and then opens the output directory.

Electron and electron-builder are intentionally pinned in `desktop-app/package.json`; do not bump them casually. The `desktop-app/npm-overrides/temp` shim is a temporary workaround for the old `electron-winstaller` chain so the build can avoid the deprecated `rimraf@2.6.3` path without breaking packaging.

## 4. Installing the Windows desktop app

1. Extract the project archive.
2. Double-click:

```text
BUILD_DESKTOP_WINDOWS.cmd
```

The script builds the desktop app and creates an installer here:

```text
desktop-app\dist\
```

Run the installer named like:

```text
Local Meet Translator-1.0.7-Setup-x64.exe
```

After installation, a **Local Meet Translator** shortcut appears on the desktop and in the Start menu.

The config file is stored here:

```text
%APPDATA%\Local Meet Translator\.env
```

Usually:

```text
C:\Users\<user>\AppData\Roaming\Local Meet Translator\.env
```

## 5. Installing browser extensions

The extension popup pairs the browser extension with the desktop app and connects the current meeting tab. Start / Stop still live in the desktop app.

### Chrome

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select:

```text
chrome-extension
```

### Edge

1. Open `edge://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select:

```text
edge-extension
```

### Firefox

1. Open `about:debugging#/runtime/this-firefox`.
2. Click **Load Temporary Add-on**.
3. Select:

```text
firefox-extension/manifest.json
```

Firefox uses a dedicated architecture: a page bridge intercepts incoming WebRTC audio tracks in Meet / Zoom / Teams, while a persistent background page sends audio chunks to the bridge and handles microphone capture and TTS. The Firefox extension does not use Chromium `offscreen`/`tabCapture`. It captures meeting WebRTC audio only, not arbitrary system audio.

Firefox 142 or newer is required. During installation, Firefox shows built-in consent for transmitting the token and conference audio to the local desktop service.

Important: after replacing extension files, always press **Reload** on the browser extensions page and reload the Meet / Zoom / Teams tab.

## 6. First run

1. Open the desktop app.
2. Paste your `OpenAI API key`.
3. Click **Save .env**.
4. Click **Start bridge**.
5. Open a Meet / Zoom / Teams tab.
6. Copy the **pairing code** shown in the desktop app, open the extension popup on that meeting tab, paste the code, and click **Pair with desktop**.
7. Click **Connect this meeting tab** in the popup.
8. In the desktop app, choose **Start voice translation for the other participant** or **Start subtitles only**.

The popup does not start translation. It only pairs the extension with the desktop app and identifies the exact meeting tab that the desktop app should control.

## 7. Language settings

The default incoming target language is English:

```text
Incoming target language = en
```

Useful language codes:

```text
en — English
ru — Russian
pl — Polish
de — German
es — Spanish
it — Italian
auto — source language auto-detection
```

Recommended incoming subtitle setup:

```text
Incoming source language = auto
Incoming target language = en or your preferred language
```

For your outgoing translated voice:

```text
My speech source language = ru / pl / de / es / it / en
Meeting target language = en / ru / pl / de / es / it
```

## 8. Subtitles for you

For subtitles, configure incoming translation:

```text
Incoming source language = auto
Incoming target language = subtitle language
Speak incoming translations locally = OFF, unless you want local TTS for yourself
```

Then run:

```text
Start bridge
Start translation in browser
```

Subtitles appear over Meet / Zoom / Teams in the **Local Meet Translator** overlay.

## 9. Outgoing translated voice for the other participant

This is a separate feature. It lets the other participant hear translated speech instead of your original microphone audio.

Correct routing:

```text
Your physical microphone
→ Local Meet Translator
→ translation
→ TTS
→ CABLE Input
→ CABLE Output
→ Google Meet / Zoom / Teams microphone
→ other participant
```

### Desktop settings

In the outgoing voice block:

```text
My speech source language = your language, for example ru
Meeting target language = other participant language, for example en
My microphone name contains = Realtek / Mikrofon / USB / Headset
Translated voice output name contains = CABLE Input
Advanced microphone device ID = usually empty
Advanced TTS output device ID = usually empty
```

Do not put `CABLE Output` into **My microphone name contains**. That field must identify your real microphone.

Before starting, confirm **I selected CABLE Output as the microphone in Zoom / Meet / Teams**, then click the single green **Start voice translation for the other participant** button. No additional Start button is required.

Voice translation is actually active only when the status panel is green and confirms that the bridge, meeting tab, physical microphone, and CABLE Input output are ready.

### Google Meet settings

In Google Meet → Settings → Audio:

```text
Microphone = CABLE Output
Speakers = normal headphones or speakers
```

In other words:

```text
Desktop plays TTS to CABLE Input.
Meet uses CABLE Output as the microphone.
```

If Meet is still using your normal microphone, the other participant will not hear the translated voice.

## 10. Voice conversion / RVC

Voice conversion is not translation and not TTS. It is an optional step that changes the generated TTS voice into a trained voice model.

Normal mode without RVC:

```text
speech → translation → OpenAI TTS → other participant hears a synthetic voice
```

Mode with RVC:

```text
speech → translation → OpenAI TTS → RVC model → other participant hears a voice similar to your model
```

RVC is not required for normal outgoing translated voice. Recommended default:

```text
Enable TTS for outgoing translated voice = ON
Enable voice conversion / RVC hook = OFF
Outgoing voice style = OpenAI voice
```

Enable RVC only if you have a trained model and configured `RVC_INFER_CMD`. The voice-conversion server itself is bundled with the desktop application.

Treat the desktop Electron versions as locked release inputs, not ordinary dependencies.

## 11. Updating the project

If the desktop app changed:

1. Close Local Meet Translator.
2. End old `java.exe`, `javaw.exe`, `node.exe`, `electron.exe` processes if they remain.
3. Uninstall the old app through Windows → Apps → Installed apps.
4. Run `INSTALL_DESKTOP_WINDOWS.cmd`.
5. Install the new `.exe` from `desktop-app\dist`.
6. Reload the browser extension.
7. Reload the meeting tab.

If only the extensions changed:

1. Stop translation in the desktop app.
2. Replace the relevant extension folder.
3. Press **Reload** on the browser extensions page.
4. Reload the meeting tab.
5. Start translation from the desktop app.

## 12. Troubleshooting

### Popup still shows Start / Connect buttons

An old extension folder is loaded. Remove the extension and load the correct folder again:

```text
chrome-extension / edge-extension / firefox-extension
```

### Log says: Extension has not been invoked for the current page

The active tab is not Meet / Zoom / Teams, or the browser did not grant `activeTab`. Open the real meeting tab, reload it, and start translation from the desktop app.

### Subtitles work, but the other participant does not hear translated voice

Check the route:

```text
Desktop: Translated voice output name contains = CABLE Input
Meet: Microphone = CABLE Output
Desktop: My microphone name contains = Realtek / Mikrofon / USB / Headset
```

`CABLE Output` must be selected in Meet, not as the source for recognizing your own speech.

### You hear the translated voice yourself, but the other participant does not

TTS is going to normal speakers instead of `CABLE Input`. Set:

```text
Translated voice output name contains = CABLE Input
```

### Outgoing voice is too fragmented

This version collects microphone speech until a short pause and sends a phrase instead of fixed tiny chunks. If it still cuts speech, set `Mic chunk seconds` to `5` and pause briefly after complete sentences.

### Voice conversion is red / ECONNREFUSED

The voice-conversion server is not running. For normal translation, disable RVC:

```text
Enable voice conversion / RVC hook = OFF
Outgoing voice style = OpenAI voice
```

## 13. Security

The OpenAI API key is stored locally in the desktop app `.env` file. It should not be copied into the browser extension and should not be included in archives shared with other people.

## 14. Local protected subtitle window

Starting with desktop version `1.0.8`, incoming subtitles are no longer injected into the Google Meet, Zoom, or Teams page DOM. The extension sends transcript and translation events to the local desktop app, and Electron renders them in a separate window.

Data flow:

```text
tab audio → extension → Java bridge → extension → localhost:18798/extension/subtitle → protected Electron window
```

The **Local subtitle window** section provides:

- enable/disable;
- always-on-top;
- capture protection;
- click-through mode;
- original and translated text controls;
- font size;
- background opacity;
- maximum visible lines;
- a local protection self-test.

Default shortcuts:

```text
Ctrl+Shift+S — show or hide the subtitle window
Ctrl+Shift+X — toggle click-through mode
```

On Windows, Electron applies the operating-system window protection before sensitive subtitle content is loaded. The desktop status reports whether protection was actually applied.

For maximum reliability, share a browser tab or a specific meeting window. Entire-screen behavior depends on Windows and the capture application. The built-in self-test is useful, but it does not replace a manual Google Meet, Zoom, or Teams preview test.

## 15. Stage 3: repeat suppression and candidate profile

Desktop `1.0.9` and extensions `1.6.9` add two layers of incoming subtitle repeat suppression:

1. the extension keeps a short incoming phrase history and avoids re-sending a phrase from a later audio chunk;
2. the desktop app checks events again by meeting tab, extension client and translation channel before rendering them.

A genuine longer completion is preserved: it replaces the earlier partial line instead of creating another subtitle line. Translation models, languages and translated wording are not changed by this logic.

### Candidate profile

The desktop app now includes **Candidate Profile and Confirmed Facts**. Data is stored locally at:

```text
%APPDATA%\Local Meet Translator\candidate-profile.json
```

The profile contains identity, target role, location, languages, skills, experience, projects, education, imported resume text and factual statements.

Facts have two independent flags:

- `confirmed` — reviewed by the user and eligible for future assistant grounding;
- `locked` — must not be automatically rewritten or replaced.

This stage imports `JSON`, `TXT` and `MD`. Text documents are loaded only for manual review. The app does not automatically convert resume text into facts and does not send the profile to OpenAI when it is saved.

PDF and DOCX text extraction will be added in a separate stage after the profile and answer-library workflow is stable.

## 16. Stage 4: focused profile and Answer Library screens

Desktop `1.0.10` reduces the main controller page and moves interview data into focused in-app screens.

The main page now keeps compact cards for:

- **Candidate profile** — identity, target role and confirmed-fact count;
- **Answer Library** — saved and locked answer counts.

**Open profile** navigates to a dedicated screen inside the same desktop window. The existing profile file is preserved without migration:

```text
%APPDATA%\Local Meet Translator\candidate-profile.json
```

Profile groups are collapsible: basic information, skills and education, experience and projects, imported source, and confirmed facts. Leaving the screen or closing the app with unsaved changes produces a warning.

### Answer Library

Reviewed answers are stored locally at:

```text
%APPDATA%\Local Meet Translator\answer-library.json
```

Each entry contains the interview question, intent/category, English level (`A2`, `B1`, `B2`), answer style (`simple`, `technical`, `STAR`, `general`), prepared answer, first sentence, keywords, grounding facts and a `locked` flag.

Stage 4 is manual-only: the app does not generate answers or send them to OpenAI. The library can be imported from or exported to JSON.
