## On-demand usage (start only during calls)

This project requires a local Java bridge to be running while you want translation.
Recommended workflow:

1) Build once:
```powershell
cd local-meet-bridge
mvn -q -DskipTests package
```

2) Start the bridge when you join a call:
```powershell
powershell -ExecutionPolicy Bypass -File scripts\windows\run-bridge.ps1
```

3) Copy the printed TOKEN into the extension popup, click **Check server**, then **Start**.

4) Stop when the call ends:
- close the PowerShell window or press `Ctrl+C`.

Secrets:
- Put your `OPENAI_API_KEY` and local token into a local `.env` file (ignored by git),
  or paste the key when the script prompts you.
