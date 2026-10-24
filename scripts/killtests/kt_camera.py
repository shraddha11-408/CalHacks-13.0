"""Kill-test 1: laptop webcam frames into Python.

Pass: frames arrive at >= 10 fps at 640x480 and are not black.
The Pi 5 + OV5647 stream replaces this later (devices.camera in config.yaml).
"""
import time

import cv2
import numpy as np
import yaml

from common import OUT, ROOT, record

cfg = yaml.safe_load((ROOT / "config.yaml").read_text())["devices"]
t = {}

t0 = time.perf_counter()
cap = cv2.VideoCapture(cfg["webcam_index"], cv2.CAP_AVFOUNDATION)
cap.set(cv2.CAP_PROP_FRAME_WIDTH, cfg["frame_size"][0])
cap.set(cv2.CAP_PROP_FRAME_HEIGHT, cfg["frame_size"][1])
if not cap.isOpened():
    raise SystemExit(record("camera", "fail", "Webcam did not open. Check System Settings → Privacy & Security → Camera."))

ok, frame = cap.read()
t["open_to_first_frame"] = (time.perf_counter() - t0) * 1000
if not ok:
    raise SystemExit(record("camera", "fail", "Webcam opened but returned no frame (camera permission?)", t))

# Let auto-exposure settle, then time 60 frames
for _ in range(15):
    cap.read()
n, t1 = 60, time.perf_counter()
for _ in range(n):
    ok, frame = cap.read()
elapsed = time.perf_counter() - t1
cap.release()
fps = n / elapsed
t["per_frame"] = elapsed / n * 1000

h, w = frame.shape[:2]
brightness = float(np.mean(frame))
cv2.imwrite(str(OUT / "camera_frame.jpg"), frame)  # gitignored; may contain a face

detail = f"{w}x{h} at {fps:.1f} fps, mean brightness {brightness:.0f}/255"
if brightness < 8:
    raise SystemExit(record("camera", "fail", detail + " — frame is black", t))
if fps < 10:
    raise SystemExit(record("camera", "partial", detail + " — below 10 fps", t, {"fps": fps}))
raise SystemExit(record("camera", "pass", detail, t, {"fps": round(fps, 1), "width": w, "height": h}))
