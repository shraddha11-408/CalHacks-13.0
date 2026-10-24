"""Cartesia voice: pre-recorded clips (instant playback), on-demand phrases, speech-to-text.

Clips are mp3 files cached by text hash under data/audio/, so the same phrase
is only ever generated once. Stock warm voice until a consented clone exists
(cloning needs a paid Cartesia plan — see kill-test results).
"""
from __future__ import annotations

import hashlib
import os
import threading
import time
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
}


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
    def key(text: str) -> str:
        return hashlib.sha1(text.strip().encode()).hexdigest()[:16]

    def path(self, text: str) -> Path:
        return self.dir / f"{self.key(text)}.mp3"

    def url(self, text: str) -> str:
        return f"/files/audio/{self.key(text)}.mp3"

    def ensure(self, text: str) -> str:
        """Generate the clip if missing; return its URL."""
        p = self.path(text)
        if p.exists():
            return self.url(text)
        from cartesia import RateLimitError

        for attempt in range(5):  # free tier allows only a few concurrent requests
            try:
                r = self._c().tts.generate(model_id=MODEL, transcript=text.strip(), voice={"mode": "id", "id": self.voice_id()}, output_format=FORMAT, language="en")
                break
            except RateLimitError:
                if attempt == 4:
                    raise
                time.sleep(0.6 * (attempt + 1))
        tmp = p.with_name(f"{p.stem}.{threading.get_ident()}.tmp")
        tmp.write_bytes(r.read())
        tmp.replace(p)
        return self.url(text)

    def ensure_many(self, texts: list[str]) -> dict[str, str]:
        from concurrent.futures import ThreadPoolExecutor

        uniq = list(dict.fromkeys(t for t in texts if t and t.strip()))
        with ThreadPoolExecutor(max_workers=2) as ex:  # Cartesia free tier concurrency
            urls = list(ex.map(self.ensure, uniq))
        return dict(zip(uniq, urls))

    def transcribe(self, audio: bytes, filename: str, mime: str) -> tuple[str, float]:
        t0 = time.perf_counter()
        r = self._c().stt.transcribe(file=(filename, audio, mime), model=STT_MODEL, language="en")
        return (getattr(r, "text", "") or "").strip(), (time.perf_counter() - t0) * 1000


def transcribe_words(v: "Voice", data: bytes, filename: str, mime: str):
    """Speech-to-text with word timestamps (works on video files directly). Returns (text, words, ms)."""
    t0 = time.perf_counter()
    r = v._c().stt.transcribe(file=(filename, data, mime), model=STT_MODEL, language="en", timestamp_granularities=["word"])
    return (getattr(r, "text", "") or "").strip(), list(getattr(r, "words", None) or []), (time.perf_counter() - t0) * 1000
