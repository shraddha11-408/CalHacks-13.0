"""Laptop side: read the Pi's /audio stream (16 kHz mono s16le) and report rate and level.

  python3 audio_receiver.py http://<pi-ip>:8000/audio                    # 10 s, print stats
  python3 audio_receiver.py http://<pi-ip>:8000/audio --save a.wav       # also save a WAV
  python3 audio_receiver.py http://<pi-ip>:8000/audio --meter            # live level bars, Ctrl-C to stop

For your own code: `for chunk in iter_pcm(url): ...` yields 100 ms numpy int16 arrays, ready for STT.
"""
import argparse
import http.client
import time
import wave
from urllib.parse import urlparse

import numpy as np

RATE = 16000


def iter_pcm(url: str, chunk_bytes: int = 3200, timeout: float = 5.0):
    """Yield (int16 samples, arrival_monotonic) for every 100 ms of audio."""
    u = urlparse(url)
    conn = http.client.HTTPConnection(u.hostname, u.port or 80, timeout=timeout)
    conn.request("GET", u.path or "/audio")
    resp = conn.getresponse()
    if resp.status != 200:
        raise ConnectionError(f"HTTP {resp.status}")
    try:
        while True:
            data = resp.read(chunk_bytes)
            if len(data) < chunk_bytes:
                raise ConnectionError("audio stream closed")
            yield np.frombuffer(data, np.int16), time.monotonic()
    finally:
        conn.close()


def dbfs(x: np.ndarray) -> float:
    rms = np.sqrt(np.mean((x.astype(np.float64) / 32768) ** 2))
    return 20 * np.log10(rms) if rms > 0 else -120.0


def run(url: str, seconds: float = 10.0, save: str = None):
    chunks, arrivals = [], []
    t0 = time.monotonic()
    for pcm, t in iter_pcm(url):
        chunks.append(pcm)
        arrivals.append(t)
        if time.monotonic() - t0 >= seconds:
            break
    audio = np.concatenate(chunks)
    span = arrivals[-1] - arrivals[0]
    levels = [dbfs(c) for c in chunks]
    gaps = np.diff(arrivals) * 1000
    if save:
        with wave.open(save, "wb") as w:
            w.setnchannels(1)
            w.setsampwidth(2)
            w.setframerate(RATE)
            w.writeframes(audio.tobytes())
    return {
        "seconds": len(audio) / RATE,
        "realtime": (len(audio) - len(chunks[0])) / RATE / span if span else 0.0,  # 1.0 = no loss, no backlog
        "peak_dbfs": dbfs(np.array([np.abs(audio).max()])),
        "loudest_dbfs": max(levels),
        "quietest_dbfs": min(levels),
        "clipping": bool(np.abs(audio).max() >= 32760),
        "gap_ms_p50": float(np.median(gaps)) if len(gaps) else 0.0,
        "gap_ms_p99": float(np.percentile(gaps, 99)) if len(gaps) else 0.0,
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("url")
    ap.add_argument("--seconds", type=float, default=10.0)
    ap.add_argument("--save")
    ap.add_argument("--meter", action="store_true")
    a = ap.parse_args()
    if a.meter:
        try:
            for pcm, _ in iter_pcm(a.url):
                lvl = dbfs(pcm)
                print(f"\r{lvl:6.1f} dBFS " + "#" * max(0, int((lvl + 70) / 2)) + " " * 40, end="", flush=True)
        except KeyboardInterrupt:
            print()
        return
    s = run(a.url, a.seconds, a.save)
    print(f"{s['seconds']:.1f} s  rate {s['realtime']:.2f}x realtime  peak {s['peak_dbfs']:.1f} dBFS  "
          f"loudest 100 ms {s['loudest_dbfs']:.1f}  quietest {s['quietest_dbfs']:.1f}  "
          f"clipping: {'yes' if s['clipping'] else 'no'}  chunk gap p50/p99 {s['gap_ms_p50']:.0f}/{s['gap_ms_p99']:.0f} ms")
    if a.save:
        print(f"saved {a.save}")


if __name__ == "__main__":
    main()
