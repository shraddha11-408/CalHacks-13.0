"""Kill-test 4: Cartesia streaming TTS through the laptop speaker, plus plan checks.

1. TTS: WebSocket, sonic-3.6, raw pcm_f32le @ 44.1 kHz, chunks played as they
   arrive through sounddevice. Measures time to first audio chunk.
2. STT: batch-transcribe the audio we just generated (ink-whisper) → available?
3. Voice cloning: probe with 1 s of silence. We never clone a real person here.
   A plan/permission error → not on our plan; a clip-validation error → the
   feature is allowed. If it somehow succeeds, the voice is deleted at once.
"""
import io
import time
import wave

import numpy as np
import sounddevice as sd
from cartesia import Cartesia

from common import OUT, env, record

MODEL = "sonic-3.6"
STT_MODEL = "ink-whisper"
SR = 44100
TEXT = ["Hi, I'm your coach. ", "Pick up the blue soap. ", "Put it in the top-left slot."]

client = Cartesia(api_key=env("CARTESIA_API_KEY"))
t: dict[str, float] = {}
extra: dict = {"tts_model": MODEL}

# Stock warm voice (no clone until consent is recorded, AGENTS.md §8)
voice_id = None
try:
    for v in client.voices.list(q="warm", limit=10):
        if v.language == "en":
            voice_id, extra["voice"] = v.id, v.name
            break
except Exception as e:
    extra["voice_list_error"] = str(e)[:120]
voice_id = voice_id or "f786b574-daa5-4673-aa0c-cbe3e8534c02"  # docs quickstart voice
extra.setdefault("voice", voice_id)

# ---------- 1. streaming TTS → speaker ----------
pcm = bytearray()
stream = sd.OutputStream(samplerate=SR, channels=1, dtype="float32")
stream.start()
t0 = time.perf_counter()
first = None
try:
    with client.tts.websocket_connect() as conn:
        ctx = conn.context(
            model_id=MODEL,
            voice={"mode": "id", "id": voice_id},
            output_format={"container": "raw", "encoding": "pcm_f32le", "sample_rate": SR},
        )
        for part in TEXT:
            ctx.push(part)
        ctx.no_more_inputs()
        for resp in ctx.receive():
            if resp.type == "chunk" and resp.audio:
                if first is None:
                    first = (time.perf_counter() - t0) * 1000
                pcm.extend(resp.audio)
                stream.write(np.frombuffer(resp.audio, dtype=np.float32))
            elif resp.type == "done":
                break
except Exception as e:
    stream.close()
    raise SystemExit(record("cartesia", "fail", f"TTS websocket failed: {type(e).__name__}: {str(e)[:160]}", t, extra))
t["tts_first_chunk"] = first or 0
t["tts_total"] = (time.perf_counter() - t0) * 1000
stream.stop()
stream.close()
audio = np.frombuffer(bytes(pcm), dtype=np.float32)
extra["tts_audio_s"] = round(len(audio) / SR, 2)

# Save as 16-bit WAV for STT (and for listening back; gitignored)
wav_buf = io.BytesIO()
with wave.open(wav_buf, "wb") as w:
    w.setnchannels(1)
    w.setsampwidth(2)
    w.setframerate(SR)
    w.writeframes((np.clip(audio, -1, 1) * 32767).astype("<i2").tobytes())
(OUT / "cartesia_tts.wav").write_bytes(wav_buf.getvalue())

# ---------- 2. STT availability ----------
try:
    t1 = time.perf_counter()
    tr = client.stt.transcribe(file=("tts.wav", wav_buf.getvalue(), "audio/wav"), model=STT_MODEL, language="en")
    t["stt_batch"] = (time.perf_counter() - t1) * 1000
    extra["stt"] = "available"
    extra["stt_text"] = (getattr(tr, "text", "") or "")[:120]
except Exception as e:
    extra["stt"] = f"unavailable: {type(e).__name__}: {str(e)[:120]}"

# ---------- 3. voice-cloning availability (silence probe) ----------
silence = io.BytesIO()
with wave.open(silence, "wb") as w:
    w.setnchannels(1)
    w.setsampwidth(2)
    w.setframerate(16000)
    w.writeframes(b"\x00\x00" * 16000)
try:
    v = client.voices.clone(clip=("silence.wav", silence.getvalue(), "audio/wav"), name="stepwise-plan-probe", language="en")
    client.voices.delete(v.id)
    extra["clone"] = "available (probe voice deleted)"
except Exception as e:
    code = getattr(e, "status_code", None)
    msg = str(e)[:160]
    if code in (401, 402, 403) or any(s in msg.lower() for s in ("plan", "upgrade", "subscription", "not allowed", "forbidden")):
        extra["clone"] = f"NOT on plan ({code}): {msg}"
    else:
        extra["clone"] = f"available (probe rejected as expected, {code}): {msg[:100]}"

stt_ok = extra["stt"] == "available"
clone_ok = extra["clone"].startswith("available")
detail = f"TTS first audio {t['tts_first_chunk']:.0f} ms ({extra['tts_audio_s']} s spoken); STT {'yes' if stt_ok else 'no'}; clone {'yes' if clone_ok else 'NO'}"
status = "pass" if first and stt_ok and clone_ok else ("partial" if first else "fail")
raise SystemExit(record("cartesia", status, detail, t, extra))
