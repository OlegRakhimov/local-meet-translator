import base64
import os
import shlex
import subprocess
import tempfile
from pathlib import Path

from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel

app = FastAPI(title="Local Meet Translator Voice Conversion")


class ConvertRequest(BaseModel):
    audioBase64: str
    audioMime: str = "audio/wav"
    modelTag: str = ""


def _check_token(x_auth_token: str | None) -> None:
    expected = os.getenv("VOICE_CONVERSION_TOKEN", "").strip()
    if expected and x_auth_token != expected:
        raise HTTPException(status_code=401, detail="Missing or invalid X-Auth-Token")


@app.get("/health")
def health(x_auth_token: str | None = Header(default=None)):
    _check_token(x_auth_token)
    return {
        "ok": True,
        "service": "local-meet-translator-voice-conversion",
        "mode": "external-rvc" if os.getenv("RVC_INFER_CMD", "").strip() else "passthrough",
    }


@app.post("/convert")
def convert(req: ConvertRequest, x_auth_token: str | None = Header(default=None)):
    _check_token(x_auth_token)
    try:
        audio = base64.b64decode(req.audioBase64)
    except Exception as exc:
        raise HTTPException(status_code=400, detail="audioBase64 is not valid base64") from exc

    cmd_template = os.getenv("RVC_INFER_CMD", "").strip()
    if not cmd_template:
        return {"ok": True, "audioMime": req.audioMime or "audio/wav", "audioBase64": base64.b64encode(audio).decode("ascii"), "mode": "passthrough"}

    timeout = int(os.getenv("RVC_INFER_TIMEOUT_SEC", "180"))
    with tempfile.TemporaryDirectory(prefix="lmt-rvc-") as td:
        input_path = Path(td) / "input.wav"
        output_path = Path(td) / "output.wav"
        input_path.write_bytes(audio)

        command = cmd_template.format(input=str(input_path), output=str(output_path), modelTag=req.modelTag or "")
        completed = subprocess.run(shlex.split(command), cwd=td, timeout=timeout, capture_output=True, text=True)
        if completed.returncode != 0:
            raise HTTPException(status_code=500, detail={"error": "RVC command failed", "stderr": completed.stderr[-4000:]})
        if not output_path.exists():
            raise HTTPException(status_code=500, detail="RVC command did not create output wav")
        out = output_path.read_bytes()
        return {"ok": True, "audioMime": "audio/wav", "audioBase64": base64.b64encode(out).decode("ascii"), "mode": "external-rvc"}
