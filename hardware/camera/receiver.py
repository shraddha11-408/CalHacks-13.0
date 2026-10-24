"""Laptop side: read the Pi's MJPEG stream, report fps / jitter / decode time.

  python3 receiver.py http://<pi-ip>:8000/stream            # stats only
  python3 receiver.py http://<pi-ip>:8000/stream --show     # preview window (q to quit)
"""
import argparse
import http.client
import statistics
import time
from urllib.parse import urlparse

import cv2
import numpy as np


def iter_jpegs(url: str, timeout: float = 5.0):
    """Yield (jpeg_bytes, arrival_monotonic) from a multipart/x-mixed-replace stream."""
    u = urlparse(url)
    conn = http.client.HTTPConnection(u.hostname, u.port or 80, timeout=timeout)
    conn.request("GET", u.path or "/")
    resp = conn.getresponse()
    if resp.status != 200:
        raise ConnectionError(f"HTTP {resp.status}")
    try:
        while True:
            length = None
            while True:  # part headers, ended by a blank line
                line = resp.fp.readline()
                if not line:
                    raise ConnectionError("stream closed")
                line = line.strip()
                if not line:
                    if length is not None:
                        break
                    continue  # blank line before boundary
                if line.lower().startswith(b"content-length:"):
                    length = int(line.split(b":")[1])
            data = resp.fp.read(length)
            if len(data) != length:
                raise ConnectionError("truncated frame")
            yield data, time.monotonic()
    finally:
        conn.close()


def decode(jpeg: bytes):
    return cv2.imdecode(np.frombuffer(jpeg, np.uint8), cv2.IMREAD_COLOR)


def pct(xs, p):
    xs = sorted(xs)
    return xs[min(len(xs) - 1, int(len(xs) * p))]


def run(url, duration=None, max_frames=None, show=False):
    arrivals, decode_ms, sizes, shape = [], [], [], None
    t0 = time.monotonic()
    for jpeg, t in iter_jpegs(url):
        t_dec = time.monotonic()
        img = decode(jpeg)
        decode_ms.append((time.monotonic() - t_dec) * 1000)
        if img is None:
            raise ValueError("frame failed to decode")
        shape = img.shape
        arrivals.append(t)
        sizes.append(len(jpeg))
        if show:
            cv2.imshow("stepwise camera", img)
            if cv2.waitKey(1) & 0xFF == ord("q"):
                break
        if max_frames and len(arrivals) >= max_frames:
            break
        if duration and time.monotonic() - t0 >= duration:
            break
    if show:
        cv2.destroyAllWindows()
    gaps = [(b - a) * 1000 for a, b in zip(arrivals, arrivals[1:])]
    span = arrivals[-1] - arrivals[0] if len(arrivals) > 1 else 0
    return {
        "frames": len(arrivals),
        "shape": shape,
        "fps": (len(arrivals) - 1) / span if span else 0.0,
        "gap_ms_p50": statistics.median(gaps) if gaps else 0.0,
        "gap_ms_p99": pct(gaps, 0.99) if gaps else 0.0,
        "decode_ms_p50": statistics.median(decode_ms),
        "kb_per_frame": statistics.mean(sizes) / 1024,
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("url")
    ap.add_argument("--duration", type=float, default=10.0)
    ap.add_argument("--show", action="store_true")
    args = ap.parse_args()
    while True:
        try:
            s = run(args.url, duration=None if args.show else args.duration, show=args.show)
            break
        except (ConnectionError, OSError) as e:
            print(f"connect failed ({e}); retrying in 2 s")
            time.sleep(2)
    print(f"{s['frames']} frames {s['shape']}  {s['fps']:.1f} fps  "
          f"gap p50/p99 {s['gap_ms_p50']:.0f}/{s['gap_ms_p99']:.0f} ms  "
          f"decode p50 {s['decode_ms_p50']:.1f} ms  {s['kb_per_frame']:.0f} KB/frame")


if __name__ == "__main__":
    main()
