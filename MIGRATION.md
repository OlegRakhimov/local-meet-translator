# Migration: remove "sokuji" naming

This repo is named **local-meet-translator**. Older iterations used "sokuji" naming (folder, package, env vars).
This guide removes it while keeping backwards compatibility.

## 1) Rename the bridge folder
From repo root:

```powershell
git mv local-sokuji-bridge local-meet-bridge
```

## 2) Replace Java package and entrypoint
Old: `package local.sokuji;`
New: `package local.meettranslator;`

This pack includes the updated `Main.java` under:
`local-meet-bridge/src/main/java/local/meettranslator/Main.java`

Remove old folder after applying:
`local-meet-bridge/src/main/java/local/sokuji/`

## 3) Environment variables (preferred)
- `LOCAL_MEET_TRANSLATOR_PORT`
- `LOCAL_MEET_TRANSLATOR_TOKEN`

Backwards-compatible fallbacks still supported:
- `LOCAL_SOKUJI_PORT`
- `LOCAL_SOKUJI_TOKEN`

## 4) Extension branding
The extension is renamed to **Local Meet Translator** and overlay text updated.

Reload the extension in `edge://extensions` after replacing files.

