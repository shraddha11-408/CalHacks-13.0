"""Measure how far the picture lags the sound in a recording, using claps.

  .venv/bin/python record.py --seconds 10 --out clap.mp4      # clap 3 times with your hands in view
  .venv/bin/python sync_check.py clap.mp4

Prints, per clap, video minus audio in seconds (positive: the picture is late) and the
--av-offset to use next time. A clap is the loudest sound and the biggest motion in a window, so
keep the room quiet and nothing else moving. Accuracy is about 0.07 s (video frames are 67 ms apart).
"""
import json
import subprocess
import sys
import tempfile
import wave
from pathlib import Path

import cv2
import numpy as np


def _peaks(t, e, k, gap=0.6):
    out = []
    for i in np.argsort(e)[::-1]:
        if all(abs(t[i] - t[j]) > gap for j in out):
            out.append(i)
        if len(out) == k:
            break
    return sorted(float(t[i]) for i in out)


def offsets(path, claps=3):
    """[video_peak - audio_peak] for each of the `claps` strongest events, in seconds."""
    cap = cv2.VideoCapture(str(path))
    prev, vt, vm = None, [], []
    while True:
        ok, f = cap.read()
        if not ok:
            break
        g = cv2.cvtColor(f, cv2.COLOR_BGR2GRAY).astype(np.float32)
        if prev is not None:
            vt.append(cap.get(cv2.CAP_PROP_POS_MSEC) / 1000)
            vm.append(np.abs(g - prev).mean())
        prev = g
    with tempfile.TemporaryDirectory() as d:
        wav = Path(d) / "a.wav"
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(path), "-vn", "-ac", "1", "-ar", "16000", str(wav)], check=True)
        w = wave.open(str(wav))
        a = np.frombuffer(w.readframes(w.getnframes()), np.int16).astype(np.float32)
    n = 320  # 20 ms
    at = np.arange(len(a) // n) * n / 16000
    ae = np.array([np.sqrt(np.mean(a[i * n:(i + 1) * n] ** 2)) for i in range(len(a) // n)])
    v, au = _peaks(np.array(vt), np.array(vm), claps), _peaks(at, ae, claps)
    return [round(x - y, 3) for x, y in zip(v, au)]


def main():
    path = Path(sys.argv[1])
    d = offsets(path)
    used = 0.0
    side = path.with_suffix(".json")
    if side.exists():
        used = json.loads(side.read_text()).get("av_offset_s") or 0.0
    print("video minus audio per clap (s):", d)
    print(f"mean {np.mean(d):+.2f} s with --av-offset {used:g}  ->  use --av-offset {used + np.mean(d):.2f}")


if __name__ == "__main__":
    main()
