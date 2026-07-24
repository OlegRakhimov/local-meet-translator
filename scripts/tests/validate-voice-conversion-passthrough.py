import base64
import json
import os
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path


def free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def wait_for_health(url: str, timeout_sec: int = 30) -> None:
    deadline = time.time() + timeout_sec
    last_error: Exception | None = None
    while time.time() < deadline:
        try:
            with urllib.request.urlopen(url, timeout=2) as resp:
                if resp.status == 200:
                    return
        except Exception as exc:  # noqa: BLE001 - deliberate polling loop
            last_error = exc
            time.sleep(0.25)
    raise RuntimeError(f"voice-conversion health check did not become ready: {last_error}")


def request_json(url: str, payload: dict[str, object]) -> dict[str, object]:
    body = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=10) as resp:
        return json.loads(resp.read().decode("utf-8"))


def main() -> int:
    repo_root = Path(__file__).resolve().parents[2]
    voice_dir = repo_root / "voice-conversion"
    server_py = voice_dir / "server.py"
    if not server_py.is_file():
        print(f"Missing voice-conversion server: {server_py}", file=sys.stderr)
        return 1

    port = free_port()
    env = os.environ.copy()
    env["VOICE_CONVERSION_HOST"] = "127.0.0.1"
    env["VOICE_CONVERSION_PORT"] = str(port)
    env["VOICE_CONVERSION_TOKEN"] = ""
    env["RVC_INFER_CMD"] = ""

    proc = subprocess.Popen(
        [sys.executable, str(server_py), "--host", "127.0.0.1", "--port", str(port)],
        cwd=str(voice_dir),
        env=env,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    try:
        base_url = f"http://127.0.0.1:{port}"
        wait_for_health(f"{base_url}/health")

        with urllib.request.urlopen(f"{base_url}/health", timeout=10) as resp:
            health = json.loads(resp.read().decode("utf-8"))
        assert health["ok"] is True, health
        assert health["mode"] == "passthrough", health

        audio = b"local-meet-translator-passthrough-test"
        result = request_json(
            f"{base_url}/convert",
            {
                "audioBase64": base64.b64encode(audio).decode("ascii"),
                "audioMime": "audio/wav",
                "modelTag": "ignored",
            },
        )
        assert result["ok"] is True, result
        assert result["mode"] == "passthrough", result
        assert result["audioMime"] == "audio/wav", result
        assert base64.b64decode(result["audioBase64"]) == audio, result

        print("Voice conversion passthrough validation passed.")
        return 0
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=10)
        except subprocess.TimeoutExpired:
            proc.kill()
            proc.wait(timeout=10)


if __name__ == "__main__":
    raise SystemExit(main())
