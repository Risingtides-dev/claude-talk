"""Persistent whisper daemon. Loads the model once, serves transcriptions over
HTTP. Avoids the uvx subprocess cold-start on every request."""

from __future__ import annotations

import os
import tempfile
import time
from pathlib import Path

import mlx_whisper
from fastapi import FastAPI, File, UploadFile
from fastapi.responses import JSONResponse

MODEL = os.environ.get("WHISPER_MODEL", "mlx-community/whisper-large-v3-turbo")

app = FastAPI()


@app.get("/healthz")
def healthz():
    return {"ok": True, "model": MODEL}


@app.post("/transcribe")
async def transcribe(audio: UploadFile = File(...)):
    started = time.time()
    suffix = Path(audio.filename or "clip.wav").suffix or ".wav"
    raw = await audio.read()
    if not raw:
        return JSONResponse({"error": "empty audio"}, status_code=400)
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=True) as tmp:
        tmp.write(raw)
        tmp.flush()
        try:
            result = mlx_whisper.transcribe(tmp.name, path_or_hf_repo=MODEL)
        except Exception as exc:  # noqa: BLE001
            return JSONResponse({"error": str(exc)}, status_code=500)
    text = (result.get("text") or "").strip()
    ms = int((time.time() - started) * 1000)
    return {"text": text, "ms": ms}


# Pre-warm: trigger a tiny load so the first user request is fast.
@app.on_event("startup")
async def warm():  # noqa: D401
    print(f"[stt] loading model {MODEL} ...", flush=True)
    try:
        # Tiny 0.1s of silence to force model load without a real file.
        import numpy as np  # type: ignore

        silence = np.zeros(1600, dtype=np.float32)
        mlx_whisper.transcribe(silence, path_or_hf_repo=MODEL)
        print("[stt] model loaded", flush=True)
    except Exception as exc:  # noqa: BLE001
        print(f"[stt] warm-up failed (non-fatal): {exc}", flush=True)
