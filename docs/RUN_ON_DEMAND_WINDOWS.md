# Run the bridge on-demand (Windows)

This project uses a **local localhost bridge** (Java) that the browser extension calls at:

- `http://127.0.0.1:<PORT>`

Because the extension depends on this endpoint, the bridge must be running **while you want translation**.
For an on-demand workflow, you start it **only when you join a call**, then stop it when the call ends.

## Recommended approach (no secrets committed)

1) Create a local `.env` next to the repo root:
   - Copy `.env.example` → `.env`
   - Put your real values into `.env`
   - **Do not commit `.env`** (keep it in `.gitignore`)

2) Build the bridge once (or when code changes):

```powershell
cd local-meet-bridge
mvn -q -DskipTests package
```

3) Start the bridge **when you join a meeting**:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\windows\run-bridge.ps1
```

4) The script prints:
- URL (port)
- TOKEN

Paste the TOKEN into the extension popup and click **Check server**, then **Start**.

5) Stop the bridge when the call ends:
- Close the PowerShell window, or press `Ctrl+C`.

## Where to put secrets

- **Best for GitHub**: keep secrets only in `.env` (ignored) or enter them at runtime.
- Avoid committing any file that contains:
  - `OPENAI_API_KEY=...`
  - `LOCAL_MEET_TRANSLATOR_TOKEN=...`

## If you prefer not to keep an `.env` file

You can set variables only for the current PowerShell window:

```powershell
$env:OPENAI_API_KEY="sk-..."
$env:LOCAL_MEET_TRANSLATOR_TOKEN=([guid]::NewGuid().ToString("N"))
$env:LOCAL_MEET_TRANSLATOR_PORT="8799"
$env:OPENAI_TRANSCRIBE_MODEL="whisper-1"
$env:OPENAI_TEXT_MODEL="gpt-4o-mini"
java -jar local-meet-bridge\target\local-meet-bridge-1.0.0.jar
```

(That keeps secrets out of the filesystem, but you must paste the key each time.)
