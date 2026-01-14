# On-demand bridge run (Windows)

If the extension shows `TypeError: Failed to fetch`, the localhost bridge is usually not running.

## Run
From repo root:

```powershell
scripts\windows\run-bridge.cmd
```

or:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\windows\run-bridge.ps1
```

The script prints:
- URL (port)
- TOKEN

Paste the TOKEN into the extension popup, click **Check server**, then **Start**.

## Secrets
Put secrets in a local `.env` (not committed), or paste the key when prompted.

Example `.env`:

```ini
OPENAI_API_KEY=sk-...
LOCAL_MEET_TRANSLATOR_PORT=8799
LOCAL_MEET_TRANSLATOR_TOKEN=your-token
OPENAI_TRANSCRIBE_MODEL=whisper-1
OPENAI_TEXT_MODEL=gpt-4o-mini
```
