"""Cartesia voice: pre-recorded clips (instant playback), on-demand phrases, speech-to-text.

Clips are mp3 files cached by (voice, text) hash under data/audio/, so the same phrase
is only ever generated once per voice. Stock warm voice unless a task has a consented
clone of the supervisor's voice (cloned from their teach video; needs a paid Cartesia plan).
"""
from __future__ import annotations

import hashlib
import io
import json
import os
import threading
import time
import wave
from pathlib import Path

from cartesia import Cartesia

MODEL = "sonic-3.6"
STT_MODEL = "ink-whisper"
FORMAT = {"container": "mp3", "sample_rate": 44100, "bit_rate": 128000}

# Fixed phrases, pre-recorded at startup
PHRASES = {
    "great": "Great!",
    "let_me_look": "Let me look.",
    "help": "Okay, I've let your supervisor know. Help is coming.",
    "all_done": "You did every step. Great work!",
    "not_sure": "I can't see it well. Show me the work again, please.",
    # reinforcement: rotated so praise doesn't sound canned
    "praise_1": "Great job!",
    "praise_2": "Nice work!",
    "praise_3": "You did it!",
    "praise_4": "Well done!",
    "praise_5": "Perfect!",
    "praise_6": "Awesome!",
    "next_step": "Next step.",
    # stuck: gentle, escalating
    "take_your_time": "Take your time.",
    "ask_anytime": "You can ask me a question anytime.",
    "offer_help": "Do you need help? Say help, or press the help button.",
    "keep_going": "You're doing great. Keep going.",
}
PRAISE_KEYS = [f"praise_{i}" for i in range(1, 7)]


class Voice:
    def __init__(self, cache_dir: Path) -> None:
        self.dir = cache_dir
        self.dir.mkdir(parents=True, exist_ok=True)
        self._client: Cartesia | None = None
        self._voice_id: str | None = os.getenv("CARTESIA_VOICE_ID") or None
        self._lock = threading.Lock()
        self.error: str | None = None

    def _c(self) -> Cartesia:
        if self._client is None:
            self._client = Cartesia(api_key=os.getenv("CARTESIA_API_KEY", ""))
        return self._client

    def voice_id(self) -> str:
        with self._lock:
            if self._voice_id is None:
                for v in self._c().voices.list(q="warm", limit=10):
                    if v.language == "en":
                        self._voice_id = v.id
                        break
                self._voice_id = self._voice_id or "f786b574-daa5-4673-aa0c-cbe3e8534c02"
            return self._voice_id

    @staticmethod
    def key(text: str, voice: str | None = None) -> str:
        base = text.strip() if not voice else f"{voice}|{text.strip()}"  # stock voice keeps its old cache keys
        return hashlib.sha1(base.encode()).hexdigest()[:16]

    def path(self, text: str, voice: str | None = None) -> Path:
        return self.dir / f"{self.key(text, voice)}.mp3"

    def url(self, text: str, voice: str | None = None) -> str:
        return f"/files/audio/{self.key(text, voice)}.mp3"

    def ensure(self, text: str, voice: str | None = None) -> str:
        """Generate the clip if missing (in `voice`, a cloned voice id, else the stock voice); return its URL."""
        p = self.path(text, voice)
        if p.exists():
            return self.url(text, voice)
        from cartesia import RateLimitError

        for attempt in range(5):  # free tier allows only a few concurrent requests
            try:
                r = self._c().tts.generate(model_id=MODEL, transcript=text.strip(), voice={"mode": "id", "id": voice or self.voice_id()}, output_format=FORMAT, language="en")
                break
            except RateLimitError:
                if attempt == 4:
                    raise
                time.sleep(0.6 * (attempt + 1))
        tmp = p.with_name(f"{p.stem}.{threading.get_ident()}.tmp")
        tmp.write_bytes(r.read())
        tmp.replace(p)
        return self.url(text)

    def ensure_many(self, texts: list[str], voice: str | None = None) -> dict[str, str]:
        from concurrent.futures import ThreadPoolExecutor

        uniq = list(dict.fromkeys(t for t in texts if t and t.strip()))
        with ThreadPoolExecutor(max_workers=2) as ex:  # Cartesia free tier concurrency
            urls = list(ex.map(lambda t: self.ensure(t, voice), uniq))
        return dict(zip(uniq, urls))

    # ---- voice cloning (consented supervisor voice) ----
    def clone(self, wav: bytes, name: str, description: str) -> str:
        """Cartesia voice clone from a clean speech clip. Returns the new voice id. 402 on the free tier."""
        v = self._c().voices.clone(clip=("supervisor.wav", wav, "audio/wav"), name=name[:60], language="en", description=description[:300])
        return v.id

    def transcribe(self, audio: bytes, filename: str, mime: str) -> tuple[str, float]:
        t0 = time.perf_counter()
        r = self._c().stt.transcribe(file=(filename, audio, mime), model=STT_MODEL, language="en")
        return (getattr(r, "text", "") or "").strip(), (time.perf_counter() - t0) * 1000


def transcribe_words(v: "Voice", data: bytes, filename: str, mime: str):
    """Speech-to-text with word timestamps (works on video files directly). Returns (text, words, ms)."""
    t0 = time.perf_counter()
    r = v._c().stt.transcribe(file=(filename, data, mime), model=STT_MODEL, language="en", timestamp_granularities=["word"])
    return (getattr(r, "text", "") or "").strip(), list(getattr(r, "words", None) or []), (time.perf_counter() - t0) * 1000


def speech_clip(path: Path, words: list, max_s: float = 45.0) -> tuple[bytes, float]:
    """The supervisor's narration as a mono 24 kHz WAV for cloning: from the first spoken word, up to
    max_s seconds (Cartesia: 10 s is enough, up to 60 s keeps the accent). Returns (wav, seconds)."""
    import av  # PyAV: decodes the audio track of mp4/mov/webm without ffmpeg installed

    def t(w, k):
        return (w.get(k) if isinstance(w, dict) else getattr(w, k, None)) or 0.0

    start = max(0.0, (t(words[0], "start") - 0.3) if words else 0.0)
    end = min(start + max_s, (t(words[-1], "end") + 0.3) if words else start + max_s)
    rate = 24000
    out = bytearray()
    with av.open(str(path)) as c:
        if not c.streams.audio:
            raise ValueError("this video has no sound")
        rs = av.AudioResampler(format="s16", layout="mono", rate=rate)
        for frame in c.decode(audio=0):
            ft = float(frame.time or 0.0)
            if ft > end:
                break
            for f in rs.resample(frame):
                if ft + f.samples / rate >= start:
                    out += bytes(f.planes[0])[: f.samples * 2]
    pcm = bytes(out)  # audio frames that end before `start` were skipped above
    seconds = len(pcm) / 2 / rate
    if seconds < 5:
        raise ValueError(f"only {seconds:.0f} s of speech found; record at least 10 s of talking")
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(pcm)
    return buf.getvalue(), seconds


class VoiceRegistry:
    """Cloned voices and their consent records (data/voices.json). Only these ids may be used for speech."""

    def __init__(self, path: Path) -> None:
        self.path = path

    def _all(self) -> dict:
        try:
            return json.loads(self.path.read_text())
        except (OSError, ValueError):
            return {}

    def add(self, voice_id: str, record: dict) -> None:
        d = self._all()
        d[voice_id] = record
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.path.write_text(json.dumps(d, indent=2))

    def get(self, voice_id: str | None) -> dict | None:
        return self._all().get(voice_id) if voice_id else None
