"""Laptop microphone capture (interim voice input until the DJI mic reaches the Pi).

Uses ffmpeg's avfoundation input, so there is no Python audio dependency beyond numpy.
Audio is 16 kHz mono 16-bit, the format speech-to-text engines expect.

  python3 mac_mic.py --list                 # show input devices
  python3 mac_mic.py --seconds 5 --save a.wav   # record, print level, optionally save
  python3 mac_mic.py --meter                # live level bars (Ctrl-C to stop)

macOS asks for microphone permission for the app running this (Terminal, iTerm, the IDE).
"""
import argparse
import re
import subprocess
import sys
import wave

import numpy as np

RATE = 16000
CHUNK = RATE // 10  # 100 ms


def list_devices() -> list[tuple[int, str]]:
    out = subprocess.run(
        ["ffmpeg", "-hide_banner", "-f", "avfoundation", "-list_devices", "true", "-i", ""],
        capture_output=True, text=True,
    ).stderr
    audio = out.split("AVFoundation audio devices:")[-1]
    return [(int(i), n.strip()) for i, n in re.findall(r"\[(\d+)\] (.+)", audio)]


def stream(device: int = 0):
    """Yield 100 ms int16 numpy chunks from the laptop mic until the caller stops iterating."""
    proc = subprocess.Popen(
        ["ffmpeg", "-hide_banner", "-loglevel", "error", "-f", "avfoundation", "-i", f":{device}",
         "-ac", "1", "-ar", str(RATE), "-f", "s16le", "-"],
        stdout=subprocess.PIPE,
    )
    try:
        while True:
            data = proc.stdout.read(CHUNK * 2)
            if len(data) < CHUNK * 2:
                raise RuntimeError("mic stream ended (permission denied or device unplugged?)")
            yield np.frombuffer(data, np.int16)
    finally:
        proc.kill()


def dbfs(x: np.ndarray) -> float:
    rms = np.sqrt(np.mean((x.astype(np.float64) / 32768) ** 2))
    return 20 * np.log10(rms) if rms > 0 else -120.0


def record(seconds: float, device: int = 0) -> np.ndarray:
    chunks = []
    for c in stream(device):
        chunks.append(c)
        if len(chunks) * CHUNK >= seconds * RATE:
            break
    return np.concatenate(chunks)


def save_wav(path: str, audio: np.ndarray):
    with wave.open(path, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(RATE)
        w.writeframes(audio.tobytes())


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--list", action="store_true")
    ap.add_argument("--device", type=int, default=0)
    ap.add_argument("--seconds", type=float, default=5)
    ap.add_argument("--save")
    ap.add_argument("--meter", action="store_true")
    a = ap.parse_args()
    if a.list:
        for i, n in list_devices():
            print(f"[{i}] {n}")
        return
    if a.meter:
        try:
            for c in stream(a.device):
                lvl = dbfs(c)
                print(f"\r{lvl:6.1f} dBFS " + "#" * max(0, int((lvl + 70) / 2)) + " " * 40, end="", flush=True)
        except KeyboardInterrupt:
            print()
        return
    print(f"recording {a.seconds:g} s from device {a.device} ... speak now", flush=True)
    audio = record(a.seconds, a.device)
    w = RATE // 10
    levels = [dbfs(audio[i:i + w]) for i in range(0, len(audio) - w + 1, w)]
    print(f"{len(audio) / RATE:.1f} s  peak {dbfs(np.array([np.abs(audio).max()])):.1f} dBFS  "
          f"loudest 100 ms {max(levels):.1f} dBFS  quietest {min(levels):.1f} dBFS  "
          f"clipping: {'yes' if np.abs(audio).max() >= 32760 else 'no'}")
    if a.save:
        save_wav(a.save, audio)
        print(f"saved {a.save}")


if __name__ == "__main__":
    sys.exit(main())
