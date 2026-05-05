# Local Meet Translator — English guide

Local Meet Translator is a local translator for web meetings. The desktop app is the control center. The browser extension is a thin client: it shows status, receives commands from the desktop app, and renders subtitles over Meet / Zoom / Teams.

## 1. What the app does

- Shows translated subtitles for the other participant over the meeting page.
- Can optionally speak incoming translations locally for you.
- Can translate your own speech for the other participant: your microphone → transcription → translation → TTS → virtual audio cable → meeting microphone.
- Supports Chrome, Edge, and Firefox through separate extension folders.
- Keeps the OpenAI API key locally in the desktop app, not in the browser extension.
- Supports normal OpenAI TTS and optional RVC / voice conversion if you have a separate voice-conversion server and trained model.

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
  INSTALL_DESKTOP_WINDOWS.cmd
  RUN_DESKTOP_DEV.cmd
  README_RU.md
  README_EN.md
```

## 3. Requirements

For normal Windows usage:

- Windows 10 / 11.
- Node.js LTS — required to build the desktop installer.
- Java 17+ — required for the bridge.
- Google Chrome, Microsoft Edge, or Firefox.
- OpenAI API key.
- VB-Audio Virtual Cable or a similar virtual audio cable — required only if the other participant must hear your translated voice.

For bridge development, Maven is also needed if you rebuild `local-meet-bridge` manually.

## 4. Installing the Windows desktop app

1. Extract the project archive.
2. Double-click:

```text
INSTALL_DESKTOP_WINDOWS.cmd
```

The script builds the desktop app and creates an installer here:

```text
desktop-app\dist\
```

Run the installer named like:

```text
Local Meet Translator-1.0.0-Setup-x64.exe
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

The extension popup does not control translation. It only shows status. Start / Stop live in the desktop app.

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

Important: after replacing extension files, always press **Reload** on the browser extensions page and reload the Meet / Zoom / Teams tab.

## 6. First run

1. Open the desktop app.
2. Paste your `OpenAI API key`.
3. Click **Save .env**.
4. Click **Start bridge**.
5. Open a Meet / Zoom / Teams tab.
6. Click in the desktop app:

```text
Start translation in browser
```

Do not use the extension popup to start translation.

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
ON: my microphone → translation → voice to meeting = ON
My speech source language = your language, for example ru
Meeting target language = other participant language, for example en
My microphone name contains = Realtek / Mikrofon / USB / Headset
Translated voice output name contains = CABLE Input
Advanced microphone device ID = usually empty
Advanced TTS output device ID = usually empty
```

Do not put `CABLE Output` into **My microphone name contains**. That field must identify your real microphone.

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

Enable RVC only if you have a trained model and a running voice-conversion server.

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
